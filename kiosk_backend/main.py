import os
import io
import secrets
import uuid
import json
import time
import shutil
import asyncio
import logging
import threading
import requests
import mimetypes
import subprocess
import zipfile
import socket
import ipaddress
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional
from urllib.parse import quote, urlparse

from fastapi import (
    FastAPI,
    Request,
    UploadFile,
    File,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    BackgroundTasks,
    Depends,
    Header,
    Form,
)
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from kiosk_backend.config import settings, log_startup_configuration
from kiosk_backend.database import (
    init_db,
    create_session_record,
    get_session_record,
    update_session_record,
    record_uploaded_file,
    get_session_file,
    create_transaction_record,
    update_transaction_record,
    get_latest_transaction_record,
    get_latest_transaction_record,
    get_latest_pending_gcash_transaction,
    get_db_connection,
    mark_gcash_transaction_paid,
    create_print_job_record,
    update_print_job_record,
)
from kiosk_backend.models import (
    SessionCreateResponse,
    PrintOptionsRequest,
    GCashPaymentCreateRequest,
    CashPaymentStartRequest,
    PrintJobStartRequest,
)
from kiosk_backend.hardware import get_hardware
from kiosk_backend.system_monitor import SystemStatusMonitor
from kiosk_backend.pricing import compute_pixel_pricing
from kiosk_backend.printing import build_software_print_queue, execute_print_job, feed_paper_and_settle
from kiosk_backend.payments import (
    check_internet_connectivity,
    PayMongoService,
    send_telegram_audit_notification,
)

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
)
logger = logging.getLogger("kiosk.server")

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Self-service print kiosk backend for Raspberry Pi OS.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections per session: {session_id: [WebSocket, ...]}
active_websockets: Dict[str, List[WebSocket]] = {}
websocket_last_seen: Dict[str, float] = {}
ws_lock = threading.Lock()
bluetooth_observer: Optional[Observer] = None
obexpush_process: Optional[subprocess.Popen] = None
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".docx", ".jpg", ".jpeg", ".png"}
system_status_monitor: Optional[SystemStatusMonitor] = None
app_event_loop: Optional[asyncio.AbstractEventLoop] = None
operating_settings_path = Path(__file__).resolve().parent / "settings.json"
operating_settings_lock = threading.Lock()
DEFAULT_OPERATING_SETTINGS = {
    "gcash_start_time": "07:00",
    "gcash_end_time": "20:30",
}


def read_operating_settings() -> Dict[str, str]:
    with operating_settings_lock:
        try:
            with operating_settings_path.open("r", encoding="utf-8") as settings_file:
                saved_settings = json.load(settings_file)
            if not isinstance(saved_settings, dict):
                raise ValueError("Settings file must contain a JSON object.")
            return {
                key: saved_settings.get(key, default)
                for key, default in DEFAULT_OPERATING_SETTINGS.items()
            }
        except FileNotFoundError:
            return DEFAULT_OPERATING_SETTINGS.copy()
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            logger.error("Could not read kiosk operating settings: %s", exc)
            return DEFAULT_OPERATING_SETTINGS.copy()


def write_operating_settings(settings_data: Dict[str, str]) -> Dict[str, str]:
    operating_settings_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = operating_settings_path.with_suffix(".json.tmp")
    with operating_settings_lock:
        with temporary_path.open("w", encoding="utf-8") as settings_file:
            json.dump(settings_data, settings_file, indent=2)
            settings_file.write("\n")
        os.replace(temporary_path, operating_settings_path)
    return settings_data.copy()


def forward_system_monitor_event(event: Dict[str, Any]):
    """Forward status from the monitor thread without blocking the API event loop."""
    if not settings.GCASH_CONFIRM_TOKEN:
        return
    try:
        requests.post(
            settings.GCASH_CONFIRM_STATUS_URL,
            json=event,
            headers={"X-GCash-Confirm-Token": settings.GCASH_CONFIRM_TOKEN},
            timeout=1.5,
        ).raise_for_status()
    except requests.RequestException as exc:
        logger.debug("Unable to forward system status to operator app: %s", exc)


def forward_hopper_event_to_operator(event_type: str, data: Dict[str, Any]):
    if not settings.GCASH_CONFIRM_TOKEN:
        return
    try:
        requests.post(
            settings.GCASH_CONFIRM_STATUS_URL,
            json={"type": "hopper_event", "data": {"event": event_type, **data}},
            headers={"X-GCash-Confirm-Token": settings.GCASH_CONFIRM_TOKEN},
            timeout=1.5,
        ).raise_for_status()
    except requests.RequestException as exc:
        logger.debug("Unable to forward hopper event to operator app: %s", exc)


def forward_hardware_status_to_operator(data: Dict[str, Any]):
    """Push board state transitions to the operator SSE stream immediately."""
    cached = system_status_monitor.get_status() if system_status_monitor else {}
    components = dict(cached.get("components") or {})
    alerts = [
        alert for alert in cached.get("critical_alerts", [])
        if alert.get("id") not in {"acceptor", "actuator"}
    ]

    for key, label in (("acceptor", "Acceptor Arduino 1"), ("actuator", "Actuator Arduino 2")):
        board = data.get(f"{key}_board") or {}
        connected = board.get("connected") is True
        components[key] = {
            **components.get(key, {}),
            "name": label,
            "status": "Connected" if connected else "Disconnected",
            "connected": connected,
            "port": board.get("port", "Unknown"),
            "details": "Heartbeat responding" if connected else "Serial link offline; retrying",
        }
        if not connected:
            alerts.append({
                "id": key,
                "message": f"{label} is offline. Reconnecting to its serial port.",
            })

    if "printer" not in components:
        components["printer"] = {
            "name": f"Epson L121 ({settings.CUPS_PRINTER_NAME})",
            "status": "Unknown",
            "connected": False,
            "details": "Waiting for CUPS status query",
        }

    event = {
        "type": "system_status",
        "data": {
            **cached,
            "components": components,
            "critical_alerts": alerts,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    threading.Thread(
        target=forward_system_monitor_event,
        args=(event,),
        name="operator-hardware-status-forwarder",
        daemon=True,
    ).start()

    for alert in alerts:
        if alert.get("id") in {"acceptor", "actuator"} and not (data.get(f"{alert['id']}_board") or {}).get("connected"):
            threading.Thread(
                target=forward_system_monitor_event,
                args=({
                    "type": "critical_alert",
                    "data": {
                        **alert,
                        "severity": "critical",
                        "timestamp": event["data"]["checked_at"],
                    },
                },),
                name="operator-hardware-alert-forwarder",
                daemon=True,
            ).start()


async def broadcast_to_session(session_id: str, event_type: str, data: Dict[str, Any]):
    """Dispatches real-time WebSocket events to all clients on this session."""
    payload = json.dumps({"event": event_type, "data": data, "timestamp": time.time()})
    with ws_lock:
        targets = list(active_websockets.get(session_id, []))

    for ws in targets:
        try:
            await ws.send_text(payload)
        except Exception:
            pass


def sync_broadcast_to_session(session_id: str, event_type: str, data: Dict[str, Any]):
    """Thread-safe synchronous wrapper for background hardware callbacks."""
    loop = app_event_loop
    if loop is None or not loop.is_running():
        logger.debug("Skipping %s broadcast: application event loop is unavailable", event_type)
        return
    try:
        asyncio.run_coroutine_threadsafe(
            broadcast_to_session(session_id, event_type, data),
            loop,
        )
    except RuntimeError:
        logger.debug("Broadcast dispatch note for %s", event_type, exc_info=True)


def latest_connected_session() -> Optional[str]:
    with ws_lock:
        connected_sessions = [session_id for session_id, sockets in active_websockets.items() if sockets]
        if not connected_sessions:
            return None
        return max(connected_sessions, key=lambda session_id: websocket_last_seen.get(session_id, 0))


def is_valid_upload_file(file_path: Path) -> bool:
    extension = file_path.suffix.lower()
    if extension not in ALLOWED_UPLOAD_EXTENSIONS or file_path.is_symlink() or not file_path.is_file():
        return False
    try:
        with file_path.open("rb") as source:
            signature = source.read(8)
        if extension == ".pdf":
            return signature.startswith(b"%PDF-")
        if extension in {".jpg", ".jpeg"}:
            return signature.startswith(b"\xff\xd8\xff")
        if extension == ".png":
            return signature.startswith(b"\x89PNG\r\n\x1a\n")
        if extension == ".docx":
            with zipfile.ZipFile(file_path) as archive:
                return "word/document.xml" in archive.namelist()
    except (OSError, zipfile.BadZipFile):
        return False
    return False


def _process_bluetooth_file(source_path: Path):
    try:
        for _ in range(10):
            if not source_path.exists():
                return
            initial_size = source_path.stat().st_size
            time.sleep(0.5)
            if source_path.exists() and source_path.stat().st_size == initial_size and initial_size > 0:
                break
        else:
            logger.warning("Bluetooth upload did not finish writing: %s", source_path.name)
            return

        if source_path.suffix.lower() not in ALLOWED_UPLOAD_EXTENSIONS or not is_valid_upload_file(source_path):
            logger.warning("Deleting unsupported or invalid Bluetooth upload: %s", source_path.name)
            source_path.unlink(missing_ok=True)
            return

        session_id = latest_connected_session()
        if not session_id:
            logger.warning("No active kiosk session; leaving Bluetooth file in receive folder: %s", source_path.name)
            return

        if not get_session_record(session_id):
            create_session_record(session_id, ttl_minutes=settings.HOTSPOT_FILE_TTL_MINUTES)
        session_dir = (settings.UPLOAD_DIR.resolve() / session_id).resolve()
        upload_root = settings.UPLOAD_DIR.resolve()
        if session_dir.parent != upload_root:
            logger.error("Refusing Bluetooth upload to unsafe session path for %s", session_id)
            return
        session_dir.mkdir(parents=True, exist_ok=True)

        safe_filename = "".join(
            character for character in source_path.name if character.isalnum() or character in "._- "
        ).strip() or f"bluetooth_upload{source_path.suffix.lower()}"
        destination = session_dir / f"bluetooth_{time.time_ns()}_{safe_filename}"
        shutil.move(str(source_path), destination)
        file_size = destination.stat().st_size
        mime_type = mimetypes.guess_type(destination.name)[0] or "application/octet-stream"
        file_id = str(uuid.uuid4())
        record_uploaded_file(
            file_id=file_id,
            session_id=session_id,
            original_filename=safe_filename,
            sanitized_filename=safe_filename,
            stored_path=str(destination),
            file_size_bytes=file_size,
            mime_type=mime_type,
            page_count=1,
            upload_method="bluetooth",
        )
        update_session_record(session_id, status="uploaded")
        sync_broadcast_to_session(session_id, "FILE_RECEIVED", {
            "session_id": session_id,
            "file_id": file_id,
            "filename": safe_filename,
            "file_url": f"/api/session/{session_id}/file",
            "file_size": file_size,
            "upload_method": "bluetooth",
        })
        logger.info("Accepted Bluetooth upload for session %s: %s", session_id, safe_filename)
    except FileNotFoundError:
        return
    except Exception:
        logger.exception("Bluetooth upload processing failed for %s", source_path)


class BluetoothUploadHandler(FileSystemEventHandler):
    def on_created(self, event: FileSystemEvent):
        if not event.is_directory:
            threading.Thread(target=_process_bluetooth_file, args=(Path(event.src_path),), daemon=True).start()

    def on_moved(self, event: FileSystemEvent):
        if not event.is_directory:
            threading.Thread(target=_process_bluetooth_file, args=(Path(event.dest_path),), daemon=True).start()


# ---------------------------------------------------------------------------
# Hardware Event Wire-Up
# ---------------------------------------------------------------------------
active_cash_session: Optional[str] = None
dispense_state_lock = threading.Lock()
active_dispense_state: Optional[Dict[str, Any]] = None
completed_dispenses: Dict[str, Dict[str, Any]] = {}
file_deletion_timers: Dict[str, threading.Timer] = {}
file_deletion_timers_lock = threading.Lock()


def handle_hardware_event(event_type: str, data: Dict[str, Any]):
    """Global hardware listener forwarding pulses and status to active sessions."""
    global active_cash_session, active_dispense_state
    logger.info(f"[HARDWARE EVENT] {event_type} -> {data}")

    # Broadcast hardware status changes to all active sessions
    if event_type == "hardware_status":
        with ws_lock:
            for s_id in list(active_websockets.keys()):
                sync_broadcast_to_session(s_id, "hardware_status", data)
        forward_hardware_status_to_operator(data)

    elif event_type in {"dispense_done", "dispense_coins_done", "hopper_error", "hopper_ack"}:
        session_id = None
        progress = None
        with dispense_state_lock:
            state = active_dispense_state
            if state:
                session_id = state["session_id"]
                if event_type == "dispense_coins_done":
                    delivered = max(0, int(data.get("coins") or 0))
                    state["remaining_5"] = max(0, state["remaining_5"] - delivered)
                    state["dispensed_5"] += delivered
                elif event_type == "dispense_done":
                    state["done_received"] = True
                elif event_type == "hopper_ack" and data.get("delivery") == "SENSOR":
                    denomination = str(data.get("denomination") or "")
                    if denomination == "1" and state["remaining_1"] > 0:
                        state["remaining_1"] -= 1
                        state["dispensed_1"] += 1
                elif event_type == "hopper_error":
                    state["error"] = "Arduino reported HOPPER_ERROR before all change was confirmed."

                if state["done_received"] and state["remaining_5"] == 0 and state["remaining_1"] == 0:
                    state["done"].set()
                if state["error"]:
                    state["done"].set()
                progress = {
                    "session_id": session_id,
                    "dispensed_5": state["dispensed_5"],
                    "dispensed_1": state["dispensed_1"],
                    "remaining_5": state["remaining_5"],
                    "remaining_1": state["remaining_1"],
                    "error": state["error"],
                }

        if event_type != "hopper_ack" or data.get("delivery") != "TIMED":
            event_data = {**data, "session_id": session_id or active_cash_session}
            if event_type in {"dispense_done", "dispense_coins_done"} and progress:
                event_type_to_send = "dispense_progress"
                event_data = {**progress, "serial_event": event_type}
            elif event_type == "hopper_ack" and data.get("delivery") == "SENSOR" and progress:
                event_type_to_send = "dispense_progress"
                event_data = {**progress, "serial_event": event_type}
            else:
                event_type_to_send = event_type
            if event_data.get("session_id"):
                sync_broadcast_to_session(event_data["session_id"], event_type_to_send, event_data)
            threading.Thread(
                target=forward_hopper_event_to_operator,
                args=(event_type_to_send, event_data),
                name="operator-hopper-event-forwarder",
                daemon=True,
            ).start()

    # Process coin and bill pulses if a cash session is waiting
    elif event_type in ["coin_inserted", "bill_inserted"] and active_cash_session:
        denom = data.get("denomination", 0)
        session = get_session_record(active_cash_session)
        if not session:
            return

        current_paid = float(session.get("paid_amount") or 0.0)
        total_due = float(session.get("total_amount") or 0.0)
        new_paid = current_paid + denom

        # Safety Check: Enforce max payable amount against coin hopper limits
        if new_paid > settings.MAX_PAYABLE_AMOUNT:
            logger.warning(f"Payment exceeded max payable limit (₱{settings.MAX_PAYABLE_AMOUNT}).")
            sync_broadcast_to_session(
                active_cash_session,
                "cash_limit_exceeded",
                {"max_limit": settings.MAX_PAYABLE_AMOUNT, "inserted": new_paid},
            )
            return

        update_session_record(active_cash_session, paid_amount=new_paid)

        # Notify frontend of updated balance
        sync_broadcast_to_session(
            active_cash_session,
            "balance_update",
            {
                "session_id": active_cash_session,
                "inserted_denomination": denom,
                "pulse_type": event_type,
                "total_paid": new_paid,
                "amount_due": total_due,
                "remaining_due": max(0.0, total_due - new_paid),
            },
        )

        # Check if payment is fully satisfied
        if new_paid >= total_due and total_due > 0:
            change_owed = round(new_paid - total_due, 2)
            hw = get_hardware()
            hw.disable_acceptors()

            # Record completed transaction
            tx_id = f"tx_cash_{uuid.uuid4().hex[:12]}"
            create_transaction_record(
                transaction_id=tx_id,
                session_id=active_cash_session,
                payment_method="cash",
                amount_due=total_due,
                amount_paid=new_paid,
                status="paid",
            )
            update_transaction_record(
                transaction_id=tx_id,
                change_dispensed=0.0,
                change_coins_5=0,
                change_coins_1=0,
            )
            update_session_record(active_cash_session, status="paid")

            sync_broadcast_to_session(
                active_cash_session,
                "payment_confirmed",
                {
                    "session_id": active_cash_session,
                    "method": "cash",
                    "amount_paid": new_paid,
                    "amount_due": total_due,
                    "change_dispensed": 0,
                    "change_due": change_owed,
                    "change_pending": change_owed > 0,
                },
            )

            # Send Telegram audit log
            send_telegram_audit_notification(
                session_id=active_cash_session,
                amount_paid=new_paid,
                payment_method="cash",
                page_count=session.get("copies", 1),
                paper_size=session.get("paper_size", "A4"),
                color_mode=session.get("color_mode", "bw"),
            )


# Initialize hardware listeners
get_hardware().register_event_listener(handle_hardware_event)


# ---------------------------------------------------------------------------
# Lifecycle Startup & Periodic Cleanup Task
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    global app_event_loop, system_status_monitor, bluetooth_observer
    app_event_loop = asyncio.get_running_loop()
    log_startup_configuration()
    init_db()

    settings.BLUETOOTH_RECEIVE_DIR.mkdir(parents=True, exist_ok=True)
    bluetooth_observer = Observer()
    bluetooth_observer.schedule(BluetoothUploadHandler(), str(settings.BLUETOOTH_RECEIVE_DIR), recursive=False)
    bluetooth_observer.start()

    system_status_monitor = SystemStatusMonitor(
        hardware=get_hardware(),
        on_update=forward_system_monitor_event,
        interval_seconds=settings.SYSTEM_STATUS_INTERVAL_SECONDS,
    )
    system_status_monitor.start()

    # Periodic background worker to cleanup stale uploaded files (TTL)
    def _cleanup_worker():
        while True:
            time.sleep(120)  # Check every 2 minutes
            try:
                now = time.time()
                ttl_seconds = settings.HOTSPOT_FILE_TTL_MINUTES * 60
                if settings.UPLOAD_DIR.exists():
                    for session_dir in settings.UPLOAD_DIR.iterdir():
                        if session_dir.is_dir():
                            mtime = session_dir.stat().st_mtime
                            if now - mtime > ttl_seconds:
                                logger.info(f"[TTL CLEANUP] Deleting expired session dir: {session_dir.name}")
                                shutil.rmtree(session_dir, ignore_errors=True)
            except Exception as e:
                logger.error(f"Error in TTL cleanup thread: {e}")

    threading.Thread(target=_cleanup_worker, daemon=True).start()


@app.on_event("shutdown")
def on_shutdown():
    global app_event_loop, bluetooth_observer, obexpush_process
    if system_status_monitor:
        system_status_monitor.stop()
    if bluetooth_observer:
        bluetooth_observer.stop()
        bluetooth_observer.join(timeout=5)
        bluetooth_observer = None
    if obexpush_process and obexpush_process.poll() is None:
        obexpush_process.terminate()
        try:
            obexpush_process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            obexpush_process.kill()
        obexpush_process = None
    app_event_loop = None


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
def get_health():
    """Lightweight endpoint for kiosk and companion-app connectivity checks."""
    return {"status": "ok"}


@app.get("/api/settings")
def get_operating_settings():
    return read_operating_settings()


def detect_lan_ipv4() -> Optional[str]:
    candidates: List[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 80))
            routed_address = probe.getsockname()[0]
            routed_ip = ipaddress.ip_address(routed_address)
            if routed_ip.is_private and not routed_ip.is_loopback and not routed_ip.is_link_local:
                return routed_address
    except (OSError, ValueError):
        pass

    try:
        import fcntl
        import struct

        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            for interface_index, interface_name in socket.if_nameindex():
                if interface_name == "lo" or interface_name.startswith(("docker", "br-", "veth", "virbr", "tun", "tap")):
                    continue
                request = struct.pack("256s", interface_name[:15].encode("utf-8"))
                try:
                    result = fcntl.ioctl(probe.fileno(), 0x8915, request)
                    candidates.append(socket.inet_ntoa(result[20:24]))
                except OSError:
                    continue
    except (ImportError, OSError, AttributeError):
        pass

    if not candidates:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.connect(("192.0.2.1", 80))
                candidates.append(probe.getsockname()[0])
        except OSError:
            pass

    private_candidates = []
    for address in candidates:
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError:
            continue
        if parsed.version != 4 or parsed.is_loopback or parsed.is_link_local or not parsed.is_private:
            continue
        if address.startswith("172.17.") or address.startswith("172.18."):
            continue
        private_candidates.append(address)

    if not private_candidates:
        return None
    return sorted(
        set(private_candidates),
        key=lambda address: (
            0 if address.startswith("192.168.") else 1 if address.startswith("10.") else 2,
            address,
        ),
    )[0]


@app.get("/api/kiosk/upload-origin")
def get_kiosk_upload_origin(request: Request):
    lan_address = detect_lan_ipv4()
    if not lan_address:
        raise HTTPException(status_code=503, detail="No private LAN IPv4 address is available for QR uploads.")

    referer = urlparse(request.headers.get("referer", ""))
    frontend_port = referer.port or (
        443 if referer.scheme == "https" else 80 if referer.scheme == "http" else 4173
    )
    origin = f"http://{lan_address}:{frontend_port}"
    return {"origin": origin, "ip": lan_address, "port": frontend_port}


@app.post("/api/settings")
def update_operating_settings(payload: Dict[str, str]):
    current_settings = read_operating_settings()
    updated_settings = current_settings.copy()
    for key in DEFAULT_OPERATING_SETTINGS:
        if key in payload:
            value = payload[key]
            try:
                datetime.strptime(value, "%H:%M")
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{key} must use 24-hour HH:MM format.")
            if len(value) != 5:
                raise HTTPException(status_code=400, detail=f"{key} must use 24-hour HH:MM format.")
            updated_settings[key] = value

    if not any(key in payload for key in DEFAULT_OPERATING_SETTINGS):
        raise HTTPException(status_code=400, detail="At least one GCash operating time is required.")

    return write_operating_settings(updated_settings)


@app.get("/api/system/status")
def get_system_status():
    """Returns real-time health for internet, hardware, and printer queues."""
    internet_ok = check_internet_connectivity()
    hw_status = get_hardware().get_status()
    monitor_status = system_status_monitor.get_status() if system_status_monitor else None
    return {
        "status": "online",
        "internet_connected": internet_ok,
        "hardware": hw_status,
        "system_status": monitor_status,
        "cups_printer": settings.CUPS_PRINTER_NAME,
        "max_payable_amount": settings.MAX_PAYABLE_AMOUNT,
        "hopper_denominations": [1, 5],
        "pricing_rates": {
            "base_bw": settings.BASE_PRICE_BW,
            "base_color": settings.BASE_PRICE_COLOR,
        },
    }


@app.post("/api/sessions/create", response_model=SessionCreateResponse)
def create_session():
    """Generates a secure, isolated session ID and directory sandbox."""
    session_id = str(uuid.uuid4())
    create_session_record(session_id, ttl_minutes=settings.HOTSPOT_FILE_TTL_MINUTES)

    session_dir = settings.UPLOAD_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"Created session sandbox: {session_id}")
    return SessionCreateResponse(
        session_id=session_id,
        created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        status="active",
        upload_url=f"/api/upload/{session_id}",
    )


def validate_upload_content(filename: str, content: bytes) -> tuple[str, str]:
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Accepted formats: PDF, DOCX, JPG, JPEG, and PNG.")
    if extension == ".pdf" and not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="The uploaded PDF signature is invalid.")
    if extension in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=400, detail="The uploaded JPEG signature is invalid.")
    if extension == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=400, detail="The uploaded PNG signature is invalid.")
    if extension == ".docx":
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if "word/document.xml" not in archive.namelist():
                    raise HTTPException(status_code=400, detail="The uploaded DOCX document is invalid.")
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=400, detail="The uploaded DOCX document is invalid.") from exc
    return extension, mimetypes.guess_type(filename)[0] or "application/octet-stream"


async def _save_session_upload(session_id: str, file: UploadFile, upload_method: str = "qr"):
    if not session_id or len(session_id) > 128 or any(
        not (character.isalnum() or character in "_-") for character in session_id
    ):
        raise HTTPException(status_code=400, detail="Invalid session ID.")

    original_name = Path(file.filename or "document").name
    content = await file.read(50 * 1024 * 1024 + 1)
    if not content or len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File is empty or exceeds the 50MB limit.")
    extension, mime_type = validate_upload_content(original_name, content)
    sanitized_name = "".join(character for character in original_name if character.isalnum() or character in "._- ").strip()
    if not sanitized_name:
        sanitized_name = f"document{extension}"

    if not get_session_record(session_id):
        create_session_record(session_id, ttl_minutes=settings.HOTSPOT_FILE_TTL_MINUTES)
    upload_root = settings.UPLOAD_DIR.resolve()
    session_dir = (upload_root / session_id).resolve()
    if session_dir.parent != upload_root:
        raise HTTPException(status_code=400, detail="Invalid upload session directory.")
    session_dir.mkdir(parents=True, exist_ok=True)
    destination_path = session_dir / f"upload_{time.time_ns()}{extension}"
    destination_path.write_bytes(content)

    page_count = 1
    if extension == ".pdf":
        page_count = max(1, content.count(b"/Type /Page") - content.count(b"/Type /Pages"))

    file_id = str(uuid.uuid4())
    record_uploaded_file(
        file_id=file_id,
        session_id=session_id,
        original_filename=original_name,
        sanitized_filename=sanitized_name,
        stored_path=str(destination_path),
        file_size_bytes=len(content),
        mime_type=mime_type,
        page_count=page_count,
        upload_method=upload_method,
    )
    update_session_record(session_id, status="uploaded")
    file_url = f"/api/session/{session_id}/file"
    await broadcast_to_session(session_id, "FILE_RECEIVED", {
        "session_id": session_id,
        "file_id": file_id,
        "filename": sanitized_name,
        "file_url": file_url,
        "file_size": len(content),
        "page_count": page_count,
        "upload_method": upload_method,
    })
    logger.info("Received %s upload for session %s: %s", upload_method, session_id, sanitized_name)
    return {
        "success": True,
        "session_id": session_id,
        "file_id": file_id,
        "filename": sanitized_name,
        "file_url": file_url,
        "page_count": page_count,
        "size_bytes": len(content),
    }


@app.post("/api/upload/{session_id}")
async def upload_file(session_id: str, file: UploadFile = File(...)):
    return await _save_session_upload(session_id, file, "qr")


@app.post("/api/upload")
async def upload_file_with_session(session_id: str = Form(...), file: UploadFile = File(...)):
    return await _save_session_upload(session_id, file, "qr")


@app.get("/api/recent_uploads")
def list_recent_uploads():
    upload_root = settings.UPLOAD_DIR.resolve()
    expiry = time.time() - settings.HOTSPOT_FILE_TTL_MINUTES * 60
    files = []
    with get_db_connection() as connection:
        records = connection.execute(
            "SELECT original_filename, sanitized_filename, stored_path, file_size_bytes FROM uploaded_files ORDER BY created_at DESC"
        ).fetchall()
    for record in records:
        try:
            resolved = Path(record["stored_path"]).resolve(strict=True)
            if not resolved.is_file() or upload_root not in resolved.parents:
                continue
            if resolved.suffix.lower() not in ALLOWED_UPLOAD_EXTENSIONS:
                continue
            stat = resolved.stat()
            if stat.st_mtime < expiry:
                continue
            relative_path = resolved.relative_to(upload_root).as_posix()
            files.append({
                "name": record["sanitized_filename"] or record["original_filename"],
                "url": f"/api/recent_uploads/file?path={quote(relative_path)}",
                "size": stat.st_size,
                "modified": stat.st_mtime,
            })
        except (OSError, RuntimeError):
            continue
    files.sort(key=lambda item: item["modified"], reverse=True)
    return {"files": files}


@app.get("/api/recent_uploads/file")
def get_recent_upload(path: str):
    upload_root = settings.UPLOAD_DIR.resolve()
    candidate = (upload_root / path).resolve()
    if upload_root not in candidate.parents or not candidate.is_file():
        raise HTTPException(status_code=404, detail="Recent file not found.")
    if candidate.suffix.lower() not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported file type.")
    media_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
    return FileResponse(candidate, media_type=media_type, filename=candidate.name)


@app.post("/api/bluetooth/enable")
def enable_bluetooth_discoverability():
    global obexpush_process
    try:
        for command in (
            ["bluetoothctl", "power", "on"],
            ["bluetoothctl", "system-alias", "PrintPoint-Kiosk"],
            ["bluetoothctl", "pairable", "on"],
            ["bluetoothctl", "discoverable", "on"],
        ):
            result = subprocess.run(command, capture_output=True, text=True, timeout=8, check=False)
            if result.returncode != 0:
                detail = result.stderr.strip() or result.stdout.strip() or "Bluetooth command failed."
                raise HTTPException(status_code=503, detail=detail)
        if obexpush_process is None or obexpush_process.poll() is not None:
            settings.BLUETOOTH_RECEIVE_DIR.mkdir(parents=True, exist_ok=True)
            obexpush_process = subprocess.Popen(
                ["obexpushd", "-B", "-n", "-o", str(settings.BLUETOOTH_RECEIVE_DIR)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="bluetoothctl is not installed on this kiosk.") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Bluetooth setup timed out.") from exc
    return {"success": True, "device_name": "PrintPoint-Kiosk"}


@app.post("/api/privacy/store/{session_id}")
async def store_privacy_document(session_id: str, file: UploadFile = File(...)):
    """Persist the print source in the session sandbox for the receipt privacy choice."""
    if not session_id or len(session_id) > 128 or any(
        not (character.isalnum() or character in "_-") for character in session_id
    ):
        raise HTTPException(status_code=400, detail="Invalid session ID.")

    content = await file.read()
    if not content or len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Document is empty or exceeds 50MB.")
    if content.startswith(b"%PDF-"):
        extension, mime_type = ".pdf", "application/pdf"
    elif content.startswith(b"\x89PNG\r\n\x1a\n"):
        extension, mime_type = ".png", "image/png"
    elif content.startswith(b"\xff\xd8\xff"):
        extension, mime_type = ".jpg", "image/jpeg"
    else:
        raise HTTPException(status_code=415, detail="Only PDF, PNG, and JPEG documents are supported.")

    session = get_session_record(session_id)
    if session is None:
        create_session_record(session_id, ttl_minutes=settings.HOTSPOT_FILE_TTL_MINUTES)

    upload_root = settings.UPLOAD_DIR.resolve()
    upload_root.mkdir(parents=True, exist_ok=True)
    session_dir = (upload_root / session_id).resolve()
    if session_dir.parent != upload_root:
        raise HTTPException(status_code=400, detail="Invalid upload session directory.")
    session_dir.mkdir(parents=True, exist_ok=True)

    for existing_file in session_dir.glob("source_document.*"):
        if existing_file.is_file() and existing_file.resolve().parent == session_dir:
            os.remove(existing_file)
    destination_path = session_dir / f"source_document{extension}"
    destination_path.write_bytes(content)
    safe_name = "".join(character for character in (file.filename or "document") if character.isalnum() or character in "._- ").strip()
    record_uploaded_file(
        file_id=str(uuid.uuid4()),
        session_id=session_id,
        original_filename=file.filename or "document",
        sanitized_filename=safe_name or "document",
        stored_path=str(destination_path),
        file_size_bytes=len(content),
        mime_type=mime_type,
        page_count=0,
        upload_method="print_privacy",
    )
    update_session_record(session_id, status="uploaded")
    return {"success": True, "session_id": session_id, "stored": True}


def delete_session_uploads(session_id: str) -> int:
    """Remove regular files only from the validated upload sandbox for one session."""
    upload_root = settings.UPLOAD_DIR.resolve()
    session_dir = (upload_root / session_id).resolve()
    if session_dir.parent != upload_root:
        raise ValueError("Session upload directory escaped the upload root.")
    if not session_dir.is_dir():
        return 0

    deleted_count = 0
    for stored_file in session_dir.iterdir():
        if stored_file.is_file() and stored_file.resolve().parent == session_dir:
            os.remove(stored_file)
            deleted_count += 1
    try:
        session_dir.rmdir()
    except OSError:
        pass
    return deleted_count


@app.delete("/api/session/{session_id}/file")
def delete_session_file_upload(session_id: str):
    try:
        deleted_count = delete_session_uploads(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid session ID.") from exc
    return {"success": True, "deleted": deleted_count > 0}


def _delete_session_uploads_after_keep(session_id: str):
    try:
        deleted_count = delete_session_uploads(session_id)
        logger.info("[PRIVACY TTL] Deleted %s file(s) for session %s", deleted_count, session_id)
    except Exception:
        logger.exception("[PRIVACY TTL] Could not delete files for session %s", session_id)
    finally:
        with file_deletion_timers_lock:
            file_deletion_timers.pop(session_id, None)


@app.post("/api/privacy/{session_id}")
def choose_file_privacy(session_id: str, payload: Dict[str, Any]):
    """Delete now or schedule deletion 30 minutes after the receipt choice."""
    if not session_id or len(session_id) > 128 or any(
        not (character.isalnum() or character in "_-") for character in session_id
    ):
        raise HTTPException(status_code=400, detail="Invalid session ID.")
    session = get_session_record(session_id)
    if not session or session.get("status") != "completed":
        raise HTTPException(status_code=409, detail="File privacy choices are available after transaction completion.")

    action = payload.get("action")
    if action not in {"delete", "keep"}:
        raise HTTPException(status_code=400, detail="Action must be 'delete' or 'keep'.")

    with file_deletion_timers_lock:
        previous_timer = file_deletion_timers.pop(session_id, None)
        if previous_timer:
            previous_timer.cancel()

        if action == "delete":
            deleted_count = delete_session_uploads(session_id)
            return {"success": True, "deleted": deleted_count > 0}

        file_record = get_session_file(session_id)
        if not file_record:
            raise HTTPException(status_code=404, detail="No stored document exists for this session.")
        stored_path = Path(file_record["stored_path"]).resolve()
        session_dir = (settings.UPLOAD_DIR.resolve() / session_id).resolve()
        if stored_path.parent != session_dir or not stored_path.is_file():
            raise HTTPException(status_code=404, detail="The stored document is no longer available.")

        os.utime(stored_path, None)
        os.utime(session_dir, None)
        delete_timer = threading.Timer(1800, _delete_session_uploads_after_keep, args=(session_id,))
        delete_timer.daemon = True
        file_deletion_timers[session_id] = delete_timer
        delete_timer.start()

    return {"success": True, "scheduled": True, "delete_at": time.time() + 1800}


@app.get("/api/upload/usb/scan")
def scan_usb_drives():
    """
    Scans for mounted USB flash drives, listing found PDF files.
    Treated as untrusted input.
    """
    found_pdfs = []
    # Candidate mount directories on Linux / Pi
    search_roots = [Path("/media"), Path("/mnt")]

    for root in search_roots:
        if root.exists():
            try:
                for pdf_file in root.rglob("*.pdf"):
                    # Validate read-only access and safe path
                    if pdf_file.is_file() and pdf_file.stat().st_size <= 50 * 1024 * 1024:
                        found_pdfs.append({
                            "name": pdf_file.name,
                            "path": str(pdf_file),
                            "size": pdf_file.stat().st_size,
                        })
            except Exception:
                pass

    return {"drives_detected": True, "files": found_pdfs}


@app.post("/api/upload/usb/{session_id}")
async def import_from_usb(session_id: str, payload: Dict[str, str]):
    """Copies selected PDF from USB drive into session-scoped sandbox."""
    usb_path_str = payload.get("path", "")
    session_dir = settings.UPLOAD_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    destination = session_dir / "usb_imported_document.pdf"

    src = Path(usb_path_str)
    if not src.exists():
        raise HTTPException(status_code=404, detail="File on USB drive not accessible.")
    shutil.copyfile(src, destination)
    page_count = 3

    file_id = str(uuid.uuid4())
    record_uploaded_file(
        file_id=file_id,
        session_id=session_id,
        original_filename=Path(usb_path_str).name,
        sanitized_filename="usb_document.pdf",
        stored_path=str(destination),
        file_size_bytes=destination.stat().st_size,
        mime_type="application/pdf",
        page_count=page_count,
        upload_method="usb",
    )
    update_session_record(session_id, status="uploaded")

    await broadcast_to_session(
        session_id,
        "file_uploaded",
        {
            "filename": Path(usb_path_str).name,
            "page_count": page_count,
            "file_size": destination.stat().st_size,
        },
    )
    return {"success": True, "page_count": page_count}


@app.get("/api/session/{session_id}/file")
def get_pdf_for_preview(session_id: str):
    """Streams the current session document for client-side preview."""
    file_record = get_session_file(session_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="No document found for this session.")

    upload_root = settings.UPLOAD_DIR.resolve()
    session_dir = (upload_root / session_id).resolve()
    stored_path = Path(file_record["stored_path"]).resolve()
    if session_dir.parent != upload_root or stored_path.parent != session_dir or not stored_path.is_file():
        raise HTTPException(status_code=404, detail="Underlying document file missing.")

    media_type = file_record.get("mime_type") or mimetypes.guess_type(stored_path.name)[0] or "application/octet-stream"
    return FileResponse(path=stored_path, media_type=media_type, filename=file_record["sanitized_filename"])


@app.post("/api/pricing/quote")
async def calculate_document_quote(
    document: UploadFile = File(...),
    selectedPages: str = Form("[1]"),
    paperSize: str = Form("A4"),
    colorMode: str = Form("bw"),
    copies: int = Form(1),
    reverseOrder: bool = Form(False),
    collate: bool = Form(True),
):
    """Compute an exact pixel-based quote without consulting hardware state."""
    if copies < 1 or copies > 50:
        raise HTTPException(status_code=400, detail="Copies must be between 1 and 50.")
    if paperSize.upper() not in {"A4", "LETTER", "LONG"}:
        raise HTTPException(status_code=400, detail="Unsupported paper size.")
    if colorMode.lower() not in {"bw", "color"}:
        raise HTTPException(status_code=400, detail="Unsupported print mode.")
    try:
        page_numbers = json.loads(selectedPages)
        if not isinstance(page_numbers, list) or not page_numbers:
            raise ValueError("At least one page must be selected.")
        page_numbers = sorted({int(page) for page in page_numbers})
        if any(page < 1 for page in page_numbers):
            raise ValueError("Page numbers must be positive.")
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Selected pages must be a JSON list of positive page numbers.") from exc

    filename = Path(document.filename or "document.pdf").name
    content = await document.read(50 * 1024 * 1024 + 1)
    if not content or len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Document is empty or exceeds the 50MB limit.")
    extension, _ = validate_upload_content(filename, content)

    with tempfile.TemporaryDirectory(prefix="kiosk_quote_") as temp_directory:
        temp_path = Path(temp_directory)
        pdf_path = temp_path / "quote.pdf"
        if extension == ".pdf":
            pdf_path.write_bytes(content)
        elif extension in {".jpg", ".jpeg", ".png"}:
            try:
                from PIL import Image

                with Image.open(io.BytesIO(content)) as image:
                    image.convert("RGB").save(pdf_path, "PDF", resolution=settings.RASTER_DPI)
            except Exception as exc:
                raise HTTPException(status_code=400, detail="Could not convert the image for pricing.") from exc
        elif extension == ".docx":
            source_path = temp_path / filename
            source_path.write_bytes(content)
            converter = shutil.which("libreoffice") or shutil.which("soffice")
            if not converter:
                raise HTTPException(status_code=503, detail="DOCX pricing conversion is unavailable on this kiosk.")
            try:
                conversion = subprocess.run(
                    [converter, "--headless", "--convert-to", "pdf", "--outdir", str(temp_path), str(source_path)],
                    capture_output=True,
                    text=True,
                    timeout=45,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise HTTPException(status_code=503, detail="DOCX pricing conversion is unavailable.") from exc
            generated_pdf = temp_path / f"{source_path.stem}.pdf"
            if conversion.returncode != 0 or not generated_pdf.is_file():
                raise HTTPException(status_code=422, detail="Could not convert this DOCX document for pricing.")
            generated_pdf.replace(pdf_path)

        try:
            pricing_result = compute_pixel_pricing(
                pdf_path=pdf_path,
                selected_pages=page_numbers,
                color_mode=colorMode.lower(),
                paper_size=paperSize.upper(),
                copies=copies,
                reverse_order=reverseOrder,
                collate=collate,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Pixel-based pricing failed")
            raise HTTPException(status_code=422, detail="Could not calculate pixel pricing for this document.") from exc

    queue = build_software_print_queue(page_numbers, copies, reverseOrder, collate)
    tray_names = {"A4": "TRAY_1_A4", "LETTER": "TRAY_2_LETTER", "LONG": "TRAY_3_LONG"}
    queue_sequence = [{
        "page_number": item["page_number"],
        "copy_number": item["copy_number"],
        "sheet_index": item["sequence_index"],
        "paper_size": paperSize.upper(),
        "tray_motor": tray_names[paperSize.upper()],
        "color_mode": colorMode.lower(),
    } for item in queue]
    return {
        **pricing_result,
        "queue_sequence": queue_sequence,
    }


@app.post("/api/pricing/{session_id}")
def calculate_authoritative_price(session_id: str, req: PrintOptionsRequest):
    """
    Session-bound pricing using the same software-only PyMuPDF/OpenCV pixel algorithm.
    """
    file_record = get_session_file(session_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="No document uploaded for this session.")

    pdf_path = Path(file_record["stored_path"])
    try:
        pricing_result = compute_pixel_pricing(
            pdf_path=pdf_path,
            selected_pages=req.selected_pages,
            color_mode=req.color_mode,
            paper_size=req.paper_size,
            copies=req.copies,
            reverse_order=req.reverse_order,
            collate=req.collate,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Pixel-based session pricing failed")
        raise HTTPException(status_code=422, detail="Could not calculate pixel pricing for this document.") from exc

    # Save calculated options and authoritative price into session record
    print_queue = build_software_print_queue(
        selected_pages=req.selected_pages,
        copies=req.copies,
        reverse_order=req.reverse_order,
        collate=req.collate,
    )

    update_session_record(
        session_id,
        total_amount=pricing_result["total_price"],
        paper_size=req.paper_size,
        color_mode=req.color_mode,
        copies=req.copies,
        reverse_order=1 if req.reverse_order else 0,
        collate=1 if req.collate else 0,
        print_queue_json=json.dumps(print_queue),
    )

    return {"session_id": session_id, **pricing_result}


@app.post("/api/payments/gcash/create")
def create_gcash_payment(req: GCashPaymentCreateRequest):
    """Generates PayMongo GCash QR code for the exact computed total."""
    session = get_session_record(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    total_amount = float(session.get("total_amount") or 0.0)
    if total_amount <= 0:
        raise HTTPException(status_code=400, detail="Session has zero balance due.")

    result = PayMongoService.create_gcash_source_or_intent(
        amount_peso=total_amount,
        session_id=req.session_id,
    )

    if not result.get("success"):
        raise HTTPException(status_code=503, detail=result.get("error", "Payment creation failed."))

    transaction_id = f"tx_gcash_{uuid.uuid4().hex[:12]}"
    create_transaction_record(
        transaction_id=transaction_id,
        session_id=req.session_id,
        payment_method="gcash",
        amount_due=total_amount,
        amount_paid=0,
        paymongo_id=result.get("payment_id"),
        status="pending",
    )

    return result


@app.post("/api/payments/gcash/confirm")
async def confirm_gcash_payment(
    payload: Dict[str, Any],
    confirmation_token: Optional[str] = Header(default=None, alias="X-GCash-Confirm-Token"),
):
    """
    Webhook / Poll confirmation endpoint for GCash payments.
    Immediately transitions to printing and sends owner Telegram notification.
    """
    if not settings.GCASH_CONFIRM_TOKEN:
        raise HTTPException(status_code=503, detail="Manual GCash confirmation is not configured.")
    if not confirmation_token or not secrets.compare_digest(confirmation_token, settings.GCASH_CONFIRM_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid GCash confirmation credentials.")

    session_id = payload.get("session_id")
    if not isinstance(session_id, str) or not session_id.strip():
        raise HTTPException(status_code=400, detail="A valid session_id is required.")
    session = get_session_record(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session.get("status") != "active":
        raise HTTPException(status_code=409, detail="This kiosk session is not awaiting payment.")

    total_amount = float(session.get("total_amount") or 0.0)
    if total_amount <= 0:
        raise HTTPException(status_code=400, detail="Session has zero balance due.")
    pending_transaction = get_latest_pending_gcash_transaction(session_id)
    if not pending_transaction:
        raise HTTPException(status_code=409, detail="No pending GCash payment exists for this session.")
    if not mark_gcash_transaction_paid(pending_transaction["transaction_id"], total_amount):
        raise HTTPException(status_code=409, detail="This GCash payment has already been confirmed.")
    tx_id = pending_transaction["transaction_id"]

    update_session_record(session_id, status="paid", paid_amount=total_amount)

    await broadcast_to_session(
        session_id,
        "payment_confirmed",
        {
            "session_id": session_id,
            "method": "gcash",
            "amount_paid": total_amount,
            "amount_due": total_amount,
            "change_dispensed": 0,
        },
    )

    # Owner Telegram notification
    send_telegram_audit_notification(
        session_id=session_id,
        amount_paid=total_amount,
        payment_method="gcash",
        page_count=session.get("copies", 1),
        paper_size=session.get("paper_size", "A4"),
        color_mode=session.get("color_mode", "bw"),
    )

    return {"success": True, "transaction_id": tx_id}


@app.post("/api/payments/cash/start")
def start_cash_payment(req: CashPaymentStartRequest):
    """
    Wakes the bill acceptor (TB74) and coin acceptor (Allan 1239A).
    Enforces hardware connectivity safety constraint.
    """
    global active_cash_session
    hw = get_hardware()

    if not hw.is_connected():
        raise HTTPException(
            status_code=503,
            detail="Microcontroller disconnected. Cash payment unavailable.",
        )

    if req.amount_due is None:
        raise HTTPException(status_code=400, detail="Amount due is required to start cash payment.")

    if get_session_record(req.session_id) is None:
        create_session_record(req.session_id, ttl_minutes=settings.HOTSPOT_FILE_TTL_MINUTES)
    update_session_record(req.session_id, total_amount=req.amount_due)

    active_cash_session = req.session_id
    success = hw.enable_acceptors()
    if not success:
        raise HTTPException(status_code=500, detail="Failed to wake acceptors.")

    logger.info(f"Cash payment started for session {req.session_id}. Acceptors active.")
    return {
        "success": True,
        "session_id": req.session_id,
        "max_payable_amount": settings.MAX_PAYABLE_AMOUNT,
        "hoppers": "₱1 and ₱5 coins only",
    }


@app.post("/api/payments/cash/cancel")
def cancel_cash_payment(req: CashPaymentStartRequest):
    """Disables acceptors on user cancel."""
    global active_cash_session
    hw = get_hardware()
    hw.disable_acceptors()
    active_cash_session = None
    logger.info(f"Cash payment cancelled for session {req.session_id}.")
    return {"success": True, "cancelled": True}


@app.post("/api/payments/sync-confirmed")
def sync_confirmed_payment(
    payload: Dict[str, Any],
    confirmation_token: Optional[str] = Header(default=None, alias="X-GCash-Confirm-Token"),
):
    """Synchronize Express's verified payment record into the hardware backend."""
    if not settings.GCASH_CONFIRM_TOKEN:
        raise HTTPException(status_code=503, detail="Payment synchronization is not configured.")
    if not confirmation_token or not secrets.compare_digest(confirmation_token, settings.GCASH_CONFIRM_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid payment synchronization credentials.")

    session_id = payload.get("session_id")
    method = str(payload.get("method") or "cash").lower()
    try:
        amount_due = float(payload.get("amount_due"))
        amount_paid = float(payload.get("amount_paid"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Valid due and paid amounts are required.")
    if not isinstance(session_id, str) or not session_id.strip():
        raise HTTPException(status_code=400, detail="A valid session_id is required.")
    if method not in {"cash", "bill", "coin", "gcash"} or amount_due <= 0 or amount_paid < amount_due:
        raise HTTPException(status_code=400, detail="Verified payment details are invalid.")

    session = get_session_record(session_id)
    if session is None:
        create_session_record(session_id, ttl_minutes=settings.HOTSPOT_FILE_TTL_MINUTES)
        session = get_session_record(session_id) or {}
    if session.get("status") == "completed":
        return {"success": True, "session_id": session_id, "already_completed": True}

    update_session_record(session_id, total_amount=amount_due, paid_amount=amount_paid, status="paid")
    transaction = get_latest_transaction_record(session_id)
    if transaction is None:
        create_transaction_record(
            transaction_id=f"tx_sync_{uuid.uuid4().hex[:12]}",
            session_id=session_id,
            payment_method="cash" if method in {"bill", "coin"} else method,
            amount_due=amount_due,
            amount_paid=amount_paid,
            status="paid",
        )
    elif transaction.get("status") != "paid":
        update_transaction_record(transaction_id=transaction["transaction_id"], amount_due=amount_due, amount_paid=amount_paid, status="paid")
    return {"success": True, "session_id": session_id, "status": "paid"}


@app.post("/api/print/finalize")
def finalize_completed_print(payload: Dict[str, Any]):
    """Called only after CUPS reports the submitted print request completed."""
    session_id = payload.get("session_id")
    if not isinstance(session_id, str) or not session_id.strip():
        raise HTTPException(status_code=400, detail="A valid session_id is required.")
    return finalize_print_and_change(session_id)


def finalize_print_and_change(session_id: str) -> Dict[str, Any]:
    """Wait for physical change delivery before completing/resetting a paid session."""
    global active_cash_session, active_dispense_state
    session = get_session_record(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session.get("status") == "completed":
        return {"success": True, "session_id": session_id, "already_completed": True}
    if session.get("status") not in {"paid", "dispensing_change"}:
        raise HTTPException(status_code=409, detail="Payment is not confirmed for this print session.")

    paid_amount = float(session.get("paid_amount") or 0.0)
    print_cost = float(session.get("total_amount") or 0.0)
    change_due = max(0, int(round(paid_amount - print_cost)))
    coins_5, coins_1 = divmod(change_due, 5)

    with dispense_state_lock:
        if session_id in completed_dispenses:
            return completed_dispenses[session_id]
        if active_dispense_state:
            detail = (
                "Change payout for this session is already in progress."
                if active_dispense_state["session_id"] == session_id
                else "Another change payout is already in progress."
            )
            raise HTTPException(status_code=409, detail=detail)
        else:
            state = {
                "session_id": session_id,
                "remaining_5": coins_5,
                "remaining_1": coins_1,
                "dispensed_5": 0,
                "dispensed_1": 0,
                "error": None,
                "done_received": change_due == 0,
                "done": threading.Event(),
            }
            active_dispense_state = state
            if change_due == 0:
                state["done"].set()

    if change_due:
        update_session_record(session_id, status="dispensing_change")
        sync_broadcast_to_session(
            session_id,
            "dispensing_change",
            {
                "session_id": session_id,
                "change_due": change_due,
                "coins_5": coins_5,
                "coins_1": coins_1,
                "message": "Dispensing your change...",
            },
        )
        threading.Thread(
            target=forward_hopper_event_to_operator,
            args=("dispensing_change", {"session_id": session_id, "change_due": change_due}),
            name="operator-change-start-forwarder",
            daemon=True,
        ).start()

        hw = get_hardware()
        queued = hw.dispense_change(change_due)
        if not queued.get("success"):
            with dispense_state_lock:
                state["error"] = "Unable to queue all change coins on the actuator."
                state["done"].set()

        timeout_seconds = max(20, min(900, change_due * 5 + 10))
        state["done"].wait(timeout_seconds)
        with dispense_state_lock:
            if not state["error"] and (state["remaining_5"] or state["remaining_1"]):
                state["error"] = "Timed out waiting for the actuator to confirm every change coin."
            error = state["error"]
            dispensed_5 = state["dispensed_5"]
            dispensed_1 = state["dispensed_1"]
            active_dispense_state = None

        if error:
            update_session_record(session_id, status="dispense_error")
            failure = {
                "session_id": session_id,
                "message": error,
                "change_due": change_due,
                "dispensed_5": dispensed_5,
                "dispensed_1": dispensed_1,
            }
            sync_broadcast_to_session(session_id, "change_dispense_failed", failure)
            threading.Thread(
                target=forward_hopper_event_to_operator,
                args=("change_dispense_failed", failure),
                name="operator-change-failure-forwarder",
                daemon=True,
            ).start()
            raise HTTPException(status_code=503, detail=error)
    else:
        dispensed_5 = 0
        dispensed_1 = 0

    transaction = get_latest_transaction_record(session_id)
    if transaction:
        update_transaction_record(
            transaction_id=transaction["transaction_id"],
            change_dispensed=float(dispensed_5 * 5 + dispensed_1),
            change_coins_5=dispensed_5,
            change_coins_1=dispensed_1,
        )

    update_session_record(session_id, status="completed", paid_amount=0.0, total_amount=0.0)
    if active_cash_session == session_id:
        active_cash_session = None
    result = {
        "success": True,
        "session_id": session_id,
        "total_cost": print_cost,
        "amount_paid": paid_amount,
        "change_due": change_due,
        "change_dispensed": dispensed_5 * 5 + dispensed_1,
        "change_coins_5": dispensed_5,
        "change_coins_1": dispensed_1,
    }
    with dispense_state_lock:
        if active_dispense_state and active_dispense_state["session_id"] == session_id:
            active_dispense_state = None
        completed_dispenses[session_id] = result
        if len(completed_dispenses) > 500:
            completed_dispenses.pop(next(iter(completed_dispenses)))
    sync_broadcast_to_session(session_id, "TRANSACTION_COMPLETE", result)
    sync_broadcast_to_session(session_id, "session_reset", result)
    threading.Thread(
        target=forward_hopper_event_to_operator,
        args=("session_reset", result),
        name="operator-session-reset-forwarder",
        daemon=True,
    ).start()
    return result


@app.post("/api/hardware/feed")
async def feed_hardware_paper(
    payload: Dict[str, Any],
    request: Request,
    confirmation_token: Optional[str] = Header(default=None, alias="X-GCash-Confirm-Token"),
):
    if settings.GCASH_CONFIRM_TOKEN:
        if not confirmation_token or not secrets.compare_digest(confirmation_token, settings.GCASH_CONFIRM_TOKEN):
            raise HTTPException(status_code=401, detail="Invalid hardware feed credentials.")
    elif not request.client or request.client.host not in {"127.0.0.1", "::1", "testclient"}:
        raise HTTPException(status_code=503, detail="Hardware feed authorization is not configured for remote callers.")

    tray = payload.get("tray")
    if not isinstance(tray, str) or tray.strip().upper() not in {"A4", "LETTER", "LONG"}:
        raise HTTPException(status_code=400, detail="A valid paper tray is required.")

    tray_name = tray.strip().upper()
    if not await asyncio.to_thread(feed_paper_and_settle, tray_name):
        raise HTTPException(status_code=503, detail=f"The {tray_name} paper feed did not complete.")
    return {"success": True, "tray": tray_name, "settle_seconds": 5}


@app.post("/api/print/start")
async def start_print_job(req: PrintJobStartRequest, background_tasks: BackgroundTasks):
    """
    Iterates the software print queue page-by-page.
    Feeds paper from NEMA17 tray motor, then sends to printer.
    """
    session = get_session_record(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    file_record = get_session_file(req.session_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="No document found for printing.")

    queue_json = session.get("print_queue_json")
    print_queue = json.loads(queue_json) if queue_json else []
    if not print_queue:
        raise HTTPException(status_code=400, detail="Print queue is empty.")

    job_id = f"job_{uuid.uuid4().hex[:10]}"
    create_print_job_record(
        job_id=job_id,
        session_id=req.session_id,
        paper_size=session.get("paper_size", "A4"),
        color_mode=session.get("color_mode", "bw"),
        copies=session.get("copies", 1),
        reverse_order=session.get("reverse_order", 0),
        collate=session.get("collate", 1),
        queue_pages_json=json.dumps(print_queue),
        total_pages=len(print_queue),
    )

    pdf_path = Path(file_record["stored_path"])

    def _execute_job_thread():
        def _progress(current: int, total: int, item: Dict[str, Any]):
            sync_broadcast_to_session(
                req.session_id,
                "print_progress",
                {
                    "job_id": job_id,
                    "current_page": current,
                    "total_pages": total,
                    "percent": int((current / total) * 100),
                    "page_number": item["page_number"],
                    "copy_number": item["copy_number"],
                },
            )

        print_ok = execute_print_job(
            pdf_path=pdf_path,
            print_queue=print_queue,
            paper_size=session.get("paper_size", "A4"),
            color_mode=session.get("color_mode", "bw"),
            progress_callback=_progress,
        )

        if not print_ok:
            update_print_job_record(job_id=job_id, status="failed")
            sync_broadcast_to_session(req.session_id, "print_failed", {"job_id": job_id})
            return

        update_print_job_record(
            job_id=job_id,
            status="completed",
            completed_pages=len(print_queue),
            completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        try:
            payout = finalize_print_and_change(req.session_id)
        except HTTPException as exc:
            logger.error("Print completed for %s but change finalization failed: %s", req.session_id, exc.detail)
            return

        sync_broadcast_to_session(
            req.session_id,
            "print_completed",
            {
                "job_id": job_id,
                "total_printed": len(print_queue),
                "timestamp": time.time(),
                **payout,
            },
        )

    threading.Thread(target=_execute_job_thread, daemon=True).start()

    return {
        "success": True,
        "job_id": job_id,
        "total_sheets": len(print_queue),
        "status": "printing",
    }


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Real-Time WebSocket Endpoint
# ---------------------------------------------------------------------------
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    with ws_lock:
        if session_id not in active_websockets:
            active_websockets[session_id] = []
        active_websockets[session_id].append(websocket)
        websocket_last_seen[session_id] = time.time()

    logger.info(f"WebSocket client connected for session {session_id}")

    # Send initial state snapshot
    await websocket.send_text(
        json.dumps({
            "event": "connection_ack",
            "data": {
                "session_id": session_id,
                "hardware": get_hardware().get_status(),
                "internet_connected": check_internet_connectivity(),
            },
        })
    )

    latest_file = get_session_file(session_id)
    if latest_file:
        latest_path = Path(latest_file["stored_path"])
        if latest_path.is_file():
            await websocket.send_text(json.dumps({
                "event": "FILE_RECEIVED",
                "data": {
                    "session_id": session_id,
                    "file_id": latest_file["file_id"],
                    "filename": latest_file["sanitized_filename"],
                    "file_url": f"/api/session/{session_id}/file",
                    "file_size": latest_file["file_size_bytes"],
                    "upload_method": latest_file["upload_method"],
                },
                "timestamp": time.time(),
            }))

    try:
        while True:
            # Handle incoming client ping/messages
            data = await websocket.receive_text()
            try:
                parsed = json.loads(data)
                action = parsed.get("action")
                if action == "ping":
                    await websocket.send_text(json.dumps({"event": "pong", "timestamp": time.time()}))
            except Exception:
                pass
    except WebSocketDisconnect:
        with ws_lock:
            if session_id in active_websockets and websocket in active_websockets[session_id]:
                active_websockets[session_id].remove(websocket)
                if not active_websockets[session_id]:
                    del active_websockets[session_id]
                    websocket_last_seen.pop(session_id, None)
        logger.info(f"WebSocket client disconnected for session {session_id}")


# ---------------------------------------------------------------------------
# Mount Static Frontend (Vanilla HTML/CSS/JS - No build step)
# ---------------------------------------------------------------------------
static_dir = Path("./static")
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

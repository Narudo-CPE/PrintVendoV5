import logging
import platform
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Set

from kiosk_backend.config import settings

logger = logging.getLogger("kiosk.system_monitor")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def poll_printer_status(printer_name: str = settings.CUPS_PRINTER_NAME) -> Dict[str, Any]:
    """Query CUPS with bounded subprocess calls; intended for a background worker."""
    if platform.system().lower() != "linux":
        return {
            "status": "Unavailable",
            "connected": False,
            "details": "CUPS monitoring is available on Raspberry Pi / Linux.",
        }

    try:
        printer_result = subprocess.run(
            ["lpstat", "-p", printer_name, "-l"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except FileNotFoundError:
        return {"status": "Unavailable", "connected": False, "details": "lpstat is not installed."}
    except subprocess.TimeoutExpired:
        return {"status": "Offline", "connected": False, "details": "CUPS query timed out."}
    except OSError as exc:
        return {"status": "Offline", "connected": False, "details": str(exc)}

    output = "\n".join(part for part in (printer_result.stdout, printer_result.stderr) if part).strip()
    normalized = re.sub(r"[^a-z0-9]+", " ", output.lower()).strip()
    if printer_result.returncode != 0 or not output:
        return {"status": "Offline", "connected": False, "details": output or "Printer queue not found."}

    scheduler_result = None
    try:
        scheduler_result = subprocess.run(
            ["lpstat", "-r"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        scheduler = f"{scheduler_result.stdout} {scheduler_result.stderr}".lower()
    except (OSError, subprocess.TimeoutExpired):
        scheduler = ""

    if scheduler_result is not None and (scheduler_result.returncode != 0 or "not running" in scheduler):
        return {"status": "Offline", "connected": False, "details": "CUPS scheduler is not running."}

    if any(term in normalized for term in ("paper jam", "media jam", "media jam warning", "jammed")):
        status = "Paper Jam"
    elif any(term in normalized for term in ("out of paper", "media empty", "media empty warning", "paper empty")):
        status = "Out of Paper"
    elif any(term in normalized for term in ("is not responding", "printer is offline", "not connected", "offline")):
        status = "Offline"
    elif any(term in normalized for term in (" is printing", "printing", " is processing", "processing")):
        status = "Printing"
    elif " idle" in normalized or " is idle" in normalized:
        status = "Idle"
    elif " disabled" in normalized:
        status = "Offline"
    else:
        status = "Online"

    connected = status in {"Online", "Idle", "Printing"}
    return {"status": status, "connected": connected, "details": output[:500]}


class SystemStatusMonitor:
    """Poll both Arduino heartbeat states and CUPS away from the web event loop."""

    def __init__(
        self,
        hardware: Any,
        on_update: Callable[[Dict[str, Any]], None],
        interval_seconds: float = 4.0,
        printer_poller: Callable[[], Dict[str, Any]] = poll_printer_status,
    ):
        self.hardware = hardware
        self.on_update = on_update
        self.interval_seconds = max(1.0, interval_seconds)
        self.printer_poller = printer_poller
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._previous_critical: Set[str] = set()
        self._last_status: Optional[Dict[str, Any]] = None
        self._status_lock = threading.Lock()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="system-status-monitor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)

    def get_status(self) -> Dict[str, Any]:
        with self._status_lock:
            if self._last_status is None:
                return {"components": {}, "critical_alerts": [], "checked_at": None}
            return dict(self._last_status)

    def _collect_status(self) -> Dict[str, Any]:
        now = time.monotonic()
        boards = getattr(self.hardware, "boards", {})
        components: Dict[str, Dict[str, Any]] = {}

        for board_name, display_name in (("acceptor", "Acceptor Arduino 1"), ("actuator", "Actuator Arduino 2")):
            board = boards.get(board_name)
            heartbeat_age = now - board.last_heartbeat if board and board.last_heartbeat else None
            responding = bool(board and board.connected and heartbeat_age is not None and heartbeat_age <= 8.0)
            components[board_name] = {
                "name": display_name,
                "status": "Connected" if responding else "Disconnected",
                "connected": responding,
                "port": board.port if board else "Unknown",
                "details": "Heartbeat responding" if responding else "Serial heartbeat missing",
            }

        try:
            components["printer"] = {"name": f"Epson L121 ({settings.CUPS_PRINTER_NAME})", **self.printer_poller()}
        except Exception as exc:
            logger.exception("Printer status polling failed")
            components["printer"] = {"name": f"Epson L121 ({settings.CUPS_PRINTER_NAME})", "status": "Error", "connected": False, "details": str(exc)}

        critical: list[Dict[str, str]] = []
        for key in ("acceptor", "actuator"):
            if not components[key]["connected"]:
                critical.append({"id": key, "message": f"{components[key]['name']} is disconnected. Check USB and power."})
        if components["printer"]["status"] in {"Paper Jam", "Out of Paper"}:
            critical.append({"id": "printer_" + components["printer"]["status"].lower().replace(" ", "_"), "message": f"Printer {components['printer']['status'].lower()}. Physical attention required."})

        return {"components": components, "critical_alerts": critical, "checked_at": _utc_now()}

    def _emit_update(self, event: Dict[str, Any]) -> None:
        try:
            self.on_update(event)
        except Exception:
            logger.exception("System status event forwarding failed")

    def _run(self) -> None:
        while not self._stop_event.is_set():
            status = self._collect_status()
            current_critical = {alert["id"] for alert in status["critical_alerts"]}
            new_critical = current_critical - self._previous_critical
            self._previous_critical = current_critical
            with self._status_lock:
                self._last_status = status

            self._emit_update({"type": "system_status", "data": status})
            for alert in status["critical_alerts"]:
                if alert["id"] in new_critical:
                    self._emit_update({
                        "type": "critical_alert",
                        "data": {**alert, "severity": "critical", "timestamp": status["checked_at"]},
                    })
            self._stop_event.wait(self.interval_seconds)

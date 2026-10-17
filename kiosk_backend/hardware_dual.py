import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

import serial
from serial import SerialException
from serial.tools import list_ports

from kiosk_backend.config import default_serial_port, settings

logger = logging.getLogger("kiosk.hardware")
SERIAL_RETRY_SECONDS = 1.5
ARDUINO_RESET_SECONDS = 1.8
HANDSHAKE_TIMEOUT_SECONDS = 8.0
MOTOR_FEED_ACK_TIMEOUT_SECONDS = 10.0


@dataclass
class SerialBoard:
    name: str
    port: str
    connected: bool = False
    connection: Any = None
    thread: Optional[threading.Thread] = None
    write_lock: threading.Lock = field(default_factory=threading.Lock)
    state_lock: threading.Lock = field(default_factory=threading.Lock)
    last_heartbeat: float = 0.0
    last_ping: float = 0.0
    last_connect_attempt: float = 0.0
    reconnect_ready_at: float = 0.0
    handshake_deadline: float = 0.0
    handshake_sent: bool = False
    serial_number: Optional[str] = None
    location: Optional[str] = None
    vid: Optional[int] = None
    pid: Optional[int] = None
    receive_buffer: bytearray = field(default_factory=bytearray)
    pending_dispense_5_coins: int = 0


class DualArduinoHardware:
    """Independent non-blocking serial links for acceptor and actuator Arduinos."""

    def __init__(self):
        acceptor_port = settings.ACCEPTOR_SERIAL_PORT or settings.SERIAL_PORT or default_serial_port("acceptor")
        actuator_port = settings.ACTUATOR_SERIAL_PORT or default_serial_port("actuator")
        self.boards = {
            "acceptor": SerialBoard("acceptor", acceptor_port),
            "actuator": SerialBoard("actuator", actuator_port),
        }
        self._listeners: List[Callable[[str, Dict[str, Any]], None]] = []
        self._stop_event = threading.Event()
        self._acceptors_enabled = False
        self._port_resolution_lock = threading.Lock()
        self._motor_feed_lock = threading.Lock()
        self._motor_ack_lock = threading.Lock()
        self._pending_motor_feed: Optional[str] = None
        self._motor_feed_ack = threading.Event()
        logger.info(
            "Initialized dual Arduino links: acceptor=%s actuator=%s at %s baud",
            acceptor_port,
            actuator_port,
            settings.SERIAL_BAUDRATE,
        )

    def register_event_listener(self, callback: Callable[[str, Dict[str, Any]], None]):
        if callback not in self._listeners:
            self._listeners.append(callback)

    def _emit(self, event_type: str, data: Dict[str, Any]):
        for listener in list(self._listeners):
            try:
                listener(event_type, data)
            except Exception:
                logger.exception("Hardware event listener failed")

    def connect(self) -> bool:
        self._stop_event.clear()
        for board in self.boards.values():
            if board.thread is None or not board.thread.is_alive():
                board.thread = threading.Thread(
                    target=self._board_loop,
                    args=(board,),
                    name=f"serial-{board.name}",
                    daemon=True,
                )
                board.thread.start()
        return True

    def disconnect(self) -> None:
        self._stop_event.set()
        self._write("acceptor", "ACCEPTORS:DISABLE")
        for board in self.boards.values():
            self._drop_board_connection(board, "backend shutdown")
        self._acceptors_enabled = False
        self._emit("hardware_status", self.get_status())

    def is_connected(self) -> bool:
        return all(self._board_connected(board) for board in self.boards.values())

    @staticmethod
    def _board_connected(board: SerialBoard) -> bool:
        with board.state_lock:
            return board.connected

    def _set_board_connected(self, board: SerialBoard, connected: bool):
        with board.state_lock:
            if board.connected == connected:
                return
            board.connected = connected
        logger.info("%s Arduino connection changed: connected=%s", board.name, connected)
        self._emit("hardware_status", self.get_status())

    @staticmethod
    def _configured_identity(board_name: str) -> tuple[Optional[str], Optional[int], Optional[int]]:
        prefix = board_name.upper()
        serial_number = getattr(settings, f"{prefix}_SERIAL_NUMBER", "").strip() or None

        def parse_id(value: str) -> Optional[int]:
            if not value:
                return None
            try:
                return int(value, 0)
            except ValueError:
                try:
                    return int(value, 16)
                except ValueError:
                    logger.warning("Invalid %s serial VID/PID value: %s", prefix, value)
                    return None

        vid = parse_id(getattr(settings, f"{prefix}_SERIAL_VID", "").strip())
        pid = parse_id(getattr(settings, f"{prefix}_SERIAL_PID", "").strip())
        return serial_number, vid, pid

    def _resolve_port(self, board: SerialBoard):
        """Prefer configured and remembered USB identities over transient tty names."""
        with self._port_resolution_lock:
            ports = list(list_ports.comports())
            other_ports = {
                other.port
                for other in self.boards.values()
                if other is not board and other.connection is not None
            }
            available = [port for port in ports if port.device not in other_ports]

            configured_serial, configured_vid, configured_pid = self._configured_identity(board.name)

            if board.serial_number:
                matches = [port for port in available if port.serial_number == board.serial_number]
                if len(matches) == 1:
                    return matches[0]
            if board.location:
                matches = [port for port in available if port.location == board.location]
                if len(matches) == 1:
                    return matches[0]

            serial_number = configured_serial or board.serial_number
            vid = configured_vid if configured_vid is not None else board.vid
            pid = configured_pid if configured_pid is not None else board.pid
            matches = [
                port for port in available
                if (serial_number is None or port.serial_number == serial_number)
                and (vid is None or port.vid == vid)
                and (pid is None or port.pid == pid)
            ]
            if len(matches) == 1:
                return matches[0]

            configured = next((port for port in available if port.device == board.port), None)
            if configured:
                return configured

            # If only one unclaimed USB serial device remains, it is unambiguous.
            if len(available) == 1 and available[0].vid is not None:
                return available[0]
            return None

    def _drop_board_connection(self, board: SerialBoard, reason: str) -> None:
        with board.state_lock:
            connection = board.connection
            board.connection = None
            board.handshake_sent = False
            board.reconnect_ready_at = 0.0
            board.last_heartbeat = 0.0
            was_connected = board.connected
        if connection is not None:
            try:
                connection.close()
            except (SerialException, OSError, FileNotFoundError):
                logger.debug("Error closing %s serial port after %s", board.name, reason, exc_info=True)
        if was_connected:
            logger.warning("%s Arduino disconnected: %s", board.name, reason)
        self._set_board_connected(board, False)

    def _open_board(self, board: SerialBoard):
        now = time.monotonic()
        if now - board.last_connect_attempt < SERIAL_RETRY_SECONDS:
            return
        board.last_connect_attempt = now

        try:
            port_info = self._resolve_port(board)
        except (SerialException, OSError, FileNotFoundError) as exc:
            logger.debug("Unable to enumerate serial devices for %s: %s", board.name, exc)
            return
        if port_info is None:
            logger.debug("No matching serial device is currently available for %s", board.name)
            return

        try:
            connection = serial.Serial(
                port=port_info.device,
                baudrate=settings.SERIAL_BAUDRATE,
                timeout=0,
                write_timeout=0,
            )
            with board.state_lock:
                board.port = port_info.device
                board.connection = connection
                board.receive_buffer.clear()
                board.serial_number = port_info.serial_number
                board.location = port_info.location
                board.vid = port_info.vid
                board.pid = port_info.pid
                board.handshake_sent = False
                board.reconnect_ready_at = time.monotonic() + ARDUINO_RESET_SECONDS
                board.handshake_deadline = board.reconnect_ready_at + HANDSHAKE_TIMEOUT_SECONDS
            board.last_ping = 0.0
            logger.info("Opened %s Arduino serial port %s; waiting for boot reset", board.name, board.port)
        except (SerialException, OSError, FileNotFoundError) as exc:
            logger.debug("Unable to open %s Arduino at %s: %s", board.name, port_info.device, exc)

    def _board_loop(self, board: SerialBoard):
        while not self._stop_event.is_set():
            connection = board.connection
            if connection is None:
                self._open_board(board)
                self._stop_event.wait(0.1)
                continue

            try:
                now = time.monotonic()
                if now < board.reconnect_ready_at:
                    self._stop_event.wait(min(0.05, board.reconnect_ready_at - now))
                    continue

                if not board.handshake_sent:
                    command = "ACCEPTORS:ENABLE" if board.name == "acceptor" and self._acceptors_enabled else "PING"
                    self._write(board.name, command)
                    board.handshake_sent = True
                    board.last_ping = time.monotonic()

                waiting = connection.in_waiting
                if waiting:
                    chunk = connection.read(waiting)
                    board.receive_buffer.extend(chunk)
                    while b"\n" in board.receive_buffer:
                        raw_line, _, remainder = board.receive_buffer.partition(b"\n")
                        board.receive_buffer = bytearray(remainder)
                        line = raw_line.decode("utf-8", errors="ignore").strip()
                        if line:
                            self._process_line(board, line)

                now = time.monotonic()
                if board.handshake_sent and not self._board_connected(board) and now > board.handshake_deadline:
                    raise SerialException("serial handshake timed out")
                if self._board_connected(board) and now - board.last_ping >= settings.HEARTBEAT_INTERVAL_SECONDS:
                    self._write(board.name, "PING")
                    board.last_ping = now
                if self._board_connected(board) and now - board.last_heartbeat > 8.0:
                    raise SerialException("serial heartbeat timed out")
            except (SerialException, OSError, FileNotFoundError) as exc:
                logger.warning("%s Arduino serial loop disconnected: %s", board.name, exc)
                self._drop_board_connection(board, str(exc))
                self._stop_event.wait(0.1)
                continue

            self._stop_event.wait(0.02)

    def _write(self, board_name: str, command: str) -> bool:
        board = self.boards[board_name]
        connection = board.connection
        if connection is None:
            return False
        try:
            payload = f"{command.strip()}\n".encode("utf-8")
            with board.write_lock:
                connection.write(payload)
            return True
        except Exception as exc:
            logger.warning("Unable to write to %s Arduino: %s", board_name, exc)
            self._drop_board_connection(board, str(exc))
            return False

    def _process_line(self, board: SerialBoard, line: str):
        logger.debug("Serial In (%s): %s", board.name, line)
        parts = line.split(":")
        header = parts[0].upper()
        if header in {"PONG", "HEARTBEAT", "BOOT"}:
            board.last_heartbeat = time.monotonic()
            self._set_board_connected(board, True)
            return

        if board.name == "acceptor" and header in {"COIN", "BILL"} and len(parts) >= 2:
            try:
                denomination = int(parts[1])
            except ValueError:
                logger.warning("Invalid acceptor serial payload: %s", line)
                return
            event = "coin_inserted" if header == "COIN" else "bill_inserted"
            self._emit(event, {"denomination": denomination, "currency": "PHP"})
        elif board.name == "actuator" and header == "DISPENSE" and len(parts) > 1:
            if parts[1].upper() == "COINS_DONE" and len(parts) > 2:
                try:
                    coin_count = int(parts[2])
                except ValueError:
                    logger.warning("Invalid actuator dispense count: %s", line)
                    return
                self._emit(
                    "dispense_coins_done",
                    {"denomination": 5, "coins": coin_count, "amount": coin_count * 5},
                )
            elif parts[1].upper() == "DONE":
                with board.state_lock:
                    coin_count = board.pending_dispense_5_coins
                    board.pending_dispense_5_coins = 0
                self._emit(
                    "dispense_done",
                    {"denomination": 5, "coins": coin_count, "amount": coin_count * 5},
                )
        elif header == "WARN":
            logger.error("Hardware warning (%s): %s", board.name, ":".join(parts[1:]))
            if board.name == "actuator" and len(parts) > 1 and parts[1].upper() == "HOPPER_ERROR":
                with board.state_lock:
                    coin_count = board.pending_dispense_5_coins
                    board.pending_dispense_5_coins = 0
                self._emit(
                    "hopper_error",
                    {
                        "denomination": 5 if coin_count else None,
                        "coins_requested": coin_count,
                        "reason": "no_coin_sensor_pulse",
                    },
                )
        elif header == "ACK":
            logger.info("Hardware ACK (%s): %s", board.name, line)
            if board.name == "actuator" and len(parts) >= 3 and parts[1].upper() == "MOTOR":
                with self._motor_ack_lock:
                    if self._pending_motor_feed == parts[2].upper():
                        self._motor_feed_ack.set()
            if len(parts) >= 3 and parts[1].upper() == "ACCEPTORS" and parts[2].upper() in {"ENABLED", "DISABLED"}:
                board.last_heartbeat = time.monotonic()
                self._set_board_connected(board, True)
            if len(parts) > 1 and parts[1].upper() == "HOPPER":
                self._emit(
                    "hopper_ack",
                    {
                        "board": board.name,
                        "denomination": parts[2] if len(parts) > 2 else None,
                        "delivery": parts[3] if len(parts) > 3 else "UNKNOWN",
                    },
                )

    def enable_acceptors(self) -> bool:
        self._acceptors_enabled = True
        if not self.boards["acceptor"].connected:
            logger.warning("Acceptor Arduino is disconnected; it will be enabled after reconnection")
            return False
        sent = self._write("acceptor", "ACCEPTORS:ENABLE")
        return sent

    def disable_acceptors(self) -> bool:
        sent = self._write("acceptor", "ACCEPTORS:DISABLE")
        self._acceptors_enabled = False
        return sent

    def feed_paper(self, tray: str) -> bool:
        if not self.boards["actuator"].connected:
            logger.error("Cannot feed %s: actuator Arduino is disconnected", tray)
            return False
        tray_name = tray.strip().upper()
        if tray_name not in {"A4", "LETTER", "LONG"}:
            logger.error("Unknown paper tray: %s", tray)
            return False
        with self._motor_feed_lock:
            with self._motor_ack_lock:
                self._pending_motor_feed = tray_name
                self._motor_feed_ack.clear()
            if not self._write("actuator", f"MOTOR:{tray_name}:FEED"):
                with self._motor_ack_lock:
                    self._pending_motor_feed = None
                return False
            if not self._motor_feed_ack.wait(MOTOR_FEED_ACK_TIMEOUT_SECONDS):
                with self._motor_ack_lock:
                    self._pending_motor_feed = None
                logger.error("Timed out waiting for actuator to finish feeding %s paper", tray_name)
                return False
            with self._motor_ack_lock:
                self._pending_motor_feed = None
            return True

    def dispense_change(self, amount_peso: int) -> Dict[str, Any]:
        if amount_peso <= 0:
            return {
                "5": 0, "1": 0, "dispensed": 0, "queued_5": 0, "queued_1": 0,
                "queued": 0, "unpaid": 0, "success": True,
            }
        if not self.boards["actuator"].connected:
            logger.error("Cannot dispense change: actuator Arduino is disconnected")
            return {
                "5": 0, "1": 0, "dispensed": 0, "queued_5": 0, "queued_1": 0,
                "queued": 0, "unpaid": amount_peso, "success": False,
            }

        coins_5, coins_1 = divmod(int(amount_peso), 5)
        queued_5 = 0
        queued_1 = 0
        if coins_5:
            if self._write("actuator", f"DISPENSE:BATCH:{coins_5}"):
                queued_5 = coins_5
        if queued_5 == coins_5:
            for _ in range(coins_1):
                if not self._write("actuator", "HOPPER:1:DISPENSE"):
                    break
                queued_1 += 1

        completion_marker_sent = False
        if queued_5 == coins_5 and queued_1 == coins_1:
            completion_marker_sent = self._write("actuator", "DISPENSE:END")

        queued_value = queued_5 * 5 + queued_1
        return {
            "5": 0,
            "1": 0,
            "dispensed": 0,
            "queued_5": queued_5,
            "queued_1": queued_1,
            "unpaid": max(0, amount_peso - queued_value),
            "success": queued_value == amount_peso and completion_marker_sent,
            "queued": queued_value,
        }

    def get_status(self) -> Dict[str, Any]:
        acceptor = self.boards["acceptor"]
        actuator = self.boards["actuator"]
        return {
            "mode": "dual_arduino",
            "connected": self.is_connected(),
            "acceptors_enabled": self._acceptors_enabled,
            "acceptor_board": {"connected": self._board_connected(acceptor), "status": "CONNECTED" if self._board_connected(acceptor) else "DISCONNECTED", "port": acceptor.port, "baudrate": settings.SERIAL_BAUDRATE},
            "actuator_board": {"connected": self._board_connected(actuator), "status": "CONNECTED" if self._board_connected(actuator) else "DISCONNECTED", "port": actuator.port, "baudrate": settings.SERIAL_BAUDRATE},
            "hoppers": {"hopper_5": "220V AC", "hopper_1": "220V AC"},
            "trays": ["A4", "LETTER", "LONG"],
        }

import logging
import os
import platform
from pathlib import Path
from pydantic_settings import BaseSettings

logger = logging.getLogger("kiosk.config")
APP_ROOT = Path(__file__).resolve().parent.parent


def detect_host_os() -> str:
    """Return a normalized host OS name for serial and filesystem defaults."""
    system = platform.system().lower()
    if system == "windows":
        return "windows"
    if system == "linux":
        return "linux"
    return system


def default_serial_port(board: str) -> str:
    """Return the conventional default port for one of the two Arduino boards."""
    board_name = board.strip().lower()
    if board_name not in {"acceptor", "actuator"}:
        raise ValueError("board must be 'acceptor' or 'actuator'")
    index = 0 if board_name == "acceptor" else 1
    if detect_host_os() == "windows":
        return f"COM{index + 3}"
    if detect_host_os() == "linux":
        return ("/dev/ttyACM0", "/dev/ttyACM1")[index]
    return ("/dev/ttyACM0", "/dev/ttyACM1")[index]


def resolve_app_path(value: str | Path) -> Path:
    """Resolve configured relative storage paths against the project directory."""
    path = Path(value).expanduser()
    return path if path.is_absolute() else (APP_ROOT / path).resolve()


class Settings(BaseSettings):
    # App General
    APP_NAME: str = "Self-Service Print Kiosk"
    HOST: str = "0.0.0.0"
    PORT: int = 3000
    DEBUG: bool = True

    # CUPS queue configured for the Raspberry Pi's Epson L120 Gutenprint driver
    CUPS_PRINTER_NAME: str = "L120-Series"

    RASTER_DPI: int = 150
    PIXEL_WHITE_THRESHOLD: int = 245  # RGB values above this are considered unprinted white paper

    # Authoritative Pricing Constants (PHP)
    BASE_PRICE_BW: float = 2.00  # Base cost for B&W page
    BASE_PRICE_COLOR: float = 5.00  # Base cost for Color page
    PIXEL_RATE_BW: float = 0.000008  # Additional cost per non-white pixel in B&W
    PIXEL_RATE_COLOR: float = 0.000025  # Additional cost per non-white pixel in Color
    GRAYSCALE_RATE: float = 0.000008
    COLOR_RATE: float = 0.000025

    # Serial Communication (legacy SERIAL_PORT remains an acceptor-port alias)
    SERIAL_PORT: str = ""
    ACCEPTOR_SERIAL_PORT: str = ""
    ACTUATOR_SERIAL_PORT: str = ""
    ACCEPTOR_SERIAL_NUMBER: str = ""
    ACTUATOR_SERIAL_NUMBER: str = ""
    ACCEPTOR_SERIAL_VID: str = ""
    ACCEPTOR_SERIAL_PID: str = ""
    ACTUATOR_SERIAL_VID: str = ""
    ACTUATOR_SERIAL_PID: str = ""
    SERIAL_BAUDRATE: int = 115200
    SERIAL_TIMEOUT: float = 0.0
    HEARTBEAT_INTERVAL_SECONDS: float = 3.0

    # Isolated manual GCash confirmation app
    GCASH_CONFIRM_PASSWORD: str = ""
    GCASH_CONFIRM_TOKEN: str = ""
    GCASH_CONFIRM_HOST: str = "127.0.0.1"
    GCASH_CONFIRM_PORT: int = 8080
    GCASH_CONFIRM_STATUS_URL: str = "http://127.0.0.1:8080/internal/system-status"
    KIOSK_BACKEND_URL: str = "http://127.0.0.1:3000"
    SYSTEM_STATUS_INTERVAL_SECONDS: float = 4.0

    # Payment: PayMongo (GCash QR)
    PAYMONGO_MODE: str = "test"  # 'test' | 'live'
    PAYMONGO_SECRET_KEY: str = "sk_test_demo1234567890abcdef"
    PAYMONGO_PUBLIC_KEY: str = "pk_test_demo1234567890abcdef"
    PAYMONGO_API_BASE: str = "https://api.paymongo.com/v1"

    # Telegram Audit Bot (Owner transaction notifications)
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""

    # Hardware Cash Limits (Hopper constraint: 220V AC hoppers dispense only ₱1 and ₱5 coins)
    MAX_PAYABLE_AMOUNT: float = 200.0  # Max inserted amount to prevent exceeding hopper capacity

    # Storage & Cleanup
    HOTSPOT_FILE_TTL_MINUTES: int = 30
    UPLOAD_DIR: Path = Path("uploads")
    BLUETOOTH_RECEIVE_DIR: Path = Path("bluetooth_received")
    DATABASE_PATH: Path = Path("kiosk.db")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
settings.UPLOAD_DIR = resolve_app_path(settings.UPLOAD_DIR)
settings.BLUETOOTH_RECEIVE_DIR = resolve_app_path(settings.BLUETOOTH_RECEIVE_DIR)
settings.DATABASE_PATH = resolve_app_path(settings.DATABASE_PATH)

# Ensure directories exist
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def log_startup_configuration():
    """Outputs startup configuration clearly for operator audit."""
    print("=" * 60)
    print(f"[*] {settings.APP_NAME} Initializing...")
    print(f"[*] CUPS PRINTER  : {settings.CUPS_PRINTER_NAME}")
    acceptor_port = settings.ACCEPTOR_SERIAL_PORT or settings.SERIAL_PORT or default_serial_port("acceptor")
    actuator_port = settings.ACTUATOR_SERIAL_PORT or default_serial_port("actuator")
    print(f"[*] HOST OS       : {detect_host_os()}")
    print(f"[*] ACCEPTOR PORT : {acceptor_port} @ {settings.SERIAL_BAUDRATE} baud")
    print(f"[*] ACTUATOR PORT : {actuator_port} @ {settings.SERIAL_BAUDRATE} baud")
    print(f"[*] PAYMONGO MODE : {settings.PAYMONGO_MODE.upper()}")
    print(f"[*] MAX PAYABLE   : ₱{settings.MAX_PAYABLE_AMOUNT:.2f} (Hopper Safety Cap)")
    print(f"[*] TTL CLEANUP   : {settings.HOTSPOT_FILE_TTL_MINUTES} minutes")
    print("=" * 60)

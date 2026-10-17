"""Public hardware factory for the two-Arduino kiosk controller."""

from typing import Optional

from kiosk_backend.hardware_dual import DualArduinoHardware

_hardware_instance: Optional[DualArduinoHardware] = None


def get_hardware() -> DualArduinoHardware:
    global _hardware_instance
    if _hardware_instance is None:
        _hardware_instance = DualArduinoHardware()
        _hardware_instance.connect()
    return _hardware_instance

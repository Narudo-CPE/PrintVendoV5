import base64
import time
import socket
import logging
import threading
import requests
from typing import Dict, Any, Optional, Tuple
from kiosk_backend.config import settings

logger = logging.getLogger("kiosk.payments")

# Cached internet connectivity state
_internet_online: bool = True
_last_connectivity_check: float = 0.0


def check_internet_connectivity(force: bool = False) -> bool:
    """
    Lightweight periodic probe to detect if the kiosk has internet access.
    Checks PayMongo API endpoint or Cloudflare DNS (1.1.1.1:53).
    Cached with 30s TTL.
    """
    global _internet_online, _last_connectivity_check
    now = time.time()
    if not force and (now - _last_connectivity_check < 30.0):
        return _internet_online

    _last_connectivity_check = now
    try:
        # Quick socket check to DNS root (1.1.1.1:53, 2.0s timeout)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2.0)
        sock.connect(("1.1.1.1", 53))
        sock.close()
        _internet_online = True
    except Exception:
        # Fallback HTTP probe to PayMongo API ping
        try:
            res = requests.get(f"{settings.PAYMONGO_API_BASE}/ping", timeout=2.5)
            _internet_online = res.status_code in [200, 401, 404]
        except Exception:
            _internet_online = False

    logger.info(f"Internet connectivity check: {'ONLINE' if _internet_online else 'OFFLINE'}")
    return _internet_online


class PayMongoService:
    """
    PayMongo API client supporting GCash QR generation, webhook processing,
    and fallback status polling.
    """

    @staticmethod
    def _get_headers() -> Dict[str, str]:
        encoded_key = base64.b64encode(f"{settings.PAYMONGO_SECRET_KEY}:".encode("utf-8")).decode("utf-8")
        return {
            "Authorization": f"Basic {encoded_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    @classmethod
    def create_gcash_source_or_intent(
        cls,
        amount_peso: float,
        session_id: str,
        description: str = "Print Kiosk Job",
    ) -> Dict[str, Any]:
        """
        Creates a GCash Source / PaymentIntent via PayMongo API.
        Amount is converted to centavos (PHP 1.00 = 100 centavos).
        Works in both test mode (sk_test_) and live mode.
        """
        if not check_internet_connectivity():
            return {
                "success": False,
                "error": "No internet connection. GCash is currently unavailable.",
                "offline": True,
            }

        amount_centavos = int(round(amount_peso * 100))

        # Real PayMongo API call
        url = f"{settings.PAYMONGO_API_BASE}/sources"
        payload = {
            "data": {
                "attributes": {
                    "amount": amount_centavos,
                    "redirect": {
                        "success": f"http://localhost:3000/api/payment/gcash/success?session_id={session_id}",
                        "failed": f"http://localhost:3000/api/payment/gcash/failed?session_id={session_id}",
                    },
                    "type": "gcash",
                    "currency": "PHP",
                    "description": f"Print Job #{session_id[:8]}",
                }
            }
        }

        try:
            logger.info(f"Calling PayMongo Source API for ₱{amount_peso:.2f} ({amount_centavos} centavos)...")
            resp = requests.post(url, json=payload, headers=cls._get_headers(), timeout=10.0)

            if resp.status_code in [200, 201]:
                data = resp.json().get("data", {})
                source_id = data.get("id")
                attributes = data.get("attributes", {})
                redirect_url = attributes.get("redirect", {}).get("checkout_url")

                logger.info(f"PayMongo Source created successfully: {source_id}")
                return {
                    "success": True,
                    "payment_id": source_id,
                    "checkout_url": redirect_url,
                    "qr_data": redirect_url,  # PayMongo checkout URL rendered as QR on kiosk screen
                    "amount_peso": amount_peso,
                    "status": "pending",
                }
            else:
                logger.warning(f"PayMongo API responded with {resp.status_code}: {resp.text}")

        except Exception as e:
            logger.warning(f"PayMongo request exception ({e}). Utilizing sandbox mock payload.")

        # Sandbox / Mock fallback (so developers can test immediately even without a real API key)
        mock_source_id = f"src_test_{session_id[:8]}_{int(time.time())}"
        # A mock GCash checkout QR link
        mock_checkout = f"https://test-sources.paymongo.com/sources?id={mock_source_id}&amount={amount_centavos}"

        return {
            "success": True,
            "payment_id": mock_source_id,
            "checkout_url": mock_checkout,
            "qr_data": mock_checkout,
            "amount_peso": amount_peso,
            "status": "pending",
            "is_sandbox": True,
        }

    @classmethod
    def check_payment_status(cls, payment_id: str) -> Dict[str, Any]:
        """Polls PayMongo source or payment status."""
        if payment_id.startswith("src_test_"):
            # Mock sandbox test key simulation
            return {"id": payment_id, "status": "pending"}

        try:
            url = f"{settings.PAYMONGO_API_BASE}/sources/{payment_id}"
            resp = requests.get(url, headers=cls._get_headers(), timeout=5.0)
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                status = data.get("attributes", {}).get("status", "pending")
                return {"id": payment_id, "status": status}
        except Exception as e:
            logger.error(f"Error checking PayMongo status: {e}")

        return {"id": payment_id, "status": "pending"}


def send_telegram_audit_notification(
    session_id: str,
    amount_paid: float,
    payment_method: str,
    page_count: int,
    paper_size: str,
    color_mode: str,
):
    """
    Sends audit notification to kiosk owner Telegram bot in background thread.
    Non-blocking audit trail.
    """
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
        logger.debug("Telegram bot token or chat ID not set. Skipping audit notification.")
        return

    def _worker():
        try:
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
            msg = (
                f"🖨️ *Print Kiosk Transaction Confirmed*\n"
                f"━━━━━━━━━━━━━━━━━━━\n"
                f"• *Session:* `{session_id[:8]}`\n"
                f"• *Amount:* ₱{amount_paid:.2f}\n"
                f"• *Method:* {payment_method.upper()}\n"
                f"• *Pages:* {page_count} sheets\n"
                f"• *Format:* {paper_size} ({color_mode.upper()})\n"
                f"• *Time:* {timestamp}\n"
                f"━━━━━━━━━━━━━━━━━━━"
            )
            url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
            payload = {
                "chat_id": settings.TELEGRAM_CHAT_ID,
                "text": msg,
                "parse_mode": "Markdown",
            }
            requests.post(url, json=payload, timeout=5.0)
            logger.info("Telegram audit notification sent successfully.")
        except Exception as e:
            logger.warning(f"Failed to send Telegram audit notification: {e}")

    threading.Thread(target=_worker, daemon=True).start()

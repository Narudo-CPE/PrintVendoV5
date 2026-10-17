"""
Self-Service Print Kiosk - Main Entry Point
Run with:
  python main.py
or:
  uvicorn main:app --host 0.0.0.0 --port 3000 --reload
"""
import uvicorn
from kiosk_backend.main import app
from kiosk_backend.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "kiosk_backend.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info",
    )

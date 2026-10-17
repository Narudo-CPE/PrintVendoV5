import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Any, List
from kiosk_backend.config import settings

logger = logging.getLogger("kiosk.db")


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(settings.DATABASE_PATH), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Initializes SQLite tables according to specification."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Sessions Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'active',
            total_amount REAL DEFAULT 0.0,
            paid_amount REAL DEFAULT 0.0,
            paper_size TEXT DEFAULT 'A4',
            color_mode TEXT DEFAULT 'bw',
            copies INTEGER DEFAULT 1,
            reverse_order INTEGER DEFAULT 0,
            "collate" INTEGER DEFAULT 1,
            print_queue_json TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        """)

        # Uploaded Files Table (metadata only, no content stored here)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS uploaded_files (
            file_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            sanitized_filename TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            file_size_bytes INTEGER NOT NULL,
            mime_type TEXT NOT NULL,
            page_count INTEGER NOT NULL DEFAULT 0,
            upload_method TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
        );
        """)

        # Transactions Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            transaction_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            payment_method TEXT NOT NULL,
            amount_due REAL NOT NULL,
            amount_paid REAL NOT NULL,
            change_dispensed REAL DEFAULT 0.0,
            change_coins_5 INTEGER DEFAULT 0,
            change_coins_1 INTEGER DEFAULT 0,
            paymongo_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
        );
        """)

        # Print Jobs Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS print_jobs (
            job_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            paper_size TEXT NOT NULL,
            color_mode TEXT NOT NULL,
            copies INTEGER NOT NULL DEFAULT 1,
            reverse_order INTEGER NOT NULL DEFAULT 0,
            "collate" INTEGER NOT NULL DEFAULT 1,
            queue_pages_json TEXT NOT NULL,
            total_pages INTEGER NOT NULL,
            completed_pages INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'queued',
            created_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
        );
        """)

        conn.commit()
        logger.info(f"SQLite database initialized at {settings.DATABASE_PATH}")


# Repository / DAO helpers
def create_session_record(session_id: str, ttl_minutes: int = 30):
    now = datetime.utcnow()
    expires = now + timedelta(minutes=ttl_minutes)
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO sessions (session_id, status, created_at, expires_at)
            VALUES (?, 'active', ?, ?)
            """,
            (session_id, now.isoformat(), expires.isoformat()),
        )
        conn.commit()


def get_session_record(session_id: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cur = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def update_session_record(session_id: str, **kwargs):
    if not kwargs:
        return
    fields = ", ".join([f"{k} = ?" for k in kwargs.keys()])
    values = list(kwargs.values()) + [session_id]
    with get_db_connection() as conn:
        conn.execute(f"UPDATE sessions SET {fields} WHERE session_id = ?", values)
        conn.commit()


def record_uploaded_file(
    file_id: str,
    session_id: str,
    original_filename: str,
    sanitized_filename: str,
    stored_path: str,
    file_size_bytes: int,
    mime_type: str,
    page_count: int,
    upload_method: str,
):
    now = datetime.utcnow().isoformat()
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO uploaded_files (
                file_id, session_id, original_filename, sanitized_filename,
                stored_path, file_size_bytes, mime_type, page_count, upload_method, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                file_id,
                session_id,
                original_filename,
                sanitized_filename,
                stored_path,
                file_size_bytes,
                mime_type,
                page_count,
                upload_method,
                now,
            ),
        )
        conn.commit()


def get_session_file(session_id: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cur = conn.execute(
            "SELECT * FROM uploaded_files WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
            (session_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def create_transaction_record(
    transaction_id: str,
    session_id: str,
    payment_method: str,
    amount_due: float,
    amount_paid: float,
    paymongo_id: Optional[str] = None,
    status: str = "pending",
):
    now = datetime.utcnow().isoformat()
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO transactions (
                transaction_id, session_id, payment_method, amount_due,
                amount_paid, paymongo_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                transaction_id,
                session_id,
                payment_method,
                amount_due,
                amount_paid,
                paymongo_id,
                status,
                now,
            ),
        )
        conn.commit()


def update_transaction_record(transaction_id: str, **kwargs):
    if not kwargs:
        return
    fields = ", ".join([f"{k} = ?" for k in kwargs.keys()])
    values = list(kwargs.values()) + [transaction_id]
    with get_db_connection() as conn:
        conn.execute(f"UPDATE transactions SET {fields} WHERE transaction_id = ?", values)
        conn.commit()


def get_latest_transaction_record(session_id: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cur = conn.execute(
            "SELECT * FROM transactions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
            (session_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_latest_pending_gcash_transaction(session_id: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cur = conn.execute(
            """
            SELECT * FROM transactions
            WHERE session_id = ? AND payment_method = 'gcash' AND status = 'pending'
            ORDER BY created_at DESC LIMIT 1
            """,
            (session_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def mark_gcash_transaction_paid(transaction_id: str, amount_paid: float) -> bool:
    with get_db_connection() as conn:
        cur = conn.execute(
            """
            UPDATE transactions SET status = 'paid', amount_paid = ?
            WHERE transaction_id = ? AND payment_method = 'gcash' AND status = 'pending'
            """,
            (amount_paid, transaction_id),
        )
        conn.commit()
        return cur.rowcount == 1


def create_print_job_record(
    job_id: str,
    session_id: str,
    paper_size: str,
    color_mode: str,
    copies: int,
    reverse_order: int,
    collate: int,
    queue_pages_json: str,
    total_pages: int,
):
    now = datetime.utcnow().isoformat()
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO print_jobs (
                job_id, session_id, paper_size, color_mode, copies,
                reverse_order, "collate", queue_pages_json, total_pages,
                completed_pages, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'queued', ?)
            """,
            (
                job_id,
                session_id,
                paper_size,
                color_mode,
                copies,
                reverse_order,
                collate,
                queue_pages_json,
                total_pages,
                now,
            ),
        )
        conn.commit()


def update_print_job_record(job_id: str, **kwargs):
    if not kwargs:
        return
    fields = ", ".join([f"{k} = ?" for k in kwargs.keys()])
    values = list(kwargs.values()) + [job_id]
    with get_db_connection() as conn:
        conn.execute(f"UPDATE print_jobs SET {fields} WHERE job_id = ?", values)
        conn.commit()

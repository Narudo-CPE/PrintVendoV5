import time
import shutil
import logging
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Callable, Optional
from kiosk_backend.config import settings
from kiosk_backend.hardware import get_hardware

logger = logging.getLogger("kiosk.printing")
PAPER_FEED_SETTLE_SECONDS = 5.0


def feed_paper_and_settle(paper_size: str, hardware: Any = None) -> bool:
    active_hardware = hardware if hardware is not None else get_hardware()
    if not active_hardware.is_connected():
        logger.error("Hardware disconnected; refusing to print without a confirmed paper feed.")
        return False

    logger.info("Feeding %s sheet from NEMA17 tray motor...", paper_size)
    if not active_hardware.feed_paper(paper_size):
        logger.error("Tray feed for %s failed or was not acknowledged.", paper_size)
        return False

    logger.info("Paper feed complete; waiting %.1f seconds for the sheet to settle.", PAPER_FEED_SETTLE_SECONDS)
    time.sleep(PAPER_FEED_SETTLE_SECONDS)
    return True


def build_software_print_queue(
    selected_pages: List[int],
    copies: int = 1,
    reverse_order: bool = False,
    collate: bool = True,
) -> List[Dict[str, Any]]:
    """
    Builds the explicit software print queue.
    Does NOT rely on CUPS/Gutenprint driver collation or output order, which is unreliable
    on Epson inkjet PPDs. The hardware feeds and prints one page at a time.

    Examples:
      - Pages [1, 2, 3], 2 copies, collated=True:
        Queue: [1, 2, 3, 1, 2, 3]
      - Pages [1, 2, 3], 2 copies, collated=False:
        Queue: [1, 1, 2, 2, 3, 3]
      - Pages [1, 2, 3], reverse=True, 1 copy:
        Queue: [3, 2, 1]
      - Pages [1, 2, 3], reverse=True, 2 copies, collated=True:
        Queue: [3, 2, 1, 3, 2, 1]
    """
    base_pages = list(selected_pages)
    if reverse_order:
        base_pages.reverse()

    queue: List[Dict[str, Any]] = []

    if copies <= 1 or collate:
        # Collated or single copy: full sequence repeated `copies` times
        for c in range(1, copies + 1):
            for idx, p in enumerate(base_pages):
                queue.append({
                    "page_number": p,
                    "copy_number": c,
                    "total_copies": copies,
                    "sequence_index": len(queue) + 1,
                })
    else:
        # Uncollated: each page repeated `copies` times before moving to next page
        for p in base_pages:
            for c in range(1, copies + 1):
                queue.append({
                    "page_number": p,
                    "copy_number": c,
                    "total_copies": copies,
                    "sequence_index": len(queue) + 1,
                })

    return queue


def print_single_page_cups(
    pdf_path: Path,
    page_num: int,
    paper_size: str,
    color_mode: str,
    printer_name: str = settings.CUPS_PRINTER_NAME,
) -> bool:
    """
    Sends a single page to CUPS/Gutenprint via the 'lp' command on Raspberry Pi OS.
    """
    if not shutil.which("lp"):
        logger.warning("'lp' command not found. CUPS may not be installed.")
        return False

    # Map paper size to Gutenprint PPD PageSize
    cups_paper_map = {
        "A4": "A4",
        "LETTER": "Letter",
        "LONG": "Legal",  # In the Philippines, 'Long' (8.5x13") is usually mapped to Legal or custom
    }
    cups_paper = cups_paper_map.get(paper_size.upper(), "A4")

    # Map color mode to Gutenprint ColorModel option
    # e.g., ColorModel=RGB or ColorModel=Gray
    cups_color = "RGB" if color_mode.lower() == "color" else "Gray"

    # lp command options:
    # -d <printer> -P <page> -o PageSize=<paper> -o ColorModel=<color> <pdf_file>
    lp_cmd = [
        "lp",
        "-d", printer_name,
        "-P", str(page_num),
        "-o", f"PageSize={cups_paper}",
        "-o", f"ColorModel={cups_color}",
        "-o", "fit-to-page",
        str(pdf_path),
    ]

    logger.info(f"[CUPS/Gutenprint] Executing: {' '.join(lp_cmd)}")
    try:
        res = subprocess.run(lp_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20.0)
        if res.returncode == 0:
            logger.info(f"[CUPS] Successfully queued page {page_num} on {printer_name}")
            return True
        else:
            err = res.stderr.decode("utf-8", errors="ignore")
            logger.error(f"[CUPS] lp failed with code {res.returncode}: {err}")
            return False
    except Exception as e:
        logger.error(f"[CUPS] Error invoking lp: {e}")
        return False


def execute_print_job(
    pdf_path: Path,
    print_queue: List[Dict[str, Any]],
    paper_size: str,
    color_mode: str,
    progress_callback: Optional[Callable[[int, int, Dict[str, Any]], None]] = None,
) -> bool:
    """
    Orchestrates the physical print pipeline:
    For every page in the software queue:
      1. Trigger hardware paper feed from matching NEMA17 stepper tray
    2. Send single page to the printer through CUPS/Gutenprint
      3. Report progress via callback / WebSocket
    """
    hardware = get_hardware()
    total_items = len(print_queue)

    logger.info(
        f"Starting print job execution: {total_items} items in queue. "
        f"CUPS printer={settings.CUPS_PRINTER_NAME}"
    )

    for idx, item in enumerate(print_queue):
        current_step = idx + 1
        page_num = item["page_number"]
        copy_num = item["copy_number"]

        logger.info(f"--- Printing Item {current_step}/{total_items}: Page {page_num} (Copy {copy_num}) ---")

        # Step A: Hardware Paper Tray Feed (NEMA17 DRV8825 stepper)
        if not feed_paper_and_settle(paper_size, hardware):
            logger.error("Stopping print job before CUPS submission because paper feed did not complete.")
            return False

        # Step B: Printer output
        print_ok = print_single_page_cups(
            pdf_path=pdf_path,
            page_num=page_num,
            paper_size=paper_size,
            color_mode=color_mode,
            printer_name=settings.CUPS_PRINTER_NAME,
        )
        if not print_ok:
            logger.error("Print job stopped after CUPS rejected item %s/%s", current_step, total_items)
            return False

        # Step C: Real-time progress update
        if progress_callback:
            try:
                progress_callback(current_step, total_items, item)
            except Exception as e:
                logger.error(f"Error in print progress callback: {e}")

    logger.info(f"Print job completed successfully: {total_items}/{total_items} pages printed.")
    return True

from pathlib import Path
from typing import List, Dict, Any
from decimal import Decimal

import cv2
import pymupdf as fitz
import numpy as np

from kiosk_backend.config import settings

def compute_pixel_pricing(
    pdf_path: Path,
    selected_pages: List[int],
    color_mode: str,
    paper_size: str,
    copies: int = 1,
    reverse_order: bool = False,
    collate: bool = True,
) -> Dict[str, Any]:
    """Price selected PDF pages from actual raster pixels, without touching hardware."""
    if not pdf_path.is_file():
        raise FileNotFoundError(f"Document not found: {pdf_path}")
    if copies < 1:
        raise ValueError("Copies must be at least one.")
    normalized_mode = color_mode.lower()
    if normalized_mode not in {"bw", "color"}:
        raise ValueError("Color mode must be 'bw' or 'color'.")

    page_breakdown: List[Dict[str, Any]] = []
    grayscale_pixels = 0
    color_pixels = 0
    total_pixels = 0
    dpi_scale = settings.RASTER_DPI / 72.0

    with fitz.open(pdf_path) as document:
        document_page_count = document.page_count
        if not selected_pages or any(page < 1 or page > document_page_count for page in selected_pages):
            raise ValueError("Selected page is outside the document page range.")

        for page_number in selected_pages:
            page = document.load_page(page_number - 1)
            pixmap = page.get_pixmap(
                matrix=fitz.Matrix(dpi_scale, dpi_scale),
                colorspace=fitz.csRGB,
                alpha=False,
            )
            rgb = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)
            grayscale = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            page_grayscale_pixels = int(np.count_nonzero(grayscale < 240))
            page_color_pixels = int(np.count_nonzero(np.any(rgb <= 240, axis=2)))
            total_page_pixels = int(pixmap.width * pixmap.height)
            total_pixels += total_page_pixels

            if normalized_mode == "bw":
                grayscale_pixels += page_grayscale_pixels * copies
                charged_grayscale_pixels = page_grayscale_pixels
                charged_color_pixels = 0
                charged_pixels = page_grayscale_pixels
                page_ink_cost = Decimal(page_grayscale_pixels) * Decimal(str(settings.GRAYSCALE_RATE))
            else:
                color_pixels += page_color_pixels * copies
                charged_grayscale_pixels = 0
                charged_color_pixels = page_color_pixels
                charged_pixels = page_color_pixels
                page_ink_cost = Decimal(page_color_pixels) * Decimal(str(settings.COLOR_RATE))

            coverage = charged_pixels / total_page_pixels if total_page_pixels else 0.0
            page_price = Decimal("1.00") + page_ink_cost

            page_breakdown.append({
                "page_number": page_number,
                "grayscale_pixels": charged_grayscale_pixels,
                "color_pixels": charged_color_pixels,
                "total_pixels": total_page_pixels,
                "non_white_pixels": charged_pixels,
                "coverage_ratio": round(coverage, 6),
                "price": float(page_price),
            })

    total_sheets = len(selected_pages) * copies
    base_cost = Decimal(total_sheets) * Decimal("1.00")
    grayscale_cost = Decimal(grayscale_pixels) * Decimal(str(settings.GRAYSCALE_RATE))
    color_cost = Decimal(color_pixels) * Decimal(str(settings.COLOR_RATE))
    ink_cost = grayscale_cost + color_cost
    grand_total = base_cost + ink_cost
    total_mode_pixels = grayscale_pixels if normalized_mode == "bw" else color_pixels
    per_copy_total = grand_total / copies

    return {
        "selected_pages": selected_pages,
        "document_total_pages": document_page_count,
        "total_pages_selected": len(selected_pages),
        "copies": copies,
        "total_sheets_to_feed": total_sheets,
        "paper_size": paper_size,
        "color_mode": normalized_mode,
        "reverse_order": reverse_order,
        "collate": collate,
        "page_breakdown": page_breakdown,
        "grayscale_pixel_count": grayscale_pixels,
        "grayscale_cost": float(grayscale_cost),
        "color_pixel_count": color_pixels,
        "color_cost": float(color_cost),
        "base_cost": float(base_cost),
        "base_price_total": float(base_cost),
        "ink_charge_total": float(ink_cost),
        "total_pixel_count": total_mode_pixels,
        "avg_pixel_coverage": round(total_mode_pixels / (total_pixels * copies), 6) if total_pixels else 0.0,
        "unit_price": float(per_copy_total),
        "grand_total": float(grand_total),
        "total_price": float(grand_total),
        "is_authoritative": True,
        "pricing_engine": "pymupdf-opencv-numpy",
    }

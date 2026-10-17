from typing import List, Optional
from pydantic import BaseModel, Field, validator
import re


class SessionCreateResponse(BaseModel):
    session_id: str
    created_at: str
    status: str
    upload_url: str


class PrintOptionsRequest(BaseModel):
    selected_pages: List[int] = Field(..., description="1-indexed page numbers to print")
    paper_size: str = Field(..., description="'A4', 'LETTER', or 'LONG'")
    color_mode: str = Field(..., description="'color' or 'bw'")
    copies: int = Field(1, ge=1, le=50, description="Number of copies")
    reverse_order: bool = Field(False, description="Print in reverse page order")
    collate: bool = Field(True, description="Collate pages when copies > 1")

    @validator("paper_size")
    def validate_paper_size(cls, v):
        v = v.upper().strip()
        if v not in ["A4", "LETTER", "LONG"]:
            raise ValueError("Invalid paper size. Must be A4, LETTER, or LONG.")
        return v

    @validator("color_mode")
    def validate_color_mode(cls, v):
        v = v.lower().strip()
        if v not in ["color", "bw"]:
            raise ValueError("Color mode must be 'color' or 'bw'.")
        return v

    @validator("selected_pages")
    def validate_pages(cls, v):
        if not v:
            raise ValueError("Must select at least one page.")
        for p in v:
            if p < 1:
                raise ValueError(f"Page number {p} is invalid. Pages must be >= 1.")
        return sorted(list(set(v)))


class PagePricingDetail(BaseModel):
    page_number: int
    color_mode: str
    non_white_pixels: int
    total_pixels: int
    coverage_ratio: float
    price: float


class PricingCalculationResponse(BaseModel):
    session_id: str
    total_pages_selected: int
    copies: int
    total_sheets_to_feed: int
    color_mode: str
    paper_size: str
    reverse_order: bool
    collate: bool
    page_breakdown: List[PagePricingDetail]
    unit_price: float
    total_price: float
    is_authoritative: bool = True


class GCashPaymentCreateRequest(BaseModel):
    session_id: str


class CashPaymentStartRequest(BaseModel):
    session_id: str
    amount_due: Optional[float] = Field(None, gt=0)


class PrintJobStartRequest(BaseModel):
    session_id: str

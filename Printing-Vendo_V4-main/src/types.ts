export type PaperSize = 'A4' | 'LETTER' | 'LONG';
export type ColorMode = 'bw' | 'color';
export type PaymentMethod = 'gcash' | 'cash' | 'bill' | 'coin';

export interface PaymentReceipt {
  method: PaymentMethod;
  amountPaid: number;
  changeDispensed: number;
  coins5: number;
  coins1: number;
  reference?: string;
  notes?: string;
}

export interface PricingBreakdown {
  unit_price: number;
  total_price: number;
  grand_total: number;
  total_sheets_to_feed: number;
  base_price_total: number;
  base_cost: number;
  ink_charge_total: number;
  grayscale_pixel_count: number;
  grayscale_cost: number;
  color_pixel_count: number;
  color_cost: number;
  avg_pixel_coverage: number;
  queue_sequence: Array<{
    page_number: number;
    copy_number: number;
    sheet_index: number;
    paper_size: string;
    tray_motor: string;
    color_mode: string;
  }>;
}

export interface KioskSession {
  sessionId: string;
  filename: string | null;
  fileBlobUrl: string | null;
  numPages: number;
  selectedPages: number[];
  paperSize: PaperSize;
  colorMode: ColorMode;
  copies: number;
  reverseOrder: boolean;
  collate: boolean;
  pricing: PricingBreakdown | null;
}

export interface HardwareState {
  connected: boolean;
  acceptorConnected: boolean;
  actuatorConnected: boolean;
}

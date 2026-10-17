/**
 * Philippine National QR Code Standard (QR Ph / BSP Circular 1055)
 * Compliant with EMVCo Merchant-Presented Mode (MPM) Specifications.
 *
 * This standard is natively decoded by GCash, Maya, ShopeePay,
 * BDO, BPI, UnionBank, RCBC, and all QR Ph participant banking apps.
 */

export interface QRPhOptions {
  merchantName?: string;
  merchantCity?: string;
  amount: number;
  mobileOrMerchantId?: string;
  referenceId: string;
  type?: 'p2m' | 'p2p';
}

/**
 * Encodes a Tag-Length-Value (TLV) string according to EMVCo format.
 * Tag: 2 digits, Length: 2 digits (zero padded), Value: string
 */
export function formatTLV(tag: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${tag}${len}${value}`;
}

/**
 * Computes standard 16-bit CRC-CCITT (polynomial 0x1021, init 0xFFFF)
 * required for EMVCo / QR Ph Tag 63 validation.
 */
export function calculateCRC16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Generates an official QR Ph EMVCo compliant string that is recognized
 * without errors by the built-in "Scan QR" camera feature of the GCash app.
 */
export function generateQRPhString(options: QRPhOptions): string {
  const {
    merchantName = 'PRINTPOINT KIOSK',
    merchantCity = 'MANILA',
    amount,
    mobileOrMerchantId = '09178294102',
    referenceId,
    type = 'p2m',
  } = options;

  // Clean values
  const cleanMerchant = merchantName.slice(0, 25).trim();
  const cleanCity = merchantCity.slice(0, 15).trim();
  const cleanRef = referenceId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
  const cleanPhone = mobileOrMerchantId.replace(/[^0-9]/g, '');
  const formattedAmount = Number(amount).toFixed(2);

  // Tag 28: Merchant Account Information for QR Ph (National Payment System)
  // Sub-tag 00: Globally Unique Identifier ("ph.gov.p2m" or "ph.gov.p2p")
  // Sub-tag 01: Acquirer ID (GCash institution identifier GXCHPHM2XXX)
  // Sub-tag 02: Merchant / Receiver Mobile or Account Number
  // Sub-tag 03: Terminal ID
  const subTag00 = formatTLV('00', type === 'p2p' ? 'ph.gov.p2p' : 'ph.gov.p2m');
  const subTag01 = formatTLV('01', 'GXCHPHM2XXX'); // GCash Philippines participant routing ID
  const subTag02 = formatTLV('02', cleanPhone || '09178294102');
  const subTag03 = formatTLV('03', 'PRINT01');
  const tag28Value = `${subTag00}${subTag01}${subTag02}${subTag03}`;

  // Tag 62: Additional Data Field Template (Bill/Invoice Reference)
  const sub62_01 = formatTLV('01', cleanRef.slice(0, 16)); // Bill number
  const sub62_05 = formatTLV('05', cleanRef.slice(0, 20)); // Reference label
  const sub62_07 = formatTLV('07', 'KIOSK-01'); // Terminal ID
  const tag62Value = `${sub62_01}${sub62_05}${sub62_07}`;

  // Assemble EMVCo structure
  const rawPayload =
    formatTLV('00', '01') + // Payload Format Indicator
    formatTLV('01', '12') + // Point of Initiation (12 = Dynamic with transaction amount)
    formatTLV('28', tag28Value) + // Merchant Account Info (QR Ph)
    formatTLV('52', '7399') + // Merchant Category Code (7399 = Business/Printing Services)
    formatTLV('53', '608') + // Transaction Currency (608 = Philippine Peso ISO 4217)
    formatTLV('54', formattedAmount) + // Transaction Amount
    formatTLV('58', 'PH') + // Country Code
    formatTLV('59', cleanMerchant) + // Merchant Name
    formatTLV('60', cleanCity) + // Merchant City
    formatTLV('62', tag62Value) + // Additional Data Template
    '6304'; // Checksum Tag + Length header

  // Compute CRC-16 and append
  const crc = calculateCRC16(rawPayload);
  return `${rawPayload}${crc}`;
}

/**
 * Storage helpers for kiosk owners to save custom merchant GCash settings
 */
const CUSTOM_GCASH_STORAGE_KEY = 'kiosk_custom_gcash_config';

export interface CustomGCashConfig {
  merchantName: string;
  mobileNumber: string;
  userId?: string;
  customQrDataUrl: string | null;
  mode: 'qrph' | 'custom_image' | 'web_checkout';
}

export function getCustomGCashConfig(): CustomGCashConfig {
  const defaultFatherConfig: CustomGCashConfig = {
    merchantName: 'AP*******O R.',
    mobileNumber: '09927260000',
    userId: '0FSQT7',
    customQrDataUrl: null,
    mode: 'qrph',
  };

  if (typeof window === 'undefined') {
    return defaultFatherConfig;
  }

  try {
    const raw = localStorage.getItem(CUSTOM_GCASH_STORAGE_KEY);
    if (raw) {
      return { ...defaultFatherConfig, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }

  return defaultFatherConfig;
}

export function saveCustomGCashConfig(config: CustomGCashConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_GCASH_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

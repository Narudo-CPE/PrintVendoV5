import React, { useState, useEffect, useRef } from 'react';
import {
  Banknote,
  Coins,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  ShieldCheck,
  X,
  Upload,
  Check,
  Image as ImageIcon,
  Send,
  Eye,
  WifiOff,
  QrCode,
  Lock,
  Unlock,
} from 'lucide-react';
import { PaymentMethod, PricingBreakdown, HardwareState, PaymentReceipt } from '../types';
import {
  getCustomGCashConfig,
  saveCustomGCashConfig,
  CustomGCashConfig,
} from '../utils/qrPhGenerator';
import { kioskApiUrl } from '../utils/kioskApi';

interface OperatingHours {
  gcash_start_time: string;
  gcash_end_time: string;
}

const defaultOperatingHours: OperatingHours = {
  gcash_start_time: '07:00',
  gcash_end_time: '20:30',
};

const minutesFromTime = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const formatOperatingTime = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

interface PaymentStepProps {
  sessionId?: string;
  pricing: PricingBreakdown;
  hardware: HardwareState;
  internetOnline: boolean;
  onPaymentSuccess: (receipt: PaymentReceipt) => void;
  onBackToOptions: () => void;
}

/**
 * Generates a high-contrast, clean digital receipt screenshot of the kiosk order
 * so the owner can inspect the exact amount due, document specs, and timestamp remotely.
 */
function generateOrderReceiptScreenshot(params: {
  sessionId: string;
  amount: number;
  fileName: string;
  pages: number;
  copies: number;
  colorMode: string;
}): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 760;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Sleek dark canvas background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 640, 760);

    // Blue header banner
    const grad = ctx.createLinearGradient(0, 0, 640, 110);
    grad.addColorStop(0, '#007DFE');
    grad.addColorStop(1, '#0284c7');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 110);

    // Header typography
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('PRINTPOINT KIOSK - ORDER RECEIPT', 30, 48);

    ctx.fillStyle = '#e0f2fe';
    ctx.font = '14px monospace';
    ctx.fillText(`ORDER ID: #${params.sessionId.slice(0, 8).toUpperCase()}`, 30, 78);
    ctx.fillText(
      `DATE: ${new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}`,
      30,
      96
    );

    // Inner order details card
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(30, 130, 580, 410, 16);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('PRINT JOB DETAILS', 50, 165);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(50, 178);
    ctx.lineTo(590, 178);
    ctx.stroke();

    const drawRow = (label: string, val: string, y: number) => {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '15px sans-serif';
      ctx.fillText(label, 50, y);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(val, 590 - ctx.measureText(val).width, y);
    };

    drawRow('Document:', params.fileName.slice(0, 32), 215);
    drawRow('Page Count:', `${params.pages} Page(s)`, 255);
    drawRow('Copies:', `${params.copies} Copy/Copies`, 295);
    drawRow(
      'Color Mode:',
      params.colorMode === 'color' ? 'Full Color Print' : 'Black & White (Monochrome)',
      335
    );
    drawRow('Payment Method:', 'GCash (InstaPay P2P Transfer)', 375);

    // Big prominent box for the Amount Due
    ctx.fillStyle = '#064e3b';
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(50, 405, 540, 110, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('EXACT AMOUNT DUE TO VERIFY', 70, 438);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px monospace';
    const priceText = `₱${params.amount.toFixed(2)}`;
    ctx.fillText(priceText, 70, 490);

    // Remote owner banner
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('⚡ REMOTE OWNER APPROVAL ACTIVATED', 30, 570);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText('Owner verifies payment on their smartphone and approves remotely.', 30, 596);
    ctx.fillText('Once approved, printing starts automatically without owner on-site.', 30, 618);

    ctx.fillStyle = '#64748b';
    ctx.font = '12px monospace';
    ctx.fillText(`Session: ${params.sessionId.toUpperCase()}`, 30, 680);

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('Screenshot generation error', err);
    return '';
  }
}

export const PaymentStep: React.FC<PaymentStepProps> = ({
  sessionId = 'sess_default',
  pricing,
  hardware,
  internetOnline,
  onPaymentSuccess,
  onBackToOptions,
}) => {
  // Method selection: 'gcash' | 'bill' (Bills Only) | 'coin' (Coins Only)
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [operatingHours, setOperatingHours] = useState(defaultOperatingHours);
  const [localMinutes, setLocalMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  // Separate payment state for Bill Acceptor Only
  const [billInserted, setBillInserted] = useState<number>(0);

  // Separate payment state for Coin Acceptor Only
  const [coinInserted, setCoinInserted] = useState<number>(0);
  const [cashPaymentError, setCashPaymentError] = useState<string | null>(null);

  // GCash configuration & permanent QR state
  const [gcashConfig, setGcashConfig] = useState<CustomGCashConfig>(getCustomGCashConfig);
  const [serverQrUrl, setServerQrUrl] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [gcashRefInput, setGcashRefInput] = useState<string>('');
  const [customerReceiptProof, setCustomerReceiptProof] = useState<string | null>(null);
  const [proofSubmitted, setProofSubmitted] = useState<boolean>(false);
  const [isSubmittingProof, setIsSubmittingProof] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [orderScreenshotUrl, setOrderScreenshotUrl] = useState<string | null>(null);
  const [isApprovedByOwner, setIsApprovedByOwner] = useState<boolean>(false);
  const [isRejectedByOwner, setIsRejectedByOwner] = useState<boolean>(false);
  const [approvalRef, setApprovalRef] = useState<string>('');
  const pendingNotificationSentRef = useRef(false);
  const approvalHandledRef = useRef(false);
  const cashPaymentHandledRef = useRef(false);
  const onPaymentSuccessRef = useRef(onPaymentSuccess);
  onPaymentSuccessRef.current = onPaymentSuccess;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);

  const baseExactCost = pricing.total_price;
  const amountDue = method === 'gcash' ? baseExactCost + 2 : Math.round(baseExactCost);
  const pricingColorMode = pricing.queue_sequence[0]?.color_mode || 'bw';
  const startMinute = minutesFromTime(operatingHours.gcash_start_time);
  const endMinute = minutesFromTime(operatingHours.gcash_end_time);
  const gcashHoursAvailable = startMinute < endMinute
    ? localMinutes >= startMinute && localMinutes < endMinute
    : startMinute > endMinute
      ? localMinutes >= startMinute || localMinutes < endMinute
      : false;
  const gcashUnavailable = !gcashHoursAvailable;

  // Remaining balance for the physical bill acceptor.
  const billRemaining = Math.max(0, amountDue - billInserted);

  // Remaining balance for the physical coin acceptor.
  const coinRemaining = Math.max(0, amountDue - coinInserted);

  useEffect(() => {
    let cancelled = false;
    const fetchOperatingHours = async () => {
      try {
        const response = await fetch(kioskApiUrl('/api/settings'), { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && typeof data.gcash_start_time === 'string' && typeof data.gcash_end_time === 'string') {
          setOperatingHours({
            gcash_start_time: data.gcash_start_time,
            gcash_end_time: data.gcash_end_time,
          });
        }
      } catch {
        // Keep the documented defaults; cash payment remains available if settings cannot load.
      }
    };
    void fetchOperatingHours();
    const settingsTimer = window.setInterval(() => void fetchOperatingHours(), 60_000);
    const clockTimer = window.setInterval(() => {
      const now = new Date();
      setLocalMinutes(now.getHours() * 60 + now.getMinutes());
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(settingsTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  useEffect(() => {
    if (method === 'gcash' && gcashUnavailable) setMethod(null);
  }, [method, gcashUnavailable]);

  // Fetch permanent QR status from server on mount
  useEffect(() => {
    fetch('/api/kiosk/qr-status')
      .then((res) => res.json())
      .then((data) => {
        if (data.hasQR && data.url) {
          setServerQrUrl(data.url);
        }
      })
      .catch(() => {});
  }, []);

  // Generate the order screenshot and notify the owner once per payment session.
  useEffect(() => {
    if (method !== 'gcash') return;
    const screenshot = generateOrderReceiptScreenshot({
      sessionId,
      amount: amountDue,
      fileName: `${pricing.total_sheets_to_feed} page(s) Document`,
      pages: pricing.total_sheets_to_feed,
      copies: pricing.copies,
      colorMode: pricing.color_mode,
    });
    setOrderScreenshotUrl(screenshot);

    if (pendingNotificationSentRef.current) return;
    pendingNotificationSentRef.current = true;
    fetch(`/api/payment/${sessionId}/pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountDue,
        fileName: `${pricing.total_sheets_to_feed} page(s) Document`,
        pageCount: pricing.total_sheets_to_feed,
        copies: pricing.copies,
        colorMode: pricing.color_mode,
        orderScreenshot: screenshot || undefined,
      }),
    }).catch(() => {});
  }, [sessionId, amountDue, pricing, method]);

  // Real-time payment listener: listens for Owner App approval via backend polling, BroadcastChannel, and storage
  useEffect(() => {
    if (method !== 'gcash') return;
    let isCancelled = false;
    const handlePaymentStatus = (data: any) => {
      if (isCancelled || approvalHandledRef.current) return;
      if (data?.status === 'rejected') {
        approvalHandledRef.current = true;
        setIsRejectedByOwner(true);
        return;
      }
      if (data?.paid || data?.status === 'approved') {
        const reference = data.reference || `GCASH-APPV-${sessionId.slice(0, 8).toUpperCase()}`;
        approvalHandledRef.current = true;
        setIsApprovedByOwner(true);
        setApprovalRef(reference);
        onPaymentSuccess({
          method: 'gcash',
          amountPaid: data.amount || amountDue,
          changeDispensed: 0,
          coins5: 0,
          coins1: 0,
          reference,
          notes: 'Approved remotely by Owner App',
        });
      }
    };

    // Cross-tab / multi-tab listener for Owner App testing on same browser
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        channel = new BroadcastChannel('kiosk_owner_bridge');
        channel.onmessage = (event) => {
          const data = event.data;
          if (data && (data.type === 'APPROVE_ORDER' || data.type === 'PAYMENT_APPROVED')) {
            if (!data.sessionId || data.sessionId === sessionId) {
              handlePaymentStatus({ ...data, paid: true, status: 'approved' });
            }
          }
        };
      }
    } catch {
      // quiet channel fallback
    }

    const paymentEvents = new EventSource(`/api/payment/${encodeURIComponent(sessionId)}/events`);
    paymentEvents.addEventListener('payment_status', (event) => {
      try {
        handlePaymentStatus(JSON.parse((event as MessageEvent).data));
      } catch {
        // Ignore malformed event payloads and let the status poll recover.
      }
    });

    const pollInterval = setInterval(async () => {
      if (isCancelled || approvalHandledRef.current) return;
      try {
        const queryParams = new URLSearchParams({
          amount: amountDue.toString(),
          pages: pricing.total_sheets_to_feed.toString(),
          copies: pricing.copies.toString(),
          color: pricing.color_mode,
          file: `${pricing.total_sheets_to_feed} page(s) Document`,
        });
        const res = await fetch(`/api/payment/${sessionId}/status?${queryParams.toString()}`);
        if (!res.ok) return;
        handlePaymentStatus(await res.json());
      } catch {
        // silent polling catch
      }
    }, 1200);

    return () => {
      isCancelled = true;
      clearInterval(pollInterval);
      paymentEvents.close();
      if (channel) {
        try {
          channel.close();
        } catch {}
      }
    };
  }, [sessionId, amountDue, pricing, onPaymentSuccess, isApprovedByOwner, isRejectedByOwner]);

  const confirmCashPayment = async (receipt: PaymentReceipt) => {
    setCashPaymentError(null);
    try {
      const response = await fetch(`/api/payment/${sessionId}/cash/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(receipt),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not register the cash payment.');
      onPaymentSuccessRef.current(receipt);
    } catch (error) {
      setCashPaymentError(error instanceof Error ? error.message : 'Could not register the cash payment.');
    }
  };

  useEffect(() => {
    if (!hardware.connected || (method !== 'bill' && method !== 'coin')) return;

    let disposed = false;
    let cashStarted = false;
    const backendOrigin = `${window.location.protocol}//${window.location.hostname}:3001`;
    const websocketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${websocketProtocol}//${window.location.hostname}:3001/ws/${encodeURIComponent(sessionId)}`
    );

    const cancelCashPayment = () => {
      void fetch(`${backendOrigin}/api/payments/cash/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => {});
    };

    socket.onopen = async () => {
      try {
        const response = await fetch(`${backendOrigin}/api/payments/cash/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, amount_due: amountDue }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || 'Could not start the cash acceptors.');
        cashStarted = true;
        if (disposed) cancelCashPayment();
        else setCashPaymentError(null);
      } catch (error) {
        if (!disposed) {
          setCashPaymentError(error instanceof Error ? error.message : 'Could not start the cash acceptors.');
        }
      }
    };

    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        if (event.event === 'cash_limit_exceeded') {
          setCashPaymentError('The cash limit has been reached. Please cancel and restart payment.');
          return;
        }
        if (event.event !== 'balance_update' || event.data?.session_id !== sessionId) return;

        const totalInserted = Number(event.data.total_paid);
        if (!Number.isFinite(totalInserted) || totalInserted < 0) return;
        if (event.data.pulse_type === 'bill_inserted') setBillInserted(totalInserted);
        if (event.data.pulse_type === 'coin_inserted') setCoinInserted(totalInserted);

        if (totalInserted >= amountDue && !cashPaymentHandledRef.current) {
          cashPaymentHandledRef.current = true;
          const paymentMethod = event.data.pulse_type === 'bill_inserted' ? 'bill' : 'coin';
          const receipt: PaymentReceipt = {
            method: paymentMethod,
            amountPaid: totalInserted,
            changeDispensed: 0,
            coins5: 0,
            coins1: 0,
            notes: `Physical ${paymentMethod} acceptor. Inserted PHP ${totalInserted.toFixed(2)}.`,
          };
          void confirmCashPayment(receipt);
        }
      } catch {
        setCashPaymentError('Received an invalid cash payment update.');
      }
    };

    socket.onerror = () => {
      if (!disposed) setCashPaymentError('Could not connect to the live cash acceptor feed.');
    };

    return () => {
      disposed = true;
      socket.close();
      if (cashStarted) cancelCashPayment();
    };
  }, [hardware.connected, method, sessionId, amountDue]);

  // Process image file for QR Standee and save permanently to server
  const handleFileProcess = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const updated: CustomGCashConfig = {
        ...gcashConfig,
        customQrDataUrl: dataUrl,
      };
      setGcashConfig(updated);
      saveCustomGCashConfig(updated);

      // Save permanently to server disk (/public/father-gcash-qr.png)
      fetch('/api/kiosk/save-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: dataUrl }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (res.success) {
            setServerQrUrl(res.url);
          }
        })
        .catch((err) => console.error('Failed to save QR to server', err));
    };
    reader.readAsDataURL(file);
  };

  // Custom QR Standee Image Upload via File Input
  const handleCustomQrUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileProcess(file);
  };

  // Drag & Drop handlers
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileProcess(file);
  };

  // Customer uploads screenshot of their GCash payment receipt
  const handleProofUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setCustomerReceiptProof(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // Submit payment proof (reference or receipt) to Owner App
  const handleSubmitProofToOwner = async () => {
    if (!gcashRefInput.trim() && !customerReceiptProof) {
      alert('Please enter your GCash Reference Number or attach a receipt screenshot.');
      return;
    }

    setIsSubmittingProof(true);
    try {
      const proofResponse = await fetch(`/api/payment/${sessionId}/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerReceipt: customerReceiptProof || undefined,
          customerRef: gcashRefInput.trim() || undefined,
        }),
      });
      if (!proofResponse.ok) throw new Error('Unable to send payment proof');
      setProofSubmitted(true);
    } catch {
      alert('Error communicating with server. Please try again.');
    } finally {
      setIsSubmittingProof(false);
    }
  };

  // Active QR image source (Server permanent image > local storage > fallback)
  const activeQrImage = serverQrUrl || gcashConfig.customQrDataUrl;

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onBackToOptions}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Print Settings
        </button>

        <div className="text-right">
          <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
            Total Amount Due
          </div>
          <div className="text-3xl font-black text-emerald-400 font-mono">
            ₱{amountDue.toFixed(method === 'gcash' ? 2 : 0)}
          </div>
        </div>
      </div>

      <div className="health-glass-panel mb-5 px-4 py-3 text-sm font-bold text-white" role="note">
        {method === 'gcash'
          ? `NOTICE: A 2.00 PHP convenience fee is added to your exact total. Base: ₱${baseExactCost.toFixed(2)} + fee: ₱2.00 = ₱${amountDue.toFixed(2)}.`
          : method
            ? 'WARNING: Exact amount only. The machine does not dispense change.'
            : 'Select GCash, Coin, or Bill to continue.'}
      </div>

      {/* 3 Distinct Payment Method Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {/* Tab 1: GCash QR */}
        <button
          onClick={() => internetOnline && !gcashUnavailable && setMethod('gcash')}
          disabled={!internetOnline || gcashUnavailable}
          className={`relative p-4 rounded-2xl border-2 transition text-left cursor-pointer flex flex-col justify-between ${
            !internetOnline || gcashUnavailable
              ? 'opacity-40 bg-slate-900 border-slate-800 cursor-not-allowed'
              : method === 'gcash'
              ? 'bg-slate-900 border-blue-500 shadow-xl shadow-blue-500/10 ring-2 ring-blue-500/20'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          {!internetOnline && (
            <div className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <WifiOff className="w-3 h-3" /> Offline
            </div>
          )}
          {internetOnline && gcashUnavailable && (
            <div className="absolute top-3 right-3 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-200/30 bg-white/15 text-amber-100">
              Outside hours
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-black">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-white text-sm">GCash e-Wallet</div>
              <div className="text-[11px] text-blue-400 font-medium">QR Ph & PayMongo</div>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-slate-400">
            Scan via GCash App or Camera
          </div>
        </button>

        {/* Tab 2: Bill Acceptor (Bills Only) */}
        <button
          onClick={() => setMethod('bill')}
          className={`p-4 rounded-2xl border-2 transition text-left cursor-pointer flex flex-col justify-between ${
            !hardware.connected
              ? 'opacity-40 bg-slate-900 border-slate-800 cursor-not-allowed'
              : method === 'bill'
              ? 'bg-slate-900 border-emerald-500 shadow-xl shadow-emerald-500/10 ring-2 ring-emerald-500/20'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-white text-sm">Bill Acceptor</div>
              <div className="text-[11px] text-emerald-400 font-medium">Bills Only (TB74)</div>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Accepts ₱20, ₱50, ₱100</span>
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60">
              Coin Slot Locked
            </span>
          </div>
        </button>

        {/* Tab 3: Coin Acceptor (Coins Only) */}
        <button
          onClick={() => setMethod('coin')}
          className={`p-4 rounded-2xl border-2 transition text-left cursor-pointer flex flex-col justify-between ${
            !hardware.connected
              ? 'opacity-40 bg-slate-900 border-slate-800 cursor-not-allowed'
              : method === 'coin'
              ? 'bg-slate-900 border-amber-500 shadow-xl shadow-amber-500/10 ring-2 ring-amber-500/20'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-white text-sm">Coin Acceptor</div>
              <div className="text-[11px] text-amber-400 font-medium">Coins Only (Allan 1239A)</div>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Accepts ₱1, ₱5, ₱10, ₱20</span>
            <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">
              Bill Slot Locked
            </span>
          </div>
        </button>
      </div>

      {gcashUnavailable && (
        <div className="health-glass-panel mb-6 px-4 py-3 text-sm font-semibold leading-relaxed text-white" role="status">
          GCash payments are only available from {formatOperatingTime(operatingHours.gcash_start_time)} to {formatOperatingTime(operatingHours.gcash_end_time)}. Please use Coins or Bills.
        </div>
      )}

      {/* Main Payment Viewport Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
        {/* ======================================================== */}
        {/* OPTION 1: GCASH QR PAYMENT VIEW (PERMANENT QR & REMOTE)  */}
        {/* ======================================================== */}
        {method === 'gcash' && (
          <div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800 mb-6">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-black">
                    G
                  </span>
                  GCash InstaPay Gateway
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Scan the genuine GCash QR code below. Monitored & authorized remotely by the owner.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-xs font-bold">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Genuine QR Code
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-950/80 border border-blue-700/60 text-blue-300 text-xs font-bold">
                  <Eye className="w-3.5 h-3.5 text-blue-400" /> Remote Owner Approval
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              {/* QR Display Column */}
              <div className="md:col-span-6 flex flex-col items-center justify-center p-5 bg-slate-950/80 border border-slate-800 rounded-2xl text-center">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(true);
                  }}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={handleDrop}
                  className="w-full flex flex-col items-center"
                >
                  <div className="w-full max-w-[280px] bg-gradient-to-b from-blue-600 via-blue-700 to-blue-900 p-4 rounded-3xl shadow-2xl border border-blue-400/40 text-white text-center">
                    <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-blue-100 mb-2 px-1">
                      <span>GCASH / INSTAPAY</span>
                      <span className="bg-blue-800/80 px-2 py-0.5 rounded-full text-[10px] text-blue-200">
                        Scan to Pay
                      </span>
                    </div>

                    <div className="bg-white p-3 rounded-2xl shadow-inner flex flex-col items-center">
                      <img
                        src={activeQrImage || '/father-gcash-qr.png'}
                        alt="Father's GCash QR"
                        className="w-full h-auto rounded-xl object-contain max-h-[250px] mx-auto"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          if (target.src.includes('data:image')) {
                            target.src = '/father-gcash-qr.png';
                          } else {
                            target.style.display = 'none';
                          }
                        }}
                      />
                    </div>

                    <div className="mt-3">
                      <div className="text-base font-black text-white tracking-wide">
                        {gcashConfig.merchantName || 'APOLINARIO R.'}
                      </div>
                      <div className="text-xs text-blue-200 font-mono mt-0.5">
                        Mobile: +63 {gcashConfig.mobileNumber ? gcashConfig.mobileNumber.replace(/^0/, '') : '992 726 4487'}
                      </div>
                      <div className="text-[11px] text-blue-300 font-mono">
                        User ID: ••••••••••{gcashConfig.userId || '0FSQT7'}
                      </div>
                    </div>

                    {/* Exact Price Banner to type into GCash */}
                    <div className="mt-3 pt-2.5 border-t border-blue-400/30 bg-blue-950/60 rounded-xl p-2.5">
                      <div className="text-[11px] uppercase font-bold text-blue-200">
                        Exact Amount to Enter:
                      </div>
                      <div className="text-2xl font-black text-emerald-300 font-mono tracking-tight">
                        ₱{amountDue.toFixed(method === 'gcash' ? 2 : 0)}
                      </div>
                    </div>
                  </div>

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleCustomQrUpload}
                    accept="image/*"
                    className="hidden"
                  />

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" /> Update QR Code
                    </button>
                    <button
                      onClick={() => setShowConfigModal(true)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition"
                    >
                      Edit Account Info
                    </button>
                  </div>

                  <p className="mt-3 text-[11px] text-slate-400 max-w-xs leading-relaxed">
                    💡 This is the genuine GCash InstaPay standee. GCash app will recognize it seamlessly without &quot;invalid QR&quot; errors.
                  </p>
                </div>
              </div>

              {/* Action and Remote Approval Column */}
              <div className="md:col-span-6 space-y-4">
                {/* Live Remote Listening Status Card */}
                <div className={`border rounded-2xl p-4 relative overflow-hidden transition-all duration-300 ${
                  isApprovedByOwner
                    ? 'bg-emerald-950/80 border-emerald-500 shadow-lg shadow-emerald-900/40'
                    : isRejectedByOwner
                      ? 'bg-rose-950/80 border-rose-500 shadow-lg shadow-rose-900/30'
                      : 'bg-slate-950 border-slate-800'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Live Terminal Status
                    </span>
                    {isApprovedByOwner ? (
                      <span className="flex items-center gap-1.5 text-xs text-emerald-300 font-bold bg-emerald-900/90 px-3 py-1 rounded-full border border-emerald-500">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        Transaction Confirmed!
                      </span>
                    ) : isRejectedByOwner ? (
                      <span className="flex items-center gap-1.5 text-xs text-rose-200 font-bold bg-rose-950 px-3 py-1 rounded-full border border-rose-500">
                        Payment Rejected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-blue-400 font-bold bg-blue-950/80 px-2.5 py-1 rounded-full border border-blue-800/80">
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                        Pending Owner Verification
                      </span>
                    )}
                  </div>
                  <div className={`text-3xl font-black font-mono mt-1 ${isApprovedByOwner ? 'text-emerald-300' : isRejectedByOwner ? 'text-rose-200' : 'text-white'}`}>
                    ₱{amountDue.toFixed(method === 'gcash' ? 2 : 0)}
                  </div>
                  {isApprovedByOwner ? (
                    <div className="mt-2 space-y-1">
                      <div className="text-xs text-emerald-200 font-semibold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Payment verified by owner app. Starting print queue...
                      </div>
                      <div className="text-[11px] font-mono text-emerald-300/80">
                        Approval Ref: {approvalRef}
                      </div>
                    </div>
                  ) : isRejectedByOwner ? (
                    <div className="mt-2 space-y-1">
                      <div className="text-xs text-rose-200 font-semibold">
                        The operator could not verify this GCash transfer. Printing was not started. Please ask the operator for help.
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        The transaction is not confirmed until the owner app approves it. Printing job begins automatically once confirmed.
                      </p>
                      <div className="text-[11px] text-amber-400/90 flex items-center gap-1 font-medium">
                        <span>🔒 Print locked until owner app approves payment</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Remote Order Screenshot & Receipt Card */}
                {orderScreenshotUrl && (
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-bold text-slate-200">
                          Order Receipt Sent to Owner
                        </span>
                      </div>
                      <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                        #{sessionId.slice(0, 8).toUpperCase()}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/80">
                      <img
                        src={orderScreenshotUrl}
                        alt="Order receipt thumbnail"
                        className="w-14 h-16 object-cover rounded-lg border border-slate-700 cursor-pointer shadow hover:opacity-90 transition"
                        onClick={() => {
                          const w = window.open('');
                          w?.document.write(`<img src="${orderScreenshotUrl}" style="max-width:100%; height:auto;" />`);
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {pricing.total_sheets_to_feed} page(s) • {pricingColorMode === 'color' ? 'Color' : 'B&W'}
                        </div>
                        <div className="text-[11px] text-emerald-400 font-mono font-bold">
                          Amount Due: ₱{amountDue.toFixed(method === 'gcash' ? 2 : 0)}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Sent to remote owner for instant inspection.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Customer Payment Proof / Reference Submission Box */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                  <div className="text-xs font-bold text-slate-200 mb-2 flex items-center justify-between">
                    <span>Customer Payment Verification</span>
                    <span className="text-[11px] text-blue-400 font-semibold">Notify Owner</span>
                  </div>

                  {proofSubmitted ? (
                    <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 text-xs flex items-center gap-2.5">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div>
                        <div className="font-bold text-white">Proof Sent to Owner!</div>
                        <div className="text-[11px] text-emerald-300/90 mt-0.5">
                          The owner has been notified to check their GCash and approve printing.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                          GCash Transaction Ref No. (Optional)
                        </label>
                        <input
                          type="text"
                          value={gcashRefInput}
                          onChange={(e) => setGcashRefInput(e.target.value)}
                          placeholder="e.g. 1029 4819 2831"
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                          Attach GCash Receipt Screenshot (Optional)
                        </label>
                        <input
                          type="file"
                          ref={proofInputRef}
                          onChange={handleProofUpload}
                          accept="image/*"
                          className="hidden"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => proofInputRef.current?.click()}
                            className="flex-1 py-2 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-300 flex items-center justify-center gap-1.5 transition cursor-pointer"
                          >
                            <Upload className="w-3.5 h-3.5 text-blue-400" />
                            {customerReceiptProof ? 'Receipt Attached ✓' : 'Upload Receipt Screenshot'}
                          </button>
                          {customerReceiptProof && (
                            <button
                              type="button"
                              onClick={() => setCustomerReceiptProof(null)}
                              className="p-2 text-rose-400 hover:text-rose-300 bg-slate-900 border border-slate-700 rounded-xl"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={handleSubmitProofToOwner}
                        disabled={isSubmittingProof}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {isSubmittingProof ? (
                          <span>Sending to Owner...</span>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Send Payment Proof</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  <div className="text-[10px] text-slate-500 mt-2">
                    Once the owner clicks &quot;Approve Printing&quot; on their phone, the kiosk prints immediately.
                  </div>
                </div>

                {/* Owner Companion App Connected Indicator */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 shrink-0 animate-pulse" />
                    <div className="min-w-0">
                      <div className="font-bold text-slate-200 flex items-center gap-2">
                        <span>Owner Approval App (port 3001)</span>
                        <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800/80 px-2 py-0.5 rounded-full font-mono font-semibold">
                          Live Active
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate font-mono mt-0.5">
                        Approval Hub on Mobile & Web
                      </div>
                    </div>
                  </div>

                  <span className="text-[10px] text-slate-500 text-right">Approve from the owner phone app</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* OPTION 2: BILL ACCEPTOR ONLY (TB74)                      */}
        {/* ======================================================== */}
        {method === 'bill' && (
          <div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800 mb-6">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <Banknote className="w-5 h-5 text-emerald-400" />
                  TB74 Bill Acceptor (Bills Only)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Feed paper banknotes into the illuminated bill slot.
                </p>
              </div>
            </div>

            {cashPaymentError && <div role="alert" className="mb-4 rounded-lg border border-rose-700 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{cashPaymentError}</div>}

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              {/* Inserted Display */}
              <div className="md:col-span-6 bg-slate-950 rounded-2xl border border-slate-800 p-6 text-center">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  INSERTED BILLS
                </div>
                <div className="text-5xl font-black text-emerald-400 font-mono tracking-tight mb-2">
                  ₱{billInserted.toFixed(2)}
                </div>

                <div className="text-xs font-semibold mb-4">
                  {billRemaining > 0 ? (
                    <span className="text-rose-400">
                      Remaining Amount Due: ₱{billRemaining.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-emerald-400 flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Bill Amount Fully Covered!
                    </span>
                  )}
                </div>

              </div>

              {/* Bill acceptor status */}
              <div className="md:col-span-6 space-y-4">
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Insert banknotes into the bill acceptor
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    TB74 Optical Bill Validator validates Philippine New Generation Currency banknotes.
                  </p>
                </div>

                <div className="w-full py-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-300 font-bold text-sm text-center">
                  {billInserted >= amountDue
                    ? 'Payment accepted. Starting print...'
                    : `Insert ₱${billRemaining.toFixed(2)} More in Bills`}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* OPTION 3: COIN ACCEPTOR ONLY (Allan 1239A)               */}
        {/* ======================================================== */}
        {method === 'coin' && (
          <div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800 mb-6">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <Coins className="w-5 h-5 text-amber-400" />
                  Allan 1239A Multi-Coin Acceptor (Coins Only)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Drop coins into the top coin slot.
                </p>
              </div>

              {/* Hardware slot lock indicators */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-950/80 border border-amber-800/80 text-amber-400 text-xs font-bold">
                  <Unlock className="w-3.5 h-3.5" /> Coin Slot: ACTIVE
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-950 border border-slate-800 text-rose-400 text-xs font-bold">
                  <Lock className="w-3.5 h-3.5 text-rose-500" /> Bill Slot: LOCKED
                </div>
              </div>
            </div>

            {cashPaymentError && <div role="alert" className="mb-4 rounded-lg border border-rose-700 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{cashPaymentError}</div>}

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              {/* Inserted Display */}
              <div className="md:col-span-6 bg-slate-950 rounded-2xl border border-slate-800 p-6 text-center">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  INSERTED COINS
                </div>
                <div className="text-5xl font-black text-amber-400 font-mono tracking-tight mb-2">
                  ₱{coinInserted.toFixed(2)}
                </div>

                <div className="text-xs font-semibold mb-4">
                  {coinRemaining > 0 ? (
                    <span className="text-rose-400">
                      Remaining Amount Due: ₱{coinRemaining.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-amber-400 flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Coin Amount Fully Covered!
                    </span>
                  )}
                </div>

              </div>

              {/* Coin acceptor status */}
              <div className="md:col-span-6 space-y-4">
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Insert coins into the coin acceptor
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Allan 1239A Intelligent Multi-Coin Selector validates weight, diameter, and alloy pulse rates.
                  </p>
                </div>

                <div className="w-full py-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-300 font-bold text-sm text-center">
                  {coinInserted >= amountDue
                    ? 'Payment accepted. Starting print...'
                    : `Insert ₱${coinRemaining.toFixed(2)} More in Coins`}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* KIOSK OWNER GCASH CONFIGURATION MODAL                   */}
      {/* ======================================================== */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-md w-full relative shadow-2xl">
            <button
              onClick={() => setShowConfigModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-lg font-black text-white mb-1">Configure Store GCash / QR Ph</h3>
            <p className="text-xs text-slate-400 mb-4">
              Configured with your Father&apos;s GCash account from your QR Ph image. The QR code dynamically sets the exact print job price (₱{amountDue.toFixed(2)}) while sending funds to his account.
            </p>

            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                  GCash Account Name (Masked or Full)
                </label>
                <input
                  type="text"
                  value={gcashConfig.merchantName}
                  onChange={(e) =>
                    setGcashConfig((prev) => ({ ...prev, merchantName: e.target.value }))
                  }
                  placeholder="e.g. AP*******O R."
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                  GCash Mobile Number (+63 992 726 ...)
                </label>
                <input
                  type="text"
                  value={gcashConfig.mobileNumber}
                  onChange={(e) =>
                    setGcashConfig((prev) => ({ ...prev, mobileNumber: e.target.value }))
                  }
                  placeholder="0992-XXX-XXXX"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                  User ID (InstaPay Reference)
                </label>
                <input
                  type="text"
                  value={gcashConfig.userId || '0FSQT7'}
                  onChange={(e) =>
                    setGcashConfig((prev) => ({ ...prev, userId: e.target.value }))
                  }
                  placeholder="e.g. 0FSQT7"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  saveCustomGCashConfig(gcashConfig);
                  setShowConfigModal(false);
                }}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition"
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

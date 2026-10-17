import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Printer,
  Smartphone,
  AlertCircle,
  RefreshCw,
  QrCode,
  DollarSign,
  FileText,
  Volume2,
  VolumeX,
  ExternalLink,
  ShieldCheck,
  Eye,
  Check,
  X,
  Layers,
  Sparkles,
} from 'lucide-react';
import { QRCodeCanvas } from './QRCodeCanvas';
import { kioskApiUrl } from '../utils/kioskApi';
import { AdminSettings } from './AdminSettings';

interface OrderItem {
  id: string;
  sessionId: string;
  orderId?: string;
  amount: number;
  fileName: string;
  pageCount: number;
  copies: number;
  colorMode: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: number;
  orderScreenshot?: string;
  customerReceipt?: string;
  customerRef?: string;
  reference?: string;
  notes?: string;
  approvedAt?: number;
}

interface CashierStats {
  todayGcash: number;
  todayPages: number;
  totalOrders: number;
}

export const CashierTerminal: React.FC = () => {
  const [activeView, setActiveView] = useState<'orders' | 'settings'>('orders');
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [pendingOrders, setPendingOrders] = useState<OrderItem[]>([]);
  const [stats, setStats] = useState<CashierStats>({ todayGcash: 0, todayPages: 0, totalOrders: 0 });
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [latencyMs, setLatencyMs] = useState<number>(45);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showMobileQr, setShowMobileQr] = useState<boolean>(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date>(new Date());
  const [isQuickTesting, setIsQuickTesting] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const previousPendingCount = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Sound chime when new order arrives
  const playChime = () => {
    if (!soundEnabled) return;
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.42);
      }
    } catch {
      // audio error ignored
    }
  };

  // Poll kiosk backend for pending orders every 1.5s
  const fetchOrders = async () => {
    const startTime = performance.now();
    try {
      const res = await fetch(kioskApiUrl('/api/kiosk/pending-payments?format=full'), { cache: 'no-store' });
      const elapsed = Math.round(performance.now() - startTime);
      setLatencyMs(elapsed > 0 ? elapsed : 35);
      setIsOnline(true);
      setLastCheckTime(new Date());

      if (!res.ok) return;
      const data = await res.json();

      const allOrders: OrderItem[] = Array.isArray(data.orders) ? data.orders : [];
      const pending: OrderItem[] = Array.isArray(data.pending) ? data.pending : [];

      // Check if new pending order arrived
      if (pending.length > previousPendingCount.current) {
        playChime();
      }
      previousPendingCount.current = pending.length;

      setOrders(allOrders);
      setPendingOrders(pending);

      setStats({
        todayGcash: Number(data.todayGcash) || allOrders.filter(o => o.status === 'approved').reduce((s, o) => s + (o.amount || 0), 0),
        todayPages: Number(data.todayPages) || allOrders.filter(o => o.status === 'approved').reduce((s, o) => s + ((o.pageCount || 1) * (o.copies || 1)), 0),
        totalOrders: allOrders.length,
      });
    } catch {
      setIsOnline(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 1500);
    return () => clearInterval(interval);
  }, []);

  // Listen to BroadcastChannel for instant same-browser cross-tab sync
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel('kiosk_owner_bridge');
      channel.onmessage = (event) => {
        if (event.data?.type === 'ORDER_PENDING' || event.data?.type === 'ORDER_PROOF_SUBMITTED') {
          fetchOrders();
        }
      };
    }
    return () => {
      channel?.close();
    };
  }, []);

  // Approve Order Handler
  const handleApprove = async (order: OrderItem) => {
    setApprovingId(order.sessionId);
    try {
      const genRef = `GCASH-APPV-${order.sessionId.slice(-6).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const res = await fetch(kioskApiUrl(`/api/payment/${order.sessionId}/approve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: order.sessionId,
          reference: genRef,
          notes: 'Approved via PrintPoint Cashier Terminal',
          amount: order.amount,
        }),
      });

      // Broadcast across tabs for instant multi-tab sync
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const channel = new BroadcastChannel('kiosk_owner_bridge');
        channel.postMessage({
          type: 'APPROVE_ORDER',
          sessionId: order.sessionId,
          amount: order.amount,
          reference: genRef,
        });
        channel.close();
      }

      setActionNotice(`✅ Approved order ${order.sessionId}! Kiosk has started printing.`);
      setTimeout(() => setActionNotice(null), 4000);

      await fetchOrders();
    } catch (e: any) {
      alert(`Approval error: ${e.message}`);
    } finally {
      setApprovingId(null);
    }
  };

  // Reject Order Handler
  const handleReject = async (order: OrderItem) => {
    const reason = prompt('Reason for rejection / flagging:', 'Payment not received in GCash app');
    if (reason === null) return;

    setRejectingId(order.sessionId);
    try {
      await fetch(kioskApiUrl(`/api/payment/${order.sessionId}/reject`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: order.sessionId,
          reason,
        }),
      });

      setActionNotice(`❌ Order ${order.sessionId} was rejected.`);
      setTimeout(() => setActionNotice(null), 4000);

      await fetchOrders();
    } catch (e: any) {
      alert(`Reject error: ${e.message}`);
    } finally {
      setRejectingId(null);
    }
  };

  // Quick Test Order simulation
  const handleQuickTest = async () => {
    setIsQuickTesting(true);
    try {
      const randomPages = Math.floor(Math.random() * 4) + 2;
      const amount = randomPages * 3.0;
      await fetch(kioskApiUrl('/api/kiosk/test-order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          fileName: `Sample_Document_${Math.floor(100 + Math.random() * 900)}.pdf`,
          pageCount: randomPages,
          copies: 1,
          colorMode: Math.random() > 0.5 ? 'bw' : 'color',
        }),
      });
      playChime();
      await fetchOrders();
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsQuickTesting(false);
    }
  };

  const cashierUrl = typeof window !== 'undefined' ? `${window.location.origin}/?cashier=true` : '';
  const kioskUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const approvedOrders = orders.filter((o) => o.status === 'approved');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* CASHIER TOP BAR */}
      <header className="bg-slate-900/90 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white font-bold">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-white">PrintPoint CASHIER</h1>
                <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-500/30">
                  OWNER TERMINAL
                </span>
              </div>
              <p className="text-xs text-slate-400">GCash Approval Hub • Real-Time Kiosk Monitor</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-white/20 bg-white/10 p-1">
              <button type="button" onClick={() => setActiveView('orders')} aria-pressed={activeView === 'orders'} className={`rounded-lg px-3 py-2 text-xs font-bold ${activeView === 'orders' ? 'bg-white/20 text-white' : 'text-white/70'}`}>
                Orders
              </button>
              <button type="button" onClick={() => setActiveView('settings')} aria-pressed={activeView === 'settings'} className={`rounded-lg px-3 py-2 text-xs font-bold ${activeView === 'settings' ? 'bg-white/20 text-white' : 'text-white/70'}`}>
                Settings
              </button>
            </div>
            {/* Live Telemetry Pill */}
            <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/80 rounded-full px-3 py-1.5 text-xs">
              <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="font-mono text-slate-300">
                {isOnline ? `Kiosk Online (${latencyMs}ms)` : 'Kiosk Offline'}
              </span>
            </div>

            {/* Sound Toggle */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title={soundEnabled ? 'Mute Alert Sound' : 'Enable Alert Sound'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
            </button>

            {/* Mobile QR Share */}
            <button
              onClick={() => setShowMobileQr(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30 text-xs font-semibold transition-colors"
              title="Open Cashier Terminal on Mobile Phone"
            >
              <Smartphone className="w-4 h-4" />
              <span className="hidden sm:inline">Phone QR</span>
            </button>

            {/* Switch to Kiosk Screen */}
            <a
              href={kioskUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
            >
              <span>Kiosk View</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
          </div>
        </div>
      </header>

      {/* ACTION NOTICE TOAST */}
      {actionNotice && (
        <div className="bg-emerald-600 text-white font-bold text-center text-sm py-2 px-4 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1 space-y-6">
        {activeView === 'settings' ? <AdminSettings /> : <>
        {/* TOP STATS CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Pending Card */}
          <div className={`p-5 rounded-2xl border transition-all ${
            pendingOrders.length > 0
              ? 'bg-amber-950/40 border-amber-500/60 shadow-lg shadow-amber-950/30'
              : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Pending Approvals
              </span>
              <span className={`w-2.5 h-2.5 rounded-full ${pendingOrders.length > 0 ? 'bg-amber-400 animate-ping' : 'bg-slate-600'}`} />
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-4xl font-black font-mono ${pendingOrders.length > 0 ? 'text-amber-400' : 'text-slate-200'}`}>
                {pendingOrders.length}
              </span>
              <span className="text-xs text-slate-400">customers waiting</span>
            </div>
          </div>

          {/* Shift Revenue Card */}
          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Today's GCash
              </span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black font-mono text-emerald-400">
                ₱{stats.todayGcash.toFixed(2)}
              </span>
              <span className="text-xs text-slate-400">total collected</span>
            </div>
          </div>

          {/* Total Pages Printed */}
          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Total Pages
              </span>
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black font-mono text-blue-400">
                {stats.todayPages}
              </span>
              <span className="text-xs text-slate-400">sheets printed</span>
            </div>
          </div>
        </div>

        {/* PENDING APPROVALS SECTION */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black uppercase tracking-wider text-slate-200">
                Active GCash Orders
              </h2>
              {pendingOrders.length > 0 && (
                <span className="bg-amber-500 text-slate-950 font-black text-xs px-2 py-0.5 rounded-full">
                  {pendingOrders.length} ACTION NEEDED
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleQuickTest}
                disabled={isQuickTesting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-all disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>+ Quick Test Kiosk Order</span>
              </button>

              <button
                onClick={fetchOrders}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                title="Refresh manually"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* If No Pending Orders */}
          {pendingOrders.length === 0 ? (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-10 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-400">
                <CheckCircle2 className="w-7 h-7 text-slate-500" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h3 className="text-base font-bold text-slate-200">Cashier Standby</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  No customers are currently waiting at the kiosk payment screen. The app continuously checks every 1.5s.
                </p>
              </div>
              <div>
                <button
                  onClick={handleQuickTest}
                  disabled={isQuickTesting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-xs font-bold transition-colors"
                >
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  Simulate a customer at kiosk to test alerts
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {pendingOrders.map((order) => {
                const isApproving = approvingId === order.sessionId;
                const isRejecting = rejectingId === order.sessionId;
                const elapsedSec = Math.floor((Date.now() - order.timestamp) / 1000);

                return (
                  <div
                    key={order.sessionId}
                    className="bg-slate-900 border-2 border-amber-500/80 rounded-2xl p-5 shadow-2xl shadow-amber-950/30 transition-all space-y-4"
                  >
                    {/* Order Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-3 h-3 rounded-full bg-amber-400 animate-ping" />
                        <span className="font-mono text-sm font-bold text-amber-400 uppercase">
                          Order #{order.sessionId}
                        </span>
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Waiting for {elapsedSec}s
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Total Price:</span>
                        <span className="text-2xl font-black font-mono text-emerald-400">
                          ₱{order.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Order Details & Proof Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Document Details */}
                      <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 space-y-2 text-xs">
                        <div className="font-bold text-slate-300 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-400" /> Print Specifications
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-slate-300">
                          <div>
                            <span className="text-slate-500 block text-[11px]">File:</span>
                            <span className="font-semibold truncate block" title={order.fileName}>
                              {order.fileName}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[11px]">Pages / Copies:</span>
                            <span className="font-semibold">
                              {order.pageCount} pgs × {order.copies} copy
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[11px]">Color Mode:</span>
                            <span className="font-semibold uppercase">
                              {order.colorMode === 'color' ? '🎨 Full Color' : '📄 Black & White'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[11px]">Customer Ref #:</span>
                            <span className="font-mono font-bold text-blue-300">
                              {order.customerRef || 'Not entered yet'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Receipt & Screenshot Preview */}
                      <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs">
                        <div className="space-y-1">
                          <div className="font-bold text-slate-300 flex items-center gap-1.5">
                            <Eye className="w-3.5 h-3.5 text-purple-400" /> Visual Verification
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            {order.customerReceipt
                              ? 'Customer attached payment screenshot!'
                              : order.orderScreenshot
                              ? 'Kiosk order breakdown receipt ready.'
                              : 'Waiting for customer to scan standee.'}
                          </p>
                        </div>

                        {(order.customerReceipt || order.orderScreenshot) && (
                          <button
                            onClick={() => setPreviewImage(order.customerReceipt || order.orderScreenshot || null)}
                            className="flex-shrink-0 relative group rounded-lg overflow-hidden border border-slate-700 w-16 h-16 bg-slate-900"
                            title="Click to zoom receipt"
                          >
                            <img
                              src={order.customerReceipt || order.orderScreenshot}
                              alt="Receipt"
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                              <Eye className="w-4 h-4" />
                            </div>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                      <button
                        onClick={() => handleApprove(order)}
                        disabled={isApproving || isRejecting}
                        className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm tracking-wide shadow-lg shadow-emerald-700/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                      >
                        {isApproving ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Confirming & Starting Kiosk Print...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-5 h-5" />
                            <span>Approve ₱{order.amount.toFixed(2)} & Release Print</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => handleReject(order)}
                        disabled={isApproving || isRejecting}
                        className="w-full sm:w-auto py-3 px-4 rounded-xl bg-slate-800 hover:bg-red-950/60 hover:text-red-400 text-slate-400 font-bold text-xs border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject / Flag</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RECENT APPROVED TRANSACTIONS */}
        <div className="space-y-3">
          <h2 className="text-base font-black uppercase tracking-wider text-slate-200">
            Recent Approved Transactions ({approvedOrders.length})
          </h2>

          {approvedOrders.length === 0 ? (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 text-center text-slate-500 text-xs">
              No approved transactions recorded in this shift yet.
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-800/80 text-xs">
              {approvedOrders.slice(0, 10).map((order) => (
                <div key={order.sessionId} className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-800/30">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                      <Check className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-200">{order.fileName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        Ref: {order.reference || 'GCASH-APPV'} • {new Date(order.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold font-mono text-emerald-400 text-sm">
                      ₱{order.amount.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {order.pageCount * order.copies} sheet(s)
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </>}
      </main>

      {/* MODAL: IMAGE PREVIEW */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-lg w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <span className="font-bold text-sm text-slate-200">Payment Verification Image</span>
              <button
                onClick={() => setPreviewImage(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto flex items-center justify-center rounded-xl bg-slate-950 p-2">
              <img src={previewImage} alt="Preview" className="max-w-full h-auto object-contain rounded-lg" />
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MOBILE QR CODE */}
      {showMobileQr && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setShowMobileQr(false)}
        >
          <div className="relative max-w-sm w-full bg-slate-900 border border-slate-700 rounded-2xl p-6 text-center space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="font-bold text-sm text-slate-200">Open on Your Smartphone</span>
              <button
                onClick={() => setShowMobileQr(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-white rounded-2xl inline-block shadow-inner">
              <QRCodeCanvas value={cashierUrl} size={220} />
            </div>

            <div className="text-xs text-slate-300 leading-relaxed">
              Scan this QR code with your phone camera or tablet to approve kiosk customer print jobs anywhere in the shop.
            </div>

            <div className="bg-slate-950 p-2 rounded-xl text-[11px] font-mono text-slate-400 break-all select-all">
              {cashierUrl}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

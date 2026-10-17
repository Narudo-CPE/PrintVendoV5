import React, { useState } from 'react';
import {
  ShieldCheck,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Printer,
  Lock,
} from 'lucide-react';

interface MobilePaymentCheckoutProps {
  sessionId: string;
  amount: number;
}

export const MobilePaymentCheckout: React.FC<MobilePaymentCheckoutProps> = ({
  sessionId,
  amount,
}) => {
  const [phoneNumber, setPhoneNumber] = useState('0917-829-4102');
  const [mpin, setMpin] = useState('••••');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAuthorizePayment = async () => {
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const response = await fetch(`/api/payment/${sessionId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          method: 'gcash',
          amount,
          reference: `GCASH-PAY-${Date.now().toString(36).toUpperCase()}`,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to reach kiosk gateway');
      }

      // Also dispatch to BroadcastChannel and localStorage for same-device fallback
      if (typeof window !== 'undefined') {
        try {
          if ('BroadcastChannel' in window) {
            const channel = new BroadcastChannel(`kiosk_payment_${sessionId}`);
            channel.postMessage({ type: 'PAYMENT_CONFIRMED', sessionId, amount });
          }
          localStorage.setItem(
            `kiosk_payment_${sessionId}`,
            JSON.stringify({ confirmed: true, amount, time: Date.now() })
          );
        } catch {
          // ignore
        }
      }

      setIsSuccess(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Payment authorization failed');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen text-white flex flex-col items-center justify-center p-6 text-center relative selection:bg-sky-500">
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-500/15 rounded-full blur-[140px]" />
        </div>

        <div className="max-w-md w-full glass-modal p-8 shadow-2xl relative z-10 border-emerald-500/35">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-400/30 flex items-center justify-center mx-auto mb-4 animate-bounce shadow-[0_0_24px_rgba(16,185,129,0.3)]">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <span className="text-[11px] font-bold tracking-widest text-emerald-300 uppercase bg-emerald-500/15 px-3 py-1 rounded-full border border-emerald-500/30 mb-2 inline-block">
            Payment Confirmed
          </span>

          <h2 className="text-2xl font-black text-white mt-1 mb-2">
            ₱{amount.toFixed(2)} Paid Successfully!
          </h2>

          <p className="text-xs sm:text-sm text-slate-300 mb-6 leading-relaxed">
            Your payment was authorized and sent directly to the PrintPoint Kiosk terminal.
          </p>

          <div className="bg-black/40 border border-white/10 rounded-2xl p-4 text-left mb-6 space-y-2 text-xs shadow-inner">
            <div className="flex justify-between text-slate-400">
              <span>Merchant:</span>
              <span className="text-white font-semibold">PrintPoint Self-Service Kiosk</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Kiosk Session:</span>
              <span className="font-mono text-sky-400 font-bold">#{sessionId.slice(0, 8)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Payment Gateway:</span>
              <span className="text-white font-semibold">PayMongo GCash Gateway</span>
            </div>
            <div className="flex justify-between text-slate-400 pt-2 border-t border-white/10">
              <span className="text-white font-bold">Total Debited:</span>
              <span className="text-emerald-400 font-bold font-mono text-base">
                ₱{amount.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="glass-card border-sky-400/30 bg-sky-500/10 p-4 flex items-center gap-3 text-left">
            <Printer className="w-6 h-6 text-sky-400 shrink-0 animate-pulse" />
            <div className="text-xs text-slate-200">
              <p className="font-bold text-white">Look at the Kiosk Screen</p>
              <p className="text-[11px] text-slate-300 mt-0.5">
                The terminal has received your payment and is currently rasterizing & dispensing your pages.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center p-4 relative selection:bg-sky-500">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-96 h-96 bg-sky-500/15 rounded-full blur-[130px]" />
      </div>

      {/* Top GCash branded header banner */}
      <div className="max-w-md w-full glass-modal overflow-hidden shadow-2xl relative z-10">
        <div className="bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 p-6 text-white text-center relative border-b border-white/15">
          <div className="w-14 h-14 rounded-2xl bg-white text-blue-600 flex items-center justify-center mx-auto mb-3 font-black text-2xl shadow-xl">
            G
          </div>
          <h1 className="text-xl font-black tracking-tight">GCash Online Checkout</h1>
          <p className="text-xs text-sky-100 font-medium">Powered by PayMongo Gateway</p>

          <div className="absolute top-4 right-4 flex items-center gap-1 text-[10px] bg-white/20 backdrop-blur-md px-2.5 py-1 rounded-full text-white font-bold border border-white/20">
            <Lock className="w-3 h-3" /> 256-Bit SSL
          </div>
        </div>

        {/* Payment Summary Box */}
        <div className="p-6">
          <div className="bg-black/40 border border-white/10 rounded-2xl p-4 mb-6 shadow-inner">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-1">
              Amount Due to Merchant
            </div>
            <div className="text-3xl font-black text-emerald-400 font-mono">
              ₱{amount.toFixed(2)}
            </div>
            <div className="text-xs text-slate-400 mt-2 flex items-center justify-between pt-2 border-t border-white/10">
              <span>PrintPoint Kiosk</span>
              <span className="font-mono text-sky-400 font-semibold">Session #{sessionId.slice(0, 8)}</span>
            </div>
          </div>

          {errorMsg && (
            <div className="bg-rose-500/15 border border-rose-500/30 rounded-2xl p-3 text-xs text-rose-300 flex items-center gap-2 mb-4">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                GCash Registered Number
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="0917-XXX-XXXX"
                  className="glass-input w-full px-4 py-3 font-mono text-sm"
                />
                <Smartphone className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                  4-Digit MPIN
                </label>
                <span className="text-[11px] text-sky-400">Sandbox Test: 1234</span>
              </div>
              <input
                type="password"
                value={mpin}
                onChange={(e) => setMpin(e.target.value)}
                maxLength={4}
                className="glass-input w-full px-4 py-3 font-mono text-center tracking-widest text-xl"
              />
            </div>
          </div>

          <button
            onClick={handleAuthorizePayment}
            disabled={isProcessing}
            className="glass-btn-primary w-full py-4 text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Authorizing GCash...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5" />
                <span>Pay ₱{amount.toFixed(2)} Now</span>
              </>
            )}
          </button>

          <p className="text-[11px] text-slate-400 text-center mt-4 leading-relaxed">
            Upon confirmation, the kiosk terminal automatically detects the payment in real-time and starts printing immediately.
          </p>
        </div>
      </div>
    </div>
  );
};

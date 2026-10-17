import React, { useState } from 'react';
import {
  ShieldCheck,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Clock,
  Printer,
  ChevronRight,
  Sparkles,
  Lock,
  ArrowRight
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
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-slate-900 border-2 border-emerald-500/40 rounded-3xl p-8 shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-4 animate-bounce">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <span className="text-[11px] font-bold tracking-widest text-emerald-400 uppercase bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-800/60 mb-2 inline-block">
            Payment Confirmed
          </span>

          <h2 className="text-2xl font-black text-white mt-1 mb-2">
            ₱{amount.toFixed(2)} Paid Successfully!
          </h2>

          <p className="text-sm text-slate-300 mb-6 leading-relaxed">
            Your payment was authorized and sent directly to the PrintPoint Kiosk terminal.
          </p>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-left mb-6 space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Merchant:</span>
              <span className="text-white font-semibold">PrintPoint Self-Service Kiosk</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Kiosk Session:</span>
              <span className="font-mono text-blue-400">#{sessionId.slice(0, 8)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Payment Gateway:</span>
              <span className="text-white font-semibold">PayMongo GCash Gateway</span>
            </div>
            <div className="flex justify-between text-slate-400 pt-2 border-t border-slate-800">
              <span className="text-white font-bold">Total Debited:</span>
              <span className="text-emerald-400 font-bold font-mono text-sm">
                ₱{amount.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="bg-blue-950/40 border border-blue-800/60 rounded-2xl p-4 flex items-center gap-3 text-left">
            <Printer className="w-6 h-6 text-blue-400 shrink-0 animate-pulse" />
            <div className="text-xs text-blue-200">
              <p className="font-bold text-white">Look at the Kiosk Screen</p>
              <p className="text-[11px] text-blue-300">
                The terminal has received your payment and is currently rasterizing & feeding your pages.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
      {/* Top GCash branded header banner */}
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-sky-600 p-6 text-white text-center relative">
          <div className="w-14 h-14 rounded-2xl bg-white text-blue-600 flex items-center justify-center mx-auto mb-3 font-black text-2xl shadow-xl">
            G
          </div>
          <h1 className="text-xl font-black tracking-tight">GCash Online Checkout</h1>
          <p className="text-xs text-blue-100 font-medium">Powered by PayMongo Gateway</p>

          <div className="absolute top-4 right-4 flex items-center gap-1 text-[10px] bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full text-white font-bold">
            <Lock className="w-3 h-3" /> 256-Bit SSL
          </div>
        </div>

        {/* Payment Summary Box */}
        <div className="p-6">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 mb-6">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-1">
              Amount Due to Merchant
            </div>
            <div className="text-3xl font-black text-emerald-400 font-mono">
              ₱{amount.toFixed(2)}
            </div>
            <div className="text-xs text-slate-400 mt-2 flex items-center justify-between pt-2 border-t border-slate-900">
              <span>PrintPoint Kiosk</span>
              <span className="font-mono text-slate-500">Session #{sessionId.slice(0, 8)}</span>
            </div>
          </div>

          {errorMsg && (
            <div className="bg-rose-950/50 border border-rose-800/80 rounded-2xl p-3 text-xs text-rose-300 flex items-center gap-2 mb-4">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                GCash Registered Number
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="0917-XXX-XXXX"
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-sm focus:outline-none focus:border-blue-500 transition"
                />
                <Smartphone className="w-4 h-4 text-slate-500 absolute right-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                  4-Digit MPIN
                </label>
                <span className="text-[11px] text-blue-400">Sandbox Test: 1234</span>
              </div>
              <input
                type="password"
                value={mpin}
                onChange={(e) => setMpin(e.target.value)}
                maxLength={4}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-center tracking-widest text-xl focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <button
            onClick={handleAuthorizePayment}
            disabled={isProcessing}
            className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-black text-sm uppercase tracking-wider shadow-lg shadow-blue-600/30 transition flex items-center justify-center gap-2 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Authorizing GCash...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5" />
                <span>Pay ₱{amount.toFixed(2)} Now</span>
              </>
            )}
          </button>

          <p className="text-[11px] text-slate-500 text-center mt-4 leading-relaxed">
            Upon confirmation, the kiosk terminal automatically detects the payment in real-time and starts printing immediately.
          </p>
        </div>
      </div>
    </div>
  );
};

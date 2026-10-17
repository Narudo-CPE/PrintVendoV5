import React, { useState } from 'react';
import { CheckCircle2, ShieldCheck, Trash2, Clock3 } from 'lucide-react';
import { PricingBreakdown, PaymentMethod } from '../types';

interface ReceiptStepProps {
  sessionId: string;
  pricing: PricingBreakdown;
  paymentDetails: {
    method: PaymentMethod;
    amountPaid: number;
    changeDispensed: number;
    coins5: number;
    coins1: number;
    reference?: string;
  };
  completionData: Record<string, unknown> | null;
  onFilePrivacyChoice: (action: 'delete' | 'keep') => Promise<void>;
}

export const ReceiptStep: React.FC<ReceiptStepProps> = ({
  sessionId,
  pricing,
  paymentDetails,
  completionData,
  onFilePrivacyChoice,
}) => {
  const [pendingChoice, setPendingChoice] = useState<'delete' | 'keep' | null>(null);
  const [choiceError, setChoiceError] = useState('');

  const chooseFilePrivacy = async (action: 'delete' | 'keep') => {
    setPendingChoice(action);
    setChoiceError('');
    try {
      await onFilePrivacyChoice(action);
    } catch (error) {
      setChoiceError(error instanceof Error ? error.message : 'Could not save your file privacy choice.');
      setPendingChoice(null);
    }
  };
  const getGatewayLabel = (m: PaymentMethod) => {
    switch (m) {
      case 'gcash':
        return 'GCash (QR Ph / e-Wallet)';
      case 'bill':
        return 'TB74 Bill Acceptor (Bills Only)';
      case 'coin':
        return 'Allan 1239A Coin Acceptor (Coins Only)';
      default:
        return 'Cash Hardware';
    }
  };
  const pixelBreakdown = (completionData?.pixel_breakdown || completionData?.pricing_breakdown || completionData || {}) as Record<string, unknown>;
  const valueOf = (keys: string[], fallback: number) => {
    for (const key of keys) {
      const value = Number(pixelBreakdown[key]);
      if (Number.isFinite(value)) return value;
    }
    return fallback;
  };
  const pageCount = valueOf(['total_pages', 'pages', 'page_count'], pricing.total_sheets_to_feed);
  const paperCost = valueOf(['base_paper_cost', 'paper_cost', 'base_price_total'], pricing.base_price_total);
  const blackPixels = valueOf(
    ['total_black_pixels', 'black_pixels', 'grayscale_pixels', 'grayscale_pixel_count'],
    pricing.grayscale_pixel_count || 0
  );
  const blackCost = valueOf(
    ['black_cost', 'grayscale_cost', 'black_ink_cost'],
    pricing.grayscale_cost || 0
  );
  const colorPixels = valueOf(
    ['total_color_pixels', 'color_pixels', 'color_pixel_count'],
    pricing.color_pixel_count || 0
  );
  const colorCost = valueOf(
    ['color_cost', 'color_ink_cost'],
    pricing.color_cost || 0
  );
  const convenienceFee = paymentDetails.method === 'gcash' ? valueOf(['convenience_fee', 'fee'], 2) : 0;
  const finalTotal = valueOf(['final_total_cost', 'final_price', 'total_cost'], paymentDetails.amountPaid);
  return (
    <div className="max-w-md mx-auto py-12 px-4 relative z-10">
      <div className="glass-modal p-7 sm:p-8 relative overflow-hidden shadow-2xl border-emerald-500/30">
        {/* Subtle Ambient Emerald Flare */}
        <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-emerald-500/15 blur-2xl pointer-events-none" />

        {/* Receipt Header */}
        <div className="text-center pb-6 border-b border-dashed border-white/15">
          <div className="w-14 h-14 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-black tracking-tight text-white">PRINTPOINT KIOSK</h2>
          <p className="text-xs text-slate-400 font-medium">Official Transaction Summary</p>
          <div className="inline-block text-[11px] font-mono text-emerald-400/90 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20 mt-2">
            Session: #{sessionId.slice(0, 10).toUpperCase()}
          </div>
        </div>

        {/* Itemized computation */}
        <div className="py-6 space-y-2.5 text-xs border-b border-dashed border-white/15 font-mono text-slate-300">
          <div className="flex justify-between">
            <span className="text-slate-400 font-sans">Date & Time:</span>
            <span className="font-semibold text-white">{new Date().toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 font-sans">Total Pages:</span>
            <span className="font-bold text-white">{pageCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 font-sans">Base Paper Cost:</span>
            <span className="font-bold text-white">₱{paperCost.toFixed(2)}</span>
          </div>
          <div className="pt-2 border-t border-white/10 font-bold text-sky-300 font-sans">
            Ink Density Breakdown
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 font-sans">Black pixels ({blackPixels.toLocaleString()}):</span>
            <span className="font-bold text-white">₱{blackCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 font-sans">Color pixels ({colorPixels.toLocaleString()}):</span>
            <span className="font-bold text-white">₱{colorCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 font-sans">Payment Method:</span>
            <span className="font-bold uppercase text-sky-400">
              {getGatewayLabel(paymentDetails.method)}
            </span>
          </div>
          {paymentDetails.reference && (
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Reference:</span>
              <span className="font-mono font-bold text-sky-300">
                {paymentDetails.reference}
              </span>
            </div>
          )}
          {paymentDetails.method === 'gcash' && (
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Convenience Fee:</span>
              <span className="font-bold text-white">₱{convenienceFee.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold pt-3 border-t border-white/15 text-white font-sans">
            <span>Final Total Cost:</span>
            <span className="text-emerald-400 font-mono text-base font-black">₱{finalTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-white font-sans">
            <span>Amount Paid:</span>
            <span className="text-white font-mono">₱{paymentDetails.amountPaid.toFixed(2)}</span>
          </div>
        </div>

        {/* File Privacy Decision */}
        <div className="my-6 text-left">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
            What would you like to do with your uploaded file?
          </h3>
          <button
            type="button"
            disabled={pendingChoice !== null}
            onClick={() => void chooseFilePrivacy('delete')}
            className="glass-btn-danger w-full py-3 px-4 text-xs font-bold flex items-center justify-center gap-2 mb-2 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            {pendingChoice === 'delete' ? 'Deleting file...' : 'Delete File Right Away'}
          </button>
          <button
            type="button"
            disabled={pendingChoice !== null}
            onClick={() => void chooseFilePrivacy('keep')}
            className="glass-btn-secondary w-full py-3 px-4 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Clock3 className="w-4 h-4" />
            {pendingChoice === 'keep' ? 'Preserving temporary cache...' : 'Keep File'}
          </button>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-sky-400" />
            <span>Files are permanently purged automatically after 30 minutes for user privacy.</span>
          </p>
          {choiceError && <p role="alert" className="mt-3 text-xs text-rose-300">{choiceError}</p>}
        </div>
      </div>
    </div>
  );
};

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
  const blackPixels = valueOf(['total_black_pixels', 'black_pixels', 'grayscale_pixels'], 0);
  const blackCost = valueOf(['black_cost', 'grayscale_cost', 'black_ink_cost'], 0);
  const colorPixels = valueOf(['total_color_pixels', 'color_pixels'], 0);
  const colorCost = valueOf(['color_cost', 'color_ink_cost'], 0);
  const convenienceFee = paymentDetails.method === 'gcash' ? valueOf(['convenience_fee', 'fee'], 2) : 0;
  const finalTotal = valueOf(['final_total_cost', 'final_price', 'total_cost'], paymentDetails.amountPaid);
  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="bg-white text-slate-900 rounded-3xl p-8 shadow-2xl relative border-t-8 border-emerald-500 font-sans">
        {/* Receipt Header */}
        <div className="text-center pb-6 border-b-2 border-dashed border-slate-300">
          <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-black tracking-tight">PRINTPOINT KIOSK</h2>
          <p className="text-xs text-slate-500 font-medium">Official Transaction Summary</p>
          <div className="text-[11px] font-mono text-slate-400 mt-1">
            Session: {sessionId.slice(0, 12)}
          </div>
        </div>

        {/* Itemized computation */}
        <div className="py-6 space-y-3 text-xs border-b-2 border-dashed border-slate-300 font-mono">
          <div className="flex justify-between">
            <span className="text-slate-500">Date & Time:</span>
            <span className="font-bold text-slate-800">{new Date().toLocaleString()}</span>
          </div>
          <div className="flex justify-between"><span className="text-slate-500">Total Pages:</span><span className="font-bold text-slate-800">{pageCount}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Base Paper Cost:</span><span className="font-bold text-slate-800">₱{paperCost.toFixed(2)}</span></div>
          <div className="pt-2 border-t border-slate-200 font-bold text-slate-700">Ink Coverage</div>
          <div className="flex justify-between"><span className="text-slate-500">Black pixels ({blackPixels.toLocaleString()}):</span><span className="font-bold text-slate-800">₱{blackCost.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Color pixels ({colorPixels.toLocaleString()}):</span><span className="font-bold text-slate-800">₱{colorCost.toFixed(2)}</span></div>
          <div className="flex justify-between">
            <span className="text-slate-500">Payment Gateway:</span>
            <span className="font-bold uppercase text-slate-800">
              {getGatewayLabel(paymentDetails.method)}
            </span>
          </div>
          {paymentDetails.reference && (
            <div className="flex justify-between">
              <span className="text-slate-500">GCash Ref No:</span>
              <span className="font-mono font-bold text-blue-600">
                {paymentDetails.reference}
              </span>
            </div>
          )}
          {paymentDetails.method === 'gcash' && <div className="flex justify-between"><span className="text-slate-500">Convenience Fee:</span><span className="font-bold text-slate-800">₱{convenienceFee.toFixed(2)}</span></div>}
          <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-200"><span>Final Total Cost:</span><span>₱{finalTotal.toFixed(2)}</span></div>
          <div className="flex justify-between text-sm font-bold">
            <span>Amount Paid:</span>
            <span>₱{paymentDetails.amountPaid.toFixed(2)}</span>
          </div>
        </div>

        <div className="my-5 text-left">
          <h3 className="text-sm font-bold text-slate-800 mb-3">What would you like to do with your printed document?</h3>
          <button
            type="button"
            disabled={pendingChoice !== null}
            onClick={() => void chooseFilePrivacy('delete')}
            className="w-full min-h-12 px-4 py-3 rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {pendingChoice === 'delete' ? 'Deleting file...' : 'Delete File Right Away'}
          </button>
          <button
            type="button"
            disabled={pendingChoice !== null}
            onClick={() => void chooseFilePrivacy('keep')}
            className="w-full min-h-12 mt-2 px-4 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2"
          >
            <Clock3 className="w-4 h-4" />
            {pendingChoice === 'keep' ? 'Keeping file temporarily...' : 'Keep File'}
          </button>
          <p className="mt-2 text-xs leading-relaxed text-amber-800 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>For your privacy, your file will be automatically deleted after 30 minutes.</span>
          </p>
          {choiceError && <p role="alert" className="mt-3 text-sm text-rose-700">{choiceError}</p>}
        </div>
      </div>
    </div>
  );
};

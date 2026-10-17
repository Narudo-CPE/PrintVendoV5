import React, { useEffect, useState } from 'react';
import { Bluetooth, FileText, Printer, ShoppingBag, UploadCloud, ArrowRight, Sparkles, CheckCircle2, ShieldCheck, QrCode } from 'lucide-react';
import { PaperSize } from '../types';

interface KioskStartStepProps {
  onPrintDocument: () => void;
  onBuyBondpaper: () => void;
}

export const KioskStartStep: React.FC<KioskStartStepProps> = ({ onPrintDocument, onBuyBondpaper }) => (
  <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 py-12 text-center relative z-10">
    {/* Floating Glass Badge */}
    <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/[0.06] border border-white/15 backdrop-blur-md text-xs font-semibold text-sky-300 shadow-[0_4px_16px_rgba(0,0,0,0.25)] mb-6">
      <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)] animate-pulse" />
      <span>Touchscreen Automated Vendo Station</span>
    </div>

    {/* Hero Headline */}
    <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight max-w-2xl text-balance mb-4">
      Fast, Contactless Document Printing
    </h1>
    <p className="text-slate-300/80 text-sm sm:text-base max-w-xl mx-auto mb-10 leading-relaxed font-normal">
      Scan with your smartphone to upload your files instantly, or purchase premium bondpaper sheets directly from the dispenser.
    </p>

    {/* Two Primary Glass Action Cards */}
    <div className="grid w-full max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2 mb-10">
      {/* Card 1: Print Document */}
      <div
        role="button"
        tabIndex={0}
        onClick={onPrintDocument}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPrintDocument(); }}
        className="glass-card-interactive group p-8 sm:p-9 text-left flex flex-col justify-between relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-sky-400/50"
      >
        {/* Subtle Ambient Card Glow */}
        <div className="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-sky-500/15 blur-[50px] pointer-events-none group-hover:bg-sky-500/25 transition-all" />

        <div>
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500/20 to-blue-600/20 border border-sky-400/30 flex items-center justify-center text-sky-300 mb-6 group-hover:scale-105 group-hover:shadow-[0_0_24px_rgba(14,165,233,0.3)] transition-all">
            <Printer className="w-8 h-8" />
          </div>

          <h2 className="text-2xl font-black text-white tracking-tight mb-2 flex items-center justify-between">
            <span>Print Document</span>
            <span className="text-xs uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/30">
              Popular
            </span>
          </h2>

          <p className="text-sm text-slate-300/80 mb-6 leading-relaxed">
            Upload PDF, DOCX, JPG, or PNG files from your phone via QR Code or Bluetooth.
          </p>

          <ul className="space-y-2 text-xs text-slate-300/90 mb-8">
            <li className="flex items-center gap-2">
              <span className="text-sky-400 font-bold">✓</span>
              <span>Instant QR Mobile Upload (No app required)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-sky-400 font-bold">✓</span>
              <span>Accurate pixel-density ink pricing</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-sky-400 font-bold">✓</span>
              <span>Interactive multi-page canvas preview</span>
            </li>
          </ul>
        </div>

        <div className="glass-btn-primary w-full py-3.5 px-5 flex items-center justify-between text-sm group-hover:brightness-110">
          <span>Start Document Print</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>

      {/* Card 2: Buy Bondpaper */}
      <div
        role="button"
        tabIndex={0}
        onClick={onBuyBondpaper}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onBuyBondpaper(); }}
        className="glass-card-interactive group p-8 sm:p-9 text-left flex flex-col justify-between relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
      >
        {/* Subtle Ambient Card Glow */}
        <div className="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-emerald-500/15 blur-[50px] pointer-events-none group-hover:bg-emerald-500/25 transition-all" />

        <div>
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 mb-6 group-hover:scale-105 group-hover:shadow-[0_0_24px_rgba(16,185,129,0.3)] transition-all">
            <ShoppingBag className="w-8 h-8" />
          </div>

          <h2 className="text-2xl font-black text-white tracking-tight mb-2 flex items-center justify-between">
            <span>Buy Bondpaper</span>
            <span className="text-xs font-mono font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
              ₱1.00 / sheet
            </span>
          </h2>

          <p className="text-sm text-slate-300/80 mb-6 leading-relaxed">
            Dispense blank sheets or custom bordered forms directly with NEMA stepper accuracy.
          </p>

          <ul className="space-y-2 text-xs text-slate-300/90 mb-8">
            <li className="flex items-center gap-2">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>A4, Letter, and Long (8.5x13") paper sizes</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>Blank sheets or pre-saved border designs</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>Automated high-precision motorized feeder</span>
            </li>
          </ul>
        </div>

        <div className="glass-btn-emerald w-full py-3.5 px-5 flex items-center justify-between text-sm group-hover:brightness-110">
          <span>Select Bondpaper</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </div>

    {/* Bottom Quick Feature Highlights (Glass Micro-Cards) */}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 w-full max-w-4xl text-left">
      <div className="glass-card px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-400 shrink-0">
          <QrCode className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-xs font-bold text-white">Instant QR Upload</h3>
          <p className="text-[11px] text-slate-400">Scan camera, zero app installs</p>
        </div>
      </div>

      <div className="glass-card px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-400/20 flex items-center justify-center text-indigo-400 shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-xs font-bold text-white">Fair Pixel Pricing</h3>
          <p className="text-[11px] text-slate-400">Pay only for exact ink coverage</p>
        </div>
      </div>

      <div className="glass-card px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center text-emerald-400 shrink-0">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-xs font-bold text-white">GCash & Cash Ready</h3>
          <p className="text-[11px] text-slate-400">Instant QR Ph and change dispenser</p>
        </div>
      </div>
    </div>
  </section>
);

interface DesignFile {
  id: string;
  name: string;
  url: string;
}

interface BondpaperStepProps {
  onBack: () => void;
}

const allowedDesign = (file: File) => /\.(pdf|docx|jpg|jpeg|png)$/i.test(file.name);

export const BondpaperStep: React.FC<BondpaperStepProps> = ({ onBack }) => {
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [quantity, setQuantity] = useState(1);
  const [bordered, setBordered] = useState<boolean | null>(null);
  const [designSource, setDesignSource] = useState<'saved' | 'upload'>('saved');
  const [designs, setDesigns] = useState<DesignFile[]>([]);
  const [selectedDesign, setSelectedDesign] = useState('');
  const [customDesignName, setCustomDesignName] = useState('');
  const [designError, setDesignError] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    if (!bordered || designSource !== 'saved') return;
    let cancelled = false;
    const backendOrigin = `${window.location.protocol}//${window.location.hostname}:3001`;
    fetch(`${backendOrigin}/api/bondpaper/designs`, { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || 'Saved designs are temporarily unavailable.');
        if (!Array.isArray(result.designs)) throw new Error('Saved designs are temporarily unavailable.');
        if (!cancelled) {
          setDesigns(result.designs);
          setDesignError('');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setDesignError(error instanceof Error ? error.message : 'Saved designs are unavailable.');
      });
    return () => { cancelled = true; };
  }, [bordered, designSource]);

  const onDesignSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!allowedDesign(file)) {
      setDesignError('Accepted formats: PDF, DOCX, JPG, JPEG, and PNG.');
      event.target.value = '';
      return;
    }
    setDesignError('');
    setCustomDesignName(file.name);
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-8 text-white relative z-10">
      <button
        type="button"
        onClick={onBack}
        className="glass-btn-secondary px-4 py-2 text-xs mb-6 inline-flex items-center gap-1.5"
      >
        ← Back to Welcome
      </button>

      <div className="glass-panel p-7 sm:p-9 shadow-2xl space-y-7">
        <div className="border-b border-white/10 pb-5">
          <h1 className="text-3xl font-black tracking-tight text-white">Buy Bondpaper</h1>
          <p className="text-slate-400 text-xs mt-1">Select your paper dimensions, quantity, and print border preferences.</p>
        </div>

        {/* Paper Size */}
        <div>
          <label className="mb-2.5 block text-xs font-bold uppercase tracking-wider text-slate-300">
            1. Paper Size
          </label>
          <div className="grid grid-cols-3 gap-2.5 bg-black/25 p-1.5 rounded-2xl border border-white/10">
            {(['A4', 'LETTER', 'LONG'] as PaperSize[]).map((size) => (
              <button
                type="button"
                key={size}
                onClick={() => setPaperSize(size)}
                aria-pressed={paperSize === size}
                className={`py-3 rounded-xl font-bold text-xs transition-all ${
                  paperSize === size
                    ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-sky-500/30 border border-sky-400/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                {size === 'LONG' ? 'Long (8.5x13")' : size === 'LETTER' ? 'Letter (8.5x11")' : 'A4 (210x297mm)'}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity */}
        <div>
          <label htmlFor="bondpaper-quantity" className="mb-2.5 block text-xs font-bold uppercase tracking-wider text-slate-300">
            2. Quantity (Sheets)
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="glass-btn-secondary w-12 h-12 flex items-center justify-center text-lg font-bold"
            >
              -
            </button>
            <input
              id="bondpaper-quantity"
              type="number"
              min={1}
              max={500}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
              className="glass-input h-12 w-36 text-center font-mono text-xl font-bold text-white"
            />
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(500, q + 1))}
              className="glass-btn-secondary w-12 h-12 flex items-center justify-center text-lg font-bold"
            >
              +
            </button>
            <span className="text-xs text-slate-400 font-mono">
              Total base paper: ₱{quantity.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Border / Design Option */}
        <fieldset>
          <legend className="mb-2.5 block text-xs font-bold uppercase tracking-wider text-slate-300">
            3. Do you want it printed with a border or template?
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setBordered(false)}
              aria-pressed={bordered === false}
              className={`p-4 rounded-2xl border text-left font-bold text-sm transition-all ${
                bordered === false
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-white shadow-md shadow-emerald-500/20'
                  : 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
              }`}
            >
              <span className="block text-base">Blank Sheets</span>
              <span className="text-xs text-emerald-400 font-mono mt-1 block">₱{quantity.toFixed(2)} total</span>
            </button>
            <button
              type="button"
              onClick={() => setBordered(true)}
              aria-pressed={bordered === true}
              className={`p-4 rounded-2xl border text-left font-bold text-sm transition-all ${
                bordered === true
                  ? 'bg-sky-500/20 border-sky-400/50 text-white shadow-md shadow-sky-500/20'
                  : 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
              }`}
            >
              <span className="block text-base">Bordered / Custom</span>
              <span className="text-xs text-sky-400 font-mono mt-1 block">+ Ink coverage</span>
            </button>
          </div>
        </fieldset>

        {bordered && (
          <div className="glass-card p-5 space-y-4">
            <div className="text-xs font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-sky-400" />
              <span>Select Pre-Saved Kiosk Border Template</span>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto" aria-label="Pre-saved designs">
              {designError && <p role="alert" className="text-xs text-rose-300">{designError}</p>}
              {designs.length === 0 && !designError && (
                <div className="space-y-2">
                  {[
                    { id: 'formal-border', name: 'Formal Certificate Gold/Navy Border' },
                    { id: 'deped-form', name: 'DepEd Official School Header & Border' },
                    { id: 'resume-border', name: 'Executive Resume Grid Border' },
                  ].map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedDesign(tpl.id)}
                      className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-3.5 text-xs text-left transition cursor-pointer ${
                        selectedDesign === tpl.id
                          ? 'border-emerald-400/60 bg-emerald-500/20 text-white'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <FileText className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="font-semibold">{tpl.name}</span>
                      </span>
                      {selectedDesign === tpl.id && (
                        <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded">
                          Selected ✓
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {designs.map((design) => (
                <button
                  key={design.id}
                  type="button"
                  onClick={() => setSelectedDesign(design.id)}
                  aria-pressed={selectedDesign === design.id}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3.5 text-xs text-left transition ${
                    selectedDesign === design.id
                      ? 'border-emerald-400/60 bg-emerald-500/20 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  <FileText className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="truncate">{design.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Warning Policy Notice */}
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs font-medium text-amber-200 flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Please double-check paper size and sheet quantity. Vendo purchases are non-refundable for user errors.</span>
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={() => setReviewOpen((open) => !open)}
          disabled={bordered === null || (bordered && (designSource === 'saved' ? !selectedDesign : !customDesignName))}
          className="glass-btn-emerald w-full py-4 text-sm font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
        >
          {reviewOpen ? 'Hide Selection Review' : 'Review Selection & Purchase'}
        </button>

        {reviewOpen && (
          <div className="glass-card border-emerald-500/30 bg-emerald-500/10 p-5 text-sm" role="status">
            <h2 className="font-extrabold text-emerald-300 text-base mb-1">Selection Review</h2>
            <p className="text-slate-200">
              {quantity} {paperSize === 'LONG' ? 'Long' : paperSize} sheet{quantity === 1 ? '' : 's'} · {bordered ? 'Bordered template' : 'Blank'}
            </p>
            {bordered ? (
              <p className="mt-1 text-xs text-slate-400">
                Design: {designSource === 'saved' ? designs.find((d) => d.id === selectedDesign)?.name : customDesignName}
              </p>
            ) : (
              <p className="mt-2 font-mono font-bold text-lg text-emerald-400">Total Paper Price: ₱{quantity.toFixed(2)}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

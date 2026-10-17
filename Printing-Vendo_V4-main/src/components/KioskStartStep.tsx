import React, { useEffect, useState } from 'react';
import { Bluetooth, FileText, Printer, ShoppingBag, UploadCloud } from 'lucide-react';
import { PaperSize } from '../types';

interface KioskStartStepProps {
  onPrintDocument: () => void;
  onBuyBondpaper: () => void;
}

export const KioskStartStep: React.FC<KioskStartStepProps> = ({ onPrintDocument, onBuyBondpaper }) => (
  <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-5 py-14 text-center">
    <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-sky-300">Self-service print kiosk</p>
    <h1 className="mb-10 text-4xl font-black text-white">Welcome</h1>
    <div className="grid w-full max-w-3xl grid-cols-1 gap-5 sm:grid-cols-2">
      <button type="button" onClick={onPrintDocument} className="group min-h-64 border border-slate-700 bg-slate-900 p-8 text-left transition hover:border-sky-400 hover:bg-slate-800">
        <Printer className="mb-8 h-10 w-10 text-sky-300" />
        <span className="block text-2xl font-black text-white">Print Document</span>
        <span className="mt-2 block text-sm text-slate-400">QR Code, Bluetooth, or Recent</span>
      </button>
      <button type="button" onClick={onBuyBondpaper} className="group min-h-64 border border-slate-700 bg-slate-900 p-8 text-left transition hover:border-emerald-400 hover:bg-slate-800">
        <ShoppingBag className="mb-8 h-10 w-10 text-emerald-300" />
        <span className="block text-2xl font-black text-white">Buy Bondpaper</span>
        <span className="mt-2 block text-sm text-slate-400">Blank sheets or custom bordered designs</span>
      </button>
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
    <section className="mx-auto w-full max-w-3xl px-4 py-8 text-white">
      <button type="button" onClick={onBack} className="mb-6 text-sm font-bold text-slate-300 hover:text-white">← Back</button>
      <h1 className="text-3xl font-black">Buy Bondpaper</h1>
      <div className="mt-6 space-y-6 border-y border-slate-700 py-6">
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase text-slate-400">Paper Size</h2>
          <div className="grid grid-cols-3 gap-2">
            {(['A4', 'LETTER', 'LONG'] as PaperSize[]).map((size) => (
              <button type="button" key={size} onClick={() => setPaperSize(size)} aria-pressed={paperSize === size} className={`min-h-12 border px-3 font-bold ${paperSize === size ? 'border-sky-400 bg-sky-950 text-sky-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
                {size === 'LONG' ? 'Long' : size === 'LETTER' ? 'Letter' : 'A4'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="bondpaper-quantity" className="mb-3 block text-xs font-bold uppercase text-slate-400">Quantity</label>
          <input id="bondpaper-quantity" type="number" min={1} max={500} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} className="min-h-12 w-36 border border-slate-700 bg-slate-950 px-4 font-mono text-lg text-white" />
        </div>
        <fieldset>
          <legend className="mb-3 text-xs font-bold uppercase text-slate-400">Do you want to have it printed with a border/design?</legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setBordered(false)} aria-pressed={bordered === false} className={`min-h-12 border font-bold ${bordered === false ? 'border-emerald-400 bg-emerald-950 text-emerald-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>No, blank · ₱{quantity.toFixed(2)}</button>
            <button type="button" onClick={() => setBordered(true)} aria-pressed={bordered === true} className={`min-h-12 border font-bold ${bordered === true ? 'border-emerald-400 bg-emerald-950 text-emerald-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>Yes, bordered</button>
          </div>
        </fieldset>
        {bordered && (
          <div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setDesignSource('saved')} aria-pressed={designSource === 'saved'} className={`min-h-12 border font-bold ${designSource === 'saved' ? 'border-sky-400 bg-sky-950 text-sky-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}><FileText className="mr-2 inline h-4 w-4" />Choose a pre-saved design</button>
              <button type="button" onClick={() => setDesignSource('upload')} aria-pressed={designSource === 'upload'} className={`min-h-12 border font-bold ${designSource === 'upload' ? 'border-sky-400 bg-sky-950 text-sky-100' : 'border-slate-700 bg-slate-900 text-slate-300'}`}><UploadCloud className="mr-2 inline h-4 w-4" />Upload your own design</button>
            </div>
            {designSource === 'saved' ? (
              <div className="space-y-2" aria-label="Pre-saved designs">
                {designError && <p role="alert" className="text-sm text-rose-300">{designError}</p>}
                {designs.length === 0 && !designError && <p className="py-4 text-sm text-slate-400">No pre-saved designs available.</p>}
                {designs.map((design) => <button key={design.id} type="button" onClick={() => setSelectedDesign(design.id)} aria-pressed={selectedDesign === design.id} className={`flex min-h-12 w-full items-center gap-3 border px-4 text-left ${selectedDesign === design.id ? 'border-emerald-400 bg-emerald-950' : 'border-slate-700 bg-slate-900'}`}><FileText className="h-4 w-4 text-emerald-300" />{design.name}</button>)}
              </div>
            ) : (
              <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center border border-dashed border-slate-600 bg-slate-900 p-4 text-sm text-slate-300">
                <input type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png" onChange={onDesignSelected} className="sr-only" />
                <span className="flex items-center gap-2"><Bluetooth className="h-4 w-4 text-sky-300" />Choose design file</span>
                <span className="mt-2 text-xs text-slate-400">PDF, DOCX, JPG, JPEG, PNG</span>
                {customDesignName && <span className="mt-2 font-bold text-emerald-300">{customDesignName}</span>}
              </label>
            )}
            {designError && designSource === 'upload' && <p role="alert" className="mt-2 text-sm text-rose-300">{designError}</p>}
          </div>
        )}
      </div>
      <p className="mt-5 text-sm text-slate-400">Blank bondpaper: ₱1.00 per piece. Bordered designs are priced by printed pixel coverage.</p>
      <div className="mt-6 rounded-sm border border-amber-500/70 bg-amber-950/50 p-4 text-sm font-bold text-amber-100">Please ensure your file and paper size are correct. No refunds for user errors.</div>
      <button type="button" onClick={() => setReviewOpen((open) => !open)} disabled={bordered === null || (bordered && (designSource === 'saved' ? !selectedDesign : !customDesignName))} className="mt-6 min-h-12 w-full bg-emerald-500 px-5 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{reviewOpen ? 'Hide Selection Review' : 'Review Selection'}</button>
      {reviewOpen && <div className="mt-4 border border-emerald-500/50 bg-emerald-950/40 p-4 text-sm" role="status">
        <h2 className="font-black text-emerald-200">Selection Review</h2>
        <p className="mt-2">{quantity} {paperSize === 'LONG' ? 'Long' : paperSize} sheet{quantity === 1 ? '' : 's'} · {bordered ? 'Bordered design' : 'Blank'}</p>
        {bordered ? <p className="mt-1 text-slate-300">{designSource === 'saved' ? designs.find((design) => design.id === selectedDesign)?.name : customDesignName}</p> : <p className="mt-1 font-bold">Paper total: ₱{quantity.toFixed(2)}</p>}
      </div>}
    </section>
  );
};

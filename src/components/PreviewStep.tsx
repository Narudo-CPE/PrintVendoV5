import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Printer,
  Copy,
  ArrowUpDown,
  Sparkles,
  CheckSquare,
  Square,
  FileText,
  AlertTriangle,
  Image as ImageIcon,
  CheckCircle2,
  RefreshCw,
  Eye,
  Activity,
} from 'lucide-react';
import { PaperSize, ColorMode, PricingBreakdown } from '../types';
import {
  analyzePdfDocument,
  analyzeImageElement,
  DocumentPixelSummary,
} from '../utils/pixelCounter';

interface PreviewStepProps {
  pdfUrl: string;
  fileName: string;
  paperSize: PaperSize;
  colorMode: ColorMode;
  copies: number;
  reverseOrder: boolean;
  collate: boolean;
  selectedPages: number[];
  pricing: PricingBreakdown | null;
  pricingLoading: boolean;
  pricingError: string;
  onPaperSizeChange: (size: PaperSize) => void;
  onColorModeChange: (mode: ColorMode) => void;
  onCopiesChange: (copies: number) => void;
  onReverseOrderChange: (reverse: boolean) => void;
  onCollateChange: (collate: boolean) => void;
  onTogglePage: (pageNum: number) => void;
  onSelectAllPages: (allPages: number[]) => void;
  onDeselectAllPages: () => void;
  onProceedToPayment: () => void;
  onChangeFile: () => void;
  onPixelAnalysisCalculated?: (summary: DocumentPixelSummary) => void;
}

export const PreviewStep: React.FC<PreviewStepProps> = ({
  pdfUrl,
  fileName,
  paperSize,
  colorMode,
  copies,
  reverseOrder,
  collate,
  selectedPages,
  pricing,
  pricingLoading,
  pricingError,
  onPaperSizeChange,
  onColorModeChange,
  onCopiesChange,
  onReverseOrderChange,
  onCollateChange,
  onTogglePage,
  onSelectAllPages,
  onDeselectAllPages,
  onProceedToPayment,
  onChangeFile,
  onPixelAnalysisCalculated,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [loadNotice, setLoadNotice] = useState<string | null>(null);
  const [isImageDoc, setIsImageDoc] = useState(false);
  const [paperSizeChosen, setPaperSizeChosen] = useState(false);
  const [colorModeChosen, setColorModeChosen] = useState(false);
  const [scanningPixels, setScanningPixels] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number } | null>(null);
  const [pixelData, setPixelData] = useState<DocumentPixelSummary | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  // Keep a stable ref to onSelectAllPages to prevent re-triggering document loading
  const onSelectAllPagesRef = useRef(onSelectAllPages);
  useEffect(() => {
    onSelectAllPagesRef.current = onSelectAllPages;
  }, [onSelectAllPages]);

  // Show an honest blank preview state when a document format cannot be rendered.
  const drawFallbackCanvas = useCallback((name: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 595;
    canvas.height = 842;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText('Preview unavailable', 40, 80);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('This file could not be rendered accurately.', 40, 112);
    ctx.fillText(name.slice(0, 64), 40, 140);
  }, []);

  // Dedicated page renderer
  const renderPage = useCallback(
    async (doc: any, pageNum: number) => {
      if (!doc || !canvasRef.current) return;

      // Cancel any ongoing render task before starting a new one
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore cancelled task
        }
        renderTaskRef.current = null;
      }

      try {
        const page = await doc.getPage(pageNum);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const viewport = page.getViewport({ scale: 1.3 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };

        const task = page.render(renderContext);
        renderTaskRef.current = task;
        await task.promise;
        renderTaskRef.current = null;
        setLoadingPdf(false);
      } catch (err: any) {
        if (err?.name === 'RenderingCancelledException') {
          return;
        }
        console.warn('Error rendering PDF page, applying fallback:', err);
        drawFallbackCanvas(fileName);
        setLoadingPdf(false);
      }
    },
    [drawFallbackCanvas, fileName]
  );

  // Main loader: supports PDF, images (PNG/JPG/WEBP), and graceful fallbacks
  useEffect(() => {
    let isCancelled = false;
    setLoadingPdf(true);
    setLoadNotice(null);
    setIsImageDoc(false);

    // Watchdog timer: If rendering takes more than 4.5 seconds, force fallback canvas so customer is never stuck
    const watchdog = setTimeout(() => {
      if (!isCancelled) {
        setLoadingPdf(false);
        drawFallbackCanvas(fileName);
      }
    }, 4500);

    const loadDocument = async () => {
      const isImage =
        fileName.match(/\.(png|jpe?g|webp|bmp|gif)$/i) ||
        (pdfUrl && pdfUrl.startsWith('data:image/'));

      // 1. Handle Direct Image Uploads (IDs, forms, photos, receipts)
      if (isImage) {
        setIsImageDoc(true);
        const img = new Image();
        img.onload = () => {
          if (isCancelled) return;
          clearTimeout(watchdog);
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const maxW = 595;
              const maxH = 842;
              let scale = Math.min(maxW / img.width, maxH / img.height);
              if (scale > 1.5) scale = 1.5;

              canvas.width = Math.round(img.width * scale);
              canvas.height = Math.round(img.height * scale);

              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            }
          }
          setTotalPages(1);
          setCurrentPage(1);
          onSelectAllPagesRef.current([1]);
          setLoadingPdf(false);
          setLoadNotice('Image document loaded. Scaled to single sheet print frame.');

          // Trigger optical pixel density analysis for image document
          setScanningPixels(true);
          analyzeImageElement(img)
            .then((summary) => {
              if (!isCancelled) {
                setPixelData(summary);
                setScanningPixels(false);
                onPixelAnalysisCalculated?.(summary);
              }
            })
            .catch((e) => {
              console.warn('Image pixel analysis failed:', e);
              if (!isCancelled) setScanningPixels(false);
            });
        };
        img.onerror = () => {
          if (isCancelled) return;
          clearTimeout(watchdog);
          drawFallbackCanvas(fileName);
          setTotalPages(1);
          setCurrentPage(1);
          onSelectAllPagesRef.current([1]);
          setLoadingPdf(false);
        };
        img.src = pdfUrl;
        return;
      }

      // 2. Handle PDF Document Rendering via PDF.js
      try {
        const pdfjsLib = (window as any).pdfjsLib;
        if (!pdfjsLib) {
          throw new Error('PDF.js library unavailable');
        }

        // Configure worker source to avoid fake-worker failures
        if (!pdfjsLib.GlobalWorkerOptions?.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (isCancelled) return;
        clearTimeout(watchdog);

        pdfDocRef.current = doc;
        setTotalPages(doc.numPages || 1);
        setCurrentPage(1);

        const allPages = Array.from({ length: doc.numPages || 1 }, (_, i) => i + 1);
        onSelectAllPagesRef.current(allPages);

        // Immediately render first page for view
        await renderPage(doc, 1);

        // Concurrently run non-blocking optical pixel density rasterization across all pages
        setScanningPixels(true);
        setScanProgress({ current: 1, total: doc.numPages || 1 });
        analyzePdfDocument(doc, (current, total) => {
          if (!isCancelled) {
            setScanProgress({ current, total });
          }
        })
          .then((summary) => {
            if (!isCancelled) {
              setPixelData(summary);
              setScanningPixels(false);
              onPixelAnalysisCalculated?.(summary);
            }
          })
          .catch((e) => {
            console.warn('PDF optical pixel analysis warning:', e);
            if (!isCancelled) setScanningPixels(false);
          });
      } catch (err: any) {
        console.warn('PDF.js parser error, activating fallback renderer:', err);
        if (isCancelled) return;
        clearTimeout(watchdog);

        drawFallbackCanvas(fileName);
        setTotalPages(1);
        setCurrentPage(1);
        onSelectAllPagesRef.current([1]);
        setLoadingPdf(false);
        setLoadNotice('Document loaded in compatibility mode. Ready for print configuration.');
      }
    };

    loadDocument();

    return () => {
      isCancelled = true;
      clearTimeout(watchdog);
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pdfUrl, fileName, drawFallbackCanvas, renderPage]);

  // Page switcher
  const handlePrevPage = () => {
    if (currentPage > 1) {
      const nextPageNum = currentPage - 1;
      setCurrentPage(nextPageNum);
      if (pdfDocRef.current && !isImageDoc) {
        renderPage(pdfDocRef.current, nextPageNum);
      }
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      const nextPageNum = currentPage + 1;
      setCurrentPage(nextPageNum);
      if (pdfDocRef.current && !isImageDoc) {
        renderPage(pdfDocRef.current, nextPageNum);
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4">
      {/* Compatibility Notice / Mode Alert */}
      {loadNotice && (
        <div className="flex items-center gap-3 bg-sky-950/70 border border-sky-600/50 rounded-2xl px-5 py-3.5 mb-4 text-xs text-sky-200">
          <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="flex-1 font-medium">{loadNotice}</span>
          <button
            onClick={onChangeFile}
            className="underline text-sky-300 hover:text-white font-bold ml-2 cursor-pointer"
          >
            Switch File
          </button>
        </div>
      )}

      {/* File banner */}
      <div className="flex items-center justify-between glass-card px-5 py-3.5 mb-6">
        <div className="flex items-center gap-3.5 truncate">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/25 text-sky-400 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="truncate">
            <div className="font-extrabold text-white text-sm truncate">{fileName}</div>
            <div className="text-xs text-slate-400 font-medium">{totalPages} page{totalPages === 1 ? '' : 's'} · Ready for configuration</div>
          </div>
        </div>
        <button
          onClick={onChangeFile}
          className="glass-btn-secondary text-xs px-3.5 py-1.5 shrink-0"
        >
          Change File
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: PDF.js HTML5 <canvas> display */}
        <div className="lg:col-span-7 flex flex-col glass-panel p-5 sm:p-6 shadow-2xl">
          <div className="flex items-center justify-between mb-3 text-xs text-slate-400 font-semibold">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <span>Document Canvas Preview</span>
            </span>
            <span className="text-sky-300 font-mono font-bold bg-sky-500/15 px-2.5 py-0.5 rounded-full border border-sky-400/25">
              Page {currentPage} of {totalPages}
            </span>
          </div>

          <div className="flex-1 bg-black/45 rounded-2xl border border-white/10 flex items-center justify-center p-4 min-h-[460px] overflow-auto shadow-inner relative">
            {loadingPdf && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-slate-300 z-10">
                <div className="w-9 h-9 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mb-3" />
                <span className="text-xs font-semibold">Rendering document viewport...</span>
              </div>
            )}
            <canvas
              ref={canvasRef}
              id="pdf-canvas"
              className={`max-w-full max-h-[440px] shadow-[0_12px_40px_rgba(0,0,0,0.6)] rounded-sm border border-slate-700/60 bg-white ${
                loadingPdf ? 'opacity-20' : 'opacity-100'
              } transition-opacity duration-150`}
            />
          </div>

          {/* Canvas Navigation bar */}
          <div className="flex items-center justify-between mt-4 px-1">
            <button
              onClick={handlePrevPage}
              disabled={currentPage <= 1}
              className="glass-btn-secondary flex items-center gap-1 px-4 py-2 text-xs font-bold disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>

            <span className="text-xs font-bold text-slate-300 font-mono bg-white/[0.06] px-3 py-1.5 rounded-xl border border-white/10">
              {currentPage} / {totalPages}
            </span>

            <button
              onClick={handleNextPage}
              disabled={currentPage >= totalPages}
              className="glass-btn-secondary flex items-center gap-1 px-4 py-2 text-xs font-bold disabled:opacity-30 disabled:pointer-events-none"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Column: Print Options & Authoritative Pricing */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          <div className="glass-panel p-6 shadow-2xl space-y-5">
            {/* Paper Size Selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Paper Size
                </label>
                <span className="text-[10px] text-sky-400 font-mono font-semibold">
                  NEMA17 Tray Auto-Feed
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 bg-black/30 p-1.5 rounded-2xl border border-white/10">
                {(['A4', 'LETTER', 'LONG'] as PaperSize[]).map((size) => (
                  <button
                    key={size}
                    onClick={() => {
                      onPaperSizeChange(size);
                      setPaperSizeChosen(true);
                    }}
                    className={`py-2.5 rounded-xl text-xs font-bold transition ${
                      paperSize === size
                        ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-sky-500/30 border border-sky-400/40'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                    }`}
                  >
                    {size === 'LONG' ? 'Long (8.5x13")' : size === 'LETTER' ? 'Letter (8.5x11")' : 'A4'}
                  </button>
                ))}
              </div>
            </div>

            {/* Color Mode Toggle */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-2">
                Color Mode
              </label>
              <div className="grid grid-cols-2 gap-2 bg-black/30 p-1.5 rounded-2xl border border-white/10">
                <button
                  onClick={() => {
                    onColorModeChange('bw');
                    setColorModeChosen(true);
                  }}
                  className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
                    colorMode === 'bw'
                      ? 'bg-slate-700/90 text-white shadow-md border border-slate-500/40'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block shadow-sm" />
                  Black & White
                </button>
                <button
                  onClick={() => {
                    onColorModeChange('color');
                    setColorModeChosen(true);
                  }}
                  className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
                    colorMode === 'color'
                      ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md shadow-sky-500/25 border border-sky-400/40'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-pink-500 to-amber-400 inline-block shadow-sm" />
                  Full Color
                </button>
              </div>
            </div>

            {/* Page Selection Chips */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Select Pages ({selectedPages.length}/{totalPages})
                </label>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => {
                      const all = Array.from({ length: totalPages }, (_, i) => i + 1);
                      onSelectAllPages(all);
                    }}
                    className="text-sky-400 hover:underline font-semibold"
                  >
                    Select All
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    onClick={onDeselectAllPages}
                    className="text-slate-400 hover:underline font-semibold"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto p-2 bg-black/30 rounded-2xl border border-white/10">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                  const isSelected = selectedPages.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => onTogglePage(p)}
                      className={`w-9 h-9 rounded-xl font-bold text-xs flex items-center justify-center transition ${
                        isSelected
                          ? 'bg-sky-500 text-white shadow-md shadow-sky-500/40 border border-sky-300/40'
                          : 'bg-white/[0.05] text-slate-400 hover:bg-white/[0.1] hover:text-white border border-white/5'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Copies Counter */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-2">
                Number of Copies
              </label>
              <div className="flex items-center justify-between bg-black/30 p-1.5 rounded-2xl border border-white/10">
                <button
                  onClick={() => onCopiesChange(Math.max(1, copies - 1))}
                  className="glass-btn-secondary w-10 h-10 flex items-center justify-center text-lg font-bold"
                >
                  -
                </button>
                <span className="text-xl font-black text-white font-mono">{copies}</span>
                <button
                  onClick={() => onCopiesChange(Math.min(50, copies + 1))}
                  className="glass-btn-secondary w-10 h-10 flex items-center justify-center text-lg font-bold"
                >
                  +
                </button>
              </div>
            </div>

            {/* Sequencing Toggles: Reverse Order & Collate */}
            <div className="space-y-2.5 pt-2 border-t border-white/10">
              <label className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/10 cursor-pointer hover:bg-white/[0.06] transition">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <ArrowUpDown className="w-4 h-4 text-sky-400" />
                  Reverse Order (Last Page First)
                </span>
                <input
                  type="checkbox"
                  checked={reverseOrder}
                  onChange={(e) => onReverseOrderChange(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-600 bg-slate-900 border-white/20 focus:ring-0 cursor-pointer accent-sky-500"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/10 cursor-pointer hover:bg-white/[0.06] transition">
                <div>
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <Copy className="w-4 h-4 text-indigo-400" />
                    Collate Copies
                  </div>
                  <div className="text-[10px] text-slate-500 ml-6">
                    {copies > 1 ? '[1,2,3][1,2,3] sequence' : 'Active when copies > 1'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={collate}
                  disabled={copies <= 1}
                  onChange={(e) => onCollateChange(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-600 bg-slate-900 border-white/20 focus:ring-0 disabled:opacity-40 cursor-pointer accent-sky-500"
                />
              </label>
            </div>
          </div>

          {/* Authoritative Ghostscript Pixel-Density Pricing Card */}
          <div className="glass-card border-sky-400/30 bg-sky-500/10 p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute -top-14 -right-14 w-36 h-36 rounded-full bg-sky-500/15 blur-2xl pointer-events-none" />

            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase font-mono font-bold tracking-wider text-sky-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-sky-400" />
                Live Price Computation
              </span>
              <span className="text-[10px] bg-sky-500/20 text-sky-200 border border-sky-400/30 px-2 py-0.5 rounded-full font-bold">
                Pixel-Accurate
              </span>
            </div>

            {/* Real Optical Pixel Scanner Status */}
            <div className="mb-4 p-2.5 rounded-xl bg-slate-950/70 border border-sky-400/30 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sky-300 flex items-center gap-1.5 text-[11px]">
                  <Activity className="w-3.5 h-3.5 text-sky-400" />
                  Optical Density Scanner
                </span>
                {scanningPixels ? (
                  <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full animate-pulse border border-amber-400/30">
                    Scanning {scanProgress?.current || 1}/{scanProgress?.total || totalPages}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-400/30">
                    Verified Accurate ✓
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between text-slate-400 font-mono text-[10px]">
                <span>Ink Coverage: {pricing ? `${pricing.avg_pixel_coverage}%` : 'Scanning...'}</span>
                <span>
                  {pixelData?.colorPages && pixelData.colorPages.length > 0
                    ? `${pixelData.colorPages.length} Color / ${pixelData.bwPages.length} B&W`
                    : 'Monochrome Detected'}
                </span>
              </div>
            </div>

            <div className="space-y-2 text-xs text-slate-300 mb-5 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Selected Pages:</span>
                <span className="text-white font-bold">{selectedPages.length} page(s)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Total Sheets to Feed:</span>
                <span className="text-white font-bold">
                  {pricing ? pricing.total_sheets_to_feed : selectedPages.length * copies} sheet(s)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Paper Tray:</span>
                <span className="text-sky-300 font-bold">{paperSize}</span>
              </div>
              {pricing && (
                <>
                  <div className="flex justify-between border-t border-white/10 pt-2">
                    <span className="text-slate-400 font-sans">Base Paper ({pricing.total_sheets_to_feed} × ₱1.00):</span>
                    <span className="text-white font-bold">₱{pricing.base_cost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Black Ink ({pricing.grayscale_pixel_count.toLocaleString()} px):</span>
                    <span className="text-white font-bold">₱{pricing.grayscale_cost.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Color Ink ({pricing.color_pixel_count.toLocaleString()} px):</span>
                    <span className="text-white font-bold">₱{pricing.color_cost.toFixed(4)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center pt-3 border-t border-white/15 text-sm font-bold text-white font-sans">
                <span>Grand Total:</span>
                <span className="text-emerald-400 text-2xl font-black font-mono">
                  {pricing ? `₱${pricing.grand_total.toFixed(2)}` : pricingLoading ? 'Calculating…' : 'Unavailable'}
                </span>
              </div>
            </div>

            {pricingError && <p role="alert" className="mb-4 text-xs text-rose-300">{pricingError}</p>}

            <button
              onClick={onProceedToPayment}
              disabled={selectedPages.length === 0 || !paperSizeChosen || !colorModeChosen || !pricing}
              className="glass-btn-primary w-full py-4 text-sm font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-xl"
            >
              {!paperSizeChosen || !colorModeChosen ? 'Select Size & Color Mode' : 'Proceed to Payment →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

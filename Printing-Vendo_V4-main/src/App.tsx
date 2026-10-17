import React, { useState, useEffect, useCallback } from 'react';
import { KioskHeader } from './components/KioskHeader';
import { UploadStep } from './components/UploadStep';
import { PreviewStep } from './components/PreviewStep';
import { PaymentStep } from './components/PaymentStep';
import { PrintingStep } from './components/PrintingStep';
import { ReceiptStep } from './components/ReceiptStep';
import { IdleScreensaver } from './components/IdleScreensaver';
import { BondpaperStep, KioskStartStep } from './components/KioskStartStep';
import { MobileUploadView } from './components/MobileUploadView';
import { MobilePaymentCheckout } from './components/MobilePaymentCheckout';
import { kioskApiUrl } from './utils/kioskApi';
import {
  PaperSize,
  ColorMode,
  PaymentMethod,
  PaymentReceipt,
  PricingBreakdown,
  HardwareState,
} from './types';

export default function App() {
  // Check if client is a mobile device that scanned the Kiosk Upload QR code or GCash Payment QR
  const searchParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const uploadParam = searchParams ? searchParams.get('upload') : null;
  const payParam = searchParams ? searchParams.get('pay') : null;
  const amountParam = searchParams ? searchParams.get('amount') : null;
  if (payParam) {
    return (
      <MobilePaymentCheckout
        sessionId={payParam}
        amount={amountParam ? parseFloat(amountParam) || 2.0 : 2.0}
      />
    );
  }

  if (uploadParam) {
    return <MobileUploadView sessionId={uploadParam} />;
  }

  // Step State: 1 = Upload, 2 = Preview/Config, 3 = Payment, 4 = Printing, 5 = Receipt
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [sessionId, setSessionId] = useState<string>(() =>
    'sess_' + Math.random().toString(36).substring(2, 10)
  );

  // File & Print Job Configuration
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [colorMode, setColorMode] = useState<ColorMode>('bw');
  const [copies, setCopies] = useState<number>(1);
  const [reverseOrder, setReverseOrder] = useState<boolean>(false);
  const [collate, setCollate] = useState<boolean>(true);
  const [selectedPages, setSelectedPages] = useState<number[]>([1]);

  // Pricing & Payment
  const [pricing, setPricing] = useState<PricingBreakdown | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState('');
  const [paymentDetails, setPaymentDetails] = useState<PaymentReceipt | null>(null);
  const [completionData, setCompletionData] = useState<Record<string, unknown> | null>(null);

  // Hardware & Network Telemetry
  const [internetOnline, setInternetOnline] = useState<boolean>(false);
  const [hardware, setHardware] = useState<HardwareState>({
    connected: false,
    acceptorConnected: false,
    actuatorConnected: false,
  });

  useEffect(() => {
    let cancelled = false;

    const refreshSystemStatus = async () => {
      try {
        const statusUrl = `${window.location.protocol}//${window.location.hostname}:3001/api/system/status`;
        const response = await fetch(statusUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error('Kiosk status request failed');
        const status = await response.json();
        if (cancelled) return;

        setInternetOnline(status.internet_connected === true);
        setHardware({
          connected: status.hardware?.connected === true,
          acceptorConnected: status.hardware?.acceptor_board?.connected === true,
          actuatorConnected: status.hardware?.actuator_board?.connected === true,
        });
      } catch {
        if (cancelled) return;
        setInternetOnline(false);
        setHardware({ connected: false, acceptorConnected: false, actuatorConnected: false });
      }
    };

    void refreshSystemStatus();
    const intervalId = window.setInterval(() => void refreshSystemStatus(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  // Ask the backend for an authoritative quote whenever print settings change.
  useEffect(() => {
    if (currentStep !== 2 || !pdfUrl || selectedPages.length === 0) return;
    let cancelled = false;
    setPricing(null);
    setPricingLoading(true);
    setPricingError('');

    const requestQuote = async () => {
      try {
        const fileResponse = await fetch(pdfUrl);
        if (!fileResponse.ok) throw new Error('Could not read the selected file for pricing.');
        const fileBlob = await fileResponse.blob();
        const form = new FormData();
        form.append('document', fileBlob, fileName || 'document');
        form.append('selectedPages', JSON.stringify(selectedPages));
        form.append('paperSize', paperSize);
        form.append('colorMode', colorMode);
        form.append('copies', String(copies));
        form.append('reverseOrder', String(reverseOrder));
        form.append('collate', String(collate));
        const response = await fetch(kioskApiUrl('/api/pricing/quote'), { method: 'POST', body: form });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error('Pricing currently unavailable');
        const quote = result.pricing || result;
        if (typeof quote.total_price !== 'number' || !Array.isArray(quote.queue_sequence)) {
          throw new Error('Pricing currently unavailable');
        }
        if (!cancelled) setPricing(quote as PricingBreakdown);
      } catch (error) {
        console.error('Pricing quote failed:', error);
        if (!cancelled) setPricingError('Pricing currently unavailable');
      } finally {
        if (!cancelled) setPricingLoading(false);
      }
    };

    void requestQuote();
    return () => { cancelled = true; };
  }, [
    currentStep,
    pdfUrl,
    fileName,
    selectedPages,
    paperSize,
    colorMode,
    copies,
    reverseOrder,
    collate,
  ]);

  // Handle File Selection
  const handleFileSelected = useCallback((url: string, name: string) => {
    setPdfUrl(url);
    setFileName(name);
    setCurrentStep(2); // Go to Preview
  }, []);

  const handleSelectAllPages = useCallback((all: number[]) => {
    setSelectedPages((prev) => {
      if (prev.length === all.length && prev.every((v, i) => v === all[i])) {
        return prev;
      }
      return all;
    });
  }, []);

  const handleTogglePage = useCallback((p: number) => {
    setSelectedPages((prev) => {
      if (prev.includes(p)) {
        if (prev.length > 1) {
          return prev.filter((x) => x !== p);
        }
        return prev;
      } else {
        return [...prev, p].sort((a, b) => a - b);
      }
    });
  }, []);

  const handleDeselectAllPages = useCallback(() => {
    setSelectedPages([1]);
  }, []);

  // Fullscreen helper
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleFinishSession = useCallback(() => {
    if (pdfUrl?.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    setFileName('');
    setPricing(null);
    setPaymentDetails(null);
    setCompletionData(null);
    setSelectedPages([1]);
    setSessionId('sess_' + Math.random().toString(36).substring(2, 10));
    setCurrentStep(0); // Return to Welcome
  }, [pdfUrl]);

  const handleTransactionComplete = useCallback((result: Record<string, unknown>) => {
    setCompletionData(result);
    setPaymentDetails((previous) => previous ? {
      ...previous,
      changeDispensed: Number(result.change_dispensed ?? previous.changeDispensed),
      coins5: Number(result.change_coins_5 ?? previous.coins5),
      coins1: Number(result.change_coins_1 ?? previous.coins1),
    } : previous);
    setCurrentStep(5);
  }, []);

  const handleIdleTimeout = useCallback(() => {
    const backendOrigin = `${window.location.protocol}//${window.location.hostname}:3001`;
    void fetch(`${backendOrigin}/api/privacy/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    }).catch(() => {});
    handleFinishSession();
  }, [sessionId, handleFinishSession]);

  const handleFilePrivacyChoice = useCallback(async (action: 'delete' | 'keep') => {
    const backendOrigin = `${window.location.protocol}//${window.location.hostname}:3001`;
    const response = await fetch(`${backendOrigin}/api/privacy/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail || 'Could not save your file privacy choice.');
    }
    handleFinishSession();
  }, [sessionId, handleFinishSession]);

  useEffect(() => {
    const blockKeyboardShortcuts = (event: KeyboardEvent) => {
      const isModifierCombo =
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey;

      if (isModifierCombo && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault();
        return;
      }

      if (event.key === 'F5' || event.key === 'F11' || event.key === 'F12') {
        event.preventDefault();
        return;
      }

      if (event.key === 'Tab' && (!event.shiftKey && !event.ctrlKey && !event.metaKey)) {
        event.preventDefault();
      }
    };

    const blockContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const blockBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('keydown', blockKeyboardShortcuts);
    window.addEventListener('contextmenu', blockContextMenu, { passive: false });
    window.addEventListener('beforeunload', blockBeforeUnload);

    return () => {
      window.removeEventListener('keydown', blockKeyboardShortcuts);
      window.removeEventListener('contextmenu', blockContextMenu);
      window.removeEventListener('beforeunload', blockBeforeUnload);
    };
  }, []);

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white"
      style={{ userSelect: 'none' }}
      onSelectStart={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* Header with status pills & microcontroller alert */}
      <KioskHeader
        hardware={hardware}
        internetOnline={internetOnline}
        onToggleFullscreen={handleToggleFullscreen}
      />

      {/* Step Indicator Bar */}
      {currentStep > 0 && currentStep < 6 && <div className="bg-slate-900/60 border-b border-slate-800/80 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between text-xs font-bold">
          {[
            { num: 1, label: 'Upload' },
            { num: 2, label: 'Configure' },
            { num: 3, label: 'Payment' },
            { num: 4, label: 'Printing' },
            { num: 5, label: 'Receipt' },
          ].map((s, idx, arr) => (
            <React.Fragment key={s.num}>
              <div
                className={`flex items-center gap-2 ${
                  currentStep === s.num
                    ? 'text-blue-400'
                    : currentStep > s.num
                    ? 'text-emerald-400'
                    : 'text-slate-500'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black border transition-all ${
                    currentStep === s.num
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/30'
                      : currentStep > s.num
                      ? 'bg-emerald-600 text-white border-emerald-500'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {s.num}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {idx < arr.length - 1 && (
                <div
                  className={`flex-1 h-[2px] mx-2 sm:mx-3 transition-colors ${
                    currentStep > s.num ? 'bg-emerald-600' : 'bg-slate-800'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>}

      {/* Main Kiosk Content Step Router */}
      <main className="flex-1 flex flex-col justify-center">
        {currentStep === 0 && (
          <KioskStartStep
            onPrintDocument={() => setCurrentStep(1)}
            onBuyBondpaper={() => setCurrentStep(6)}
          />
        )}
        {currentStep === 1 && (
          <UploadStep
            onFileSelected={handleFileSelected}
            sessionId={sessionId}
          />
        )}

        {currentStep === 6 && <BondpaperStep onBack={() => setCurrentStep(0)} />}

        {currentStep === 2 && pdfUrl && (
          <PreviewStep
            pdfUrl={pdfUrl}
            fileName={fileName}
            paperSize={paperSize}
            colorMode={colorMode}
            copies={copies}
            reverseOrder={reverseOrder}
            collate={collate}
            selectedPages={selectedPages}
            pricing={pricing}
            pricingLoading={pricingLoading}
            pricingError={pricingError}
            onPaperSizeChange={setPaperSize}
            onColorModeChange={setColorMode}
            onCopiesChange={setCopies}
            onReverseOrderChange={setReverseOrder}
            onCollateChange={setCollate}
            onTogglePage={handleTogglePage}
            onSelectAllPages={handleSelectAllPages}
            onDeselectAllPages={handleDeselectAllPages}
            onProceedToPayment={() => setCurrentStep(3)}
            onChangeFile={() => setCurrentStep(1)}
          />
        )}

        {currentStep === 3 && pricing && (
          <PaymentStep
            sessionId={sessionId}
            pricing={pricing}
            hardware={hardware}
            internetOnline={internetOnline}
            onPaymentSuccess={(details) => {
              setPaymentDetails(details);
              setCurrentStep(4); // Go to Printing
            }}
            onBackToOptions={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 4 && pricing && (
          <PrintingStep
            sessionId={sessionId}
            pdfUrl={pdfUrl || ''}
            fileName={fileName}
            pricing={pricing}
            selectedPages={selectedPages}
            paperSize={paperSize}
            colorMode={colorMode}
            copies={copies}
            reverseOrder={reverseOrder}
            collate={collate}
            onComplete={handleTransactionComplete}
          />
        )}

        {currentStep === 5 && pricing && paymentDetails && (
          <ReceiptStep
            sessionId={sessionId}
            pricing={pricing}
            paymentDetails={paymentDetails}
            completionData={completionData}
            onFilePrivacyChoice={handleFilePrivacyChoice}
          />
        )}
      </main>

      <IdleScreensaver
        onTimeout={handleIdleTimeout}
        onWake={() => setCurrentStep(0)}
      />

    </div>
  );
}

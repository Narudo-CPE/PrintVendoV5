import React, { useEffect, useRef, useState } from 'react';
import {
  Printer,
  QrCode,
  Bluetooth,
  Coins,
  Banknote,
  Sparkles,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  Layers,
  Zap,
  ArrowRight,
  Clock,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';

interface IdleScreensaverProps {
  currentStep?: number;
  onTimeout: () => void;
  onWake: () => void;
  idleTimeoutSeconds?: number;
}

export const IdleScreensaver: React.FC<IdleScreensaverProps> = ({
  currentStep = 0,
  onTimeout,
  onWake,
  idleTimeoutSeconds = 30,
}) => {
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [screensaverOpen, setScreensaverOpen] = useState(false);
  const [timerReset, setTimerReset] = useState(0);

  // Active Ad Slide index (0 to 3)
  const [activeSlide, setActiveSlide] = useState(0);
  const [currentTime, setCurrentTime] = useState('');
  const warningOpenRef = useRef(false);

  // Real-time clock for top status banner
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    updateTime();
    const clockInterval = setInterval(updateTime, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  // Idle Detection logic:
  // After 30 seconds of inactivity -> 30-second countdown warning -> then screensaver shows
  useEffect(() => {
    if (screensaverOpen) return;

    let warningTimer: number | undefined;
    let countdownTimer: number | undefined;
    let screensaverDirectTimer: number | undefined;

    const resetTimer = () => {
      window.clearTimeout(warningTimer);
      window.clearInterval(countdownTimer);
      window.clearTimeout(screensaverDirectTimer);
      setWarningOpen(false);
      warningOpenRef.current = false;

      // On start screen (step 0), activate screensaver after 30 seconds of inactivity
      if (currentStep === 0) {
        screensaverDirectTimer = window.setTimeout(() => {
          setScreensaverOpen(true);
        }, idleTimeoutSeconds * 1000);
      } else {
        // In active session (steps 1-5):
        // Wait 30 seconds of inactivity, then start 30-second countdown warning!
        const warningDelay = idleTimeoutSeconds * 1000;
        warningTimer = window.setTimeout(() => {
          setWarningOpen(true);
          warningOpenRef.current = true;
          setSecondsLeft(30);

          countdownTimer = window.setInterval(() => {
            setSecondsLeft((remaining) => {
              if (remaining <= 1) {
                window.clearInterval(countdownTimer);
                setWarningOpen(false);
                warningOpenRef.current = false;
                setScreensaverOpen(true);
                onTimeout();
                return 0;
              }
              return remaining - 1;
            });
          }, 1000);
        }, warningDelay);
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'pointermove',
      'keydown',
      'touchstart',
      'wheel',
    ];

    const handleActivity = () => {
      if (!warningOpenRef.current) {
        resetTimer();
      }
    };

    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, handleActivity, { passive: true })
    );

    resetTimer();

    return () => {
      window.clearTimeout(warningTimer);
      window.clearInterval(countdownTimer);
      window.clearTimeout(screensaverDirectTimer);
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, handleActivity)
      );
    };
  }, [screensaverOpen, onTimeout, timerReset, currentStep, idleTimeoutSeconds]);

  // Auto-rotate advertisement slides every 5.5 seconds while screensaver is visible
  useEffect(() => {
    if (!screensaverOpen) return;
    const slideInterval = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % 4);
    }, 5500);

    return () => clearInterval(slideInterval);
  }, [screensaverOpen]);

  const continueSession = () => {
    setWarningOpen(false);
    warningOpenRef.current = false;
    setTimerReset((value) => value + 1);
  };

  const wakeKiosk = () => {
    setScreensaverOpen(false);
    setWarningOpen(false);
    warningOpenRef.current = false;
    setTimerReset((value) => value + 1);
    onWake();
  };

  const nextSlide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveSlide((prev) => (prev + 1) % 4);
  };

  const prevSlide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveSlide((prev) => (prev - 1 + 4) % 4);
  };

  return (
    <>
      {/* Active Session Idle Warning Dialog (30-second countdown after 30 seconds of inactivity) */}
      {warningOpen && !screensaverOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-5 backdrop-blur-md"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="idle-warning-title"
        >
          <section className="bg-slate-900/95 border border-amber-400/40 rounded-3xl w-full max-w-lg p-8 sm:p-10 text-center text-white relative overflow-hidden shadow-2xl">
            <div className="absolute -top-16 -right-16 w-36 h-36 rounded-full bg-amber-500/15 blur-2xl pointer-events-none" />
            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-400/40 text-amber-300 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">⏳</span>
            </div>
            <h2 id="idle-warning-title" className="text-2xl font-black tracking-tight text-white">
              Are you still there?
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-300/80">
              This session will automatically reset to protect your document privacy.
            </p>
            <div
              className="my-6 font-mono text-7xl font-black tabular-nums text-amber-300 drop-shadow-[0_0_25px_rgba(251,191,36,0.4)]"
              aria-live="assertive"
            >
              {secondsLeft}s
            </div>
            <button
              type="button"
              onClick={continueSession}
              className="w-full py-4 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-sm uppercase tracking-wider rounded-2xl shadow-lg shadow-amber-500/30 transition-all cursor-pointer"
            >
              I'm Still Here · Keep Working
            </button>
          </section>
        </div>
      )}

      {/* Full-Screen Digital Kiosk Advertisement Screensaver (English Retail Kiosk Style) */}
      {screensaverOpen && (
        <div
          className="fixed inset-0 z-[110] bg-slate-950 select-none flex flex-col justify-between overflow-hidden cursor-pointer"
          onPointerDown={wakeKiosk}
          onTouchStart={wakeKiosk}
          role="button"
          aria-label="Touch anywhere to start printing"
          tabIndex={0}
          onKeyDown={wakeKiosk}
        >
          {/* Animated Ambient Glow Lighting */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute -top-40 -left-40 w-[38rem] h-[38rem] rounded-full bg-sky-500/20 blur-[150px] animate-pulse" />
            <div className="absolute top-1/2 -right-40 w-[42rem] h-[42rem] rounded-full bg-indigo-600/20 blur-[160px]" />
            <div className="absolute -bottom-40 left-1/3 w-[40rem] h-[40rem] rounded-full bg-pink-500/15 blur-[150px]" />
          </div>

          {/* Top Kiosk Header Bar */}
          <header className="relative z-10 px-6 sm:px-10 py-5 bg-slate-900/80 border-b border-slate-800/80 backdrop-blur-xl flex items-center justify-between">
            {/* Brand Logo & Station ID */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sky-400 via-indigo-500 to-pink-500 p-0.5 shadow-lg shadow-sky-500/30">
                <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                  <Printer className="w-6 h-6 text-sky-400" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black tracking-wider text-white">
                    PASTEL<span className="text-sky-400">PRINT</span>
                  </h1>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    LIVE VENDO
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-400 tracking-wide">
                  Autonomous Self-Service Printing Kiosk • Terminal #01
                </p>
              </div>
            </div>

            {/* Live Status Indicators & Clock */}
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 bg-slate-950/70 border border-slate-800 px-3.5 py-1.5 rounded-xl text-xs font-mono text-slate-300">
                <span className="text-sky-400">EPSON L120</span>
                <span className="text-slate-600">|</span>
                <span className="text-emerald-400">A4 • LETTER • LONG</span>
              </div>

              <div className="flex items-center gap-2 bg-slate-950/90 border border-slate-800 px-4 py-2 rounded-2xl text-right">
                <Clock className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="text-xs font-mono font-bold text-white tracking-wider">
                    {currentTime || '12:00:00 PM'}
                  </div>
                  <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
                    PH Time (PST)
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Central Main Stage: Kiosk Advertisement Showcase */}
          <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-8 py-4 sm:py-6 max-w-6xl mx-auto w-full">
            {/* Slide Navigation Buttons */}
            <button
              onClick={prevSlide}
              aria-label="Previous advertisement"
              className="hidden lg:flex absolute left-2 p-3 rounded-2xl bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-all z-20"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={nextSlide}
              aria-label="Next advertisement"
              className="hidden lg:flex absolute right-2 p-3 rounded-2xl bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-all z-20"
            >
              <ChevronRight className="w-6 h-6" />
            </button>

            {/* ========================================================================= */}
            {/* SLIDE 0: MAIN PRICING & SPEED PROMO (English)                             */}
            {/* ========================================================================= */}
            {activeSlide === 0 && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-center animate-in fade-in zoom-in-95 duration-500">
                {/* Left Catchy Copy */}
                <div className="lg:col-span-7 space-y-4 text-left">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-400/40 text-sky-300 text-xs font-extrabold tracking-wide uppercase">
                    <Sparkles className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                    AFFORDABLE & FAST SELF-SERVICE PRINTING
                  </div>

                  <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-[1.1]">
                    Fast & Reliable Printing.{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-indigo-300 to-pink-400">
                      Starting at ₱1.00!
                    </span>
                  </h2>

                  <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                    No waiting in line, no hassle! Fully autonomous self-service vending kiosk powered by
                    genuine Epson High-Definition MicroPiezo inkjet technology.
                  </p>

                  {/* Highlights Grid */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/80">
                      <div className="text-[11px] font-mono uppercase text-slate-400">Standard Text & Docs</div>
                      <div className="text-2xl font-black text-sky-400">₱1.00 <span className="text-xs font-normal text-slate-400">/ sheet</span></div>
                      <p className="text-[11px] text-slate-400 mt-0.5">Crisp black & white laser-grade text</p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/80">
                      <div className="text-[11px] font-mono uppercase text-slate-400">Vibrant Full Color</div>
                      <div className="text-2xl font-black text-pink-400">₱3.50 <span className="text-xs font-normal text-slate-400">/ sheet</span></div>
                      <p className="text-[11px] text-slate-400 mt-0.5">Photos, charts, school projects & posters</p>
                    </div>
                  </div>

                  {/* 3 Steps Pill */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 text-xs font-semibold text-slate-300">
                    <span className="px-3 py-1 rounded-xl bg-slate-800/70 border border-slate-700/60 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-sky-500 text-slate-950 font-black text-[10px] flex items-center justify-center">1</span>
                      Upload via Phone
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    <span className="px-3 py-1 rounded-xl bg-slate-800/70 border border-slate-700/60 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-indigo-500 text-slate-950 font-black text-[10px] flex items-center justify-center">2</span>
                      Choose Paper Size
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    <span className="px-3 py-1 rounded-xl bg-slate-800/70 border border-slate-700/60 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-emerald-500 text-slate-950 font-black text-[10px] flex items-center justify-center">3</span>
                      Insert Cash or GCash
                    </span>
                  </div>
                </div>

                {/* Right Visual Card Mockup */}
                <div className="lg:col-span-5 flex justify-center">
                  <div className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 p-6 shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/20 rounded-full blur-2xl pointer-events-none" />

                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-4">
                      <div className="flex items-center gap-2">
                        <Printer className="w-5 h-5 text-sky-400" />
                        <span className="font-mono text-xs font-bold text-slate-200">EXPRESS FEED ENGINE</span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-400/30">
                        INSTANT READY
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-950/60 border border-slate-800">
                        <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center text-sky-400 font-bold">
                          PDF
                        </div>
                        <div className="text-left flex-1">
                          <div className="text-xs font-bold text-white">Resumes & School Projects</div>
                          <div className="text-[11px] text-slate-400">Direct page & ink coverage counter</div>
                        </div>
                        <span className="text-xs font-black text-sky-400">₱1.00</span>
                      </div>

                      <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-950/60 border border-slate-800">
                        <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-400/30 flex items-center justify-center text-pink-400 font-bold">
                          CLR
                        </div>
                        <div className="text-left flex-1">
                          <div className="text-xs font-bold text-white">Certificates & ID Cards</div>
                          <div className="text-[11px] text-slate-400">Ultra-vibrant 4-color pigment CMYK</div>
                        </div>
                        <span className="text-xs font-black text-pink-400">₱3.50</span>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-500/15 to-teal-500/10 border border-emerald-400/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Coins className="w-5 h-5 text-emerald-400" />
                          <div className="text-left">
                            <div className="text-xs font-bold text-white">Automatic Change Dispenser</div>
                            <div className="text-[10px] text-emerald-300">Dual 220V AC Dispense Hoppers</div>
                          </div>
                        </div>
                        <span className="text-xs font-mono font-bold text-emerald-300">₱1 & ₱5</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* SLIDE 1: WIRELESS MOBILE UPLOAD PROMO (English)                           */}
            {/* ========================================================================= */}
            {activeSlide === 1 && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-center animate-in fade-in zoom-in-95 duration-500">
                <div className="lg:col-span-7 space-y-4 text-left">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-400/40 text-indigo-300 text-xs font-extrabold tracking-wide uppercase">
                    <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                    100% CONTACTLESS & PHONE FRIENDLY
                  </div>

                  <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-[1.1]">
                    No Flash Drive?{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-sky-300 to-emerald-400">
                      Upload Directly From Your Phone!
                    </span>
                  </h2>

                  <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                    Simply scan the QR code using your smartphone camera or beam your file via Bluetooth.
                    No cables, flash drives, or app installations needed!
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center shrink-0">
                        <QrCode className="w-5 h-5 text-sky-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Instant QR Code Scan</h4>
                        <p className="text-xs text-slate-400 mt-1">
                          Point your phone camera to upload PDFs, Word docs, or images directly.
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-400/40 flex items-center justify-center shrink-0">
                        <Bluetooth className="w-5 h-5 text-purple-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Bluetooth Direct Beam</h4>
                        <p className="text-xs text-slate-400 mt-1">
                          Wirelessly send documents directly to the kiosk Bluetooth transceiver for free!
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 text-xs text-emerald-400 font-mono">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>SECURE & PRIVATE: Documents are automatically wiped from memory after printing.</span>
                  </div>
                </div>

                <div className="lg:col-span-5 flex justify-center">
                  <div className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-indigo-950/40 to-slate-950 border border-indigo-500/30 p-6 shadow-2xl relative text-center">
                    <div className="w-20 h-20 rounded-3xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center mx-auto mb-4 text-indigo-400 shadow-xl shadow-indigo-500/20">
                      <Smartphone className="w-10 h-10" />
                    </div>
                    <h3 className="text-lg font-black text-white">Scan & Print Technology</h3>
                    <p className="text-xs text-slate-400 mt-1 mb-4">
                      Compatible with iPhone, Android, iPad, and all tablets without installing any app!
                    </p>

                    <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-left space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                        <CheckCircle2 className="w-4 h-4 text-sky-400" />
                        <span>PDF, Word Docs, Canva designs, JPG/PNG</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                        <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                        <span>Automatic optical ink coverage analysis</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Zero USB viruses or malware transfer</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* SLIDE 2: MULTI-PAPER TRAYS & BONDPAPER VENDO PROMO (English)             */}
            {/* ========================================================================= */}
            {activeSlide === 2 && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-center animate-in fade-in zoom-in-95 duration-500">
                <div className="lg:col-span-7 space-y-4 text-left">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-xs font-extrabold tracking-wide uppercase">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    3-TRAY MOTORIZED PAPER FEEDER
                  </div>

                  <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-[1.1]">
                    All Paper Sizes Available:{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-sky-400">
                      Letter, A4, & Long Folio!
                    </span>
                  </h2>

                  <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                    Equipped with dedicated precision NEMA-17 stepper motors and DRV8825 drivers for
                    each paper size. Always fresh, clean, and jam-free bondpaper.
                  </p>

                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-center">
                      <div className="text-[10px] font-mono uppercase text-slate-400">Short / Letter</div>
                      <div className="text-lg font-black text-white mt-1">8.5" × 11"</div>
                      <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300">
                        ₱1.00 base
                      </span>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-900/80 border border-emerald-500/30 text-center bg-emerald-950/20">
                      <div className="text-[10px] font-mono uppercase text-emerald-400">A4 Standard</div>
                      <div className="text-lg font-black text-white mt-1">8.27" × 11.69"</div>
                      <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300">
                        ₱1.00 base
                      </span>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-center">
                      <div className="text-[10px] font-mono uppercase text-slate-400">Long / Folio</div>
                      <div className="text-lg font-black text-white mt-1">8.5" × 13"</div>
                      <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300">
                        ₱1.50 base
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400">
                    💡 You can also purchase <strong className="text-white">fresh blank bondpaper sheets</strong> directly from the kiosk for student and office needs!
                  </p>
                </div>

                <div className="lg:col-span-5 flex justify-center">
                  <div className="w-full max-w-sm rounded-3xl bg-slate-900/90 border border-slate-800 p-6 shadow-2xl space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-slate-300">TRAY FEED SENSORS</span>
                      <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-md">
                        OPTICAL SENSORS ACTIVE
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex justify-between items-center text-xs">
                        <span className="font-semibold text-white">Tray 1: Standard A4</span>
                        <span className="font-mono text-emerald-400 font-bold">READY (70 GSM)</span>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex justify-between items-center text-xs">
                        <span className="font-semibold text-white">Tray 2: Short Letter</span>
                        <span className="font-mono text-emerald-400 font-bold">READY (80 GSM)</span>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex justify-between items-center text-xs">
                        <span className="font-semibold text-white">Tray 3: Long Folio</span>
                        <span className="font-mono text-emerald-400 font-bold">READY (80 GSM)</span>
                      </div>
                    </div>

                    <div className="pt-2 text-[11px] text-slate-400 border-t border-slate-800/80">
                      Arduino Uno microcontroller automated feed sequence prevents dual feeds and paper damage.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* SLIDE 3: ACCEPTED PAYMENTS PROMO (English)                                */}
            {/* ========================================================================= */}
            {activeSlide === 3 && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-center animate-in fade-in zoom-in-95 duration-500">
                <div className="lg:col-span-7 space-y-4 text-left">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 text-xs font-extrabold tracking-wide uppercase">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    CONVENIENT PAYMENT OPTIONS
                  </div>

                  <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-[1.1]">
                    Easy Payment Options.{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-300 to-emerald-400">
                      With Automatic Change!
                    </span>
                  </h2>

                  <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                    Accepts all Philippine coins and banknotes, plus instant GCash QR. High-speed 220V
                    AC motor hoppers automatically dispense your exact change.
                  </p>

                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800">
                      <div className="flex items-center gap-1.5 text-emerald-400 mb-1">
                        <Coins className="w-4 h-4" />
                        <span className="text-xs font-black">COINS</span>
                      </div>
                      <div className="text-base font-black text-white">₱1 · ₱5 · ₱10 · ₱20</div>
                      <div className="text-[10px] text-slate-400 mt-1">Allan 1239A Optical Acceptor</div>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800">
                      <div className="flex items-center gap-1.5 text-sky-400 mb-1">
                        <Banknote className="w-4 h-4" />
                        <span className="text-xs font-black">BILLS</span>
                      </div>
                      <div className="text-base font-black text-white">₱20 · ₱50 · ₱100</div>
                      <div className="text-[10px] text-slate-400 mt-1">TB74 Anti-Jam Bill Validator</div>
                    </div>

                    <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800">
                      <div className="flex items-center gap-1.5 text-blue-400 mb-1">
                        <QrCode className="w-4 h-4" />
                        <span className="text-xs font-black">GCASH</span>
                      </div>
                      <div className="text-base font-black text-white">Instant QR</div>
                      <div className="text-[10px] text-slate-400 mt-1">Real-time owner companion sync</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 text-xs font-mono text-amber-300">
                    <Sparkles className="w-4 h-4" />
                    <span>Hoppers are pre-loaded with fresh ₱5 and ₱1 coins for automatic change dispensing.</span>
                  </div>
                </div>

                <div className="lg:col-span-5 flex justify-center">
                  <div className="w-full max-w-sm rounded-3xl bg-slate-900/90 border border-slate-800 p-6 shadow-2xl relative overflow-hidden">
                    <div className="text-center pb-4 border-b border-slate-800">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-400 flex items-center justify-center mx-auto mb-2">
                        <Coins className="w-8 h-8" />
                      </div>
                      <h3 className="text-lg font-bold text-white">Automatic Change System</h3>
                      <p className="text-xs text-slate-400">Never worry about lack of loose change!</p>
                    </div>

                    <div className="py-4 space-y-2 text-xs">
                      <div className="flex justify-between items-center text-slate-300">
                        <span>Hopper 1 (₱5 Coins):</span>
                        <span className="font-mono font-bold text-emerald-400">DISPENSE READY</span>
                      </div>
                      <div className="flex justify-between items-center text-slate-300">
                        <span>Hopper 2 (₱1 Coins):</span>
                        <span className="font-mono font-bold text-emerald-400">DISPENSE READY</span>
                      </div>
                      <div className="flex justify-between items-center text-slate-300">
                        <span>Transaction Security:</span>
                        <span className="font-mono font-bold text-sky-400">PIN 8/9 INHIBIT PROTECTED</span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800 text-center">
                      <span className="text-[11px] font-mono text-slate-400">
                        No minimum purchase • Print 1 single page or 100 pages!
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>

          {/* Slide Indicator Dots & Auto-Advance Progress */}
          <div className="relative z-10 flex justify-center items-center gap-2 pb-2">
            {[0, 1, 2, 3].map((index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveSlide(index);
                }}
                className={`h-2.5 rounded-full transition-all duration-300 cursor-pointer ${
                  activeSlide === index
                    ? 'w-10 bg-gradient-to-r from-sky-400 to-indigo-500 shadow-lg shadow-sky-500/50'
                    : 'w-2.5 bg-slate-800 hover:bg-slate-700'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>

          {/* Giant Bottom Call-To-Action Banner (English) */}
          <footer className="relative z-10 px-4 sm:px-8 pb-6 pt-2">
            <div className="max-w-4xl mx-auto">
              <div className="group relative rounded-3xl p-1 bg-gradient-to-r from-sky-500 via-indigo-500 to-pink-500 shadow-2xl shadow-sky-500/30 animate-pulse hover:animate-none">
                <div className="bg-slate-950/90 rounded-[22px] px-6 sm:px-10 py-5 flex flex-col sm:flex-row items-center justify-between gap-4 backdrop-blur-xl">
                  <div className="text-center sm:text-left">
                    <div className="flex items-center justify-center sm:justify-start gap-2 text-sky-400 text-xs font-mono font-extrabold uppercase tracking-wider">
                      <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                      STANDBY ADVERTISING MODE
                    </div>
                    <div className="text-xl sm:text-3xl font-black text-white tracking-tight">
                      TOUCH SCREEN ANYWHERE TO BEGIN PRINTING
                    </div>
                    <div className="text-xs text-slate-400">
                      Touch screen anywhere to wake kiosk & start printing your documents
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-3">
                    <span className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-400 to-indigo-500 text-slate-950 flex items-center justify-center font-black text-2xl shadow-lg shadow-sky-400/40 transform group-hover:scale-105 transition-transform">
                      👆
                    </span>
                  </div>
                </div>
              </div>

              {/* Scrolling Promotional News Ticker Marquee along the bottom edge (English) */}
              <div className="mt-3 overflow-hidden py-1.5 px-4 rounded-xl bg-slate-900/60 border border-slate-800/60 text-slate-300 text-xs font-mono">
                <div className="kiosk-ticker-track">
                  <span className="mr-8">
                    📢 ANNOUNCEMENT: No minimum page requirement! • Printing starts at ₱1.00 for B&W and ₱3.50 for Full Color • Accepts ₱1, ₱5, ₱10, ₱20 coins and ₱20, ₱50, ₱100 bills • Automatic change dispensed instantly • Upload easily via phone QR scan or Bluetooth beam • Sandboxed & 100% Private files • Touch screen anywhere to begin!
                  </span>
                  <span className="mr-8">
                    📢 ANNOUNCEMENT: No minimum page requirement! • Printing starts at ₱1.00 for B&W and ₱3.50 for Full Color • Accepts ₱1, ₱5, ₱10, ₱20 coins and ₱20, ₱50, ₱100 bills • Automatic change dispensed instantly • Upload easily via phone QR scan or Bluetooth beam • Sandboxed & 100% Private files • Touch screen anywhere to begin!
                  </span>
                </div>
              </div>
            </div>
          </footer>
        </div>
      )}
    </>
  );
};
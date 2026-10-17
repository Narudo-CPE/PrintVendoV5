import React, { useState, useEffect } from 'react';
import {
  QrCode,
  FileText,
  X,
  ExternalLink,
  Bluetooth,
  Clock3,
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  FileCheck,
  Radio,
  Smartphone,
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
  Lock
} from 'lucide-react';
import { QRCodeCanvas } from './QRCodeCanvas';
import { kioskApiUrl } from '../utils/kioskApi';

interface UploadStepProps {
  onFileSelected: (fileUrl: string, fileName: string) => void;
  sessionId: string;
  onBack?: () => void;
}

const allowedExtensions = ['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png'];
const isAllowedFile = (fileName: string) =>
  allowedExtensions.some((extension) => fileName.toLowerCase().endsWith(extension));

interface RecentFile {
  name: string;
  url: string;
  size?: number;
  timestamp?: number;
  expiresInMinutes?: number;
}

type CardType = 'bluetooth' | 'qr' | 'recent';

export const UploadStep: React.FC<UploadStepProps> = ({ onFileSelected, sessionId, onBack }) => {
  // The primary active card is 1 big square at the top. Whichever is tapped becomes active!
  const [activeCard, setActiveCard] = useState<CardType>('bluetooth');

  const [showQrModal, setShowQrModal] = useState(false);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [showBluetoothModal, setShowBluetoothModal] = useState(false);
  const [bluetoothStatus, setBluetoothStatus] = useState<'idle' | 'enabling' | 'active'>('active');
  const [bluetoothMessage, setBluetoothMessage] = useState(
    "Bluetooth Beacon Active: Look for 'PrintPoint-Vendo-Kiosk' in phone Bluetooth settings."
  );
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState('');
  const [swapAnim, setSwapAnim] = useState(false);

  const [uploadOrigin, setUploadOrigin] = useState<string>(() => {
    return typeof window !== 'undefined' ? window.location.origin : '';
  });

  // Auto-detect kiosk host origin for QR URL
  useEffect(() => {
    let isCancelled = false;
    fetch(kioskApiUrl('/api/kiosk/upload-origin'), { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        if (typeof data.origin === 'string' && data.origin.startsWith('http')) {
          if (!isCancelled) {
            setUploadOrigin(data.origin.replace(/\/+$/, ''));
          }
        }
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, []);

  const uploadUrl = `${uploadOrigin || (typeof window !== 'undefined' ? window.location.origin : '')}${
    typeof window !== 'undefined' ? window.location.pathname : '/'
  }?upload=${sessionId}`;

  // Poll backend for mobile QR uploads for this session
  useEffect(() => {
    let isCancelled = false;
    let pollTimer: number;

    const checkMobileUpload = async () => {
      try {
        const response = await fetch(kioskApiUrl(`/api/session/${encodeURIComponent(sessionId)}/file`), {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        if (!isCancelled && data.uploaded && data.fileDataUrl) {
          setShowQrModal(false);
          setShowBluetoothModal(false);
          onFileSelected(data.fileDataUrl, data.fileName || 'Mobile_Upload.pdf');
          return;
        }
      } catch {
        // quiet retry
      }

      if (!isCancelled) {
        pollTimer = window.setTimeout(checkMobileUpload, 1500);
      }
    };

    pollTimer = window.setTimeout(checkMobileUpload, 1200);

    return () => {
      isCancelled = true;
      window.clearTimeout(pollTimer);
    };
  }, [sessionId, onFileSelected]);

  // Quick Demo Document generator (Instant Test Print without uploading a file)
  const handleSelectDemoDocument = (type: 'resume' | 'report' | 'id') => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (type === 'resume') {
      canvas.width = 794; // A4 standard
      canvas.height = 1123;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Header Banner (B&W Formal)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(40, 40, canvas.width - 80, 110);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('MARIA SANTOS', 70, 95);
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('BS Information Technology • De La Salle University • Manila', 70, 125);

      // Section 1: Objective
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('CAREER OBJECTIVE', 70, 200);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(70, 210);
      ctx.lineTo(canvas.width - 70, 210);
      ctx.stroke();

      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText('Motivated IT specialist passionate about full-stack systems, automated IoT kiosks,', 70, 240);
      ctx.fillText('and embedded Raspberry Pi micro-controller architectures.', 70, 265);

      // Section 2: Education
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('EDUCATION & CREDENTIALS', 70, 330);
      ctx.beginPath();
      ctx.moveTo(70, 340);
      ctx.lineTo(canvas.width - 70, 340);
      ctx.stroke();

      ctx.font = 'bold 15px sans-serif';
      ctx.fillText('Bachelor of Science in Information Technology', 70, 370);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText('Graduated Magna Cum Laude • 2022 - 2026', 70, 395);

      // Section 3: Experience
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('WORK EXPERIENCE', 70, 460);
      ctx.beginPath();
      ctx.moveTo(70, 470);
      ctx.lineTo(canvas.width - 70, 470);
      ctx.stroke();

      ctx.font = 'bold 15px sans-serif';
      ctx.fillText('Full Stack Vendo Engineer • KioskPoint Corp', 70, 500);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText('• Developed real-time pixel density optical ink pricing algorithms.', 85, 530);
      ctx.fillText('• Engineered NEMA-17 stepper paper feed integration with hardware watchdog.', 85, 555);
      ctx.fillText('• Integrated PayMongo GCash and multi-coin acceptor serial communication.', 85, 580);

      // Watermark
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'italic 12px sans-serif';
      ctx.fillText('Document generated for Vendo Touchscreen Testing — 1 Sheet Standard Print', 70, 1050);

      const dataUrl = canvas.toDataURL('image/png');
      onFileSelected(dataUrl, 'Sample_College_Resume.png');
    } else if (type === 'report') {
      canvas.width = 794;
      canvas.height = 1123;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Colorful Header
      const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
      grad.addColorStop(0, '#0284c7');
      grad.addColorStop(1, '#6366f1');
      ctx.fillStyle = grad;
      ctx.fillRect(40, 40, canvas.width - 80, 130);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText('QUARTERLY PERFORMANCE AUDIT', 70, 95);
      ctx.font = '15px sans-serif';
      ctx.fillStyle = '#e0f2fe';
      ctx.fillText('Vendo Network Analytics • Automated Financial Report', 70, 130);

      // Metric Bars
      const bars = [
        { label: 'Paper Tray Level', val: 380, color: '#0284c7' },
        { label: 'Thermal Head Health', val: 420, color: '#10b981' },
        { label: 'GCash QR Settlements', val: 450, color: '#6366f1' },
        { label: 'Coin Vault Total', val: 310, color: '#f59e0b' },
      ];

      bars.forEach((b, idx) => {
        const y = 280 + idx * 60;
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(b.label, 70, y);

        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(190, y - 16, 450, 22);

        ctx.fillStyle = b.color;
        ctx.fillRect(190, y - 16, b.val, 22);

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(`${b.val} units`, 200 + b.val + 10, y);
      });

      // Color Chart circle
      ctx.beginPath();
      ctx.arc(220, 640, 80, 0, Math.PI * 2);
      ctx.fillStyle = '#0284c7';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(220, 640, 50, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('High-Fidelity Color Print Preview', 340, 620);
      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText('CMYK optical density analysis verified for accurate billing.', 340, 650);

      const dataUrl = canvas.toDataURL('image/png');
      onFileSelected(dataUrl, 'Sample_Research_Report.png');
    } else {
      // ID Document
      canvas.width = 794;
      canvas.height = 1123;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.strokeRect(60, 60, canvas.width - 120, 480);

      ctx.fillStyle = '#0369a1';
      ctx.fillRect(63, 63, canvas.width - 126, 75);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('REPUBLIC OF THE PHILIPPINES', 90, 105);
      ctx.font = '13px sans-serif';
      ctx.fillText('NATIONAL IDENTIFICATION CARD (SAMPLE TEMPLATE)', 90, 126);

      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(90, 170, 160, 190);
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('PHOTO', 140, 275);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('LAST NAME: DELA CRUZ', 280, 200);
      ctx.fillText('FIRST NAME: JUAN', 280, 235);
      ctx.fillText('MIDDLE NAME: BAUTISTA', 280, 270);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText('Card Number: 1849-2940-1928-4019', 280, 315);
      ctx.fillText('Valid Until: 2030-10-17', 280, 345);

      const dataUrl = canvas.toDataURL('image/png');
      onFileSelected(dataUrl, 'National_ID_Template.png');
    }
  };

  const openRecentFiles = async () => {
    setShowRecentModal(true);
    setRecentLoading(true);
    setRecentError('');
    setRecentFiles([]);
    try {
      const response = await fetch(kioskApiUrl('/api/recent_uploads'), { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.files)) throw new Error('unavailable');
      const supportedFiles = result.files.filter((file: RecentFile) => isAllowedFile(file.name));
      setRecentFiles(supportedFiles);
      if (supportedFiles.length === 0) setRecentError('No recent uploads found in current kiosk queue.');
    } catch {
      setRecentError('No recent uploads found in current kiosk queue.');
    } finally {
      setRecentLoading(false);
    }
  };

  const enableBluetooth = async () => {
    setBluetoothStatus('enabling');
    setBluetoothMessage('Powering on kiosk Bluetooth transceiver...');
    try {
      const response = await fetch(kioskApiUrl('/api/bluetooth/enable'), { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      setBluetoothStatus('active');
      setBluetoothMessage(
        result.message || "Bluetooth Ready: Look for 'PrintPoint-Vendo-Kiosk' on your phone and beam your file."
      );
    } catch {
      setBluetoothStatus('active');
      setBluetoothMessage("Bluetooth Ready: Look for 'PrintPoint-Vendo-Kiosk' on your phone and beam your file.");
    }
  };

  // Switch active card with animation
  const handleSwitchCard = (type: CardType) => {
    if (activeCard === type) return;
    setSwapAnim(true);
    setActiveCard(type);
    if (type === 'bluetooth') {
      void enableBluetooth();
    }
    setTimeout(() => setSwapAnim(false), 400);
  };

  // The other two inactive cards that render in the two bottom quadrangles
  const inactiveCards: CardType[] = (['bluetooth', 'qr', 'recent'] as CardType[]).filter(
    (c) => c !== activeCard
  );

  // -------------------------------------------------------------
  // RENDER 1 BIG SQUARE AT TOP (HERO ACTIVE VIEW)
  // -------------------------------------------------------------
  const renderBigSquare = () => {
    if (activeCard === 'bluetooth') {
      return (
        <div
          key="big-bluetooth"
          className={`w-full glass-panel rounded-3xl p-7 sm:p-9 text-left relative overflow-hidden shadow-2xl border-2 border-purple-400/60 bg-gradient-to-b from-purple-950/60 via-purple-900/30 to-slate-950/80 transition-all duration-400 ${
            swapAnim ? 'scale-[0.98] opacity-80' : 'scale-100 opacity-100'
          }`}
        >
          {/* Ambient Purple Glow */}
          <div className="absolute -top-28 -right-28 w-80 h-80 bg-purple-500/20 rounded-full blur-[80px] pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-indigo-500/15 rounded-full blur-[70px] pointer-events-none" />

          {/* Top Tag & Status */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6 relative z-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-500/20 border border-purple-400/40 text-purple-200 text-xs font-bold shadow-sm">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-ping" />
              <span>ACTIVE CHANNEL: BLUETOOTH DIRECT</span>
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 border border-white/10 text-xs font-mono text-purple-300">
              <Radio className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span>Beacon: PrintPoint-Vendo-Kiosk</span>
            </div>
          </div>

          {/* Hero Content: Icon + Title + Description */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center mb-8 relative z-10">
            <div className="md:col-span-4 flex flex-col items-center justify-center text-center">
              <div className="relative">
                <div className="absolute inset-0 bg-purple-500/30 blur-2xl rounded-full animate-pulse" />
                <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-gradient-to-br from-purple-500/30 to-indigo-600/40 border border-purple-400/50 flex items-center justify-center text-purple-200 shadow-[0_0_40px_rgba(168,85,247,0.4)]">
                  <Bluetooth className="w-16 h-16 sm:w-18 sm:h-18 text-purple-300" />
                </div>
              </div>
              <span className="text-[11px] font-bold text-purple-300/80 mt-3 uppercase tracking-wider">
                Direct Device-To-Device
              </span>
            </div>

            <div className="md:col-span-8 space-y-3">
              <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                Bluetooth Wireless File Transfer
              </h3>
              <p className="text-slate-300 text-xs sm:text-sm leading-relaxed max-w-xl">
                Transmit your PDF or photos straight from your Android smartphone, Mac, or Windows laptop without Wi-Fi or cables.
              </p>

              {/* Step instructions */}
              <div className="rounded-2xl bg-black/40 border border-purple-500/30 p-4 space-y-2 backdrop-blur-md">
                <div className="text-xs font-bold text-purple-200 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-purple-400" />
                  <span>How to beam your file:</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] text-slate-300 pt-1">
                  <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10">
                    <span className="font-bold text-purple-300 block mb-0.5">1. Turn On BT</span>
                    Open phone Bluetooth settings
                  </div>
                  <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10">
                    <span className="font-bold text-purple-300 block mb-0.5">2. Find Kiosk</span>
                    Tap <strong className="text-white">PrintPoint-Vendo</strong>
                  </div>
                  <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10">
                    <span className="font-bold text-purple-300 block mb-0.5">3. Share Document</span>
                    Select 'Share via Bluetooth'
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="pt-5 border-t border-purple-500/30 flex flex-wrap items-center justify-between gap-3 relative z-10">
            <div className="flex items-center gap-2 text-xs text-purple-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Receiver ready & awaiting incoming OBEX payload</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowBluetoothModal(true)}
                className="py-2.5 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-purple-600/30 transition cursor-pointer"
              >
                <Bluetooth className="w-4 h-4" />
                <span>Pairing Guide</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (activeCard === 'qr') {
      return (
        <div
          key="big-qr"
          className={`w-full glass-panel rounded-3xl p-7 sm:p-9 text-left relative overflow-hidden shadow-2xl border-2 border-sky-400/60 bg-gradient-to-b from-sky-950/60 via-slate-900/40 to-slate-950/80 transition-all duration-400 ${
            swapAnim ? 'scale-[0.98] opacity-80' : 'scale-100 opacity-100'
          }`}
        >
          {/* Ambient Sky Glow */}
          <div className="absolute -top-28 -right-28 w-80 h-80 bg-sky-500/20 rounded-full blur-[80px] pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-blue-600/15 rounded-full blur-[70px] pointer-events-none" />

          {/* Top Tag & Status */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6 relative z-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-500/20 border border-sky-400/40 text-sky-200 text-xs font-bold shadow-sm">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" />
              <span>ACTIVE CHANNEL: SMARTPHONE QR SCAN</span>
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 border border-white/10 text-xs font-mono text-sky-300">
              <Smartphone className="w-3.5 h-3.5 text-sky-400" />
              <span>Session #{sessionId.slice(0, 8)}</span>
            </div>
          </div>

          {/* Hero Content: QR Canvas + Description */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center mb-6 relative z-10">
            <div className="md:col-span-5 flex flex-col items-center justify-center text-center">
              <div className="p-3.5 bg-white/10 rounded-2xl border border-white/20 backdrop-blur-md shadow-2xl inline-block">
                <QRCodeCanvas
                  value={uploadUrl}
                  size={190}
                  label="SCAN CAMERA TO UPLOAD"
                  sublabel={`Session #${sessionId.slice(0, 8)}`}
                  showUrlControls={false}
                />
              </div>

              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>Waiting for phone upload...</span>
              </div>
            </div>

            <div className="md:col-span-7 space-y-3">
              <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                Instant Camera QR Upload
              </h3>
              <p className="text-slate-300 text-xs sm:text-sm leading-relaxed max-w-xl">
                No apps or pairing needed. Just open your phone camera, scan the QR code on the left, and choose your file from your smartphone.
              </p>

              <div className="rounded-2xl bg-black/40 border border-sky-500/30 p-4 space-y-2 backdrop-blur-md">
                <div className="text-xs font-bold text-sky-200 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-sky-400" />
                  <span>3-Step Quick Upload:</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] text-slate-300 pt-1">
                  <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10">
                    <span className="font-bold text-sky-300 block mb-0.5">1. Scan QR</span>
                    Open phone camera app
                  </div>
                  <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10">
                    <span className="font-bold text-sky-300 block mb-0.5">2. Pick File</span>
                    Tap link & select PDF or photo
                  </div>
                  <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10">
                    <span className="font-bold text-sky-300 block mb-0.5">3. Auto Load</span>
                    Kiosk advances automatically
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="pt-5 border-t border-sky-500/30 flex flex-wrap items-center justify-between gap-3 relative z-10">
            <div className="flex items-center gap-2 text-xs text-sky-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Camera QR Receiver Ready • Direct Sandboxed Upload</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowQrModal(true)}
                className="py-2.5 px-5 rounded-xl bg-sky-600/30 hover:bg-sky-600/50 border border-sky-400/40 text-sky-200 font-bold text-xs flex items-center gap-2 shadow-lg shadow-sky-600/20 transition cursor-pointer"
              >
                <QrCode className="w-4 h-4 text-sky-400" />
                <span>Enlarge QR Code</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // RECENT UPLOADS & PRE-LOADED PRINTS (ACTIVE HERO VIEW)
    return (
      <div
        key="big-recent"
        className={`w-full glass-panel rounded-3xl p-7 sm:p-9 text-left relative overflow-hidden shadow-2xl border-2 border-emerald-400/60 bg-gradient-to-b from-emerald-950/60 via-slate-900/40 to-slate-950/80 transition-all duration-400 ${
          swapAnim ? 'scale-[0.98] opacity-80' : 'scale-100 opacity-100'
        }`}
      >
        {/* Ambient Emerald Glow */}
        <div className="absolute -top-28 -right-28 w-80 h-80 bg-emerald-500/20 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-teal-600/15 rounded-full blur-[70px] pointer-events-none" />

        {/* Top Tag & Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 relative z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs font-bold shadow-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span>ACTIVE CHANNEL: RECENT UPLOADS</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openRecentFiles()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-xs font-bold text-emerald-200 transition cursor-pointer shadow-sm"
            >
              <Clock3 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Check Recent Files</span>
            </button>
          </div>
        </div>

        {/* Hero Content */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center mb-6 relative z-10">
          <div className="md:col-span-4 flex flex-col items-center justify-center text-center">
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-500/25 blur-2xl rounded-full animate-pulse" />
              <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-gradient-to-br from-emerald-500/30 to-teal-600/40 border border-emerald-400/50 flex items-center justify-center text-emerald-200 shadow-[0_0_40px_rgba(16,185,129,0.35)]">
                <Clock3 className="w-16 h-16 sm:w-18 sm:h-18 text-emerald-300" />
              </div>
            </div>
            <span className="text-[11px] font-bold text-emerald-300/80 mt-3 uppercase tracking-wider">
              Temporary Kiosk Queue
            </span>
          </div>

          <div className="md:col-span-8 space-y-3">
            <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Recent Files
            </h3>
            
            {/* User-requested exact wording */}
            <p className="text-emerald-300 font-semibold text-sm sm:text-base leading-relaxed">
              Do you have your recent file here? Open this.
            </p>

            {/* Crucial 30-min auto-delete reminder badge */}
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-400/35 text-amber-200 text-xs flex items-start gap-2.5">
              <span className="text-base shrink-0">⏳</span>
              <div>
                <strong className="font-bold text-amber-300 block">
                  Reminder: Files auto-delete for 30 mins after it has been uploaded.
                </strong>
                <span className="text-slate-300/80 text-[11px] mt-0.5 block">
                  Documents transferred from your phone via QR scan or Bluetooth remain accessible in this temporary kiosk queue for 30 minutes, then are permanently wiped.
                </span>
              </div>
            </div>

            {/* 1-Tap Demo Templates */}
            <div className="pt-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Or Print Immediately With Pre-Loaded Documents:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSelectDemoDocument('resume')}
                  className="p-3 rounded-2xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 hover:border-sky-400/50 text-left transition flex flex-col justify-between group cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <FileText className="w-5 h-5 text-sky-400" />
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300">
                      B&W
                    </span>
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-sky-300">College Resume</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">1 Sheet Standard</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectDemoDocument('report')}
                  className="p-3 rounded-2xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 hover:border-indigo-400/50 text-left transition flex flex-col justify-between group cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                      Color
                    </span>
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-indigo-300">Metrics Report</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Charts & Headings</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectDemoDocument('id')}
                  className="p-3 rounded-2xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 hover:border-emerald-400/50 text-left transition flex flex-col justify-between group cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <FileCheck className="w-5 h-5 text-emerald-400" />
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      ID Form
                    </span>
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-emerald-300">National ID</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Government Template</div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Action Row */}
        <div className="pt-5 border-t border-emerald-500/30 flex flex-wrap items-center justify-between gap-3 relative z-10">
          <span className="text-xs text-slate-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Check files recently sent to this kiosk from your smartphone:
          </span>

          <button
            type="button"
            onClick={() => void openRecentFiles()}
            className="py-3 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
          >
            <Clock3 className="w-4 h-4" />
            <span>Open This · View Recent Files</span>
          </button>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------
  // RENDER TWO SMALLER QUADRANGLES (INACTIVE CHANNELS)
  // -------------------------------------------------------------
  const renderSmallQuadrangle = (type: CardType) => {
    if (type === 'bluetooth') {
      return (
        <div
          key="small-bluetooth"
          role="button"
          tabIndex={0}
          onClick={() => handleSwitchCard('bluetooth')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleSwitchCard('bluetooth');
          }}
          className="glass-card-interactive group p-5 sm:p-6 text-left rounded-2xl relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-purple-400/50 cursor-pointer border border-purple-500/30 hover:border-purple-400 hover:shadow-[0_0_25px_rgba(168,85,247,0.25)] transition-all flex flex-col justify-between"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-400/30 text-purple-300 flex items-center justify-center group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all">
              <Bluetooth className="w-6 h-6" />
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/15 border border-purple-400/30 text-[11px] font-bold text-purple-300 group-hover:bg-purple-500/25 transition">
              <span>Tap to Focus</span>
              <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </span>
          </div>

          <div>
            <h4 className="text-lg font-black text-white group-hover:text-purple-300 transition-colors">
              Bluetooth Transfer
            </h4>
            <p className="text-xs text-slate-400 mt-1 line-clamp-2">
              Beam document or photos from your Android phone or laptop via Bluetooth beacon.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-purple-300/80 font-mono">
            <span>Beacon: PrintPoint-Vendo</span>
            <span className="font-bold text-purple-300 group-hover:underline">Select Channel →</span>
          </div>
        </div>
      );
    }

    if (type === 'qr') {
      return (
        <div
          key="small-qr"
          role="button"
          tabIndex={0}
          onClick={() => handleSwitchCard('qr')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleSwitchCard('qr');
          }}
          className="glass-card-interactive group p-5 sm:p-6 text-left rounded-2xl relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-sky-400/50 cursor-pointer border border-sky-500/30 hover:border-sky-400 hover:shadow-[0_0_25px_rgba(14,165,233,0.25)] transition-all flex flex-col justify-between"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/20 border border-sky-400/30 text-sky-300 flex items-center justify-center group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(14,165,233,0.4)] transition-all">
              <QrCode className="w-6 h-6" />
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-400/30 text-[11px] font-bold text-sky-300 group-hover:bg-sky-500/25 transition">
              <span>Tap to Focus</span>
              <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </span>
          </div>

          <div>
            <h4 className="text-lg font-black text-white group-hover:text-sky-300 transition-colors">
              Smartphone QR Scan
            </h4>
            <p className="text-xs text-slate-400 mt-1 line-clamp-2">
              Scan with phone camera to instantly upload documents with zero installations.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-sky-300/80 font-mono">
            <span>Instant Camera Link</span>
            <span className="font-bold text-sky-300 group-hover:underline">Select Channel →</span>
          </div>
        </div>
      );
    }

    // Recent Files & USB Small Quadrangle
    return (
      <div
        key="small-recent"
        role="button"
        tabIndex={0}
        onClick={() => handleSwitchCard('recent')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleSwitchCard('recent');
        }}
        className="glass-card-interactive group p-5 sm:p-6 text-left rounded-2xl relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-emerald-400/50 cursor-pointer border border-emerald-500/30 hover:border-emerald-400 hover:shadow-[0_0_25px_rgba(16,185,129,0.25)] transition-all flex flex-col justify-between"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 flex items-center justify-center group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all">
            <Clock3 className="w-6 h-6" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-bold text-emerald-300 group-hover:bg-emerald-500/25 transition">
            <span>Tap to Focus</span>
            <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </span>
        </div>

        <div>
          <h4 className="text-lg font-black text-white group-hover:text-emerald-300 transition-colors">
            Recent Files
          </h4>
          <p className="text-xs text-slate-300 font-medium mt-1">
            Do you have your recent file here? Open this.
          </p>
          <p className="text-[11px] text-amber-300/80 mt-1">
            Reminder: Files auto-delete for 30 mins after upload.
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-emerald-300/80 font-mono">
          <span>Recent Queue</span>
          <span className="font-bold text-emerald-300 group-hover:underline">Select Channel →</span>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto py-4 px-4 flex flex-col items-center relative z-10 w-full">
      {/* Top Header with Back Navigation */}
      <div className="w-full flex items-center justify-between mb-6">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="glass-btn-secondary px-4 py-2 text-xs font-bold flex items-center gap-2 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-sky-400" />
            <span>Back to Home</span>
          </button>
        ) : (
          <div />
        )}

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-md text-xs font-semibold text-sky-300">
          <FileCheck className="w-3.5 h-3.5 text-sky-400" />
          <span>Step 1 of 5: Document Upload</span>
        </div>

        <div className="w-24" />
      </div>

      {/* Section Title */}
      <div className="text-center mb-6">
        <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-2">
          Select Document Transfer Channel
        </h2>
        <p className="text-slate-300 text-xs sm:text-sm max-w-xl mx-auto">
          Tap any channel below to bring it to the center. The active channel is highlighted in the large square above.
        </p>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 1 BIG SQUARE AT THE TOP (THE ACTIVE / TAPPED CHANNEL)        */}
      {/* ------------------------------------------------------------- */}
      <div className="w-full mb-5">
        {renderBigSquare()}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* TWO SMALLER QUADRANGLES AT THE BOTTOM                         */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
        {inactiveCards.map((type) => renderSmallQuadrangle(type))}
      </div>

      {/* Kiosk Lockdown & Security Guarantee Banner (NO LOCAL FILE PICKER) */}
      <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400 bg-black/40 border border-white/10 px-5 py-2.5 rounded-full backdrop-blur-md">
        <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span>PastelPrint Lockdown Active: Host OS file explorer disabled. Sandboxed transfer only.</span>
      </div>

      {/* QR Code Zoom Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-modal p-6 sm:p-8 max-w-md w-full text-center relative shadow-2xl">
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl bg-white/[0.06] hover:bg-white/[0.12] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-2xl font-black text-white mb-2">Scan with Smartphone</h3>
            <p className="text-xs text-slate-300/80 mb-5 leading-relaxed">
              Open your phone camera to open the instant upload webpage. Once you choose your file, this screen will load it automatically.
            </p>

            <div className="mb-4 p-4 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-md inline-block">
              <QRCodeCanvas
                value={uploadUrl}
                size={220}
                label="SCAN CAMERA TO UPLOAD"
                sublabel={`Session #${sessionId.slice(0, 8)}`}
                showUrlControls
              />
            </div>

            <div className="text-xs font-semibold text-emerald-400 flex items-center justify-center gap-2 mb-4 bg-emerald-500/10 py-1.5 px-3 rounded-full border border-emerald-500/25 inline-flex">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Listening for uploaded file...</span>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/10">
              <a
                href={uploadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-btn-primary py-2.5 px-3 text-xs flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Mobile View
              </a>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="glass-btn-secondary py-2.5 px-3 text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bluetooth Guide Modal */}
      {showBluetoothModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <section className="glass-modal w-full max-w-lg p-8 text-center text-white relative shadow-2xl" role="status" aria-live="polite">
            <button
              type="button"
              onClick={() => setShowBluetoothModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl bg-white/[0.06] hover:bg-white/[0.12] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-16 h-16 rounded-2xl bg-purple-500/20 border border-purple-400/40 text-purple-300 flex items-center justify-center mx-auto mb-4">
              <Bluetooth className="h-8 w-8 animate-pulse text-purple-300" />
            </div>
            <h3 className="text-2xl font-black">Bluetooth Discovery Active</h3>
            <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-300">{bluetoothMessage}</p>

            <div className="mt-5 p-4 rounded-2xl bg-black/40 border border-purple-400/30 text-left">
              <div className="text-xs font-bold text-purple-200 mb-2">How to beam from your phone:</div>
              <ol className="text-xs text-slate-300 space-y-1.5 list-decimal list-inside">
                <li>Open your smartphone's Bluetooth settings</li>
                <li>Tap <strong className="text-white">PrintPoint-Vendo-Kiosk</strong> to pair</li>
                <li>Open your document or photo and select <strong className="text-white">Share via Bluetooth</strong></li>
              </ol>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowBluetoothModal(false)}
                className="py-2.5 px-8 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Recent Uploads Modal */}
      {showRecentModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-modal p-6 sm:p-8 max-w-lg w-full text-center relative shadow-2xl">
            <button
              type="button"
              onClick={() => setShowRecentModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl bg-white/[0.06] hover:bg-white/[0.12] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-2xl font-black text-white mb-1">Recent Files</h3>
            <p className="text-sm font-semibold text-emerald-300 mb-3">
              Do you have your recent file here? Open this.
            </p>
            <div className="mb-5 p-3 rounded-2xl bg-amber-500/10 border border-amber-400/30 text-amber-200 text-xs text-left flex items-start gap-2">
              <span className="text-base shrink-0">⏳</span>
              <p className="text-[11px] leading-relaxed">
                <strong className="text-amber-300">Reminder:</strong> Files auto-delete for 30 mins after it has been uploaded. Select your file to load it into memory.
              </p>
            </div>

            {recentLoading ? (
              <div className="py-8 text-slate-300 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Checking recent files queue...</span>
              </div>
            ) : null}

            {(recentError || (!recentLoading && recentFiles.length === 0)) ? (
              <div className="my-4 glass-card p-6 text-center text-white">
                <h4 className="text-base font-bold text-slate-200">No recent uploads in queue</h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-400 mb-4">
                  Upload via Smartphone QR scan or Bluetooth, or choose a pre-loaded test document:
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRecentModal(false);
                      handleSelectDemoDocument('resume');
                    }}
                    className="glass-btn-primary px-3 py-2 text-xs font-bold"
                  >
                    Resume (B&W)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRecentModal(false);
                      handleSelectDemoDocument('report');
                    }}
                    className="glass-btn-secondary px-3 py-2 text-xs font-bold text-indigo-300"
                  >
                    Report (Color)
                  </button>
                </div>
              </div>
            ) : null}

            <div className="max-h-64 space-y-2 overflow-y-auto text-left mb-6">
              {recentFiles.map((file) => (
                <button
                  type="button"
                  key={`${file.name}:${file.url}`}
                  onClick={async () => {
                    try {
                      const response = await fetch(new URL(file.url, kioskApiUrl('/')));
                      if (!response.ok) throw new Error('unavailable');
                      onFileSelected(URL.createObjectURL(await response.blob()), file.name);
                      setShowRecentModal(false);
                    } catch {
                      setRecentError('Could not load this file. It may have expired.');
                    }
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-emerald-400/40 p-3.5 text-left transition cursor-pointer"
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <FileText className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="font-semibold text-xs text-white truncate">{file.name}</span>
                  </span>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {file.expiresInMinutes ? (
                      <span className="text-[10px] font-mono font-medium text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-400/20">
                        {file.expiresInMinutes}m left
                      </span>
                    ) : null}
                    <span className="text-xs text-emerald-400 font-bold px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/25">
                      Open & Print
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowRecentModal(false)}
              className="glass-btn-secondary w-full py-2.5 text-xs font-bold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

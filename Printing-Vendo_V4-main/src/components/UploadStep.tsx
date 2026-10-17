import React, { useState, useEffect, useRef } from 'react';
import { QrCode, UploadCloud, FileText, X, ExternalLink, Bluetooth, Clock3 } from 'lucide-react';
import { QRCodeCanvas } from './QRCodeCanvas';
import { kioskApiUrl } from '../utils/kioskApi';

interface UploadStepProps {
  onFileSelected: (fileUrl: string, fileName: string) => void;
  sessionId: string;
}

const allowedExtensions = ['.pdf', '.docx', '.jpg', '.jpeg', '.png'];
const isAllowedFile = (fileName: string) => allowedExtensions.some((extension) => fileName.toLowerCase().endsWith(extension));

interface RecentFile {
  name: string;
  url: string;
  size?: number;
}

export const UploadStep: React.FC<UploadStepProps> = ({ onFileSelected, sessionId }) => {
  const [showQrModal, setShowQrModal] = useState(false);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [showBluetoothModal, setShowBluetoothModal] = useState(false);
  const [bluetoothStatus, setBluetoothStatus] = useState('Enabling Bluetooth...');
  const receivedFiles = useRef(new Set<string>());
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadOrigin, setUploadOrigin] = useState<string | null>(null);
  const [uploadOriginError, setUploadOriginError] = useState('');

  useEffect(() => {
    let isCancelled = false;
    fetch(kioskApiUrl('/api/kiosk/upload-origin'), { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data.origin !== 'string') {
          throw new Error(data.detail || 'The kiosk LAN address could not be detected.');
        }
        const parsedOrigin = new URL(data.origin);
        const isPrivateIpv4 = /^(10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})$/.test(parsedOrigin.hostname);
        if (!isPrivateIpv4) {
          throw new Error('The kiosk did not return a private LAN IPv4 address. Connect it to Wi-Fi or Ethernet and try again.');
        }
        if (!isCancelled) {
          setUploadOrigin(data.origin.replace(/\/+$/, ''));
          setUploadOriginError('');
        }
      })
      .catch((error: unknown) => {
        if (!isCancelled) setUploadOriginError(error instanceof Error ? error.message : 'The kiosk LAN address could not be detected.');
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const uploadUrl = uploadOrigin
    ? `${uploadOrigin}${typeof window !== 'undefined' ? window.location.pathname : '/'}?upload=${sessionId}`
    : '';

  const processFile = (file: File) => {
    if (!isAllowedFile(file.name)) {
      alert('Accepted formats: PDF, DOCX, JPG, JPEG, and PNG.');
      return;
    }

    if (/\.(jpg|jpeg|png)$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result) {
          onFileSelected(reader.result as string, file.name);
        }
      };
      reader.readAsDataURL(file);
      return;
    }

    const url = URL.createObjectURL(file);
    onFileSelected(url, file.name);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // Listen for QR and Bluetooth uploads pushed by the backend.
  useEffect(() => {
    let isCancelled = false;
    let reconnectTimer: number | undefined;
    let socket: WebSocket | undefined;
    const connect = () => {
      if (isCancelled) return;
      const url = new URL(kioskApiUrl(`/ws/${encodeURIComponent(sessionId)}`));
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.onmessage = async (message) => {
        let deliveryKey: string | undefined;
        try {
          const event = JSON.parse(message.data);
          if (event.event !== 'FILE_RECEIVED') return;
          const data = event.data || {};
          if (data.session_id && data.session_id !== sessionId) return;
          if (typeof data.file_url !== 'string' || typeof data.filename !== 'string') return;
          deliveryKey = String(data.file_id || `${data.filename}:${data.file_url}`);
          if (receivedFiles.current.has(deliveryKey)) return;
          receivedFiles.current.add(deliveryKey);
          const response = await fetch(new URL(data.file_url, kioskApiUrl('/')));
          if (!response.ok) throw new Error('Unable to load the received file.');
          setShowQrModal(false);
          setShowBluetoothModal(false);
          onFileSelected(URL.createObjectURL(await response.blob()), data.filename);
        } catch (error) {
          if (deliveryKey) receivedFiles.current.delete(deliveryKey);
          console.error('Could not load uploaded file from event:', error);
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (!isCancelled) reconnectTimer = window.setTimeout(connect, 1500);
      };
    };
    connect();

    return () => {
      isCancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [sessionId, onFileSelected]);

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
      if (supportedFiles.length === 0) setRecentError('unavailable');
    } catch {
      setRecentError('unavailable');
    } finally {
      setRecentLoading(false);
    }
  };

  const enableBluetooth = async () => {
    setShowBluetoothModal(true);
    setBluetoothStatus('Enabling Bluetooth...');
    try {
      const response = await fetch(kioskApiUrl('/api/bluetooth/enable'), { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Bluetooth could not be enabled.');
      setBluetoothStatus("Bluetooth Enabled. Look for 'PrintPoint-Kiosk' on your device and send your file.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      setBluetoothStatus(detail && detail !== 'Failed to fetch'
        ? detail
        : 'Bluetooth could not be enabled. Check that the kiosk backend and Bluetooth service are running.');
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="max-w-5xl mx-auto py-8 px-4 flex flex-col items-center relative"
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="absolute inset-2 z-40 bg-blue-600/90 border-4 border-dashed border-white rounded-3xl backdrop-blur-sm flex flex-col items-center justify-center text-white pointer-events-none animate-pulse">
          <UploadCloud className="w-20 h-20 mb-3 animate-bounce" />
          <h3 className="text-2xl font-black">Drop Document or Image Here</h3>
          <p className="text-sm text-blue-100 mt-1">Accepted formats: PDF, DOCX, JPG, JPEG, and PNG</p>
        </div>
      )}

      <div className="text-center mb-8">
          <h2 className="text-3xl font-black text-white tracking-tight mb-2">
          Print Document
        </h2>
        <p className="text-slate-400 text-sm max-w-xl mx-auto">
          Choose QR Code, Bluetooth, or a recent uploaded file.
        </p>
      </div>

      <div className="mb-6 w-full border-2 border-amber-400 bg-amber-950/70 p-4 text-center text-base font-black text-amber-100 shadow-lg" role="alert">
        Please ensure your file and paper size are correct. No refunds for user errors.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full mb-8">
        {/* Channel 1: Mobile QR Upload */}
        <div
          onClick={() => setShowQrModal(true)}
          className="bg-slate-800/80 hover:bg-slate-800 border-2 border-slate-700 hover:border-blue-500 rounded-2xl p-6 flex flex-col items-center text-center cursor-pointer transition-all hover:-translate-y-1 shadow-lg group"
        >
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <QrCode className="w-8 h-8" />
          </div>
          <h3 className="font-bold text-white text-lg mb-1">QR Code</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            Scan with your smartphone camera to upload directly from your mobile browser.
          </p>
          <span className="mt-auto text-xs font-bold text-blue-400 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20">
            Open QR Code
          </span>
        </div>

        {/* Bluetooth receive */}
        <button type="button" onClick={() => void enableBluetooth()} className="bg-slate-800/80 hover:bg-slate-800 border-2 border-slate-700 hover:border-purple-500 rounded-2xl p-6 flex flex-col items-center text-center cursor-pointer transition-all hover:-translate-y-1 shadow-lg group">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Bluetooth className="w-8 h-8" />
          </div>
          <h3 className="font-bold text-white text-lg mb-1">Bluetooth</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            Make the kiosk discoverable and send a supported document from your device.
          </p>
          <span className="mt-auto text-xs font-bold text-purple-400 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">
            Enable Bluetooth
          </span>
        </button>

        <button type="button" onClick={() => void openRecentFiles()} className="bg-slate-800/80 hover:bg-slate-800 border-2 border-slate-700 hover:border-emerald-500 rounded-2xl p-6 flex flex-col items-center text-center transition-all hover:-translate-y-1 shadow-lg group">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><Clock3 className="w-8 h-8" /></div>
          <h3 className="font-bold text-white text-lg mb-1">Recent</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">Choose from files in the kiosk's recent uploads.</p>
          <span className="mt-auto text-xs font-bold text-emerald-400">Browse Recent Files</span>
        </button>
      </div>

      {/* QR Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center relative shadow-2xl">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-black text-white mb-2">Scan to Upload</h3>
            <p className="text-xs text-slate-400 mb-6">
              Scan with your phone's native camera. Once opened in your browser, upload your file and it will appear here automatically.
            </p>
            {/* Real Dynamic Scannable QR Code */}
            <div className="mb-4">
              {uploadUrl ? (
                <QRCodeCanvas
                  value={uploadUrl}
                  size={180}
                  label="SCAN WITH SMARTPHONE CAMERA"
                  sublabel={`Session: #${sessionId.slice(0, 8)}`}
                  showUrlControls
                />
              ) : (
                <div role="alert" className="mx-auto flex min-h-48 max-w-xs flex-col items-center justify-center rounded-xl border border-amber-200/25 bg-white/10 p-5 text-sm text-white backdrop-blur-xl">
                  <span className="font-bold">QR link unavailable</span>
                  <span className="mt-2 text-xs text-white/75">{uploadOriginError || 'Detecting kiosk LAN address...'}</span>
                </div>
              )}
            </div>

            <div className="text-xs font-semibold text-emerald-400 flex items-center justify-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>{uploadUrl ? 'Awaiting document stream from mobile phone...' : 'Waiting for a usable LAN address...'}</span>
            </div>

            <p className="text-[11px] text-slate-400 max-w-xs mx-auto mb-4">
              Scan with camera or tap below to open the mobile uploader in a separate tab or window.
            </p>

            <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-slate-800">
              {uploadUrl && <a
                href={uploadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open Mobile View
              </a>}
            </div>
          </div>
        </div>
      )}

      {showBluetoothModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <section className="health-glass-panel w-full max-w-lg p-7 text-center text-white" role="status" aria-live="polite">
            <Bluetooth className="mx-auto mb-4 h-10 w-10 text-sky-200" />
            <h3 className="text-xl font-black">Waiting for Bluetooth file</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/85">{bluetoothStatus}</p>
            {bluetoothStatus.startsWith('Bluetooth Enabled.') && <div className="mt-5 flex items-center justify-center gap-2 text-xs text-white/70">
              <span className="h-2 w-2 animate-pulse rounded-full bg-sky-300" />
              Waiting for file...
            </div>}
            <button type="button" onClick={() => setShowBluetoothModal(false)} className="mt-6 min-h-11 rounded-xl border border-white/25 bg-white/15 px-5 font-bold text-white hover:bg-white/25">Cancel</button>
          </section>
        </div>
      )}

      {showRecentModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl p-6 sm:p-8 max-w-lg w-full text-center relative shadow-2xl">
            <button
              onClick={() => setShowRecentModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-black text-white mb-2">Recent Uploads</h3>
            <p className="text-xs text-slate-400 mb-6">Select a supported file from recent uploads.</p>
            {recentLoading ? <div className="py-10 text-slate-300">Loading recent files...</div> : null}
            {(recentError || (!recentLoading && recentFiles.length === 0)) ? (
              <section className="mx-auto my-4 max-w-md border border-white/20 bg-white/10 px-6 py-10 text-center text-white shadow-2xl backdrop-blur-2xl">
                <h4 className="text-xl font-black">Nothing to see here.</h4>
                <p className="mt-3 text-sm leading-relaxed text-white/85">All uploaded files are automatically permanently deleted after 30 minutes to protect user privacy. You decide what to do.</p>
              </section>
            ) : null}
            <div className="max-h-72 space-y-2 overflow-y-auto text-left">
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
                      setRecentError('unavailable');
                    }
                  }}
                  className="flex w-full items-center justify-between border border-slate-700 bg-slate-800 p-4 text-left hover:border-emerald-400"
                >
                  <span className="flex items-center gap-3"><FileText className="h-5 w-5 text-emerald-400" /><span className="font-bold text-white">{file.name}</span></span>
                  <span className="text-xs text-emerald-300">Select</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowRecentModal(false)}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

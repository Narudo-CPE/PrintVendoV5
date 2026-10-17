import React, { useState } from 'react';
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  Smartphone,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  Printer
} from 'lucide-react';
import { kioskApiUrl } from '../utils/kioskApi';

interface MobileUploadViewProps {
  sessionId: string;
  onUploadSuccess?: (fileUrl: string, fileName: string) => void;
}

export const MobileUploadView: React.FC<MobileUploadViewProps> = ({ sessionId }) => {
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [fileDeleted, setFileDeleted] = useState(false);
  const deleteUploadedFile = async () => {
    try {
      await fetch(kioskApiUrl(`/api/session/${encodeURIComponent(sessionId)}/file`), { method: 'DELETE' });
    } finally {
      setFileDeleted(true);
    }
  };

  const sendFileToKiosk = async (file: File) => {
    setUploading(true);
    setStatusMsg('Transmitting document to Kiosk terminal...');

    try {
      const fileName = file.name;
      const form = new FormData();
      form.append('file', file, file.name);
      const response = await fetch(kioskApiUrl(`/api/upload/${encodeURIComponent(sessionId)}`), {
        method: 'POST',
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'The kiosk could not accept this file.');

      setUploading(false);
      setCompleted(true);
      setSelectedFileName(fileName);
      setStatusMsg('File accepted. The kiosk is opening the document preview.');
    } catch (error) {
      setUploading(false);
      setStatusMsg(error instanceof Error ? error.message : 'Could not send the file to the kiosk.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/\.(pdf|docx|jpg|jpeg|png)$/i.test(file.name)) {
      setStatusMsg('Only PDF, DOCX, JPG, JPEG, and PNG files are accepted.');
      e.target.value = '';
      return;
    }

    void sendFileToKiosk(file);
  };

  return (
    <div className="min-h-screen text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-sky-500 relative">
      {/* Ambient Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-96 h-96 bg-sky-500/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-10 right-10 w-80 h-80 bg-indigo-500/12 rounded-full blur-[130px]" />
      </div>

      <div className="w-full max-w-md glass-modal p-6 sm:p-8 relative z-10 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-sky-500/15 text-sky-400 border border-sky-400/30 mb-3 shadow-[0_0_20px_rgba(14,165,233,0.25)]">
            <Smartphone className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            PrintPoint Mobile Upload
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Connected to Kiosk Session <span className="font-mono text-sky-400 font-bold">#{sessionId.slice(0, 8)}</span>
          </p>
        </div>

        {/* Status Card */}
        {completed ? (
          <div className="text-center py-5">
            <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-400/40 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-bounce shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-black text-white mb-1">Upload Complete!</h2>
            <p className="text-xs text-slate-300 mb-2">
              <strong className="text-emerald-400">{selectedFileName}</strong> has been transferred directly to the kiosk screen.
            </p>
            <div className="bg-black/40 border border-white/10 rounded-xl p-3.5 my-4 text-xs text-slate-300 flex items-center justify-center gap-2 shadow-inner">
              <Printer className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Please look at the <strong>kiosk monitor</strong> to configure pages, paper tray, and proceed to payment.</span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Your document is stored locally on the vending machine and automatically deleted after 30 minutes.
            </p>
            {!fileDeleted ? (
              <button
                onClick={deleteUploadedFile}
                className="glass-btn-danger mt-3 px-4 py-2 text-xs font-bold"
              >
                Delete My File Now
              </button>
            ) : (
              <p className="mt-3 text-xs font-bold text-emerald-400">Your file was deleted.</p>
            )}

            <button
              onClick={() => {
                setCompleted(false);
                setSelectedFileName(null);
              }}
              className="glass-btn-secondary mt-4 px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 mx-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Upload Another Document
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* File Pick Area */}
            <label className="block border-2 border-dashed border-white/20 hover:border-sky-400/50 rounded-2xl p-6 text-center cursor-pointer transition-all bg-white/[0.03] hover:bg-white/[0.06] group">
              <input
                type="file"
                accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                onChange={handleFileChange}
                disabled={uploading}
                className="hidden"
              />
              <div className="w-14 h-14 rounded-2xl bg-sky-500/15 text-sky-400 border border-sky-400/25 flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform shadow-[0_0_15px_rgba(14,165,233,0.2)]">
                <UploadCloud className="w-7 h-7" />
              </div>
              <div className="text-sm font-bold text-white mb-1">
                Choose Document from Phone
              </div>
              <div className="text-[11px] text-slate-400">
                PDF, DOCX, JPG, JPEG, and PNG files accepted.
              </div>
              <div className="mt-4 inline-block glass-btn-primary px-5 py-2.5 text-xs font-bold">
                {uploading ? 'Transmitting to Kiosk...' : 'Browse Files / Photos'}
              </div>
            </label>

            {statusMsg && (
              <div className="text-center text-xs font-semibold text-sky-300 flex items-center justify-center gap-2 py-2">
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                {statusMsg}
              </div>
            )}
          </div>
        )}

        {/* Security badge */}
        <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Local Kiosk Tunnel · Automatic Memory Purge</span>
        </div>
      </div>
    </div>
  );
};

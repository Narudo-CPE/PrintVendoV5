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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-blue-600">
      {/* Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative z-10">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30 mb-3 shadow-inner">
            <Smartphone className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            PrintPoint Mobile Upload
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Connected to Kiosk Session <span className="font-mono text-blue-400 font-bold">#{sessionId.slice(0, 8)}</span>
          </p>
        </div>

        {/* Status Card */}
        {completed ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-black text-white mb-1">Upload Complete!</h2>
            <p className="text-xs text-slate-300 mb-2">
              <strong className="text-emerald-400">{selectedFileName}</strong> has been transferred directly to the kiosk screen.
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 my-4 text-xs text-slate-400 flex items-center justify-center gap-2">
              <Printer className="w-4 h-4 text-sky-400" />
              <span>Please look at the <strong>kiosk monitor</strong> to configure pages, paper tray, and proceed to payment.</span>
            </div>

            <p className="text-[11px] text-slate-500">
              Your document is stored on the vending-machine PC and is automatically deleted after 30 minutes.
            </p>
            {!fileDeleted ? (
              <button
                onClick={deleteUploadedFile}
                className="mt-3 px-4 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 border border-rose-800 text-rose-300 text-xs font-bold transition"
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
              className="mt-4 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition flex items-center justify-center gap-2 mx-auto cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Upload Another Document
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* File Pick Area */}
            <label className="block border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-2xl p-6 text-center cursor-pointer transition-colors bg-slate-950/60 group">
              <input
                type="file"
                accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                onChange={handleFileChange}
                disabled={uploading}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div className="text-sm font-bold text-white mb-1">
                Choose Document from Phone
              </div>
              <div className="text-[11px] text-slate-400">
                PDF, DOCX, JPG, JPEG, and PNG files are accepted.
              </div>
              <div className="mt-4 inline-block px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black shadow-md shadow-blue-600/20">
                {uploading ? 'Transmitting...' : 'Browse Files / Photos'}
              </div>
            </label>

            {statusMsg && (
              <div className="text-center text-xs font-semibold text-blue-400 flex items-center justify-center gap-2 py-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                {statusMsg}
              </div>
            )}
          </div>
        )}

        {/* Security badge */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Local Kiosk Tunnel • Automatic Memory Purge</span>
        </div>
      </div>
    </div>
  );
};

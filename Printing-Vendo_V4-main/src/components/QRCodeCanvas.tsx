import React, { useEffect, useRef, useState } from 'react';
import QRCode, { QRCodeRenderersOptions, QRCodeErrorCorrectionLevel } from 'qrcode';
import { Copy, Check, ExternalLink } from 'lucide-react';

interface QRCodeCanvasProps {
  value: string;
  size?: number;
  level?: QRCodeErrorCorrectionLevel;
  label?: string;
  sublabel?: string;
  showUrlControls?: boolean;
  className?: string;
}

export const QRCodeCanvas: React.FC<QRCodeCanvasProps> = ({
  value,
  size = 200,
  level = 'medium',
  label,
  sublabel,
  showUrlControls = false,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !value) return;

    const options: QRCodeRenderersOptions = {
      width: size,
      margin: 2,
      errorCorrectionLevel: (level as QRCodeErrorCorrectionLevel) || 'medium',
      color: {
        dark: '#0f172a', // Slate 900 for high optical contrast
        light: '#ffffff',
      },
    };

    QRCode.toCanvas(canvasRef.current, value, options)
      .then(() => {
        setError(null);
      })
      .catch((err: Error) => {
        console.error('QR code generation error:', err);
        setError('Failed to generate QR code');
      });
  }, [value, size, level]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy
      const el = document.createElement('textarea');
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="bg-white p-3.5 rounded-2xl shadow-xl border-2 border-slate-200 flex flex-col items-center">
        {error ? (
          <div className="w-48 h-48 flex items-center justify-center text-xs text-rose-500 font-bold text-center p-2">
            {error}
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="rounded-lg max-w-full h-auto block"
            style={{ width: `${size}px`, height: `${size}px` }}
          />
        )}

        {(label || sublabel) && (
          <div className="mt-2 text-center w-full px-1 border-t border-slate-100 pt-1.5">
            {label && <div className="text-[11px] font-bold text-slate-800 tracking-tight truncate">{label}</div>}
            {sublabel && <div className="text-[10px] font-mono text-slate-500 truncate">{sublabel}</div>}
          </div>
        )}
      </div>

      {showUrlControls && (
        <div className="mt-3 flex items-center gap-2 max-w-xs w-full justify-center">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition cursor-pointer"
            title={value.startsWith('http') ? 'Copy URL' : 'Copy QR Payload'}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{value.startsWith('http') ? 'Copy Link' : 'Copy Code'}</span>
              </>
            )}
          </button>

          {value.startsWith('http') && (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-semibold transition cursor-pointer"
              title="Open in new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open Link</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
};

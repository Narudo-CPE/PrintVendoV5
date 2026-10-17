import React from 'react';
import { Printer, Wifi, WifiOff, Cpu, Layers, Maximize2, AlertTriangle } from 'lucide-react';
import { HardwareState } from '../types';

interface KioskHeaderProps {
  hardware: HardwareState;
  internetOnline: boolean;
  onToggleFullscreen: () => void;
}

export const KioskHeader: React.FC<KioskHeaderProps> = ({
  hardware,
  internetOnline,
  onToggleFullscreen,
}) => {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-2xl bg-slate-950/75 border-b border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <div className="max-w-7xl mx-auto px-5 py-3.5 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-500 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-[0_0_24px_rgba(14,165,233,0.35),inset_0_1px_1px_rgba(255,255,255,0.4)] border border-sky-300/30">
            <Printer className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-extrabold tracking-tight text-white">
                PRINTPOINT
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-400/25">
                Kiosk V4
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium tracking-wide">
              Self-Service Touchscreen Station
            </p>
          </div>
        </div>

        {/* Telemetry Status Pills */}
        <div className="hidden md:flex items-center gap-2.5">
          {/* Hardware Connection */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold backdrop-blur-md transition-all ${
              hardware.connected
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                : 'bg-rose-500/15 border-rose-500/30 text-rose-300 animate-pulse'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span
              className={`w-2 h-2 rounded-full ${
                hardware.connected
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  : 'bg-rose-500'
              }`}
            />
            <span>
              {hardware.connected
                ? `Acceptor ${hardware.acceptorConnected ? 'Online' : 'Standby'} · Actuator ${hardware.actuatorConnected ? 'Ready' : 'Standby'}`
                : 'Hardware Linking...'}
            </span>
          </div>

          {/* Internet / GCash Health */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold backdrop-blur-md ${
              internetOnline
                ? 'bg-white/[0.05] border-white/10 text-slate-200'
                : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
            }`}
          >
            {internetOnline ? (
              <Wifi className="w-3.5 h-3.5 text-sky-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>{internetOnline ? 'GCash Gateway Online' : 'Cash Only Mode'}</span>
          </div>

          {/* Stepper Motor Trays */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 text-slate-300 text-xs font-medium backdrop-blur-md">
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span>Trays: A4 · Letter · Long</span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleFullscreen}
            className="flex items-center gap-1.5 p-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 hover:border-white/20 text-slate-200 text-xs font-semibold cursor-pointer transition active:scale-95 shadow-sm"
            title="Toggle Kiosk Fullscreen Mode"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Critical Hardware Disconnection Banner */}
      {!hardware.connected && (
        <div className="bg-rose-950/70 border-b border-rose-500/30 px-5 py-2.5 text-white text-xs sm:text-sm font-semibold flex items-center justify-between backdrop-blur-md animate-pulse">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span className="text-rose-100">
              <strong className="text-white">Hardware link offline:</strong> Microcontroller connection pending. Touchscreen features active.
            </span>
          </div>
          <span className="text-[11px] bg-rose-500/20 text-rose-200 px-2.5 py-0.5 rounded-lg border border-rose-400/30 font-bold uppercase tracking-wider">
            Auto-reconnecting
          </span>
        </div>
      )}
    </header>
  );
};

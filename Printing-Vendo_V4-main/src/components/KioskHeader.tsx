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
    <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-sky-400 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <Printer className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              PRINTPOINT KIOSK
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                RPi 4 Edition
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">Self-Service Touchscreen System</p>
          </div>
        </div>

        {/* Telemetry Status Pills */}
        <div className="hidden md:flex items-center gap-3">
          {/* Hardware Connection */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
              hardware.connected
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                : 'bg-rose-950/60 border-rose-700 text-rose-300 animate-pulse'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span
              className={`w-2 h-2 rounded-full ${
                hardware.connected ? 'bg-emerald-500 shadow-sm shadow-emerald-400' : 'bg-rose-500'
              }`}
            />
            <span>
              Acceptor {hardware.acceptorConnected ? 'Online' : 'Offline'} · Actuator{' '}
              {hardware.actuatorConnected ? 'Online' : 'Offline'}
            </span>
          </div>

          {/* Internet / GCash Health */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${
              internetOnline
                ? 'bg-slate-800 border-slate-700 text-slate-200'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-400'
            }`}
          >
            {internetOnline ? <Wifi className="w-3.5 h-3.5 text-blue-400" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>{internetOnline ? 'GCash Gateway Online' : 'Offline (Cash Only)'}</span>
          </div>

          {/* Stepper Motor Trays */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300 text-xs font-medium">
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span>Trays: A4 • Letter • Long</span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleFullscreen}
            className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition active:scale-95"
            title="Toggle Kiosk Fullscreen Mode"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Critical Hardware Disconnection Banner */}
      {!hardware.connected && (
        <div className="bg-rose-700 border-b border-rose-800 px-4 py-2 text-white text-xs sm:text-sm font-semibold flex items-center justify-between shadow-inner animate-pulse">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              <strong>Hardware link disconnected:</strong> Microcontroller (Arduino Uno R3) is offline. Cash acceptors and physical printing are temporarily locked until connection is restored.
            </span>
          </div>
          <span className="text-[11px] bg-black/20 px-2 py-0.5 rounded uppercase font-bold tracking-wider">
            Auto-recovering
          </span>
        </div>
      )}
    </header>
  );
};

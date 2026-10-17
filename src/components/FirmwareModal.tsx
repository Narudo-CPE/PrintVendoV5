import React, { useState } from 'react';
import {
  X,
  Cpu,
  CheckCircle2,
  FileCode,
  AlertTriangle,
  HelpCircle,
  Terminal,
  Usb,
  ShieldAlert,
} from 'lucide-react';

interface FirmwareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FirmwareModal: React.FC<FirmwareModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'troubleshooting'>('overview');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border-2 border-sky-500/40 rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-white tracking-wide">
                  Dual Arduino Firmware
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30">
                  115200 Baud 8N1
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Separate non-blocking sketches for cash acceptors and change/paper actuators
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-950/90 border-b border-slate-800">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Pinout & Flash Guide</span>
          </button>

          <button
            onClick={() => setActiveTab('troubleshooting')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activeTab === 'troubleshooting'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-amber-400/80 hover:text-amber-300 hover:bg-slate-850'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
            <span>Upload Troubleshooting & Error Fixes</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs text-slate-300">
          {activeTab === 'overview' ? (
            <>
              {/* Quick Hardware Pinout Matrix */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                <h4 className="text-xs font-black text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-sky-400" />
                  Hardware Wiring & Pinout Mapping (Two Arduino Uno R3 Boards)
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
                  <div className="bg-slate-900 p-3 rounded-xl border border-slate-800/80">
                    <div className="font-bold text-amber-400 mb-1.5">Allan 1239A Coin</div>
                    <div className="space-y-1 text-slate-300 font-mono text-[10px]">
                      <div>Pulse: <span className="text-white font-bold">Pin 2 (INT0)</span></div>
                      <div>Inhibit: <span className="text-white font-bold">Pin 8</span></div>
                      <div className="text-slate-500">1p=₱1, 5p=₱5, 10p=₱10</div>
                    </div>
                  </div>

                  <div className="bg-slate-900 p-3 rounded-xl border border-slate-800/80">
                    <div className="font-bold text-emerald-400 mb-1.5">TB74 Bill Acceptor</div>
                    <div className="space-y-1 text-slate-300 font-mono text-[10px]">
                      <div>Pulse: <span className="text-white font-bold">Pin 3 (INT1)</span></div>
                      <div>Inhibit: <span className="text-white font-bold">Pin 9</span></div>
                      <div className="text-slate-500">1p=₱20, 2p=₱50, 5p=₱100</div>
                    </div>
                  </div>

                  <div className="bg-slate-900 p-3 rounded-xl border border-slate-800/80">
                    <div className="font-bold text-sky-400 mb-1.5">DRV8825 Stepper Trays</div>
                    <div className="space-y-1 text-slate-300 font-mono text-[10px]">
                      <div>A4 Tray: <span className="text-white font-bold">Step 4, Dir 5</span></div>
                      <div>Letter: <span className="text-white font-bold">Step 6, Dir 7</span></div>
                      <div>Long: <span className="text-white font-bold">Step 10, Dir 11</span></div>
                      <div>Enable: <span className="text-white font-bold">Pin 12 (Active Low)</span></div>
                    </div>
                  </div>

                  <div className="bg-slate-900 p-3 rounded-xl border border-slate-800/80">
                    <div className="font-bold text-purple-400 mb-1.5">220V AC Hoppers</div>
                    <div className="space-y-1 text-slate-300 font-mono text-[10px]">
                      <div>₱5 Relay: <span className="text-white font-bold">Pin A0</span></div>
                      <div>₱1 Relay: <span className="text-white font-bold">Pin A1</span></div>
                      <div>₱5 Sensor: <span className="text-white font-bold">Pin A2</span></div>
                      <div>₱1 Sensor: <span className="text-white font-bold">Pin A3</span></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Flash Instructions */}
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
                <h4 className="text-xs font-black text-white uppercase tracking-wider mb-2">
                  Firmware Files & Serial Ports
                </h4>
                <div className="space-y-2 text-slate-400 text-[11px] leading-relaxed">
                  <p>Arduino 1, acceptors: <code className="text-sky-300">firmware/kiosk_acceptor_uno/kiosk_acceptor_uno.ino</code></p>
                  <p>Arduino 2, hoppers and paper feed: <code className="text-sky-300">firmware/kiosk_actuator_uno/kiosk_actuator_uno.ino</code></p>
                  <p>Open each sketch separately in Arduino IDE, select Arduino Uno, and upload it to its matching board.</p>
                  <p>Default serial ports: Linux <code className="text-slate-200">/dev/ttyACM0</code> and <code className="text-slate-200">/dev/ttyACM1</code>; Windows <code className="text-slate-200">COM3</code> and <code className="text-slate-200">COM4</code>.</p>
                  <p>Both sketches use non-blocking timing with <code className="text-slate-200">millis()</code>; neither uses <code className="text-slate-200">delay()</code>.</p>
                </div>
              </div>

              {/* Code Preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Current Firmware Source Files
                  </span>
                </div>
              </div>
            </>
          ) : (
            /* Troubleshooting Tab */
            <div className="space-y-4">
              <div className="bg-amber-950/30 border border-amber-500/40 rounded-2xl p-4">
                <h4 className="text-xs font-black text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  Top Reasons Arduino Upload Fails & How to Fix Them
                </h4>
                <p className="text-[11px] text-slate-300">
                  If Arduino IDE displays an error when clicking the Upload button (Ctrl+U), match your error message with the verified solutions below:
                </p>
              </div>

              {/* Error 1 */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-xs mb-1.5">
                  <Terminal className="w-4 h-4" />
                  <span>1. "avrdude: ser_open(): can't open device" or "Access is denied / Resource busy"</span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-1.5 ml-6">
                  <p><strong className="text-white">Cause:</strong> Another application currently has the serial port open.</p>
                  <p><strong className="text-emerald-400">Fix:</strong></p>
                  <ul className="list-disc list-inside text-slate-400 space-y-1">
                    <li>Close the Arduino IDE <strong>Serial Monitor</strong> window (or any PuTTY / screen session).</li>
                    <li>Stop the kiosk backend with <code className="text-slate-200">Ctrl+C</code> while uploading.</li>
                    <li>Unplug the USB cable, wait 3 seconds, and plug it back in.</li>
                  </ul>
                </div>
              </div>

              {/* Error 2 */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-xs mb-1.5">
                  <Usb className="w-4 h-4" />
                  <span>2. "avrdude: stk500_recv(): programmer is not responding"</span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-1.5 ml-6">
                  <p><strong className="text-white">Cause:</strong> Wrong serial port selected, bootloader baud mismatch, or RX/TX pins occupied.</p>
                  <p><strong className="text-emerald-400">Fix:</strong></p>
                  <ul className="list-disc list-inside text-slate-400 space-y-1">
                    <li>Go to <strong className="text-white">Tools &gt; Port</strong> and select the board being uploaded, usually <code>/dev/ttyACM0</code> or <code>/dev/ttyACM1</code> on Linux.</li>
                    <li><strong>Disconnect anything on Pin 0 (RX) and Pin 1 (TX)</strong> while uploading! The USB chip uses these pins to program the ATmega328P.</li>
                    <li>If using a Chinese clone board (CH340 chip) or Nano: under <strong className="text-white">Tools &gt; Processor</strong>, choose <strong className="text-amber-300">"ATmega328P (Old Bootloader)"</strong>.</li>
                  </ul>
                </div>
              </div>

              {/* Error 3 */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-xs mb-1.5">
                  <FileCode className="w-4 h-4" />
                  <span>3. "The sketch must be in a matching folder"</span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-1.5 ml-6">
                  <p><strong className="text-white">Cause:</strong> Arduino IDE requires the sketch file to have the exact same parent folder name.</p>
                  <p><strong className="text-emerald-400">Fix:</strong> Keep each sketch inside its matching folder: <code className="text-sky-300">kiosk_acceptor_uno</code> or <code className="text-sky-300">kiosk_actuator_uno</code>.</p>
                </div>
              </div>

              {/* Error 4 */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-sky-400 font-bold text-xs mb-1.5">
                  <HelpCircle className="w-4 h-4" />
                  <span>4. Port menu is grayed out / no serial port appears</span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-1.5 ml-6">
                  <p><strong className="text-emerald-400">Fix:</strong></p>
                  <ul className="list-disc list-inside text-slate-400 space-y-1">
                    <li>Ensure you are using a <strong>data-capable USB cable</strong> (some charging cords do not have data wires).</li>
                    <li>For a CH340-based board, ensure the Raspberry Pi OS CH341/CH340 kernel driver is available and the kiosk user has serial-device permissions.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
            <CheckCircle2 className="w-4 h-4" />
            {activeTab === 'overview' ? 'Firmware ready for deployment' : 'Troubleshooting steps verified'}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

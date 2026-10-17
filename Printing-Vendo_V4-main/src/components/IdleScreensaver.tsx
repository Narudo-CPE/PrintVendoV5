import React, { useEffect, useRef, useState } from 'react';

interface IdleScreensaverProps {
  onTimeout: () => void;
  onWake: () => void;
}

export const IdleScreensaver: React.FC<IdleScreensaverProps> = ({ onTimeout, onWake }) => {
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [screensaverOpen, setScreensaverOpen] = useState(false);
  const [timerReset, setTimerReset] = useState(0);
  const [position, setPosition] = useState({ x: 120, y: 100 });
  const warningOpenRef = useRef(false);
  const direction = useRef({ x: 1, y: 1 });
  const logoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (screensaverOpen) return;
    let warningTimer: number | undefined;
    let countdownTimer: number | undefined;

    const resetTimer = () => {
      window.clearTimeout(warningTimer);
      window.clearInterval(countdownTimer);
      setWarningOpen(false);
      warningOpenRef.current = false;
      setSecondsLeft(30);
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
      }, 150_000);
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel',
    ];
    const handleActivity = () => {
      if (!warningOpenRef.current) resetTimer();
    };
    activityEvents.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }));
    resetTimer();

    return () => {
      window.clearTimeout(warningTimer);
      window.clearInterval(countdownTimer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
    };
  }, [screensaverOpen, onTimeout, timerReset]);

  useEffect(() => {
    if (!screensaverOpen) return;
    let frameId = 0;
    let previousTime = 0;

    const animate = (time: number) => {
      const logo = logoRef.current;
      if (!logo) {
        frameId = window.requestAnimationFrame(animate);
        return;
      }
      const elapsed = previousTime ? Math.min((time - previousTime) / 16.67, 2) : 1;
      previousTime = time;
      const maxX = Math.max(0, window.innerWidth - logo.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - logo.offsetHeight);
      setPosition((current) => {
        let x = current.x + direction.current.x * elapsed * 2.2;
        let y = current.y + direction.current.y * elapsed * 1.7;
        if (x <= 0 || x >= maxX) direction.current.x *= -1;
        if (y <= 0 || y >= maxY) direction.current.y *= -1;
        x = Math.min(maxX, Math.max(0, x));
        y = Math.min(maxY, Math.max(0, y));
        return { x, y };
      });
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [screensaverOpen]);

  const continueSession = () => {
    setWarningOpen(false);
    warningOpenRef.current = false;
    setSecondsLeft(30);
    setTimerReset((value) => value + 1);
  };

  const wakeKiosk = () => {
    setScreensaverOpen(false);
    onWake();
  };

  return (
    <>
      {warningOpen && !screensaverOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-5" role="alertdialog" aria-modal="true" aria-labelledby="idle-warning-title">
          <section className="w-full max-w-lg border border-amber-400 bg-slate-950 p-8 text-center text-white shadow-2xl">
            <h2 id="idle-warning-title" className="text-2xl font-black">Hey, are you still there?</h2>
            <p className="mt-3 text-slate-200">This session will be stopped in 30 seconds.</p>
            <div className="my-6 font-mono text-6xl font-black tabular-nums text-amber-300" aria-live="assertive">{secondsLeft}</div>
            <button type="button" onClick={continueSession} className="min-h-12 bg-amber-400 px-8 font-bold text-slate-950 hover:bg-amber-300">
              I'm still here
            </button>
          </section>
        </div>
      )}
      {screensaverOpen && (
        <div className="fixed inset-0 z-[110] bg-black" onPointerDown={wakeKiosk} onTouchStart={wakeKiosk} role="button" aria-label="Touch to wake the kiosk" tabIndex={0} onKeyDown={wakeKiosk}>
          <div
            ref={logoRef}
            className="absolute select-none font-black tracking-[0.12em] text-white"
            style={{ left: position.x, top: position.y }}
          >
            PRINTPOINT
          </div>
        </div>
      )}
    </>
  );
};
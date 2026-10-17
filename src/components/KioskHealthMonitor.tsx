import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { kioskApiUrl } from '../utils/kioskApi';

interface KioskHealthMonitorProps {
  children: React.ReactNode;
}

export const KioskHealthMonitor: React.FC<KioskHealthMonitorProps> = ({ children }) => {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const checkHealth = useCallback(async () => {
    setChecking(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(kioskApiUrl('/api/health'), {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Health request failed');
      const data = await response.json();
      setConnected(data.status === 'ok');
    } catch {
      setConnected(false);
    } finally {
      window.clearTimeout(timeoutId);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const intervalId = window.setInterval(() => void checkHealth(), 5000);
    return () => window.clearInterval(intervalId);
  }, [checkHealth, retryCount]);

  return (
    <>
      <div aria-hidden={!connected} inert={!connected}>
        {children}
      </div>
      {!connected && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-5 backdrop-blur-md" role="alertdialog" aria-modal="true" aria-labelledby="connection-lost-title">
          <section className="health-glass-panel w-full max-w-lg p-8 text-center text-white">
            <AlertTriangle className="mx-auto mb-5 h-12 w-12 text-amber-200" />
            <h1 id="connection-lost-title" className="text-2xl font-black text-white">Connection Lost</h1>
            <p className="mt-3 text-base text-white/90">Please turn on the kiosk first to use this app.</p>
            <button
              type="button"
              onClick={() => setRetryCount((count) => count + 1)}
              disabled={checking}
              className="glass-btn-primary mt-7 inline-flex min-h-12 items-center justify-center gap-2 px-7 font-bold text-white shadow-lg text-sm disabled:opacity-60"
            >
              <RotateCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'Checking...' : 'Retry Connection'}
            </button>
          </section>
        </div>
      )}
    </>
  );
};

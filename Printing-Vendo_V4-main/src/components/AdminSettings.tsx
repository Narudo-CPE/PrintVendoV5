import React, { useEffect, useState } from 'react';
import { Clock3, Save } from 'lucide-react';
import { kioskApiUrl } from '../utils/kioskApi';

interface OperatingSettings {
  gcash_start_time: string;
  gcash_end_time: string;
}

const defaultSettings: OperatingSettings = {
  gcash_start_time: '07:00',
  gcash_end_time: '20:30',
};

export const AdminSettings: React.FC = () => {
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(kioskApiUrl('/api/settings'), { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || 'Could not load settings.');
        if (!cancelled) {
          setSettings({
            gcash_start_time: result.gcash_start_time || defaultSettings.gcash_start_time,
            gcash_end_time: result.gcash_end_time || defaultSettings.gcash_end_time,
          });
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Could not load settings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const saveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch(kioskApiUrl('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Could not save settings.');
      setSettings({
        gcash_start_time: result.gcash_start_time,
        gcash_end_time: result.gcash_end_time,
      });
      setMessage('GCash operating hours saved.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl p-4 sm:p-6" aria-labelledby="admin-settings-title">
      <div className="health-glass-panel p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-xl border border-white/20 bg-white/10 p-3 text-sky-200"><Clock3 className="h-6 w-6" /></div>
          <div>
            <h2 id="admin-settings-title" className="text-xl font-black text-white">Settings</h2>
            <p className="mt-1 text-sm text-white/75">Set the local hours when GCash is available at the kiosk.</p>
          </div>
        </div>

        <form onSubmit={saveSettings} className="mt-7 space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-white">GCash Start Time</span>
            <input
              type="time"
              required
              value={settings.gcash_start_time}
              onChange={(event) => setSettings((current) => ({ ...current, gcash_start_time: event.target.value }))}
              className="min-h-12 w-full px-4 text-base"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-white">GCash End Time</span>
            <input
              type="time"
              required
              value={settings.gcash_end_time}
              onChange={(event) => setSettings((current) => ({ ...current, gcash_end_time: event.target.value }))}
              className="min-h-12 w-full px-4 text-base"
            />
          </label>

          {loading && <p role="status" className="text-sm text-white/75">Loading settings...</p>}
          {message && <p role="status" className="text-sm font-bold text-emerald-200">{message}</p>}
          {error && <p role="alert" className="text-sm font-bold text-rose-200">{error}</p>}

          <button type="submit" disabled={loading || saving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/20 px-5 font-bold text-white hover:bg-white/30 disabled:opacity-60">
            <Save className={`h-4 w-4 ${saving ? 'animate-pulse' : ''}`} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
      </div>
    </section>
  );
};

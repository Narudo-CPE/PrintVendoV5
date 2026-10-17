export function getKioskApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/+$/, '');

  const hostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
  const backendPort = import.meta.env.VITE_API_PORT?.trim() || '3000';
  return `${window.location.protocol}//${hostname}:${backendPort}`;
}

export function kioskApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getKioskApiBaseUrl();
  return `${baseUrl}${normalizedPath}`;
}
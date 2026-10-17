export function getKioskApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/+$/, '');

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

export function kioskApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getKioskApiBaseUrl();
  return `${baseUrl}${normalizedPath}`;
}
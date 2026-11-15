const BACKEND_URL_STORAGE_KEY = 'willio_backend_url_v1';

// Default HTTPS backend URL used when running inside the standalone Android APK
// if no custom URL has been configured in Settings or VITE_WILLIO_SERVER_URL.
export const DEFAULT_APK_BACKEND_URL =
  'https://ais-pre-7qxhbgqobcfw3pokzr3wsj-1008342213502.europe-west2.run.app';

export function isNativeCapacitor(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function normalizeBackendUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function getSavedBackendUrl(): string {
  try {
    const raw = localStorage.getItem(BACKEND_URL_STORAGE_KEY);
    return raw ? normalizeBackendUrl(raw) : '';
  } catch {
    return '';
  }
}

export function saveBackendUrl(rawUrl: string): string {
  const normalized = normalizeBackendUrl(rawUrl);
  try {
    if (normalized) {
      localStorage.setItem(BACKEND_URL_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
  return normalized;
}

export function getEnvBackendUrl(): string {
  const envVal = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env?.VITE_WILLIO_SERVER_URL;
  return envVal ? normalizeBackendUrl(envVal) : '';
}

export function getBackendBaseUrl(): string {
  const saved = getSavedBackendUrl();
  if (saved) return saved;

  const envUrl = getEnvBackendUrl();
  if (envUrl) return envUrl;

  if (isNativeCapacitor()) {
    return DEFAULT_APK_BACKEND_URL;
  }

  return '';
}

export function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getBackendBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}

export function wsUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getBackendBaseUrl();
  if (base) {
    const wsBase = base.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    return `${wsBase}${cleanPath}`;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${cleanPath}`;
}

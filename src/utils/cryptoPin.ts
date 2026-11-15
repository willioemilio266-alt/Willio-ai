const PIN_HASH_KEY = 'willio_pin_hash_v1';

export async function hashPin(pin: string): Promise<string> {
  const encoded = new TextEncoder().encode(`willio-salt:${pin.trim()}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hasPinConfigured(): boolean {
  try {
    return Boolean(localStorage.getItem(PIN_HASH_KEY));
  } catch {
    return false;
  }
}

export async function savePin(pin: string): Promise<void> {
  const digest = await hashPin(pin);
  localStorage.setItem(PIN_HASH_KEY, digest);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const saved = localStorage.getItem(PIN_HASH_KEY);
  if (!saved) return true;
  const digest = await hashPin(pin);
  return digest === saved;
}

export function clearPin(): void {
  localStorage.removeItem(PIN_HASH_KEY);
}

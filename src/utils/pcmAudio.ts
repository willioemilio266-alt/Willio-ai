export function float32ToPcm16Base64(
  float32: Float32Array,
  sourceSampleRate = 16000
): string {
  let samples = float32;
  if (sourceSampleRate > 0 && sourceSampleRate !== 16000) {
    const ratio = sourceSampleRate / 16000;
    const outLen = Math.max(1, Math.floor(float32.length / ratio));
    const resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = Math.min(float32.length - 1, Math.floor(i * ratio));
      resampled[i] = float32[idx];
    }
    samples = resampled;
  }

  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

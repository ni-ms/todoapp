/** The app's bounded, canonical mono PCM WAV format. No URLs or remote audio inputs. */
export function speechSamples(audio: string): Float32Array {
  if (audio.length > 6_000_000)
    throw new Error("Keep recordings under 90 seconds.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Invalid audio recording.");
  }
  const view = new DataView(bytes.buffer);
  const text = (offset: number, size: number) =>
    new TextDecoder().decode(bytes.subarray(offset, offset + size));
  if (
    bytes.length < 46 ||
    text(0, 4) !== "RIFF" ||
    text(8, 8) !== "WAVEfmt " ||
    text(36, 4) !== "data" ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== 16000 ||
    view.getUint32(28, true) !== 32000 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== bytes.length - 44 ||
    (bytes.length - 44) % 2
  )
    throw new Error("Record mono 16 kHz PCM WAV audio.");
  const count = (bytes.length - 44) / 2;
  // One second of tolerance matches recordingWav's recorder-stop/decoder guard.
  if (count > 91 * 16000) throw new Error("Keep recordings under 90 seconds.");
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const value = view.getInt16(44 + i * 2, true);
    samples[i] = value < 0 ? value / 32768 : value / 32767;
  }
  return samples;
}
export function validateSpeechSamples(samples: Float32Array) {
  if (
    !(samples instanceof Float32Array) ||
    !samples.length ||
    samples.length > 91 * 16000 ||
    samples.some((x) => !Number.isFinite(x) || x < -1 || x > 1)
  )
    throw new Error(
      "Invalid or oversized recording. Record up to 90 seconds and try again.",
    );
}
export function validateTranscript(text: unknown): string {
  if (typeof text !== "string" || !text.trim() || text.length > 12000)
    throw new Error(
      "No clear speech was recognized. Try again or type your request.",
    );
  return text.trim();
}

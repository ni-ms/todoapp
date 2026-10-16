// Both speech adapters accept 16-bit, mono, 16 kHz WAV. Conversion stays on-device.
export function pcmWav(samples: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    s = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  });
  return new Uint8Array(buffer);
}
export async function recordingWav(blob: Blob): Promise<string> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 91)
      throw new Error("Keep recordings under 90 seconds.");
    const offline = new OfflineAudioContext(
        1,
        Math.ceil(decoded.duration * 16000),
        16000,
      ),
      source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const mono = await offline.startRendering();
    const bytes = pcmWav(mono.getChannelData(0));
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  } finally {
    await context.close();
  }
}

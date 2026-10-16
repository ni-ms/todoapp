// Phonon 2 ONNX's public TDT contract: 8193 tokens followed by durations 0..4.
export const PHONON_BLANK = 8192;
export function phononStep(logits: Float32Array, onFrame: number) {
  if (logits.length !== 8198 || logits.some((x) => !Number.isFinite(x)))
    throw new Error("Invalid Phonon decoder output.");
  let token = 0;
  let duration = 0;
  for (let i = 1; i <= PHONON_BLANK; i++)
    if (logits[i] > logits[token]) token = i;
  for (let i = 1; i < 5; i++)
    if (logits[8193 + i] > logits[8193 + duration]) duration = i;
  // Bound zero-duration emission loops, including malformed model outputs.
  if (!duration && (token === PHONON_BLANK || onFrame >= 9)) duration = 1;
  return { token, duration };
}
export function phononVocabulary(text: string): string[] {
  const pieces: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(.*) (\d+)$/.exec(line);
    if (match) pieces[Number(match[2])] = match[1];
  }
  if (pieces.length !== 8193 || Array.from(pieces).some((p) => typeof p !== "string"))
    throw new Error("Invalid Phonon vocabulary.");
  return pieces;
}
export function phononText(tokens: number[], vocabulary: string[]) {
  return tokens.map((id) => {
    const piece = vocabulary[id];
    if (piece === undefined) throw new Error("Invalid Phonon token.");
    return piece === "<unk>" || piece === "<pad>" || /^<\|.*\|>$/.test(piece)
      ? "" : piece;
  }).join("").replace(/▁/g, " ").trim();
}
/** Keep windows below the model's 35s limit, favoring quiet cuts at 25–30s. */
export function phononChunks(samples: Float32Array): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0;
  while (samples.length - start > 30 * 16000) {
    let end = start + 30 * 16000;
    let quietest = Infinity;
    for (let at = start + 25 * 16000; at + 1600 <= start + 30 * 16000; at += 800) {
      let energy = 0;
      for (let i = at; i < at + 1600; i++) energy += samples[i] ** 2;
      if (energy < quietest) { quietest = energy; end = at + 800; }
    }
    ranges.push([start, end]);
    start = end;
  }
  ranges.push([start, samples.length]);
  return ranges;
}

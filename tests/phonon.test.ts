import { test } from "node:test";
import assert from "node:assert/strict";
import { phononChunks, phononStep, phononText, phononVocabulary, PHONON_BLANK } from "../lib/phonon-decoding";

test("TDT decoding handles blank duration zero, emissions, duration offsets and bounded repeats", () => {
  const logits = new Float32Array(8198).fill(-10);
  logits[PHONON_BLANK] = 1;
  logits[8193] = 1;
  assert.deepEqual(phononStep(logits, 0), { token: PHONON_BLANK, duration: 1 });
  logits[10] = 2;
  assert.deepEqual(phononStep(logits, 0), { token: 10, duration: 0 });
  assert.deepEqual(phononStep(logits, 9), { token: 10, duration: 1 });
  logits[8197] = 3;
  assert.deepEqual(phononStep(logits, 0), { token: 10, duration: 4 });
  logits[0] = NaN;
  assert.throws(() => phononStep(logits, 0), /Invalid/);
  assert.throws(() => phononStep(new Float32Array(8193), 0), /Invalid/);
});
test("Phonon sentence pieces preserve punctuation and remove control tokens", () => {
  const vocab = Array.from({ length: 8193 }, (_, i) => `piece${i}`);
  Object.assign(vocab, { 0: "<unk>", 1: "<|nospeech|>", 2: "▁Study", 3: "▁tomorrow", 4: ".", 5: "<pad>" });
  assert.equal(phononText([0, 1, 2, 3, 4, 5], vocab), "Study tomorrow.");
  assert.throws(() => phononText([9000], vocab), /Invalid/);
  const serialized = vocab.map((piece, i) => `${piece} ${i}`).join("\n");
  assert.deepEqual(phononVocabulary(serialized), vocab);
  assert.throws(() => phononVocabulary("<blk> 8192"), /Invalid/);
});
test("long recordings split into bounded contiguous windows at quiet regions without dropping samples", () => {
  const samples = new Float32Array(91 * 16000).fill(0.1);
  samples.fill(0, 28 * 16000, 28.2 * 16000);
  const chunks = phononChunks(samples);
  assert.ok(chunks[0][1] >= 28 * 16000 && chunks[0][1] <= 28.2 * 16000);
  let covered = 0;
  for (const [start, end] of chunks) {
    assert.equal(start, covered);
    assert.ok(end > start && end - start <= 30 * 16000);
    covered = end;
  }
  assert.equal(covered, samples.length);
});

import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import { phononChunks, phononStep, phononText, phononVocabulary, PHONON_BLANK } from "./phonon-decoding";
import { validateSpeechSamples, validateTranscript } from "./speech-audio";

// Pinned community conversion. No executable code is downloaded from the model repo.
export const phononRevision = "12c9688bbc4fc52d23c1a66ca873fd3ac6ed4408";
const base = `https://huggingface.co/tiyuvta/Phonon-2-ONNX/resolve/${phononRevision}/`;
const limits: Record<string, number> = {
  "preprocessor-model.onnx": 2_000_000,
  "encoder-model.int8.onnx": 650_000_000,
  "decoder_joint-model.onnx": 80_000_000,
  "vocab.txt": 200_000,
};
async function asset(name: string, progress: (text: string) => void) {
  const url = base + name;
  let cache: Cache | undefined;
  try { cache = await caches.open("daymark-phonon-2-v1"); } catch { /* Cache is optional. */ }
  const hit = await cache?.match(url);
  const response = hit ?? await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok || !response.body) throw new Error("Could not download Phonon 2. Check your connection and retry.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let lastReport = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limits[name]) {
      await reader.cancel();
      throw new Error("Phonon model file exceeded its download limit.");
    }
    chunks.push(value);
    if (size - lastReport >= 2_000_000) {
      progress(`${hit ? "Reading cached" : "Downloading"} Phonon 2: ${name} · ${Math.round(size / 1_000_000)} MB`);
      lastReport = size;
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!hit && cache) {
    try { await cache.put(url, new Response(bytes)); } catch { /* Quota/private mode: inference can still proceed. */ }
  }
  return bytes;
}
type Outputs = InferenceSession.ReturnType;
const dispose = (tensors: Outputs) => Object.values(tensors).forEach((t) => t.dispose());
export async function loadPhonon(progress: (text: string) => void) {
  env.wasm.numThreads = 1;
  env.wasm.proxy = false;
  env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${env.versions.web}/dist/`;
  const options: InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  const loaded: InferenceSession[] = [];
  const session = async (name: string) => {
    progress(`Loading Phonon 2: ${name}…`);
    const result = await InferenceSession.create(await asset(name, progress), options);
    loaded.push(result);
    return result;
  };
  try {
    // Sequential loads limit the peak memory held by model download buffers.
    const pre = await session("preprocessor-model.onnx");
    const enc = await session("encoder-model.int8.onnx");
    const dec = await session("decoder_joint-model.onnx");
    const vocabulary = phononVocabulary(new TextDecoder().decode(await asset("vocab.txt", progress)));
    return async (samples: Float32Array, report: (text: string) => void) => {
      validateSpeechSamples(samples);
      const texts: string[] = [];
      const chunks = phononChunks(samples);
      for (const [index, [start, end]] of chunks.entries()) {
        report(`Transcribing with Phonon 2: part ${index + 1} of ${chunks.length}…`);
        const audio = samples.slice(start, end);
        const inputs = {
          waveforms: new Tensor("float32", audio, [1, audio.length]),
          waveforms_lens: new Tensor("int64", BigInt64Array.from([BigInt(audio.length)]), [1]),
        };
        let features: Outputs = {}, encoded: Outputs = {};
        try {
          features = await pre.run(inputs);
          encoded = await enc.run({ audio_signal: features.features, length: features.features_lens });
          texts.push(await decode(encoded, dec, vocabulary));
        } finally { dispose(inputs); dispose(features); dispose(encoded); }
      }
      return validateTranscript(texts.filter(Boolean).join(" "));
    };
  } catch (error) {
    await Promise.allSettled(loaded.map((s) => s.release()));
    throw error;
  }
}
async function decode(encoded: Outputs, dec: InferenceSession, vocabulary: string[]) {
  const output = encoded.outputs;
  const [, width, stride] = output.dims;
  const length = Number(encoded.encoded_lengths.data[0]);
  if (width !== 1024 || !Number.isInteger(length) || length < 1 || length > stride)
    throw new Error("Invalid Phonon encoder output.");
  const data = output.data as Float32Array;
  const frame = new Tensor("float32", new Float32Array(width), [1, width, 1]);
  const target = new Tensor("int32", new Int32Array([PHONON_BLANK]), [1, 1]);
  const targetLength = new Tensor("int32", new Int32Array([1]), [1]);
  let first: Tensor = new Tensor("float32", new Float32Array(1280), [2, 1, 640]);
  let second: Tensor = new Tensor("float32", new Float32Array(1280), [2, 1, 640]);
  let onFrame = 0;
  const tokens: number[] = [];
  try {
    for (let at = 0; at < length;) {
      for (let i = 0; i < width; i++) (frame.data as Float32Array)[i] = data[i * stride + at];
      const out = await dec.run({ encoder_outputs: frame, targets: target, target_length: targetLength,
        input_states_1: first, input_states_2: second });
      try {
        const { token, duration } = phononStep(out.outputs.data as Float32Array, onFrame);
        if (token !== PHONON_BLANK) {
          tokens.push(token);
          (target.data as Int32Array)[0] = token;
          first.dispose(); second.dispose();
          first = out.output_states_1; second = out.output_states_2;
          onFrame++;
        }
        if (duration) onFrame = 0;
        at += duration;
      } finally {
        for (const tensor of Object.values(out))
          if (tensor !== first && tensor !== second) tensor.dispose();
      }
    }
    return phononText(tokens, vocabulary);
  } finally { frame.dispose(); target.dispose(); targetLength.dispose(); first.dispose(); second.dispose(); }
}

import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import { isSpeechModel } from "./speech-model";
import { validateSpeechSamples, validateTranscript } from "./speech-audio";
import type { SpeechCommand, SpeechMessage } from "./speech-client";
// A single WASM thread also works on Pages, without cross-origin isolation headers/WebGPU.
env.allowLocalModels = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}
let transcriber: AutomaticSpeechRecognitionPipeline | undefined;
let phonon: ((samples: Float32Array, progress: (text: string) => void) => Promise<string>) | undefined;
let busy = false;
const send = (message: SpeechMessage) => self.postMessage(message);
self.onmessage = async ({ data }: MessageEvent<SpeechCommand>) => {
  if (busy) {
    send({
      type: "error",
      id: data.id,
      message: "Speech is already busy. Try again.",
    });
    return;
  }
  busy = true;
  try {
    if (data.type === "load") {
      if (!isSpeechModel(data.model)) throw new Error("Unsupported speech model.");
      if (data.model === "phonon-2") {
        const { loadPhonon } = await import("./speech-phonon");
        phonon = await loadPhonon((text) => send({ type: "progress", id: data.id, text }));
      } else {
      transcriber ??= await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny",
        {
          device: "wasm",
          dtype: "q8",
          progress_callback: (progress) => {
            if (progress.status === "progress")
              send({
                type: "progress",
                id: data.id,
                text: `Downloading speech model: ${Math.round(progress.progress)}% · ${progress.file}`,
              });
            else if (progress.status === "initiate")
              send({
                type: "progress",
                id: data.id,
                text: "Downloading speech model files…",
              });
          },
        },
      );
      }
      send({ type: "ready", id: data.id });
    } else if (data.type === "transcribe") {
      if (!transcriber && !phonon) throw new Error("Speech model not loaded.");
      validateSpeechSamples(data.samples);
      if (phonon) {
        const text = await phonon(data.samples, (text) => send({ type: "progress", id: data.id, text }));
        send({ type: "result", id: data.id, text });
        return;
      }
      const result = await transcriber!(data.samples, {
        chunk_length_s: 30,
        stride_length_s: 5,
        task: "transcribe",
        return_timestamps: false,
      });
      const text = validateTranscript(
        Array.isArray(result)
          ? result.map((r) => r.text).join(" ")
          : result.text,
      );
      send({ type: "result", id: data.id, text });
    }
  } catch {
    send({
      type: "error",
      id: data.id,
      message:
        data.type === "load"
          ? data.model === "phonon-2"
            ? "Could not load Phonon 2. Check your connection, browser storage, and free memory. Retry, or select the smaller Whisper Tiny model."
            : "Could not load the speech model. Check the model download, browser storage, and WebAssembly support. Retry when connected."
          : "Could not transcribe this recording. Try a shorter, clearer recording, or type your request.",
    });
  } finally {
    busy = false;
  }
};

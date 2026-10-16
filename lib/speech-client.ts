import { validateSpeechSamples, validateTranscript } from "./speech-audio";
import { isSpeechModel, type SpeechModel } from "./speech-model";
export type SpeechCommand =
  | { type: "load"; id: number; model: SpeechModel }
  | { type: "transcribe"; id: number; samples: Float32Array };
export type SpeechMessage =
  | { type: "progress"; id: number; text: string }
  | { type: "ready"; id: number }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id: number; message: string };
export interface SpeechWorkerPort {
  postMessage(message: SpeechCommand, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SpeechMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
export interface SpeechSnapshot {
  model: SpeechModel;
  ready: boolean;
  busy: boolean;
  operation: "load" | "transcribe" | null;
  progress: string;
  error: string;
}
export const emptySpeechSnapshot: SpeechSnapshot = {
  model: "phonon-2",
  ready: false,
  busy: false,
  operation: null,
  progress: "",
  error: "",
};
/** One cancellable worker per tab; speech never goes through a provider/network adapter. */
export class SpeechClient {
  private model: SpeechModel = "phonon-2";
  private worker?: SpeechWorkerPort;
  private sequence = 0;
  private ready = false;
  private progress = "";
  private error = "";
  private snapshot = emptySpeechSnapshot;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    this.snapshot = {
      model: this.model,
      ready: this.ready,
      busy: Boolean(this.pending),
      operation: this.pending?.kind ?? null,
      progress: this.progress,
      error: this.error,
    };
    for (const listener of this.listeners) listener();
  }
  private pending?: {
    id: number;
    kind: SpeechCommand["type"];
    resolve: (text: string) => void;
    reject: (error: Error) => void;
    progress?: (text: string) => void;
    cleanup: () => void;
  };
  constructor(private readonly createWorker: () => SpeechWorkerPort) {}
  isReady() {
    return this.ready;
  }
  isBusy() {
    return Boolean(this.pending);
  }
  selectModel(model: SpeechModel) {
    if (!isSpeechModel(model)) throw new Error("Choose a supported speech model.");
    if (model === this.model) return;
    this.stop();
    this.model = model;
    this.progress = "Load the selected speech model before recording.";
    this.notify();
  }
  private finish(error?: Error, text = "") {
    const pending = this.pending;
    this.pending = undefined;
    pending?.cleanup();
    if (error) {
      this.error = error.message;
      this.progress = "";
    } else if (pending?.kind === "load")
      this.progress =
        "Speech model ready. Record in My day, then review your transcript.";
    else this.progress = "";
    this.notify();
    if (error) pending?.reject(error);
    else pending?.resolve(text);
  }
  stop(message?: string) {
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = false;
    if (this.pending)
      this.finish(
        new Error(
          message ??
            "Speech operation canceled. Load the speech model again when ready.",
        ),
      );
    else {
      this.error = message ?? "";
      this.progress = message
        ? ""
        : "Speech model unloaded from memory. Cached downloads remain in browser storage.";
      this.notify();
    }
  }
  private getWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker || data.id !== this.pending?.id) return;
      if (data.type === "progress") {
        this.progress = data.text;
        this.notify();
        this.pending?.progress?.(data.text);
        return;
      }
      if (data.type === "error") {
        this.stop(data.message);
        return;
      }
      if (data.type === "ready" && this.pending.kind === "load") {
        this.ready = true;
        this.finish();
      }
      if (data.type === "result" && this.pending?.kind === "transcribe") {
        try {
          this.finish(undefined, validateTranscript(data.text));
        } catch (e) {
          this.finish(
            e instanceof Error ? e : new Error("Invalid transcript."),
          );
        }
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (this.worker === worker)
        this.stop(
          "Browser speech failed. Load the model again, or try another browser.",
        );
    };
    worker.onmessageerror = () => {
      if (this.worker === worker)
        this.stop(
          "Browser speech could not read the recording. Load the model again.",
        );
    };
    return worker;
  }
  private request(
    command: SpeechCommand,
    progress?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.pending)
      return Promise.reject(
        new Error("Wait for the current speech operation to finish."),
      );
    if (signal?.aborted)
      return Promise.reject(new Error("Transcription canceled."));
    return new Promise((resolve, reject) => {
      const abort = () =>
        this.stop(
          "Transcription canceled. Load the speech model again when ready.",
        );
      const timer = setTimeout(
        () =>
          this.stop(
            "Speech took too long. Load the model again and try a shorter recording.",
          ),
        (command.type === "load" ? 30 : 10) * 60 * 1000,
      );
      this.pending = {
        id: command.id,
        kind: command.type,
        resolve,
        reject,
        progress,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        },
      };
      this.error = "";
      this.progress =
        command.type === "load"
          ? "Preparing browser speech…"
          : "Transcribing on this device…";
      signal?.addEventListener("abort", abort, { once: true });
      this.notify();
      if (this.pending?.id !== command.id) return;
      try {
        this.getWorker().postMessage(
          command,
          command.type === "transcribe"
            ? [command.samples.buffer as ArrayBuffer]
            : [],
        );
      } catch {
        this.stop(
          "Could not start browser speech. Try a current browser with WebAssembly support.",
        );
      }
    });
  }
  async load(progress?: (text: string) => void) {
    if (this.ready) return;
    await this.request({ type: "load", id: ++this.sequence, model: this.model }, progress);
  }
  transcribe(samples: Float32Array, signal?: AbortSignal): Promise<string> {
    if (!this.ready)
      return Promise.reject(
        new Error(
          "Download / load the speech model in AI setup before recording.",
        ),
      );
    try {
      validateSpeechSamples(samples);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.request(
      { type: "transcribe", id: ++this.sequence, samples },
      undefined,
      signal,
    );
  }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SpeechClient,
  type SpeechCommand,
  type SpeechMessage,
  type SpeechWorkerPort,
} from "../lib/speech-client";
import { speechSamples, validateTranscript } from "../lib/speech-audio";
import { pcmWav } from "../lib/audio";
import { transcribeAudio } from "../lib/ai";
const encoded = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
class FakeSpeechWorker implements SpeechWorkerPort {
  onmessage: SpeechWorkerPort["onmessage"] = null;
  onerror: SpeechWorkerPort["onerror"] = null;
  onmessageerror: SpeechWorkerPort["onmessageerror"] = null;
  commands: SpeechCommand[] = [];
  terminated = false;
  postMessage(message: SpeechCommand, transfer: Transferable[]) {
    this.commands.push(structuredClone(message, { transfer }));
  }
  terminate() {
    this.terminated = true;
  }
  emit(message: SpeechMessage) {
    this.onmessage?.({ data: message } as MessageEvent<SpeechMessage>);
  }
}
test("browser speech validates canonical WAV and preserves normalized samples", () => {
  const result = speechSamples(
    encoded(pcmWav(new Float32Array([-1, 0, 1, 0.5]))),
  );
  assert.equal(result.length, 4);
  assert.equal(result[0], -1);
  assert.equal(result[1], 0);
  assert.equal(result[2], 1);
  assert.ok(Math.abs(result[3] - 0.5) < 0.0001);
  assert.throws(() => speechSamples("invalid!"), /Invalid audio/);
  assert.throws(
    () => speechSamples(encoded(pcmWav(new Float32Array()))),
    /PCM WAV/,
  );
  const stereo = pcmWav(new Float32Array([0]));
  new DataView(stereo.buffer).setUint16(22, 2, true);
  assert.throws(() => speechSamples(encoded(stereo)), /PCM WAV/);
  const truncated = pcmWav(new Float32Array(10)).slice(0, -2);
  assert.throws(() => speechSamples(encoded(truncated)), /PCM WAV/);
  assert.throws(
    () => speechSamples(encoded(pcmWav(new Float32Array(91 * 16000 + 1)))),
    /90 seconds/,
  );
  assert.throws(() => validateTranscript("  "), /No clear speech/);
  assert.throws(() => validateTranscript("a".repeat(12001)), /No clear speech/);
});
test("speech worker is loaded explicitly, reports progress, reuses the model and transfers audio without a server", async () => {
  const worker = new FakeSpeechWorker();
  let created = 0;
  const client = new SpeechClient(() => {
    created++;
    return worker;
  });
  assert.equal(created, 0);
  const progress: string[] = [];
  const loading = client.load((text) => progress.push(text));
  worker.emit({
    type: "progress",
    id: 1,
    text: "Downloading speech model: 50%",
  });
  worker.emit({ type: "ready", id: 1 });
  await loading;
  await client.load();
  assert.equal(created, 1);
  assert.equal(worker.commands.length, 1);
  assert.deepEqual(progress, ["Downloading speech model: 50%"]);
  const samples = new Float32Array([0, 0.5, -0.5]);
  const transcribing = client.transcribe(samples);
  assert.equal(samples.byteLength, 0); // Transfer releases the sender's copy.
  assert.equal(worker.commands[1].type, "transcribe");
  worker.emit({ type: "result", id: 2, text: "  Study tomorrow.  " });
  assert.equal(await transcribing, "Study tomorrow.");
  assert.equal(client.isReady(), true);
  client.stop();
  assert.equal(worker.terminated, true);
  assert.equal(client.isReady(), false);
});
test("speech cancellation terminates computation, releases pending requests and ignores stale worker messages", async () => {
  const workers: FakeSpeechWorker[] = [];
  const client = new SpeechClient(() => {
    const w = new FakeSpeechWorker();
    workers.push(w);
    return w;
  });
  const loading = client.load();
  workers[0].emit({ type: "ready", id: 1 });
  await loading;
  const controller = new AbortController();
  const transcript = client.transcribe(
    new Float32Array([0.1]),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(transcript, /canceled/);
  assert.equal(workers[0].terminated, true);
  assert.equal(client.isBusy(), false);
  assert.equal(client.isReady(), false);
  const reload = client.load();
  workers[0].emit({ type: "ready", id: 3 });
  assert.equal(client.isReady(), false);
  workers[1].emit({ type: "ready", id: 3 });
  await reload;
  client.stop();
});
test("speech download can be canceled and retried; failures never silently use a server", async () => {
  const worker = new FakeSpeechWorker();
  const client = new SpeechClient(() => worker);
  const loading = client.load();
  await assert.rejects(client.load(), /current speech operation/);
  client.stop();
  await assert.rejects(loading, /canceled/);
  const retry = client.load();
  worker.emit({ type: "error", id: 3, message: "Model download failed." });
  await assert.rejects(retry, /Model download failed/);
  assert.equal(client.isReady(), false);
  assert.equal(client.isBusy(), false);
});
test("speech rejects malformed PCM and empty output; worker crashes release the model", async () => {
  const worker = new FakeSpeechWorker();
  const client = new SpeechClient(() => worker);
  await assert.rejects(
    client.transcribe(new Float32Array([0])),
    /load the speech model/,
  );
  const loading = client.load();
  worker.emit({ type: "ready", id: 1 });
  await loading;
  await assert.rejects(client.transcribe(new Float32Array([NaN])), /Invalid/);
  await assert.rejects(client.transcribe(new Float32Array([2])), /Invalid/);
  assert.equal(worker.commands.length, 1);
  const transcription = client.transcribe(new Float32Array([0]));
  worker.emit({ type: "result", id: 2, text: "" });
  await assert.rejects(transcription, /No clear speech/);
  assert.equal(client.isReady(), true);
  const next = client.transcribe(new Float32Array([0]));
  let prevented = false;
  worker.onerror?.({
    preventDefault: () => {
      prevented = true;
    },
  } as ErrorEvent);
  await assert.rejects(next, /Browser speech failed/);
  assert.equal(prevented, true);
  assert.equal(client.isReady(), false);
});
test("browser transcription never contacts loopback or hosted providers when its model is not loaded", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Network is forbidden for audio");
  };
  try {
    await assert.rejects(
      transcribeAudio(encoded(pcmWav(new Float32Array([0])))),
      /load the speech model/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("speech status and cancellation survive settings subscriber remounts", async () => {
  const worker = new FakeSpeechWorker();
  const client = new SpeechClient(() => worker);
  let updates = 0;
  const unsubscribe = client.subscribe(() => {
    updates++;
  });
  const loading = client.load();
  assert.equal(client.getSnapshot().busy, true);
  assert.equal(client.getSnapshot().operation, "load");
  unsubscribe();
  worker.emit({ type: "progress", id: 1, text: "Downloading speech: 70%" });
  assert.equal(client.getSnapshot().progress, "Downloading speech: 70%");
  const resubscribe = client.subscribe(() => {
    updates++;
  });
  assert.equal(client.getSnapshot().busy, true);
  client.stop();
  await assert.rejects(loading, /canceled/);
  assert.equal(client.getSnapshot().busy, false);
  assert.match(client.getSnapshot().error, /canceled/);
  assert.ok(updates >= 2);
  resubscribe();
});

test("switching speech models cancels old downloads, ignores stale results and loads only the explicit selection", async () => {
  const workers: FakeSpeechWorker[] = [];
  const client = new SpeechClient(() => {
    const worker = new FakeSpeechWorker(); workers.push(worker); return worker;
  });
  const loading = client.load();
  assert.equal(workers[0].commands[0].type, "load");
  assert.deepEqual(workers[0].commands[0], { type: "load", id: 1, model: "phonon-2" });
  client.selectModel("whisper-tiny");
  await assert.rejects(loading, /canceled/);
  assert.equal(workers[0].terminated, true);
  assert.equal(client.getSnapshot().model, "whisper-tiny");
  const retry = client.load();
  workers[0].emit({ type: "ready", id: 2 });
  assert.equal(client.isReady(), false);
  assert.deepEqual(workers[1].commands[0], { type: "load", id: 2, model: "whisper-tiny" });
  workers[1].emit({ type: "error", id: 2, message: "Model failed" });
  await assert.rejects(retry, /Model failed/);
  assert.equal(client.getSnapshot().model, "whisper-tiny");
  assert.equal(workers.length, 2); // A failure never loads a different model.
  assert.throws(() => client.selectModel("remote" as never), /supported/);
});

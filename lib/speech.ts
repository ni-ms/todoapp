import { SpeechClient } from "./speech-client";
import { speechSamples } from "./speech-audio";
const speech = new SpeechClient(
  () =>
    new Worker(new URL("./speech-worker.ts", import.meta.url), {
      type: "module",
    }),
);
export const speechModelReady = () => speech.isReady();
export const loadSpeechModel = (progress?: (text: string) => void) =>
  speech.load(progress);
export const stopSpeechModel = () => speech.stop();
export const transcribeBrowserAudio = (audio: string, signal?: AbortSignal) =>
  speech.transcribe(speechSamples(audio), signal);

export const speechSnapshot = speech.getSnapshot;
export const subscribeSpeech = speech.subscribe;

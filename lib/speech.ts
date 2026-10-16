import { SpeechClient } from "./speech-client";
import { speechSamples } from "./speech-audio";
import { browserRead, browserWrite } from "./browser-store";
import { isSpeechModel, type SpeechModel } from "./speech-model";
const speech = new SpeechClient(
  () =>
    new Worker(new URL("./speech-worker.ts", import.meta.url), {
      type: "module",
    }),
);
export const speechModelReady = () => speech.isReady();
let initialized: Promise<void> | undefined;
export function initializeSpeechModel() {
  return initialized ??= browserRead<SpeechModel>("speech-model").then((model) => {
    if (isSpeechModel(model)) speech.selectModel(model);
  }).catch((error) => { initialized = undefined; throw error; });
}
export async function selectSpeechModel(model: SpeechModel) {
  if (!isSpeechModel(model)) throw new Error("Choose a supported speech model.");
  await initializeSpeechModel();
  await browserWrite("speech-model", model);
  speech.selectModel(model);
}
export const loadSpeechModel = async (progress?: (text: string) => void) => {
  await initializeSpeechModel();
  await speech.load(progress);
};
export const stopSpeechModel = () => speech.stop();
export const transcribeBrowserAudio = (audio: string, signal?: AbortSignal) =>
  speech.transcribe(speechSamples(audio), signal);

export const speechSnapshot = speech.getSnapshot;
export const subscribeSpeech = speech.subscribe;

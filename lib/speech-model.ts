export type SpeechModel = "whisper-tiny" | "phonon-2";
export const speechModels: Record<SpeechModel, string> = {
  "whisper-tiny": "Whisper Tiny · multilingual · about 41 MB",
  "phonon-2": "Phonon 2 · English · about 690 MB",
};
export function isSpeechModel(value: unknown): value is SpeechModel {
  return value === "whisper-tiny" || value === "phonon-2";
}

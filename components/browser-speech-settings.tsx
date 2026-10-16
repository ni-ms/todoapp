"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { emptySpeechSnapshot } from "@/lib/speech-client";
import { speechModels, type SpeechModel } from "@/lib/speech-model";
import { Button } from "./ui/button";
import {
  loadSpeechModel,
  speechSnapshot,
  subscribeSpeech,
  stopSpeechModel,
  selectSpeechModel,
  initializeSpeechModel,
} from "@/lib/speech";
export function BrowserSpeechSettings() {
  const [settingBusy, setSettingBusy] = useState(true);
  const [settingError, setSettingError] = useState("");
  useEffect(() => {
    let active = true;
    initializeSpeechModel().catch((e) => { if (active) setSettingError(String(e)); })
      .finally(() => { if (active) setSettingBusy(false); });
    return () => { active = false; };
  }, []);
  const { model, ready, busy, operation, progress, error } = useSyncExternalStore(
    subscribeSpeech,
    speechSnapshot,
    () => emptySpeechSnapshot,
  );
  const load = () => {
    void loadSpeechModel().catch(() => {});
  };
  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">
        Voice transcription · on this device
      </h3>
      <p className="text-xs text-muted-foreground">
        Transcribe directly in your browser for every text-AI choice. No local
        server or API key is needed. Audio stays on this device; only the transcript is sent if you
        later choose hosted task drafts.
      </p>
      <label className="block space-y-2 text-xs">
        <span>Speech model</span>
        <select className="field-select" value={model} disabled={busy || settingBusy}
          onChange={async (e) => {
            setSettingBusy(true); setSettingError("");
            try { await selectSpeechModel(e.target.value as SpeechModel); }
            catch (e) { setSettingError(String(e)); }
            finally { setSettingBusy(false); }
          }}>
          {Object.entries(speechModels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        {model === "phonon-2"
          ? "Phonon 2 uses a community ONNX conversion by Tiyuvta. English only. Allow about 690 MB for downloads and several GB of free memory; processing can be slow on smaller devices."
          : "Whisper Tiny detects the spoken language. About 41 MB of model weights; accuracy varies by language and recording quality."}
        {" "}Loading downloads and caches model files plus the browser runtime.
        Switching models unloads the previous model. Models never switch automatically.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || ready || settingBusy} onClick={load}>
          {ready ? "Speech model loaded" : "Download / load speech model"}
        </Button>
        {busy && (
          <Button variant="ghost" onClick={() => stopSpeechModel()}>
            {operation === "load"
              ? "Cancel speech download"
              : "Cancel transcription"}
          </Button>
        )}
        {ready && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => stopSpeechModel()}
          >
            Unload speech model
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Requires WebAssembly and microphone permission on HTTPS or localhost.
        Accuracy varies with background noise and device speed. Load again after reloading the page.
        Recordings stop after 90 seconds. Leaving capture cancels an unfinished
        transcription.
      </p>
      {progress && (
        <p role="status" className="text-xs text-muted-foreground">
          {progress}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {settingError && <p role="alert" className="text-sm text-destructive">{settingError}</p>}
    </div>
  );
}

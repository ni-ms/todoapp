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
        Voice transcription
      </h3>
      <p className="text-xs text-muted-foreground">
        Audio stays on this device. Transcripts are shared only when you create hosted AI drafts.
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
          ? "English only · about 690 MB download. Needs several GB of free memory."
          : "Multilingual · about 41 MB of model weights."}
        {" "}Loading downloads and caches the model and runtime.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || ready || settingBusy} onClick={load}>
          {ready ? "Speech model loaded" : "Load speech model"}
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
        Load again after reloading the page. Recordings stop after 90 seconds.
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

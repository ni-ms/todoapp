"use client";
import { useSyncExternalStore } from "react";
import { emptySpeechSnapshot } from "@/lib/speech-client";
import { Button } from "./ui/button";
import {
  loadSpeechModel,
  speechSnapshot,
  subscribeSpeech,
  stopSpeechModel,
} from "@/lib/speech";
export function BrowserSpeechSettings() {
  const { ready, busy, operation, progress, error } = useSyncExternalStore(
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
        Whisper Tiny transcribes audio directly in your browser for every
        text-AI choice. No local server, API key, or GPU is needed. Loading
        downloads model files (tens of MB plus the browser runtime) and caches
        them. Audio stays on this device; only the transcript is sent if you
        later choose hosted task drafts.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || ready} onClick={load}>
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
        The model detects the spoken language; accuracy varies with language,
        background noise, and device speed. Load again after reloading the page.
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
    </div>
  );
}

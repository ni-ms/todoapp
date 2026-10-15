"use client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  RefreshCw,
  LogIn,
  LogOut,
  FileKey2,
  Cloud,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDesktop } from "@/lib/storage";
interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  automatic: boolean;
  lastSync: string | null;
  error: string | null;
}
export function GoogleConnection({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<GoogleStatus | null>(null),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState("");
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const read = () =>
      invoke<GoogleStatus>("google_status")
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch((e) => {
          if (active) onError(String(e));
        });
    read();
    const timer = setInterval(read, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [onError]);
  async function run(action: string) {
    setBusy(true);
    setAction(action);
    try {
      setStatus(
        await invoke<GoogleStatus>("google_action", {
          action,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      );
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
      setAction("");
    }
  }
  return (
    <section className="surface p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Cloud className="size-4" />
        Google
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Publish events and deadlines to a dedicated Google Calendar. Back up
        your workspace to Google Drive.
      </p>
      {!isDesktop() ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Open the desktop app to connect your Google account.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {status?.connected ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => run("sync")}
                >
                  <RefreshCw />
                  {busy && action === "sync" ? "Syncing…" : "Sync now"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run("disconnect")}
                >
                  <LogOut />
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                disabled={busy || !status?.configured}
                onClick={() => run("connect")}
              >
                <LogIn />
                {busy && action === "connect"
                  ? "Complete sign-in in your browser…"
                  : "Sign in with Google"}
              </Button>
            )}
            {!status?.connected && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run("configure")}
              >
                <FileKey2 />
                {status?.configured ? "Change setup file" : "Choose setup file"}
              </Button>
            )}
          </div>
          {!status?.configured && (
            <details className="mt-4 rounded-lg border px-4 py-3 text-xs">
              <summary className="cursor-pointer font-medium">
                First-time setup
              </summary>
              <ol className="mt-3 list-decimal space-y-2 pl-4 text-muted-foreground">
                <li>
                  Create a Google Cloud project and enable Calendar API and
                  Drive API.
                </li>
                <li>
                  Configure Google Auth, add your Google account as a test user,
                  and create a Desktop app OAuth client.
                </li>
                <li>Download its JSON file, choose it above, then sign in.</li>
              </ol>
              <Button
                variant="link"
                className="mt-2 h-auto px-0 text-xs"
                disabled={busy}
                onClick={() => run("help")}
              >
                Open Google Cloud
                <ExternalLink />
              </Button>
            </details>
          )}
          {status?.connected && (
            <label className="mt-4 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                disabled={busy}
                checked={status.automatic}
                onChange={(e) => run(e.target.checked ? "resume" : "pause")}
              />
              Sync automatically while Daymark is open
            </label>
          )}
          {status?.lastSync && (
            <p className="mt-3 text-xs text-muted-foreground">
              Last synced: {new Date(status.lastSync).toLocaleString()}
            </p>
          )}
          {status?.error && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {status.error}
            </p>
          )}
        </>
      )}
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Publishing is one way: Daymark → Google. Changes made in Google are not
        imported. If a published event was edited there, Daymark leaves it
        unchanged and reports a conflict.
      </p>
    </section>
  );
}

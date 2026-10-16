"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  prepareGoogle,
  googlePrepared,
  configureGoogle,
  googleClientId,
  googleStatus,
  connectGoogle,
  disconnectGoogle,
  automaticGoogle,
  syncGoogle,
  type GoogleStatus,
} from "@/lib/browser-google";
export function BrowserGoogleConnection({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [id, setId] = useState(""),
    [status, setStatus] = useState<GoogleStatus | null>(null),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const read = () =>
      googleStatus()
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch((e) => {
          if (active) onError(String(e));
        });
    googleClientId()
      .then((s) => {
        if (active) {
          setId(s);
          setReady(googlePrepared());
        }
      })
      .catch((e) => onError(String(e)));
    void read();
    const interval = setInterval(read, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [onError]);
  async function run(action: () => Promise<GoogleStatus | void>) {
    setBusy(true);
    try {
      const s = await action();
      setStatus(s ?? (await googleStatus()));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface space-y-4 p-6">
      <h2 className="text-sm font-semibold">Google</h2>
      <p className="text-sm text-muted-foreground">
        Publish to Google Calendar and back up your workspace, including Trash, to Drive.
      </p>
      {!status?.connected && (
        <>
          <label className="block space-y-2 text-xs">
            Google Web client ID
            <Input
              aria-label="Google Web client ID"
              value={id}
              disabled={busy}
              maxLength={256}
              onChange={(e) => {
                setId(e.target.value);
                setReady(false);
              }}
              placeholder="…apps.googleusercontent.com"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !id.trim()}
              onClick={() =>
                run(async () => {
                  await configureGoogle(id.trim());
                  await prepareGoogle();
                  setReady(true);
                })
              }
            >
              Save setup
            </Button>
            <Button
              disabled={busy || !ready || !status?.configured}
              onClick={() => run(() => connectGoogle(id.trim()))}
            >
              Sign in with Google
            </Button>
          </div>
          <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium">Google setup</summary>
            <p className="mt-3 text-muted-foreground">
              Create a Web application OAuth client, enable Calendar and Drive APIs,
              and add this website’s origin to Authorized JavaScript origins.
              Use the client ID only; never enter a client secret.
            </p>
          </details>
        </>
      )}
      {status?.connected && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => run(syncGoogle)}
            >
              {busy ? "Working…" : "Publish and back up now"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(disconnectGoogle)}
            >
              Disconnect
            </Button>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={status.automatic}
              disabled={busy}
              onChange={(e) => run(() => automaticGoogle(e.target.checked))}
            />
            Publish and back up while this tab is open
          </label>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Sign in again after reloading or when access expires. Disconnecting keeps your Google copies.
      </p>
      <p className="text-xs text-muted-foreground">
        One-way publishing. Google edits aren’t imported; conflicting edits are left unchanged.
      </p>
      {status?.lastSync && (
        <p className="text-xs">
          Last published: {new Date(status.lastSync).toLocaleString()}
        </p>
      )}
      {status?.error && (
        <p role="alert" className="text-sm text-destructive">
          {status.error}
        </p>
      )}
    </section>
  );
}

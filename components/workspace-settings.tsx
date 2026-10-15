"use client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, FolderSync, RefreshCw, Unplug } from "lucide-react";
import {GoogleConnection} from "@/components/google-connection";
import { Button } from "@/components/ui/button";
import { ThemeControl } from "@/components/theme-control";
import { isDesktop, exportWorkspace, loadPreviewExample } from "@/lib/storage";
import { exportCalendar } from "@/lib/ical";
import type { Workspace } from "@/lib/domain";
interface BackupStatus {
  folder: string | null;
  enabled: boolean;
  lastBackup: string | null;
  error: string | null;
}
export function WorkspaceSettings({
  workspace,
  onNotice,
  onError,
  onExample,
}: {
  workspace: Workspace;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  onExample: (data: Workspace) => void;
}) {
  const [backup, setBackup] = useState<BackupStatus | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const read = () =>
      invoke<BackupStatus>("backup_status")
        .then((s) => {
          if (active) setBackup(s);
        })
        .catch((e) => {
          if (active) onError(String(e));
        });
    read();
    const interval = setInterval(read, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [onError]);
  async function configure(action: string) {
    setBusy(true);
    try {
      setBackup(await invoke<BackupStatus>("configure_backup", { action }));
      if (action === "now") onNotice("Backup saved.");
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid max-w-3xl gap-5">
      <GoogleConnection onError={onError}/>
      <section className="surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Appearance</h2>
          <ThemeControl />
        </div>
      </section>
      <section className="surface space-y-5 p-6">
        <h2 className="text-sm font-semibold">Export</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm">Calendar</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A one-time copy for Google Calendar, Apple Calendar, or Outlook.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await exportCalendar(workspace);
                onNotice(
                  isDesktop()
                    ? "Calendar saved to Downloads."
                    : "Calendar exported.",
                );
              } catch (e) {
                onError(String(e));
              }
            }}
          >
            <Download />
            Export .ics
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <div>
            <p className="text-sm">Workspace</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tasks, courses, events, and tags, including Trash.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await exportWorkspace(workspace);
                onNotice(
                  isDesktop()
                    ? "Workspace saved to Downloads."
                    : "Workspace exported.",
                );
              } catch (e) {
                onError(String(e));
              }
            }}
          >
            <Download />
            Export JSON
          </Button>
        </div>
      </section>
      <section className="surface p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FolderSync className="size-4" />
          Cloud folder backup
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Choose a folder synced by Google Drive, Dropbox, or OneDrive. Your
          workspace and calendar will be backed up automatically while Daymark
          is open.
        </p>
        {isDesktop() ? (
          <>
            <div className="mt-4 rounded-lg bg-muted px-4 py-3 text-xs">
              <p className="font-medium">
                {backup?.enabled ? "Automatic backup is on" : "Not connected"}
              </p>
              {backup?.folder && (
                <p className="mt-1 break-all text-muted-foreground">
                  {backup.folder}
                </p>
              )}
              {backup?.lastBackup && (
                <p className="mt-1 text-muted-foreground">
                  Last backup: {new Date(backup.lastBackup).toLocaleString()}
                </p>
              )}
              {backup?.error && (
                <p role="alert" className="mt-2 text-destructive">
                  {backup.error}
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => configure("choose")}
              >
                <FolderSync />
                {backup?.folder ? "Change folder" : "Choose folder"}
              </Button>
              {backup?.enabled && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => configure("now")}
                  >
                    <RefreshCw />
                    Back up now
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => configure("disable")}
                  >
                    <Unplug />
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">
            Open the desktop app to choose a cloud folder.
          </p>
        )}
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          This backs up this device. It does not merge changes from other
          devices or keep Google Calendar updated.
        </p>
      </section>
      {!isDesktop() && (
        <section className="surface p-6">
          <h2 className="text-sm font-semibold">Browser workspace</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Data in this browser is separate from the desktop app.
          </p>
          {!workspace.tasks.length && !workspace.courses.length && (
            <Button
              className="mt-3"
              variant="outline"
              onClick={async () => {
                try {
                  onExample(await loadPreviewExample());
                } catch (e) {
                  onError(String(e));
                }
              }}
            >
              Load sample data
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

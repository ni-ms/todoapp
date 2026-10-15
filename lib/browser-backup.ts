import {
  browserLock,
  browserRead,
  browserWrite,
  workspaceBackup,
} from "./browser-store";
import { storage } from "./storage";
import { calendarText } from "./ical";
interface Directory extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}
interface BackupConfig {
  handle: Directory | null;
  enabled: boolean;
  lastBackup: string | null;
  error: string | null;
}
export interface BackupStatus {
  folder: string | null;
  enabled: boolean;
  lastBackup: string | null;
  error: string | null;
  supported: boolean;
}
const canPick = () =>
  typeof window !== "undefined" && "showDirectoryPicker" in window;
export async function backupStatus(): Promise<BackupStatus> {
  const s = await browserRead<BackupConfig>("backup");
  return {
    folder: s?.handle?.name ?? null,
    enabled: s?.enabled ?? false,
    lastBackup: s?.lastBackup ?? null,
    error: s?.error ?? null,
    supported: canPick(),
  };
}
export async function chooseBackup() {
  if (!canPick())
    throw new Error(
      "Folder backup requires a browser with folder-write support, such as current Chrome or Edge. JSON and ICS downloads work in other browsers.",
    );
  // Invoke the picker before awaiting storage: it requires the click's user activation.
  const handle = await (
    window as unknown as {
      showDirectoryPicker(options: {
        mode: string;
        id: string;
      }): Promise<Directory>;
    }
  ).showDirectoryPicker({ mode: "readwrite", id: "daymark-backup" });
  await browserLock("backup", () =>
    browserWrite<BackupConfig>("backup", {
      handle,
      enabled: true,
      lastBackup: null,
      error: null,
    }),
  );
  return runBackup();
}
export async function grantBackupPermission(handle: Directory) {
  if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted")
    throw new Error(
      "Folder access was not granted. Your workspace is unchanged.",
    );
  return runBackup();
}
export async function backupHandle() {
  return (await browserRead<BackupConfig>("backup"))?.handle;
}
export async function disableBackup() {
  await browserLock("backup", () =>
    browserWrite<BackupConfig>("backup", {
      handle: null,
      enabled: false,
      lastBackup: null,
      error: null,
    }),
  );
  return backupStatus();
}
export async function runBackup(): Promise<BackupStatus> {
  await browserLock("backup", async () => {
    const config = await browserRead<BackupConfig>("backup");
    if (!config?.enabled || !config.handle) return;
    try {
      if (
        (await config.handle.queryPermission({ mode: "readwrite" })) !==
        "granted"
      )
        throw new Error(
          "Folder permission is needed. Open Settings and select Allow folder access.",
        );
      let device = await browserRead<string>("deviceId");
      if (!device) {
        device = crypto.randomUUID();
        await browserWrite("deviceId", device);
      }
      await writeFolderBackup(config.handle, await storage().load(), device);
      config.lastBackup = new Date().toISOString();
      config.error = null;
    } catch (e) {
      config.error =
        e instanceof Error
          ? e.message
          : "Folder backup failed. Your local workspace is safe.";
    }
    await browserWrite("backup", config);
  });
  return backupStatus();
}

export async function writeFolderBackup(
  handle: FileSystemDirectoryHandle,
  w: import("./domain").Workspace,
  device: string,
) {
  const folder = await handle.getDirectoryHandle("Daymark backups", {
    create: true,
  });
  for (const [extension, text] of [
    ["json", workspaceBackup(w)],
    ["ics", calendarText(w)],
  ]) {
    const file = await folder.getFileHandle(
      `daymark-browser-${device}.${extension}`,
      { create: true },
    );
    const writer = await file.createWritable();
    try {
      await writer.write(text);
      await writer.close();
    } catch (e) {
      await writer.abort().catch(() => {});
      throw e;
    }
  }
}

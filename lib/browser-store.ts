import { openPreview } from "./storage";

// Integration metadata is kept outside workspace exports. Never put credentials here.
export async function browserRead<T>(key: string): Promise<T | undefined> {
  const db = await openPreview();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readonly");
    const request = tx.objectStore("workspace").get(`browser:${key}`);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () =>
      reject(new Error("Could not read browser settings."));
  });
}
export async function browserWrite<T>(key: string, value: T): Promise<void> {
  const db = await openPreview();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readwrite");
    tx.objectStore("workspace").put(value, `browser:${key}`);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(new Error("Could not save browser settings."));
  });
}
export async function browserLock<T>(
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks)
    return Promise.reject(
      new Error(
        "This browser cannot safely coordinate publishing or backups across tabs. Use a current Chrome or Edge browser.",
      ),
    );
  return await navigator.locks.request(`daymark:${name}`, run);
}
export const workspaceBackup = (w: import("./domain").Workspace) =>
  JSON.stringify(
    {
      format: "daymark-workspace",
      version: 2,
      exportedAt: new Date().toISOString(),
      ...w,
    },
    null,
    2,
  );

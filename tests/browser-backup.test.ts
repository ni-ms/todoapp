import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFolderBackup } from "../lib/browser-backup";
import { emptyWorkspace } from "../lib/domain";
test("browser folder backups replace each file on close and abort failed writes", async () => {
  const saved = new Map<string, string>(),
    paths: string[] = [];
  let fail = false,
    aborted = 0;
  const folder = {
    getDirectoryHandle: async (name: string) => {
      paths.push(name);
      return folder;
    },
    getFileHandle: async (name: string) => ({
      createWritable: async () => {
        let pending = "";
        return {
          write: async (text: string) => {
            pending = text;
            if (fail) throw new Error("disk full");
          },
          close: async () => {
            saved.set(name, pending);
          },
          abort: async () => {
            aborted++;
            pending = "";
          },
        };
      },
    }),
  } as unknown as FileSystemDirectoryHandle;
  const w = emptyWorkspace();
  await writeFolderBackup(folder, w, "test");
  assert.deepEqual(paths, ["Daymark backups"]);
  assert.equal(saved.size, 2);
  assert.ok(saved.get("daymark-browser-test.ics")?.includes("BEGIN:VCALENDAR"));
  const payload = JSON.parse(saved.get("daymark-browser-test.json")!);
  assert.equal(payload.format, "daymark-workspace");
  assert.equal(payload.version, 2);
  assert.deepEqual(payload.areas, []);
  const before = new Map(saved);
  fail = true;
  await assert.rejects(writeFolderBackup(folder, w, "test"), /disk full/);
  assert.deepEqual(saved, before);
  assert.equal(aborted, 1);
});

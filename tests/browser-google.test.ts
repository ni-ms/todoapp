import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  desiredGoogleEvents,
  sameGoogleEvent,
  type GoogleEvent,
} from "../lib/browser-google";
import { emptyWorkspace } from "../lib/domain";
test("browser Google retry comparison tolerates timezone normalization and protects remote edits", () => {
  const e: GoogleEvent = {
    summary: "Study",
    description: "",
    start: { dateTime: "2026-03-08T01:30:00-08:00" },
    end: { dateTime: "2026-03-08T03:30:00-07:00" },
  };
  const normalized = {
    ...e,
    start: { dateTime: "2026-03-08T09:30:00Z" },
    end: { dateTime: "2026-03-08T10:30:00Z" },
  };
  assert.equal(sameGoogleEvent(e, normalized), true);
  assert.equal(
    sameGoogleEvent(e, { ...normalized, summary: "Remote edit" }),
    false,
  );
  assert.equal(
    sameGoogleEvent(e, { ...normalized, transparency: "transparent" }),
    false,
  );
  assert.equal(
    sameGoogleEvent(e, { ...normalized, status: "cancelled" }),
    false,
  );
  assert.equal(
    sameGoogleEvent(e, { ...normalized, start: { dateTime: "invalid" } }),
    false,
  );
});
test("browser Google publishes only active records, separates deadlines and sessions, and advances all-day ends", () => {
  const w = emptyWorkspace();
  const metadata = { createdAt: "old", updatedAt: "now", deletedAt: null };
  w.tasks.push({
    ...metadata,
    id: "t",
    title: "Deadline",
    description: "",
    courseId: null,
    kind: "study",
    status: "todo",
    priority: "medium",
    dueDate: "2026-12-31",
    estimateMinutes: 60,
    tagIds: [],
  });
  w.events.push({
    ...metadata,
    id: "e",
    title: "Session",
    description: "",
    start: "2026-12-31T10:00:00Z",
    end: "2026-12-31T11:00:00Z",
    allDay: false,
    timeZone: "UTC",
    tagIds: [],
    taskId: "t",
  });
  const desired = desiredGoogleEvents(w);
  assert.deepEqual(Object.keys(desired), ["event-e", "task-t"]);
  assert.equal(desired["task-t"].value.end.date, "2027-01-01");
  w.tasks[0].status = "done";
  w.events[0].deletedAt = "now";
  assert.deepEqual(desiredGoogleEvents(w), {});
});

test("browser Google retries inserts idempotently, uses ETags for edits, and isolates account state", async () => {
  const {
    configureGoogle,
    connectGoogle,
    syncGoogle,
    disconnectGoogle,
    googleStatus,
  } = await import("../lib/browser-google");
  const { previewTransaction } = await import("../lib/storage");
  const oldFetch = globalThis.fetch,
    oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let account = "first",
    tokenRequests = 0,
    remoteVersion = "v1",
    creates = 0,
    patches = 0;
  const calendars: string[] = [],
    remotes = new Map<string, GoogleEvent>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (config: { callback: (r: unknown) => void }) => ({
              requestAccessToken: () => {
                tokenRequests++;
                config.callback({
                  access_token: "test-token",
                  expires_in: 3600,
                });
              },
            }),
            hasGrantedAllScopes: () => true,
          },
        },
      },
    },
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input),
      method = init?.method ?? "GET";
    assert.equal(init?.redirect, "error");
    if (url.includes("/userinfo")) return Response.json({ sub: account });
    if (url.includes("drive/v3/files?") && method === "GET")
      return Response.json({ files: [] });
    if (url.includes("upload/drive")) return Response.json({ id: "backup-id" });
    if (url.endsWith("/calendar/v3/calendars")) {
      calendars.push(account);
      return Response.json({ id: `calendar-${account}` });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method === "POST" && url.endsWith("/events")) {
      creates++;
      if (remotes.has(body.id)) return new Response("", { status: 409 });
      remotes.set(body.id, { ...body, etag: remoteVersion });
      return Response.json(remotes.get(body.id));
    }
    if (method === "PATCH" && url.includes("/events/")) {
      patches++;
      assert.ok((init?.headers as Record<string, string>)["If-Match"]);
      if (
        (init?.headers as Record<string, string>)["If-Match"] !== remoteVersion
      )
        return new Response("", { status: 412 });
      const id = url.split("/").at(-1)!;
      remotes.set(id, { ...body, id, etag: remoteVersion });
      return Response.json(remotes.get(id));
    }
    if (method === "GET" && url.includes("/events/"))
      return Response.json(remotes.get(url.split("/").at(-1)!));
    throw new Error(`Unexpected mocked request: ${method} ${url}`);
  };
  try {
    await configureGoogle("test.apps.googleusercontent.com");
    await previewTransaction((w) => {
      w.tasks = [];
      w.events = [
        {
          id: "remote-test",
          title: "Study",
          description: "",
          start: "2026-10-15T10:00:00Z",
          end: "2026-10-15T11:00:00Z",
          allDay: false,
          timeZone: "UTC",
          tagIds: [],
          taskId: null,
          createdAt: "old",
          updatedAt: "v1",
          deletedAt: null,
        },
      ];
    });
    assert.equal(
      (await connectGoogle("test.apps.googleusercontent.com")).connected,
      true,
    );
    assert.equal((await syncGoogle()).error, null);
    assert.equal(creates, 1);
    assert.equal((await syncGoogle()).error, null);
    assert.equal(creates, 1);
    assert.equal(patches, 0);
    // Lose only the local event mapping to simulate a network interruption after insert.
    const { browserRead, browserWrite } = await import("../lib/browser-store");
    const state = (await browserRead<{ events: object }>(
      "google:test.apps.googleusercontent.com:first",
    ))!;
    await browserWrite("google:test.apps.googleusercontent.com:first", {
      ...state,
      events: {},
    });
    assert.equal((await syncGoogle()).error, null);
    assert.equal(creates, 2);
    assert.equal(remotes.size, 1);
    remoteVersion = "remote-edited";
    await previewTransaction((w) => {
      w.events[0].title = "Local edit";
      w.events[0].updatedAt = "v2";
    });
    assert.match((await syncGoogle()).error ?? "", /edited in Google/);
    assert.equal([...remotes.values()][0].summary, "Study");
    await disconnectGoogle();
    assert.equal((await googleStatus()).connected, false);
    account = "second";
    remotes.clear();
    await connectGoogle("test.apps.googleusercontent.com");
    await syncGoogle();
    assert.deepEqual(calendars, ["first", "second"]);
    assert.equal(tokenRequests, 2);
  } finally {
    await disconnectGoogle();
    globalThis.fetch = oldFetch;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

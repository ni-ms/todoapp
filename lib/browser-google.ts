import {
  browserLock,
  browserRead,
  browserWrite,
  workspaceBackup,
} from "./browser-store";
import { storage } from "./storage";
import { addDays } from "./ical";
import type { Workspace } from "./domain";
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/drive.appdata",
];
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  scope?: string;
}
interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback: () => void;
      }): { requestAccessToken(options: { prompt: string }): void };
      hasGrantedAllScopes(
        response: TokenResponse,
        ...scopes: string[]
      ): boolean;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}
export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  automatic: boolean;
  lastSync: string | null;
  error: string | null;
}
interface RemoteEvent {
  id: string;
  revision: string;
  etag: string;
}
interface GoogleState {
  calendar?: string;
  drive?: string;
  digest?: string;
  lastSync?: string;
  events: Record<string, RemoteEvent>;
}
export interface GoogleEvent {
  id?: string;
  etag?: string;
  summary: string;
  description?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  status?: string;
  transparency?: string;
  extendedProperties?: { private?: { daymarkKey?: string } };
}
let credential: { token: string; expires: number; account: string } | undefined;
let error: string | null = null;
let preparing: Promise<void> | undefined;
export const googlePrepared = () => Boolean(window.google?.accounts?.oauth2);
export function prepareGoogle(): Promise<void> {
  if (googlePrepared()) return Promise.resolve();
  if (preparing) return preparing;
  preparing = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      script.remove();
      preparing = undefined;
      reject(
        new Error(
          "Google sign-in did not load. Check your connection or content blocker.",
        ),
      );
    }, 15000);
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      clearTimeout(timeout);
      if (googlePrepared()) resolve();
      else {
        preparing = undefined;
        reject(new Error("Google sign-in is unavailable."));
      }
    };
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      preparing = undefined;
      reject(new Error("Could not load Google sign-in."));
    };
    document.head.append(script);
  });
  return preparing;
}
export async function googleClientId() {
  return (
    (await browserRead<string>("googleClientId")) ??
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ??
    ""
  );
}
export async function configureGoogle(clientId: string) {
  if (credential) throw new Error("Disconnect before changing Google setup.");
  if (
    !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
    clientId.length > 256
  )
    throw new Error(
      "Enter a Google Web application client ID. No client secret is needed.",
    );
  await browserWrite("googleClientId", clientId);
  error = null;
}
export async function googleStatus(): Promise<GoogleStatus> {
  if (credential && Date.now() >= credential.expires) {
    credential = undefined;
    error = "Google access expired. Sign in again to continue publishing.";
  }
  const state = credential
    ? await browserRead<GoogleState>(`google:${credential.account}`)
    : undefined;
  return {
    configured: Boolean(await googleClientId()),
    connected: Boolean(credential),
    automatic: (await browserRead<boolean>("googleAutomatic")) ?? false,
    lastSync: state?.lastSync ?? null,
    error,
  };
}
// Called synchronously from a user click after prepareGoogle: preserve popup activation.
export function connectGoogle(clientId: string): Promise<GoogleStatus> {
  if (!window.google)
    return Promise.reject(new Error("Load Google sign-in first."));
  const identity = window.google.accounts.oauth2;
  return new Promise((resolve, reject) => {
    const client = identity.initTokenClient({
      client_id: clientId,
      scope: scopes.join(" "),
      error_callback: () =>
        reject(
          new Error(
            "Google sign-in was closed or blocked. Try again and allow the sign-in popup.",
          ),
        ),
      callback: (response) => {
        void (async () => {
          if (
            response.error ||
            !response.access_token ||
            !identity.hasGrantedAllScopes(response, ...scopes)
          )
            throw new Error(
              "Google did not grant the required calendar and backup permissions.",
            );
          const r = await fetch(
            "https://openidconnect.googleapis.com/v1/userinfo",
            {
              headers: { Authorization: `Bearer ${response.access_token}` },
              credentials: "omit",
              redirect: "error",
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!r.ok)
            throw new Error("Could not identify the connected Google account.");
          const account = await r.json();
          if (typeof account.sub !== "string" || !account.sub)
            throw new Error("Google returned no account identity.");
          credential = {
            token: response.access_token,
            expires:
              Date.now() +
              Math.max(0, Number(response.expires_in ?? 3600) - 60) * 1000,
            account: `${clientId}:${account.sub}`,
          };
          error = null;
          return googleStatus();
        })().then(resolve, reject);
      },
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}
export async function disconnectGoogle() {
  credential = undefined;
  error = null;
  await browserWrite("googleAutomatic", false);
  return googleStatus();
}
export async function automaticGoogle(enabled: boolean) {
  await browserWrite("googleAutomatic", enabled);
  return googleStatus();
}
export function desiredGoogleEvents(w: Workspace) {
  const result: Record<string, { revision: string; value: GoogleEvent }> = {};
  for (const e of w.events.filter((e) => !e.deletedAt)) {
    const key = `event-${e.id}`;
    result[key] = {
      revision: JSON.stringify([
        e.updatedAt,
        e.title,
        e.description,
        e.start,
        e.end,
        e.timeZone,
      ]),
      value: {
        summary: e.title,
        description: e.description,
        start: e.allDay
          ? { date: e.start }
          : { dateTime: e.start, timeZone: e.timeZone },
        end: e.allDay
          ? { date: e.end }
          : { dateTime: e.end, timeZone: e.timeZone },
        status: "confirmed",
        extendedProperties: { private: { daymarkKey: key } },
      },
    };
  }
  for (const t of w.tasks.filter(
    (t) => !t.deletedAt && t.status !== "done" && t.dueDate,
  )) {
    const key = `task-${t.id}`;
    result[key] = {
      revision: JSON.stringify([
        t.updatedAt,
        t.title,
        t.description,
        t.dueDate,
      ]),
      value: {
        summary: `Due: ${t.title}`,
        description: t.description,
        start: { date: t.dueDate! },
        end: { date: addDays(t.dueDate!, 1) },
        transparency: "transparent",
        status: "confirmed",
        extendedProperties: { private: { daymarkKey: key } },
      },
    };
  }
  return result;
}
export function sameGoogleEvent(a: GoogleEvent, b: GoogleEvent) {
  const boundary = (x: GoogleEvent["start"], y: GoogleEvent["start"]) =>
    x?.date && y?.date
      ? x.date === y.date
      : Boolean(x?.dateTime && y?.dateTime) &&
        Number.isFinite(Date.parse(x.dateTime!)) &&
        Date.parse(x.dateTime!) === Date.parse(y.dateTime!);
  return (
    a.summary === b.summary &&
    (a.description ?? "") === (b.description ?? "") &&
    (a.status ?? "confirmed") === "confirmed" &&
    (b.status ?? "confirmed") === "confirmed" &&
    (a.transparency ?? "opaque") === (b.transparency ?? "opaque") &&
    boundary(a.start, b.start) &&
    boundary(a.end, b.end)
  );
}
async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
const jsonBody = (value: unknown) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
export async function syncGoogle(): Promise<GoogleStatus> {
  try {
    await browserLock("google", async () => {
      const session = credential;
      if (!session || Date.now() >= session.expires)
        throw new Error("Google access expired. Sign in again.");
      const request = async (path: string, init: RequestInit = {}) => {
        if (credential !== session || Date.now() >= session.expires)
          throw new Error("Google access ended. Sign in again.");
        const r = await fetch(`https://www.googleapis.com/${path}`, {
          ...init,
          headers: {
            ...init.headers,
            Authorization: `Bearer ${session.token}`,
          },
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        if (r.status === 401) {
          credential = undefined;
          throw new Error("Google access expired. Sign in again.");
        }
        if (r.status === 403)
          throw new Error(
            "Google denied access. Enable Calendar/Drive APIs and grant the requested scopes.",
          );
        if (r.status === 412)
          throw new Error(
            "An event was edited in Google and was left unchanged. Keep any Google edits, then remove its Google copy and sync again.",
          );
        if (r.status === 429)
          throw new Error("Google usage limit reached. Try again later.");
        return r;
      };
      const document = async <T>(r: Response): Promise<T> => {
        if (!r.ok)
          throw new Error(`Google returned HTTP ${r.status}. Try again later.`);
        return r.json();
      };
      const key = `google:${session.account}`;
      const state = (await browserRead<GoogleState>(key)) ?? { events: {} };
      const save = () => browserWrite(key, state);
      const workspace = await storage().load();
      // Back up even when calendar publishing has a conflict.
      const backup = async () => {
        const hash = await digest(JSON.stringify(workspace));
        if (state.digest === hash) return;
        let device = await browserRead<string>("deviceId");
        if (!device) {
          device = crypto.randomUUID();
          await browserWrite("deviceId", device);
        }
        const name = `daymark-browser-${device}.json`;
        if (!state.drive) {
          const query = new URLSearchParams({
            spaces: "appDataFolder",
            q: `name='${name}' and trashed=false`,
            fields: "files(id)",
          });
          const result = await document<{ files?: { id: string }[] }>(
            await request(`drive/v3/files?${query}`),
          );
          state.drive = result.files?.[0]?.id;
        }
        let response = state.drive
          ? await request(
              `upload/drive/v3/files/${encodeURIComponent(state.drive)}?uploadType=media`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: workspaceBackup(workspace),
              },
            )
          : undefined;
        if (!response || response.status === 404 || response.status === 410) {
          const boundary = `daymark_${crypto.randomUUID()}`;
          const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name, parents: ["appDataFolder"], mimeType: "application/json" })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${workspaceBackup(workspace)}\r\n--${boundary}--\r\n`;
          response = await request(
            "upload/drive/v3/files?uploadType=multipart",
            {
              method: "POST",
              headers: {
                "Content-Type": `multipart/related; boundary=${boundary}`,
              },
              body,
            },
          );
        }
        const file = await document<{ id: string }>(response);
        if (!file.id) throw new Error("Google returned no backup ID.");
        state.drive = file.id;
        state.digest = hash;
        await save();
      };
      await backup();
      if (!state.calendar) {
        const c = await document<{ id: string }>(
          await request("calendar/v3/calendars", {
            method: "POST",
            ...jsonBody({
              summary: "Daymark · Browser",
              description:
                "Published from Daymark browser workspace. Edit the originals in Daymark.",
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
          }),
        );
        if (!c.id) throw new Error("Google returned no calendar ID.");
        state.calendar = c.id;
        await save();
      }
      const base = `calendar/v3/calendars/${encodeURIComponent(state.calendar)}/events`;
      const desired = desiredGoogleEvents(workspace);
      for (const [entity, previous] of Object.entries(state.events)) {
        if (desired[entity]) continue;
        const r = await request(`${base}/${previous.id}`, {
          method: "DELETE",
          headers: { "If-Match": previous.etag },
        });
        if (!r.ok && r.status !== 404 && r.status !== 410)
          throw new Error(`Google deletion returned HTTP ${r.status}.`);
        delete state.events[entity];
        await save();
      }
      for (const [entity, { revision, value }] of Object.entries(desired)) {
        const previous = state.events[entity];
        if (previous?.revision === revision) continue;
        let id = previous?.id ?? `d${await digest(entity)}`;
        let r = previous
          ? await request(`${base}/${id}`, {
              method: "PATCH",
              ...jsonBody(value),
              headers: {
                "Content-Type": "application/json",
                "If-Match": previous.etag,
              },
            })
          : await request(base, {
              method: "POST",
              ...jsonBody({ ...value, id }),
            });
        if (previous && [404, 410].includes(r.status)) {
          id = `d${await digest(entity + revision)}`;
          r = await request(base, {
            method: "POST",
            ...jsonBody({ ...value, id }),
          });
        }
        let remote: GoogleEvent;
        if (r.status === 409) {
          remote = await document<GoogleEvent>(await request(`${base}/${id}`));
          if (
            remote.extendedProperties?.private?.daymarkKey !== entity ||
            !sameGoogleEvent(remote, value)
          )
            throw new Error(
              "A Google event has different details. It was left unchanged.",
            );
        } else {
          remote = await document<GoogleEvent>(r);
        }
        if (!remote.id || !remote.etag)
          throw new Error("Google returned no event ID/version.");
        state.events[entity] = { id: remote.id, revision, etag: remote.etag };
        await save();
      }
      state.lastSync = new Date().toISOString();
      await save();
      error = null;
    });
  } catch (e) {
    error =
      e instanceof Error
        ? e.message
        : "Google publishing failed. Your local data is safe.";
  }
  return googleStatus();
}

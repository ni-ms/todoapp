# Daymark · Learning workspace

A local desktop planner for students and independent learners who also build things. Keep coursework, coding projects, and career preparation together without turning every goal into a separate app.

Built with Tauri 2, Rust, Next.js 16 static export, React 19, TypeScript, Tailwind CSS 4, and shadcn/ui with Radix primitives. The desktop app embeds static assets; it does not run a Next.js server.

## What works

- Calendar opens in Week view, with Day and Month options, navigation, tag filtering, and click/select to plan. Create timed or all-day events, link a session to a task, move or resize sessions, and recover deleted events from Trash.
- Open task deadlines appear as all-day entries. Scheduling an event does not change or complete its source task.
- Create courses, coding projects, career goals, and tasks with notes, priorities, deadlines, effort estimates, and editable tags. Learning, Building, and Career are starting tags; add more with preset or uploaded icons. Archived tags can be permanently deleted after confirmation; their assignments are removed while tasks and events remain intact.
- My Day, the task backlog, search/status/tag filters, area-specific task lists, completion/reopening, and recoverable Trash.
- Local SQLite persistence, system/light/dark themes, responsive navigation, accessible dialogs, and keyboard shortcuts (`N` for a task; `Cmd/Ctrl+K` for visible task search).
- ICS calendar export and full JSON workspace export, including Trash in JSON. Desktop exports go to Downloads.
- Optional Google desktop sign-in, one-way publishing to a dedicated Daymark calendar, and a private Drive workspace backup. Automatic sync runs approximately every minute while the app is open. Requires a Google Desktop OAuth client; see [Google setup](docs/google-setup.md). Live account integration has not yet been verified.
- Optional atomic JSON/ICS backups into a user-chosen local Drive/Dropbox/iCloud folder, without OAuth. Each device has its own files. The external desktop provider uploads them.

AI scheduling, recurrence, study recommendations, spaced review, two-way calendar sync, multi-device merging, and JSON import/restore are not implemented. Due dates and effort estimates do not automatically create sessions. Statistics summarize work; they do not measure mastery. The app works offline; Google features require an explicit connection.

## Requirements and development

Use Node.js 24 LTS (`.nvmrc`; declared minimum 22), npm, Rust 1.90 or newer, and the platform dependencies in the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/). On macOS, install Xcode Command Line Tools.

```sh
npm ci
npm run tauri dev
```

For browser-only development:

```sh
npm run dev
```

Open http://127.0.0.1:3000. **Browser preview stores its data separately in IndexedDB**, with an explanation in Settings. It never substitutes for a failed native database. An empty preview can load an optional example workspace. Clearing site data removes preview records; exporting them first preserves a copy. Preview records are not automatically transferred to the desktop database.

## Data and architecture

- `components/learner-workspace.tsx`: application shell and views.
- `components/workspace-forms.tsx`, `components/ui/`: typed forms and owned shadcn/ui component source.
- `lib/domain.ts`: shared frontend records and validation.
- `lib/storage.ts`: native command adapter and isolated browser preview adapter.
- `src-tauri/src/workspace.rs`: authoritative validation, SQLite queries, and persistence tests.
- `components/calendar-view.tsx`, `components/event-form.tsx`, `components/tag-manager.tsx`: calendar planning and custom tags.
- `lib/ical.ts`, `src-tauri/src/ical.rs`: RFC 5545 calendar exports with UTF-8 folding and exclusive all-day ends.
- `src-tauri/src/calendar.rs`: authoritative event and tag validation/persistence.
- `src-tauri/src/google.rs`: native OAuth, calendar publishing, and Drive backup; credentials stay in the OS credential store.
- `src-tauri/src/backup.rs`: atomic cloud-folder backups.
- `src-tauri/migrations/`: migrations through schema version 3, run transactionally using `PRAGMA user_version`. Existing tasks get initial tags without losing their data.
- `src-tauri/src/main.rs`: typed commands executed on blocking workers with serialized database access.
- `src-tauri/capabilities/workspace.json`: main-window permissions for workspace commands; no arbitrary SQL or filesystem API is exposed.

The SQLite database is `learner.sqlite3` in Tauri's application data directory. On macOS this is `~/Library/Application Support/com.nikms.todoapp/`. WAL mode, foreign keys, and a busy timeout are enabled. The app refuses to open newer database schemas rather than downgrading them. The database is local but **not encrypted**; standard OS account and disk protections apply.

The identifier remains `com.nikms.todoapp` to preserve app identity and storage paths. The UI uses Daymark as a working name. Prototype task records from the previous in-memory interface were not durable and cannot be recovered after their session ends. Older todo components and Rust `todo_utils` models remain as legacy code; the new SQLite records are the active model.

No AI provider or analytics is connected. Google network access happens in native Rust only after sign-in. The frontend CSP permits bundled assets and local IPC; development additionally permits the Next.js local development server. Backups do not contain OAuth tokens. Disconnect stops future uploads and preserves provider data. Read [the setup guide](docs/google-setup.md) before enabling uploads.

## Checks and builds

```sh
npm test
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri build -- --debug --no-bundle
```

`npm run check` runs ESLint, TypeScript, and a static production build. Tests cover persistence, version-one upgrades, idempotent migrations, rejecting newer schemas, invalid dates/zones/icons, recoverable deletion, atomic backups, DST and ICS escaping/folding, OAuth state/PKCE, and safe retry comparison when Google normalizes timestamps. Browser and packaged macOS checks verify user workflows and persistence. Windows and Linux runtime behavior has not been verified in this workspace.

To create a local macOS app bundle, use `npm run tauri build -- --debug --bundles app`. For release installers, run `npm run tauri build`; outputs appear under `src-tauri/target/release/`. Signing and distribution require separate configuration. If this environment prevents Turbopack from binding its local build-worker port, verify with the supported Webpack alternative: `npm run tauri build -- --debug --bundles app --config '{"build":{"beforeBuildCommand":"npm run build -- --webpack"}}'`. This override does not change the normal build configuration.

`next start` does not serve a static export. Preview `out/` using a static server, for example `python3 -m http.server 4173 --directory out`.

The current full npm audit reports five high-severity findings in the development-only `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` chain. The earlier compatible refresh left these upstream findings unresolved; recheck before release. Avoid the suggested forced downgrade. ESLint stays on 9 to match the peer ranges declared by Next's React/import/accessibility plugins. Legacy Rust model code still emits dead-code warnings.

See [AGENTS.md](AGENTS.md) for product direction, implementation conventions, and the staged plan toward learning-aware scheduling.

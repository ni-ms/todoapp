# Connect Google

Daymark works offline without an account. Its optional desktop connection publishes events and open task deadlines to a dedicated **Daymark** Google Calendar and saves a workspace backup in Google Drive's private application folder. Automatic sync runs about once a minute while the app is open. It does not run after quitting the app.

The browser app has a separate Google Web OAuth client flow and stores only short-lived access in tab memory. It can publish to its own calendar and back up to Drive without a server, but needs user-driven sign-in after reload/expiry. See [browser Google setup](browser.md#google-in-the-browser); the Desktop client setup below is not interchangeable with it.

## One-time development setup

A Google sign-in button needs an OAuth client identifying this app. For this development build:

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Under APIs & Services → Library, enable **Google Calendar API** and **Google Drive API**.
3. Configure the app under Google Auth Platform: give it a name and support email, choose an audience, and add your own Google account under Test users if the app is in testing.
4. Under Data Access, declare `openid`, `email`, `https://www.googleapis.com/auth/calendar.app.created`, and `https://www.googleapis.com/auth/drive.appdata`.
5. Create an OAuth client with application type **Desktop app**, then download its JSON configuration. A Web application client or service-account key will not work here. Desktop clients use a local loopback callback; no hosted backend or manually registered web callback is needed.
6. Open Daymark's desktop Settings → Google → Choose setup file, and select that JSON file.
7. Click **Sign in with Google**, complete consent in your normal browser, then return to Daymark. Allow the requested calendar and app-data permissions. macOS may ask for access to the app's Keychain credentials.

This configures your local build; it does not register or publish an OAuth application for other users. Before distribution, the maintainer must configure branding, publishing, and any review Google requires. External apps in testing can have short-lived refresh tokens; if Google access expires, disconnect and sign in again. See [Google's native app OAuth guide](https://developers.google.com/identity/protocols/oauth2/native-app) and [OAuth production guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).

## What gets uploaded

- Calendar: titles, notes, dates/times and time zones of active events, plus all-day deadlines for open tasks. Completed or trashed tasks are excluded. A linked task and its scheduled session remain distinct entries.
- Drive: a JSON copy of all tasks, courses/projects, tags, and events, including Trash. Uploaded tag icons are part of this backup. Each device has its own backup file, replaced as the workspace changes.
- The app does not request access to your existing primary calendar or general Drive documents. The Drive backup uses the [private app-data folder](https://developers.google.com/workspace/drive/api/guides/appdata), so it is not a normal visible document in My Drive. For accessible JSON/ICS files, use Export or Cloud folder backup instead.

OAuth authorization uses PKCE, a random state value, and an ephemeral loopback listener. Refresh tokens and the imported client secret stay in the OS credential store; access tokens remain in native process memory. Tokens are not exposed to JavaScript, stored in workspace exports, or logged. Public client configuration and sync metadata live in local preferences.

## Publishing and conflicts

Publishing is **one way: Daymark → Google**. Daymark does not import edits made in Google or merge workspaces across devices. It tracks app-owned event IDs, revisions and ETags. Retrying an interrupted insert uses the same event ID, and edits/deletions use conditional requests. If an event changed in Google, the app reports a conflict and leaves it unchanged. To resolve a conflict, first keep a copy of any Google edits you need, then remove the conflicting event from Google and click Sync now. Daymark republishes the current local version if still active, or removes its local sync mapping if the source was completed/trashed. An unresolved conflict can stop calendar publishing until addressed; the Drive backup is still attempted.

Pausing automatic sync retains sign-in and allows Sync now. Disconnect removes the local refresh token and stops uploads; it leaves existing Google events and backups intact. You can also remove the application's grant through your Google account. Changing the OAuth client or Google account starts a separate connection; previously published data remains in the old account.

Offline failures keep local changes and surface an error; automatic sync retries later. Files exported as `.ics` can be imported into Google Calendar, Apple Calendar, or Outlook, but importing a file does not establish ongoing sync. Repeated imports may duplicate records depending on the receiving app.

## Backup-folder alternative

In Settings → Cloud folder backup, choose a locally mounted folder from Google Drive for desktop, Dropbox, iCloud Drive, or another provider. Daymark writes a JSON workspace backup and an ICS calendar into `Daymark backups/`, using a separate filename per device and atomic file replacement. Your provider handles uploading those files. Disconnecting stops writes and preserves existing backups.

Folder backup needs no OAuth configuration. It does not modify Google Calendar or merge data between computers. JSON import/restore is not implemented yet; retain exported files for recovery and migration work. Do not place the live SQLite database in a cloud-synced folder.

## Verification status

Local migration, persistence, backup replacement, OAuth callback/state/PKCE, event identity, retry comparison, and calendar export regression tests run without Google credentials. The packaged macOS UI was checked for event creation, persistence after restart, deletion, and ICS export. The native folder picker opened, but completing a folder selection could not be verified because UI automation timed out; filesystem backup behavior is covered by Rust tests. A real Google account connection and end-to-end API sync still require the OAuth configuration above and have not been verified in this workspace.

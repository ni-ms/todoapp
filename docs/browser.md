# Browser app and GitHub Pages

Daymark's browser app uses static HTML/CSS/JavaScript, including a bundled WebLLM worker for optional on-device AI. GitHub Pages needs no server, Rust build, hosted secret, or shared API key. Desktop SQLite and native commands remain separate from the browser's IndexedDB workspace. Clearing site data removes browser records; export or back them up first. There is no multi-device merge or JSON import/restore yet.

## AI choices

In **Settings → AI**, choose one provider. The app never silently switches providers. All providers produce editable drafts under the same validation: 1–10 tasks, valid dates/effort/priorities, existing tag IDs, and no tool execution. Files are attached explicitly, filtered and bounded like native excerpts, displayed for review, and kept only in page memory.

### Local Ollama

Start your installed Ollama server on loopback, enable only the website's origin through `OLLAMA_ORIGINS`, and disable Ollama cloud features. For the default Pages URL:

```sh
OLLAMA_ORIGINS=https://ni-ms.github.io OLLAMA_NO_CLOUD=1 ollama serve
```

Use `http://127.0.0.1:3000` instead for frontend development, or your custom domain's origin. Origins do not include `/todoapp`. Restart an existing server after changing its environment. Do not bind it publicly or allow wildcard origins. Origin permission applies to the whole origin, including other Pages repositories on that origin; use a dedicated custom domain when isolating trusted sites matters. In Settings, Check local connection, then choose an installed model. The app checks model metadata and rejects cloud aliases/remote models before sending prompts.

Requests use fixed `http://127.0.0.1:11434` endpoints, omit cookies, reject redirects, and bound output. Browser networking still obeys the browser/OS proxy, CORS, mixed-content, and local-network permission policies; JavaScript cannot bypass these policies. Unlike the desktop native client, the browser cannot force proxies off. If a browser blocks HTTPS-to-loopback access, use a supported browser or another provider. The site cannot launch/stop local processes.

### In-browser model

Select **On this device · browser model**, then **Download / load browser model**. WebLLM runs Qwen 2.5 1.5B in a dedicated worker using WebGPU. Model files are downloaded from WebLLM's configured model/runtime hosts and cached by the library; no task text or attached excerpts are sent for inference. Downloads are around 1 GB and take time. A compatible GPU/browser, free memory, and available browser storage are required. Cached files can be evicted by the browser. The model must be loaded into memory again after reloading the page; **Unload model** releases its worker/memory. Small-model estimates and deadlines need careful review.

This does not require Ollama, an API account, or per-request payment. It uses device GPU, memory, bandwidth, and storage. Unsupported devices should use Ollama or hosted AI. See [WebLLM setup](https://webllm.mlc.ai/docs/user/get_started.html).

### Hosted OpenRouter

Select **Hosted · OpenRouter**, choose a model ID, enter your own OpenRouter API key, and select **Use hosted settings**. The key stays only in the current tab's JavaScript memory and is cleared by reload or **Forget key**. It is never stored in IndexedDB/localStorage, exported in backups, or supplied through GitHub Actions. Use a separate key with a low spending cap. A static client cannot protect a shared developer key; distributing one in the bundle is not supported.

The default `openrouter/free` routes to available free models. Model availability, quality, capacity and usage limits vary. Paid model IDs charge the user's account; the app does not configure a paid fallback. Check [OpenRouter's limits](https://openrouter.ai/docs/api-reference/limits) and your account before choosing paid models. No account or paid request is created during development.

Only **Create task drafts** sends the entered request, checked file excerpts, and active tag IDs/names to OpenRouter and its model provider. Existing tasks and the calendar are not sent. The app requests providers with `data_collection: deny`; requests can fail if no eligible provider/model supports the selected format or privacy policy. Provider policy and retention terms still apply. Changing providers alone sends no task content. A disclosure appears next to capture when hosted AI is selected.

## Voice and file context

Browser file and folder pickers enable the same text/code excerpt workflow; unsupported/binary/PDF/Office files are skipped. Folder picker availability varies by browser. Limits remain 20 attachments, 128 KB per file, 6 KB per excerpt, 60 KB attached, 24 KB selected input per request, and 2,000 inspected file entries. These filters do not replace reviewing excerpts for secrets.

Browser recording uses **Whisper Tiny directly on the device** through Transformers.js in a dedicated Web Worker. In **Settings → AI → Voice transcription**, select **Download / load speech model** before recording. This explicitly downloads the quantized multilingual model (about 41 MB of weights, plus tokenizer/config files and the browser runtime). Model files are cached by the browser; reload them into memory after a page reload. Cache eviction may require another download. **Cancel speech download** stops the worker and downloads; **Unload speech model** releases memory without deleting cached files.

The speech worker uses one WebAssembly thread, so it needs neither WebGPU nor cross-origin isolation headers and remains compatible with static GitHub Pages hosting. Browser/device support and processing speed vary. Microphone capture requires HTTPS or localhost and browser permission. No local Whisper server, API key, or hosted speech service is used in the browser. Native desktop recording continues to use its existing local Whisper adapter.

Record in My day, stop when finished, edit the transcript, then request task drafts. Recording is capped at 90 seconds; conversion stays on-device as mono 16 kHz PCM. Audio is bounded and validated, transferred to the speech worker, and never passed to a network/provider adapter or saved in the workspace. Long recordings are transcribed in overlapping chunks. Leaving capture stops the microphone and cancels unfinished browser transcription by terminating its worker; load the model again before the next recording if it was canceled. Failures do not fall back to a server. Multilingual language detection/accuracy depend on the model and recording quality. Review transcripts, especially dates/numbers.

Text AI is independent of speech: choosing hosted task drafts can subsequently send the **editable transcript as request text** to that provider when you explicitly create drafts. Raw audio is not uploaded. Model downloads contact Hugging Face and the runtime's asset hosts, without including recordings. See [Transformers.js speech recognition](https://huggingface.co/docs/transformers.js/api/pipelines) and [the model files](https://huggingface.co/Xenova/whisper-tiny/tree/main/onnx).

## Weekly planning

**My day → Plan my week** works with no AI provider or network. The browser counterpart of the native deterministic planner uses IANA time zones via the Temporal polyfill, deadlines/priorities, existing busy events, all-day blocks, future reserved sessions, breaks, and blocks up to 90 minutes. It skips ambiguous/nonexistent study-window boundaries at DST changes and uses actual elapsed time across DST. The preview reports unscheduled work.

Apply checks the current persisted workspace against the preview fingerprint and commits all sessions plus undo history in one IndexedDB transaction. It also rejects previews whose sessions have slipped into the past. Undo moves only unedited generated sessions to Trash and stops if any generated session was edited/deleted. Other records are preserved. This remains on-demand planning; continuous rescheduling, learning prerequisites, recurring habits, and imported Google busy time are not implemented.

## Google in the browser

Create a separate **Web application** OAuth client in Google Cloud, enable Calendar and Drive APIs, configure consent/test users, and add the exact origin (e.g. `https://ni-ms.github.io`) to **Authorized JavaScript origins**. Use `http://127.0.0.1:3000` for local development if registered. No client secret or redirect handler is needed for Google's browser token model. Do not upload the Desktop app OAuth JSON here.

For a public deployment, the maintainer can set the repository Actions variable `GOOGLE_WEB_CLIENT_ID` to this public Web client ID; the Pages workflow exposes it as `NEXT_PUBLIC_GOOGLE_CLIENT_ID` during the build. This is public configuration, never a client secret. A user can override it in Settings.

In **Settings → Google**, save the public client ID and load sign-in, then click **Sign in with Google**. Loading sign-in fetches Google's official Identity Services script. Signing in requests `openid`, `email`, `calendar.app.created`, and `drive.appdata`. **Publish and back up now** explicitly uploads active calendar events/open task deadlines and a full workspace backup including Trash, notes and tag icons. Automatic uploads are off until enabled, then attempted about once a minute while the tab remains open and its access is valid.

Google access tokens live only in tab memory. Reloading or token expiry requires user-driven sign-in again; no refresh token/client secret is embedded or persisted. This is a limit of the [browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model). For unattended uploads after the browser closes or seamless long-lived sign-in, a separately deployed backend would be needed.

The browser has its own app-created **Daymark · Browser** calendar and per-browser Drive app-data backup. Remote state is separated by OAuth client and account. Event IDs are deterministic, interrupted inserts reconcile only matching app-owned copies, and edits/deletes use ETags. Conflicts preserve remote edits. Web Locks serialize uploads across tabs. Disconnect ends this tab's access and disables automatic uploads; it leaves Google data intact. Revoking the app's grant is done through your Google account. Other calendars are not imported and workspaces are not merged.

## Folder backup

In browsers exposing File System Access (such as current Chrome/Edge), **Settings → Cloud folder backup → Choose folder** explicitly grants writes to a chosen directory. Pick a folder already synced by your desktop cloud client if you want that provider to upload it. A static site cannot connect directly to arbitrary Dropbox/iCloud folders without their own integration.

Daymark writes only a `Daymark backups` subfolder and per-browser JSON/ICS filenames. Each file uses `createWritable()` and is replaced on close; the two-file pair is not a single transaction. If an individual write fails, its writer is aborted. Folder handles and non-secret metadata are saved in IndexedDB, not workspace exports. Permission may need to be re-granted after a reload. Background ticks never open permission prompts. **Allow folder access** requests permission from a button click. Disconnect removes the saved handle and preserves existing files.

Automatic work runs approximately once a minute while the tab is open; background throttling/suspension, network failures, and permissions can delay it. Unsupported browsers retain JSON/ICS downloads.

## Verification limits

Tests cover browser scheduling/DST, stale previews, atomic IndexedDB apply/undo, attachment limits, AI schema/destination/output boundaries, memory-only hosted keys, Google retry/ETag/account behavior with simulated APIs, per-file backup commit/abort behavior with simulated filesystem handles, and browser speech WAV validation, worker reuse/transfers, cancel/retry/crash cleanup, and absence of a server fallback. A static export and browser UI checks do not verify real Google OAuth/publishing, a paid/free hosted model account, a user's microphone, or a chosen cloud folder. Those need the user's configured accounts/devices and permissions. Model generation quality and GPU support vary by runtime; report actual live checks separately.

A live WebGPU Qwen 2.5 1.5B check against the static repository-path export generated one study task with the requested 30-minute effort, next-day deadline, and Learning tag. Browser UI checks also covered editing/saving a draft, reload persistence, preview/apply/undo of a plan, and responsive navigation. These are sample workflow checks, not a model-quality evaluation; always review drafts.

Browser speech was checked against the exported worker using the public Transformers.js JFK fixture: single-threaded WebAssembly produced the expected English transcript without a speech server. The actual user microphone/permission/device path still requires a manual check; no user microphone audio was recorded during development.

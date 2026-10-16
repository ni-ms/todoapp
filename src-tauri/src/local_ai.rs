//! Local-only inference: fixed loopback addresses, no proxies, redirects, or cloud model aliases.
use crate::workspace::Result;
use crate::Database;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::blocking::{multipart, Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Read,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
#[derive(Default)]
pub struct Services {
    children: Mutex<Vec<std::process::Child>>,
}
pub type ServiceState = Arc<Services>;
fn stop_child(child: &mut std::process::Child) {
    if child.try_wait().is_ok_and(|exit| exit.is_some()) {
        return;
    }
    // Give model servers time to stop their own workers before a forced kill.
    #[cfg(unix)]
    let _ = std::process::Command::new("/bin/kill")
        .args(["-TERM", &child.id().to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    #[cfg(not(unix))]
    let _ = child.kill();
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if child.try_wait().is_ok_and(|exit| exit.is_some()) {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let _ = child.kill();
    let _ = child.wait();
}
impl Drop for Services {
    fn drop(&mut self) {
        if let Ok(children) = self.children.get_mut() {
            for child in children {
                stop_child(child);
            }
        }
    }
}
fn binary(name: &str) -> Result<std::path::PathBuf> {
    let mut directories = vec![
        std::path::PathBuf::from("/opt/homebrew/bin"),
        std::path::PathBuf::from("/usr/local/bin"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        directories.push(std::path::PathBuf::from(home).join(".local/bin"));
    }
    for directory in directories {
        let path = directory.join(name);
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(format!("Install {name} first. See Local AI setup."))
}
pub fn start_services(
    db: &Database,
    services: &ServiceState,
    model_path: std::path::PathBuf,
) -> Result<LocalStatus> {
    use std::process::{Command, Stdio};
    let current = status(db)?;
    let mut children = services
        .children
        .lock()
        .map_err(|_| "Local services unavailable.")?;
    children.retain_mut(|child| child.try_wait().is_ok_and(|exit| exit.is_none()));
    if !current.ollama_available {
        children.push(
            Command::new(binary("ollama")?)
                .arg("serve")
                .env("OLLAMA_NO_CLOUD", "1")
                .env("OLLAMA_HOST", "127.0.0.1:11434")
                .env("OLLAMA_FLASH_ATTENTION", "1")
                .env("OLLAMA_KV_CACHE_TYPE", "q8_0")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "Could not start Ollama.")?,
        );
    }
    if !current.speech_available && current.speech_model == SpeechEngine::Phonon2 {
        children.push(
            Command::new(binary("fermion")?)
                .args(["serve", "phonon-2", "--host", "127.0.0.1", "--port", "8010"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "Could not start Phonon 2.")?,
        );
    } else if !current.speech_available {
        if !model_path.is_file() {
            return Err("Download the Whisper base.en model first. See docs/local-ai.md.".into());
        }
        children.push(
            Command::new(binary("whisper-server")?)
                .args(["--host", "127.0.0.1", "--port", "8080", "-m"])
                .arg(model_path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "Could not start Whisper.")?,
        );
    }
    drop(children);
    for _ in 0..180 {
        let result = status(db)?;
        if result.ollama_available && result.speech_available {
            return Ok(result);
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err("Local services did not finish starting. Check ports 11434, 8080 (Whisper), or 8010 (Phonon 2). Phonon's first start downloads its model; finish setup and retry.".into())
}
pub fn stop_services(services: &ServiceState) -> Result<()> {
    let mut children = services
        .children
        .lock()
        .map_err(|_| "Local services unavailable.")?;
    for child in children.iter_mut() {
        stop_child(child);
    }
    children.clear();
    Ok(())
}
pub type ContextStore = Arc<Mutex<HashMap<String, ContextItem>>>;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub id: String,
    pub name: String,
    pub text: String,
    pub truncated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextResult {
    pub items: Vec<ContextItem>,
    pub skipped: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStatus {
    pub models: Vec<String>,
    pub model: String,
    pub ollama_available: bool,
    pub speech_model: SpeechEngine,
    pub speech_available: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpeechEngine {
    #[serde(rename = "whisper")]
    Whisper,
    #[serde(rename = "phonon-2")]
    Phonon2,
}
impl SpeechEngine {
    fn key(self) -> &'static str {
        match self {
            Self::Whisper => "whisper",
            Self::Phonon2 => "phonon-2",
        }
    }
    fn endpoint(self) -> &'static str {
        match self {
            Self::Whisper => "http://127.0.0.1:8080/inference",
            Self::Phonon2 => "http://127.0.0.1:8010/v1/audio/transcriptions",
        }
    }
}
pub fn speech_engine(db: &Database) -> Result<SpeechEngine> {
    let value = db
        .lock()
        .map_err(|_| "Workspace unavailable.")?
        .preference("local_speech_model");
    // Preserve the existing desktop Whisper configuration until explicitly changed.
    match value.as_deref() {
        None | Some("whisper") => Ok(SpeechEngine::Whisper),
        Some("phonon-2") => Ok(SpeechEngine::Phonon2),
        _ => Err("Choose a supported speech model in AI setup.".into()),
    }
}
pub fn configure_speech(db: &Database, model: SpeechEngine) -> Result<()> {
    db.lock()
        .map_err(|_| "Workspace unavailable.")?
        .put_preference("local_speech_model", model.key())
}
fn phonon_health(value: &Value) -> bool {
    value["status"] == "ok"
        && value["kind"] == "speech"
        && (value["model"] == "FermionResearch/Phonon-2" || value["model"] == "phonon-2")
}
fn client(seconds: u64) -> Result<Client> {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(seconds))
        .build()
        .map_err(|_| "Could not start local AI.".into())
}
fn document(response: std::result::Result<Response, reqwest::Error>) -> Result<Value> {
    let response = response
        .map_err(|_| "Could not reach the local model server. Check Local AI in Settings.")?;
    if !response.status().is_success() {
        return Err(format!("The local model server returned HTTP {}. Check that the model is installed and the server is running.",response.status().as_u16()));
    }
    let mut raw = Vec::new();
    response
        .take(524289)
        .read_to_end(&mut raw)
        .map_err(|_| "Could not read local model output.")?;
    if raw.len() > 524288 {
        return Err("Local model output was too large.".into());
    }
    serde_json::from_slice(&raw).map_err(|_| "Local model returned invalid JSON.".into())
}
pub fn status(db: &Database) -> Result<LocalStatus> {
    let client = client(3)?;
    let response = document(client.get("http://127.0.0.1:11434/api/tags").send());
    let available = response.is_ok();
    let models = response
        .ok()
        .and_then(|v| v["models"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|m| m["name"].as_str())
        .filter(|name| !name.contains("cloud"))
        .map(str::to_owned)
        .collect();
    let model = db
        .lock()
        .map_err(|_| "Workspace unavailable.")?
        .preference("local_ai_model")
        .unwrap_or_default();
    let speech_model = speech_engine(db)?;
    let speech_available = match speech_model {
        SpeechEngine::Whisper => client
            .get("http://127.0.0.1:8080/")
            .send()
            .is_ok_and(|r| r.status().is_success()),
        SpeechEngine::Phonon2 => document(client.get("http://127.0.0.1:8010/health").send())
            .is_ok_and(|value| phonon_health(&value)),
    };
    Ok(LocalStatus {
        models,
        model,
        ollama_available: available,
        speech_model,
        speech_available,
    })
}
pub fn configure(db: &Database, model: String) -> Result<()> {
    if model.len() > 200 || model.trim().is_empty() || model.contains("cloud") {
        return Err("Choose an installed local model.".into());
    }
    db.lock()
        .map_err(|_| "Workspace unavailable.")?
        .put_preference("local_ai_model", &model)
}
fn allowed(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if name.starts_with('.')
        || [
            "secret",
            "credential",
            "token",
            "password",
            "package-lock",
            "cargo.lock",
        ]
        .iter()
        .any(|s| name.contains(s))
    {
        return false;
    }
    if name == "readme" || name == "license" {
        return true;
    }
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "txt"
            | "md"
            | "mdx"
            | "rs"
            | "py"
            | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "html"
            | "css"
            | "toml"
            | "yaml"
            | "yml"
            | "csv"
            | "java"
            | "c"
            | "cpp"
            | "h"
            | "go"
            | "swift"
    )
}
pub fn collect(paths: Vec<std::path::PathBuf>, cache: &ContextStore) -> Result<ContextResult> {
    let mut stack = paths
        .into_iter()
        .map(|p| {
            (
                p.clone(),
                p.parent().unwrap_or(Path::new("")).to_path_buf(),
                0,
            )
        })
        .collect::<Vec<_>>();
    let mut items = vec![];
    let mut skipped = 0;
    let mut visited = 0;
    let mut total = 0;
    while let Some((path, root, depth)) = stack.pop() {
        visited += 1;
        if visited > 2000 || items.len() >= 20 || total >= 60000 {
            skipped += stack.len() + 1;
            break;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            skipped += 1;
            continue;
        };
        if meta.file_type().is_symlink() {
            skipped += 1;
            continue;
        }
        if meta.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if depth >= 5
                || (depth > 0 && name.starts_with('.'))
                || [
                    "node_modules",
                    "target",
                    "dist",
                    "build",
                    "out",
                    "vendor",
                    "venv",
                ]
                .contains(&name)
            {
                skipped += 1;
                continue;
            }
            if let Ok(entries) = std::fs::read_dir(&path) {
                let mut children = entries
                    .filter_map(|e| e.ok().map(|e| e.path()))
                    .take(2001)
                    .collect::<Vec<_>>();
                children.sort();
                for child in children.into_iter().rev() {
                    stack.push((child, root.clone(), depth + 1));
                }
            }
            continue;
        }
        if !meta.is_file() || meta.len() > 128000 || !allowed(&path) {
            skipped += 1;
            continue;
        }
        let Ok(file) = std::fs::File::open(&path) else {
            skipped += 1;
            continue;
        };
        let mut raw = Vec::new();
        if file.take(128001).read_to_end(&mut raw).is_err() || raw.len() > 128000 {
            skipped += 1;
            continue;
        }
        let Ok(mut text) = String::from_utf8(raw) else {
            skipped += 1;
            continue;
        };
        if text.contains('\0') {
            skipped += 1;
            continue;
        }
        let cap = 6000usize.min(60000 - total);
        let truncated = text.len() > cap;
        if truncated {
            let mut end = cap;
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
        }
        total += text.len();
        items.push(ContextItem {
            id: uuid::Uuid::new_v4().to_string(),
            name: path
                .strip_prefix(&root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned(),
            text,
            truncated,
        });
    }
    let mut cache = cache.lock().map_err(|_| "Context unavailable.")?;
    if cache.len() + items.len() > 20
        || cache.values().map(|item| item.text.len()).sum::<usize>() + total > 60000
    {
        return Err("Remove some attached files first (20 files / 60 KB maximum).".into());
    }
    for item in &items {
        cache.insert(item.id.clone(), item.clone());
    }
    Ok(ContextResult { items, skipped })
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub scheduling: crate::task_scheduling::TaskScheduling,
    pub estimated_fields: Vec<String>,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub estimate_minutes: i64,
    pub tag_ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Drafts {
    tasks: Vec<Draft>,
}
pub fn validate_drafts(raw: &str, tag_ids: &[String]) -> Result<Vec<Draft>> {
    if raw.len() > 524288 {
        return Err("The model returned too much text.".into());
    }
    let value: serde_json::Value = serde_json::from_str(raw).map_err(|_| "Invalid draft JSON.")?;
    let contract: serde_json::Value =
        serde_json::from_str(include_str!("../../lib/capture-contract.json")).unwrap();
    crate::task_scheduling::check_contract(&value, &contract["schema"])?;
    let parsed: Drafts = serde_json::from_str(raw).map_err(|_| {
        "The model did not produce valid task drafts. Try a clearer request or another local model."
    })?;
    if parsed.tasks.is_empty() || parsed.tasks.len() > 10 {
        return Err("The model must propose 1–10 tasks.".into());
    }
    let mut titles = std::collections::HashSet::new();
    for d in &parsed.tasks {
        if !titles.insert(d.title.trim().to_lowercase()) {
            return Err("The model repeated a task.".into());
        }
        d.scheduling.validate(d.estimate_minutes)?;
        for dep in &d.scheduling.dependencies {
            if dep
                .strip_prefix("draft:")
                .and_then(|n| n.parse::<usize>().ok())
                .is_none_or(|n| n >= parsed.tasks.len())
            {
                return Err("Unknown draft dependency.".into());
            }
        }

        if d.title.trim().is_empty()
            || d.title.chars().count() > 200
            || d.description.chars().count() > 4000
            || !["low", "medium", "high"].contains(&d.priority.as_str())
            || !(5..=1440).contains(&d.estimate_minutes)
            || d.tag_ids.len() > 20
            || d.tag_ids.iter().any(|id| !tag_ids.contains(id))
        {
            return Err("The model proposed invalid task details. Nothing was saved.".into());
        }
        if let Some(date) = &d.due_date {
            if date.len() != 10 || chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
                return Err("The model proposed an invalid deadline.".into());
            }
        }
        let unique: std::collections::HashSet<_> = d.tag_ids.iter().collect();
        if unique.len() != d.tag_ids.len() {
            return Err("The model repeated a tag.".into());
        }
    }
    Ok(parsed.tasks)
}
pub(crate) fn capture_messages(
    text: &str,
    context: &[serde_json::Value],
    calendar_context: &[serde_json::Value],
    today: &str,
    time_zone: &str,
    now: &str,
    tags: &[serde_json::Value],
) -> Result<Vec<serde_json::Value>> {
    let contract: serde_json::Value =
        serde_json::from_str(include_str!("../../lib/capture-contract.json")).unwrap();
    let zone: chrono_tz::Tz = time_zone
        .parse()
        .map_err(|_| "Invalid capture time zone.")?;
    use chrono::Datelike;
    let date =
        chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d").map_err(|_| "Invalid local date.")?;
    let upcoming_dates = (0..8).map(|i| {let d=date+chrono::Duration::days(i);json!({"weekday":contract["weekdayNames"][d.weekday().num_days_from_monday() as usize],"date":d.to_string()})}).collect::<Vec<_>>();
    let date_context = json!({"now":now,"today":today,"tomorrow":(date+chrono::Duration::days(1)).to_string(),"timeZone":zone.to_string(),"upcomingDates":upcoming_dates});
    let prompt = format!(
        "{}\nDate context: {}\nActive tags: {}.",
        contract["instructions"].as_str().unwrap(),
        date_context,
        serde_json::to_string(&tags).unwrap()
    );
    let mut messages = vec![json!({"role":"system","content":prompt})];
    for example in contract["examples"].as_array().unwrap() {
        messages.push(json!({"role":"user","content":json!({"request":example["request"],"fileExcerpts":[],"calendarContext":[]}).to_string()}));
        let mut tasks = example["tasks"].clone();
        for task in tasks.as_array_mut().unwrap() {
            task["scheduling"]["timeZone"] = json!(zone.to_string());
        }
        messages.push(json!({"role":"assistant","content":json!({"tasks":tasks}).to_string()}));
    }
    messages.push(json!({"role":"user","content":json!({"request":text,"fileExcerpts":context,"calendarContext":calendar_context}).to_string()}));
    Ok(messages)
}
pub fn extract(
    db: &Database,
    cache: &ContextStore,
    text: String,
    context_ids: Vec<String>,
    today: String,
    time_zone: String,
    now: String,
    calendar_ids: Vec<String>,
) -> Result<Vec<Draft>> {
    if text.trim().is_empty()
        || text.len() > 12000
        || context_ids.len() > 20
        || today.len() != 10
        || chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").is_err()
    {
        return Err("Enter a request under 12,000 characters and a valid local date.".into());
    }
    let _: chrono_tz::Tz = time_zone
        .parse()
        .map_err(|_| "Invalid capture time zone.")?;
    crate::task_scheduling::instant(&now)?;
    if calendar_ids.len() > 20
        || calendar_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != calendar_ids.len()
    {
        return Err("Choose up to 20 calendar events.".into());
    }
    let (model, tags, calendar_context) = {
        let store = db.lock().map_err(|_| "Workspace unavailable.")?;
        (
            store
                .preference("local_ai_model")
                .ok_or("Choose a local model in Settings first.")?,
            store
                .tags()?
                .into_iter()
                .filter(|t| t.deleted_at.is_none())
                .take(100)
                .map(|t| json!({"id":t.id,"name":t.name}))
                .collect::<Vec<_>>(),
            {
                let events = store.events()?;
                calendar_ids.iter().map(|id| {let e=events.iter().find(|e|&e.id==id && e.deleted_at.is_none()).ok_or("A selected calendar event is no longer available.")?; Ok(json!({"id":e.id,"title":e.title,"start":e.start,"end":e.end,"allDay":e.all_day,"timeZone":e.time_zone}))}).collect::<Result<Vec<_>>>()?
            },
        )
    };
    let contexts = {
        let cache = cache.lock().map_err(|_| "Context unavailable.")?;
        context_ids
            .iter()
            .map(|id| {
                cache
                    .get(id)
                    .cloned()
                    .ok_or("An attachment expired. Select it again.".to_string())
            })
            .collect::<Result<Vec<_>>>()?
    };
    if contexts.iter().map(|c| c.text.len()).sum::<usize>()
        + text.len()
        + calendar_context
            .iter()
            .map(|e| e.to_string().len())
            .sum::<usize>()
        > 24000
    {
        return Err(
            "Select fewer excerpts or shorten your request (24 KB input limit). Nothing was saved."
                .into(),
        );
    }
    let client = client(180)?;
    let details = document(
        client
            .post("http://127.0.0.1:11434/api/show")
            .json(&json!({"model":model}))
            .send(),
    )?;
    if model.contains("cloud")
        || details
            .get("remote_host")
            .is_some_and(|v| !v.is_null() && v.as_str() != Some(""))
        || details
            .get("remote_model")
            .is_some_and(|v| !v.is_null() && v.as_str() != Some(""))
        || details["model_info"]
            .as_object()
            .is_none_or(|o| o.is_empty())
    {
        return Err("Use a downloaded local model, not an Ollama cloud model.".into());
    }
    let contract: serde_json::Value =
        serde_json::from_str(include_str!("../../lib/capture-contract.json")).unwrap();
    let schema = &contract["schema"];
    let context = contexts
        .iter()
        .map(|c| json!({"file":c.name,"excerpt":c.text}))
        .collect::<Vec<_>>();
    let ids = tags
        .iter()
        .filter_map(|t| t["id"].as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    let mut messages = capture_messages(
        &text,
        &context,
        &calendar_context,
        &today,
        &time_zone,
        &now,
        &tags,
    )?;
    for attempt in 0..2 {
        let result = document(client.post("http://127.0.0.1:11434/api/chat").json(&json!({"model":model,"stream":false,"think":false,"format":schema,"options":{"temperature":0,"num_ctx":32768,"num_predict":6144},"messages":messages})).send())?;
        let validated = validate_drafts(result["message"]["content"].as_str().unwrap_or(""), &ids)
            .and_then(|drafts| {
                crate::capture_resolution::resolve(
                    drafts,
                    &text,
                    &today,
                    &time_zone,
                    &calendar_context,
                )
            })
            .and_then(|drafts| {
                validate_drafts(
                    &serde_json::to_string(&serde_json::json!({"tasks":drafts})).unwrap(),
                    &ids,
                )
            });
        match validated {
            Ok(drafts) => return Ok(drafts),
            Err(error) if attempt == 0 => messages.push(json!({"role":"user","content":format!("Your response did not pass validation. Return the original requested tasks again using every required schema field. Validation: {error}")})),
            Err(error) => return Err(error),
        }
    }
    Err("No valid task drafts returned.".into())
}

pub fn transcribe(audio: String, engine: SpeechEngine) -> Result<String> {
    if audio.len() > 6000000 {
        return Err("Keep recordings under 90 seconds.".into());
    }
    let bytes = STANDARD
        .decode(audio)
        .map_err(|_| "Invalid audio recording.")?;
    if bytes.len() < 44
        || &bytes[0..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
        || &bytes[12..16] != b"fmt "
        || u16::from_le_bytes([bytes[20], bytes[21]]) != 1
        || u16::from_le_bytes([bytes[22], bytes[23]]) != 1
        || u32::from_le_bytes(bytes[24..28].try_into().unwrap()) != 16000
        || u16::from_le_bytes([bytes[34], bytes[35]]) != 16
    {
        return Err("Record mono 16 kHz WAV audio.".into());
    }
    let part = multipart::Part::bytes(bytes)
        .file_name("capture.wav")
        .mime_str("audio/wav")
        .map_err(|_| "Invalid audio format.")?;
    let mut form = multipart::Form::new()
        .part("file", part)
        .text("response_format", "json");
    if engine == SpeechEngine::Phonon2 {
        // The server rejects other models rather than silently substituting one.
        form = form.text("model", "phonon-2");
    }
    let result = document(client(180)?.post(engine.endpoint()).multipart(form).send())?;
    let text = result["text"]
        .as_str()
        .ok_or("The selected speech model returned no transcript.")?
        .trim();
    if text.is_empty() || text.len() > 12000 {
        return Err("No usable speech was detected. Try again or type your request.".into());
    }
    Ok(text.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn speech_selection_is_explicit_persistent_and_has_fixed_endpoints() {
        let db = Arc::new(Mutex::new(
            crate::workspace::Store::open(Path::new(":memory:")).unwrap(),
        ));
        assert_eq!(speech_engine(&db).unwrap(), SpeechEngine::Whisper);
        configure_speech(&db, SpeechEngine::Phonon2).unwrap();
        assert_eq!(speech_engine(&db).unwrap(), SpeechEngine::Phonon2);
        assert_eq!(
            SpeechEngine::Phonon2.endpoint(),
            "http://127.0.0.1:8010/v1/audio/transcriptions"
        );
        assert_eq!(
            SpeechEngine::Whisper.endpoint(),
            "http://127.0.0.1:8080/inference"
        );
        assert!(serde_json::from_str::<SpeechEngine>("\"remote\"").is_err());
        assert!(phonon_health(
            &json!({"status":"ok","kind":"speech","model":"FermionResearch/Phonon-2"})
        ));
        assert!(!phonon_health(
            &json!({"status":"ok","kind":"speech","model":"FermionResearch/Phonon-1"})
        ));
        assert!(!phonon_health(
            &json!({"status":"ok","kind":"chat","model":"phonon-2"})
        ));
        configure_speech(&db, SpeechEngine::Whisper).unwrap();
        assert_eq!(speech_engine(&db).unwrap(), SpeechEngine::Whisper);
        assert!(transcribe("eA==".into(), SpeechEngine::Phonon2).is_err());
    }
    #[test]
    #[ignore = "Requires a local Phonon 2 server on port 8010 and a public PCM WAV fixture"]
    fn live_phonon_transcribes_public_speech() {
        let fixture = std::env::var("DAYMARK_SPEECH_FIXTURE")
            .expect("Set DAYMARK_SPEECH_FIXTURE to a public 16 kHz mono PCM WAV");
        assert!(phonon_health(
            &document(
                client(3)
                    .unwrap()
                    .get("http://127.0.0.1:8010/health")
                    .send()
            )
            .unwrap()
        ));
        let text = transcribe(
            STANDARD.encode(std::fs::read(fixture).unwrap()),
            SpeechEngine::Phonon2,
        )
        .unwrap();
        assert!(text.to_lowercase().contains("country"));
        assert!(text.to_lowercase().contains("ask"));
    }
    #[test]
    #[ignore = "Requires installed local models and a public speech fixture"]
    fn live_local_models_create_drafts_and_transcribe_speech() {
        let store = crate::workspace::Store::open(Path::new(":memory:")).unwrap();
        store.put_preference("local_ai_model", "qwen3:4b").unwrap();
        let db = Arc::new(Mutex::new(store));
        let contexts = ContextStore::default();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("assignment.md"),
            "Algorithms homework covers binary trees and graph traversal.",
        )
        .unwrap();
        let files = collect(vec![dir.path().join("assignment.md")], &contexts).unwrap();
        let drafts=extract(&db,&contexts,"Create two tasks: finish my algorithms assignment by tomorrow, estimated 90 minutes, high priority; and practice coding for 30 minutes with no deadline. Use the assignment file for the first task notes.".into(),files.items.iter().map(|i|i.id.clone()).collect(),"2026-10-15".into(),"America/Los_Angeles".into(),"2026-10-15T08:00:00-07:00".into(),vec![]).unwrap();
        assert_eq!(drafts.len(), 2);
        assert!(drafts
            .iter()
            .any(|d| d.due_date.as_deref() == Some("2026-10-16") && d.estimate_minutes == 90));
        let path = std::env::var("DAYMARK_SPEECH_FIXTURE")
            .expect("Set DAYMARK_SPEECH_FIXTURE to public jfk.wav");
        let transcript = transcribe(
            STANDARD.encode(std::fs::read(path).unwrap()),
            SpeechEngine::Whisper,
        )
        .unwrap();
        assert!(transcript.to_lowercase().contains("country"));
    }
    #[test]
    #[ignore = "Requires installed qwen3:4b and the local Ollama server"]
    fn live_local_text_capture_resolves_explicit_constraints() {
        let store = crate::workspace::Store::open(Path::new(":memory:")).unwrap();
        store.put_preference("local_ai_model", "qwen3:4b").unwrap();
        let db = Arc::new(Mutex::new(store));
        let drafts = extract(
            &db,
            &ContextStore::default(),
            "Study for 50 minutes. Prefer evenings but never after 8 pm.".into(),
            vec![],
            "2026-10-15".into(),
            "America/Los_Angeles".into(),
            "2026-10-15T08:00:00-07:00".into(),
            vec![],
        )
        .unwrap();
        assert_eq!(drafts.len(), 1);
        let d = &drafts[0];
        assert_eq!(d.estimate_minutes, 50);
        assert_eq!(d.estimated_fields, vec!["priority"]);
        assert!(d.scheduling.unresolved.is_empty());
        assert_eq!(d.scheduling.allowed_windows[0].start, "00:00");
        assert_eq!(d.scheduling.allowed_windows[0].end, "20:00");
        assert_eq!(
            d.scheduling.allowed_windows[0].days,
            vec![1, 2, 3, 4, 5, 6, 7]
        );
        assert_eq!(d.scheduling.preferred_windows[0].start, "18:00");
        assert_eq!(d.scheduling.preferred_windows[0].end, "20:00");
        assert!(db.lock().unwrap().snapshot().unwrap().tasks.is_empty());
    }
    #[test]
    fn rejects_hallucinated_tags_and_invalid_dates() {
        let mut value = serde_json::json!({"tasks":[{"title":"Study","description":"","priority":"high","dueDate":null,"estimateMinutes":30,"tagIds":["a"],"estimatedFields":[],"scheduling":serde_json::from_str::<serde_json::Value>(include_str!("../../tests/fixtures/capture-defaults.json")).unwrap()}]});
        let valid = value.to_string();
        assert!(validate_drafts(&valid, &["a".into()]).is_ok());
        assert!(validate_drafts(&valid, &[]).is_err());
        value["tasks"][0]["dueDate"] = serde_json::json!("2026-02-30");
        assert!(validate_drafts(&value.to_string(), &["a".into()]).is_err());
        assert!(transcribe("eA==".into(), SpeechEngine::Whisper).is_err());
    }
    #[test]
    fn context_limits_and_exclusions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("lesson.md"), "Study trees").unwrap();
        std::fs::write(dir.path().join("credentials.txt"), "secret").unwrap();
        std::fs::create_dir(dir.path().join("node_modules")).unwrap();
        std::fs::write(dir.path().join("node_modules/hidden.md"), "skip").unwrap();
        let cache = Arc::new(Mutex::new(HashMap::new()));
        let result = collect(vec![dir.path().to_owned()], &cache).unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].text, "Study trees");
        assert!(result.skipped >= 2);
    }
}

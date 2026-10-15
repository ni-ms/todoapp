//! Explicit opt-in Google publishing. Tokens are stored in the OS credential store.
//! Only app-created calendar entries and the app's private Drive folder are accessed.
use crate::{
    calendar::CalendarEvent,
    workspace::{sql_error, Result, Workspace},
    Database,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{NaiveDate, Utc};
use reqwest::{
    blocking::{Client, Response},
    StatusCode,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri_plugin_opener::OpenerExt;

pub type GoogleLock = Arc<Mutex<()>>;
const SCOPES:&str="openid email https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/drive.appdata";
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    pub configured: bool,
    pub connected: bool,
    pub automatic: bool,
    pub last_sync: Option<String>,
    pub error: Option<String>,
}
#[derive(Deserialize)]
pub struct DesktopConfig {
    pub installed: InstalledClient,
}
#[derive(Deserialize)]
pub struct InstalledClient {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
}
fn credential(name: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("com.nikms.todoapp.google", name)
        .map_err(|_| "Your OS credential store is unavailable.".into())
}
fn read_secret(name: &str) -> Result<Option<String>> {
    match credential(name)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => {
            Err("Your OS credential store could not be read. Unlock it and try again.".into())
        }
    }
}
fn secret(name: &str, value: &str) -> Result<()> {
    credential(name)?
        .set_password(value)
        .map_err(|_| "Could not save Google credentials in your OS credential store.".into())
}
fn db<T>(database: &Database, f: impl FnOnce(&crate::workspace::Store) -> Result<T>) -> Result<T> {
    let guard = database.lock().map_err(|_| "Workspace is unavailable.")?;
    f(&guard)
}
fn pref(database: &Database, key: &str) -> Option<String> {
    database.lock().ok().and_then(|s| s.preference(key))
}
fn put(database: &Database, key: &str, value: &str) -> Result<()> {
    db(database, |s| s.put_preference(key, value))
}
pub fn status(database: &Database) -> Result<GoogleStatus> {
    Ok(GoogleStatus {
        configured: pref(database, "google_client_id").is_some(),
        connected: pref(database, "google_connected").as_deref() == Some("1"),
        automatic: pref(database, "google_auto").as_deref() == Some("1"),
        last_sync: pref(database, "google_at").filter(|v| !v.is_empty()),
        error: pref(database, "google_error").filter(|v| !v.is_empty()),
    })
}
pub fn configure(database: &Database, content: &str) -> Result<GoogleStatus> {
    let config = parse_config(content)?;
    if status(database)?.connected {
        return Err("Disconnect Google before changing its sign-in configuration.".into());
    }
    secret("client-secret", &config.client_secret)?;
    if pref(database, "google_client_id").as_deref() != Some(&config.client_id) {
        reset_remote_state(database)?;
        put(database, "google_account", "")?;
    }
    put(database, "google_client_id", &config.client_id)?;
    status(database)
}
fn reset_remote_state(database: &Database) -> Result<()> {
    db(database, |s| {
        s.connection
            .execute("DELETE FROM google_event_state", [])
            .map_err(sql_error)?;
        for key in [
            "google_calendar_id",
            "google_drive_id",
            "google_digest",
            "google_at",
        ] {
            s.put_preference(key, "")?;
        }
        Ok(())
    })
}
// TCP can split a callback across packets. Bound the header size and read deadline.
fn request_target(reader: &mut impl Read) -> Result<String> {
    let mut request = Vec::new();
    let mut part = [0; 1024];
    while request.len() < 8192 {
        let size = reader
            .read(&mut part)
            .map_err(|_| "Incomplete sign-in callback.")?;
        if size == 0 {
            break;
        }
        request.extend_from_slice(&part[..size]);
        if request.windows(4).any(|v| v == b"\r\n\r\n") {
            return String::from_utf8_lossy(&request)
                .lines()
                .next()
                .and_then(|l| l.strip_prefix("GET "))
                .and_then(|l| l.split_whitespace().next())
                .map(str::to_owned)
                .ok_or("Invalid sign-in callback.".into());
        }
    }
    Err("Incomplete or oversized sign-in callback.".into())
}
pub fn parse_config(content: &str) -> Result<InstalledClient> {
    if content.len() > 65536 {
        return Err("Choose a Google Desktop OAuth client JSON file.".into());
    }
    let config: DesktopConfig = serde_json::from_str(content).map_err(|_| {
        "Choose the downloaded Desktop app OAuth client JSON, not a service-account key."
    })?;
    let c = config.installed;
    if !c.client_id.ends_with(".apps.googleusercontent.com")
        || c.client_id.len() > 256
        || c.client_secret.len() > 512
    {
        return Err("Invalid Google Desktop OAuth client.".into());
    }
    Ok(c)
}
fn client() -> Result<Client> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not start the Google connection.".into())
}
fn sent(response: std::result::Result<Response, reqwest::Error>) -> Result<Response> {
    let response = response.map_err(|_| {
        "Could not reach Google. Check your connection; your local changes are safe."
    })?;
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(match response.status(){StatusCode::UNAUTHORIZED=>"Google access expired. Disconnect and sign in again.".into(),StatusCode::FORBIDDEN=>"Google denied access. Check that Calendar and Drive APIs are enabled and permissions were granted.".into(),StatusCode::PRECONDITION_FAILED=>"An event was edited in Google and was left unchanged. To resume publishing, remove its Google copy and sync again; the local version will be republished if still active.".into(),StatusCode::TOO_MANY_REQUESTS=>"Google is busy. Sync will retry later.".into(),code=>format!("Google returned HTTP {}. Try again later.",code.as_u16())})
    }
}
fn document(response: std::result::Result<Response, reqwest::Error>) -> Result<Value> {
    sent(response)?
        .json()
        .map_err(|_| "Google returned an unreadable response.".into())
}
fn nonce() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn callback(query: &str, state: &str) -> Result<Option<String>> {
    let url = url::Url::parse(&format!("http://127.0.0.1{query}"))
        .map_err(|_| "Invalid sign-in response.")?;
    if url.path() != "/oauth/callback" {
        return Ok(None);
    }
    let p: HashMap<_, _> = url.query_pairs().into_owned().collect();
    if p.get("state").map(String::as_str) != Some(state) {
        return Ok(None);
    }
    if p.contains_key("error") {
        return Err("Google sign-in was cancelled or denied.".into());
    }
    let code = p
        .get("code")
        .filter(|s| !s.is_empty() && s.len() <= 4096)
        .ok_or("Google did not return a sign-in code.")?;
    Ok(Some(code.clone()))
}
pub fn connect(app: &tauri::AppHandle, database: &Database, zone: &str) -> Result<GoogleStatus> {
    zone.parse::<chrono_tz::Tz>()
        .map_err(|_| "Invalid time zone.")?;
    let id = pref(database, "google_client_id")
        .ok_or("Import a Google Desktop OAuth client JSON in Settings first.")?;
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|_| "Could not open a local sign-in callback.")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Could not start sign-in.")?;
    let redirect = format!(
        "http://127.0.0.1:{}/oauth/callback",
        listener
            .local_addr()
            .map_err(|_| "Could not start sign-in.")?
            .port()
    );
    let state = nonce();
    let verifier = nonce();
    let mut auth = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|_| "Could not start sign-in.")?;
    auth.query_pairs_mut().extend_pairs([
        ("client_id", id.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("response_type", "code"),
        ("scope", SCOPES),
        ("state", state.as_str()),
        ("code_challenge", challenge(&verifier).as_str()),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ]);
    app.opener()
        .open_url(auth.as_str(), None::<&str>)
        .map_err(|_| "Could not open your browser for Google sign-in.")?;
    let began = Instant::now();
    let code = loop {
        if began.elapsed() > Duration::from_secs(180) {
            return Err("Google sign-in timed out. Try again.".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                let target = match request_target(&mut stream) {
                    Ok(target) => target,
                    Err(_) => continue,
                };
                match callback(&target, &state) {
                    Ok(Some(code)) => {
                        let body =
                            "Sign-in received. You can close this tab and return to Daymark.";
                        let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
                        break code;
                    }
                    Err(e) => {
                        let _=stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        return Err(e);
                    }
                    Ok(None) => {
                        let _=stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(_) => return Err("The sign-in callback was interrupted.".into()),
        }
    };
    let client = client()?;
    let mut form = vec![
        ("client_id", id),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect),
        ("grant_type", "authorization_code".into()),
    ];
    if let Some(s) = read_secret("client-secret")?.filter(|s| !s.is_empty()) {
        form.push(("client_secret", s));
    }
    let token = document(
        client
            .post("https://oauth2.googleapis.com/token")
            .form(&form)
            .send(),
    )?;
    let refresh = token["refresh_token"]
        .as_str()
        .ok_or("Google did not grant offline access. Try signing in again with consent.")?;
    let access = token["access_token"]
        .as_str()
        .ok_or("Google did not return access permission.")?;
    let identity = document(
        client
            .get("https://openidconnect.googleapis.com/v1/userinfo")
            .bearer_auth(access)
            .send(),
    )?;
    let account = identity["sub"]
        .as_str()
        .ok_or("Google did not return an account identifier.")?;
    if pref(database, "google_account").as_deref() != Some(account) {
        reset_remote_state(database)?;
    }
    put(database, "google_account", account)?;
    secret("refresh-token", refresh)?;
    put(database, "google_zone", zone)?;
    put(database, "google_connected", "1")?;
    put(database, "google_auto", "1")?;
    put(database, "google_error", "")?;
    sync(database)
}
fn access_token(client: &Client, database: &Database) -> Result<String> {
    let id = pref(database, "google_client_id").ok_or("Google sign-in is not configured.")?;
    let refresh = read_secret("refresh-token")?.ok_or("Sign in to Google again.")?;
    let mut form = vec![
        ("client_id", id),
        ("refresh_token", refresh),
        ("grant_type", "refresh_token".into()),
    ];
    if let Some(s) = read_secret("client-secret")?.filter(|s| !s.is_empty()) {
        form.push(("client_secret", s));
    }
    let token = document(
        client
            .post("https://oauth2.googleapis.com/token")
            .form(&form)
            .send(),
    )?;
    token["access_token"]
        .as_str()
        .map(str::to_owned)
        .ok_or("Google did not return access permission.".into())
}
#[derive(Clone)]
struct RemoteState {
    id: String,
    revision: String,
    etag: String,
}
fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn entity_id(key: &str) -> String {
    format!("d{}", hex_digest(key.as_bytes()))
}
fn google_event(event: &CalendarEvent, key: &str) -> Value {
    let start = if event.all_day {
        json!({"date":event.start})
    } else {
        json!({"dateTime":event.start,"timeZone":event.time_zone})
    };
    let end = if event.all_day {
        json!({"date":event.end})
    } else {
        json!({"dateTime":event.end,"timeZone":event.time_zone})
    };
    json!({"summary":event.title,"description":event.description,"start":start,"end":end,"extendedProperties":{"private":{"daymarkKey":key}},"status":"confirmed"})
}
fn same_boundary(a: &Value, b: &Value) -> bool {
    match (a["date"].as_str(), b["date"].as_str()) {
        (Some(a), Some(b)) => a == b,
        (None, None) => match (a["dateTime"].as_str(), b["dateTime"].as_str()) {
            (Some(a), Some(b)) => match (
                chrono::DateTime::parse_from_rfc3339(a),
                chrono::DateTime::parse_from_rfc3339(b),
            ) {
                (Ok(a), Ok(b)) => a == b,
                _ => false,
            },
            _ => false,
        },
        _ => false,
    }
}
fn same_event(a: &Value, b: &Value) -> bool {
    a["summary"] == b["summary"]
        && a["description"].as_str().unwrap_or("") == b["description"].as_str().unwrap_or("")
        && a["status"].as_str().unwrap_or("confirmed") == "confirmed"
        && same_boundary(&a["start"], &b["start"])
        && same_boundary(&a["end"], &b["end"])
}
fn desired(workspace: &Workspace) -> HashMap<String, (String, Value)> {
    let mut result = HashMap::new();
    for e in workspace.events.iter().filter(|e| e.deleted_at.is_none()) {
        let key = format!("event-{}", e.id);
        result.insert(key.clone(), (e.updated_at.clone(), google_event(e, &key)));
    }
    for t in workspace
        .tasks
        .iter()
        .filter(|t| t.deleted_at.is_none() && t.status != "done")
    {
        if let Some(date) = t
            .due_date
            .as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        {
            if let Some(end) = date.succ_opt() {
                let key = format!("task-{}", t.id);
                result.insert(key.clone(),(t.updated_at.clone(),json!({"summary":format!("Due: {}",t.title),"description":t.description,"start":{"date":date.to_string()},"end":{"date":end.to_string()},"transparency":"transparent","extendedProperties":{"private":{"daymarkKey":key}},"status":"confirmed"})));
            }
        }
    }
    result
}
fn publish(client: &Client, token: &str, database: &Database, workspace: &Workspace) -> Result<()> {
    let calendar = if let Some(id) = pref(database, "google_calendar_id").filter(|s| !s.is_empty())
    {
        id
    } else {
        let zone = pref(database, "google_zone").unwrap_or_else(|| "UTC".into());
        let value=document(client.post("https://www.googleapis.com/calendar/v3/calendars").bearer_auth(token).json(&json!({"summary":"Daymark","description":"Events published from Daymark. Edit the originals in Daymark.","timeZone":zone})).send())?;
        let id = value["id"]
            .as_str()
            .ok_or("Could not create a Daymark calendar.")?
            .to_string();
        put(database, "google_calendar_id", &id)?;
        id
    };
    let encoded = url::form_urlencoded::byte_serialize(calendar.as_bytes()).collect::<String>();
    let base = format!("https://www.googleapis.com/calendar/v3/calendars/{encoded}/events");
    let states: HashMap<String, RemoteState> = db(database, |s| {
        s.connection
            .prepare("SELECT entity_key,google_id,revision,etag FROM google_event_state")
            .map_err(sql_error)?
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    RemoteState {
                        id: r.get(1)?,
                        revision: r.get(2)?,
                        etag: r.get(3)?,
                    },
                ))
            })
            .map_err(sql_error)?
            .collect::<std::result::Result<HashMap<_, _>, _>>()
            .map_err(sql_error)
    })?;
    let desired = desired(workspace);
    for (key, state) in states.iter().filter(|(key, _)| !desired.contains_key(*key)) {
        let response = client
            .delete(format!("{base}/{}", state.id))
            .bearer_auth(token)
            .header("If-Match", &state.etag)
            .send()
            .map_err(|_| "Could not reach Google Calendar.")?;
        if response.status() != StatusCode::NOT_FOUND && response.status() != StatusCode::GONE {
            sent(Ok(response))?;
        }
        db(database, |s| {
            s.connection
                .execute("DELETE FROM google_event_state WHERE entity_key=?1", [key])
                .map_err(sql_error)?;
            Ok(())
        })?;
    }
    for (key, (revision, mut value)) in desired {
        let previous = states.get(&key);
        if previous.is_some_and(|s| s.revision == revision) {
            continue;
        }
        let id = previous
            .map(|s| s.id.clone())
            .unwrap_or_else(|| entity_id(&key));
        let mut response = if let Some(state) = previous {
            client
                .patch(format!("{base}/{id}"))
                .bearer_auth(token)
                .header("If-Match", &state.etag)
                .json(&value)
                .send()
        } else {
            value["id"] = json!(id);
            client.post(&base).bearer_auth(token).json(&value).send()
        };
        if previous.is_none()
            && response
                .as_ref()
                .is_ok_and(|r| r.status() == StatusCode::CONFLICT)
        {
            let remote = document(client.get(format!("{base}/{id}")).bearer_auth(token).send())?;
            if remote["extendedProperties"]["private"]["daymarkKey"] != key {
                return Err(
                    "A Google event ID collision was detected; no event was changed.".into(),
                );
            }
            if !same_event(&remote, &value) {
                return Err("This event already exists in Google with different details. It was left unchanged.".into());
            }
            save_state(
                database,
                &key,
                &id,
                &revision,
                remote["etag"]
                    .as_str()
                    .ok_or("Google did not return an event version.")?,
            )?;
            continue;
        }
        // If a user removed a published event, a new local edit may publish a fresh copy.
        if previous.is_some()
            && response.as_ref().is_ok_and(|r| {
                r.status() == StatusCode::NOT_FOUND || r.status() == StatusCode::GONE
            })
        {
            let new_id = entity_id(&format!("{key}-{revision}"));
            value["id"] = json!(new_id);
            response = client.post(&base).bearer_auth(token).json(&value).send();
        }
        let remote = document(response).map_err(|error| {
            format!(
                "{}: {error}",
                value["summary"].as_str().unwrap_or("Calendar event")
            )
        })?;
        let actual_id = remote["id"]
            .as_str()
            .ok_or("Google did not return an event ID.")?;
        let etag = remote["etag"]
            .as_str()
            .ok_or("Google did not return an event version.")?;
        save_state(database, &key, actual_id, &revision, etag)?;
    }
    Ok(())
}
fn save_state(database: &Database, key: &str, id: &str, revision: &str, etag: &str) -> Result<()> {
    db(database, |s| {
        s.connection.execute("INSERT INTO google_event_state(entity_key,google_id,revision,etag) VALUES(?1,?2,?3,?4) ON CONFLICT(entity_key) DO UPDATE SET google_id=excluded.google_id,revision=excluded.revision,etag=excluded.etag",params![key,id,revision,etag]).map_err(sql_error)?;
        Ok(())
    })
}
fn drive_backup(
    client: &Client,
    token: &str,
    database: &Database,
    workspace: &Workspace,
) -> Result<()> {
    let raw = serde_json::to_string(workspace).map_err(|_| "Could not prepare Drive backup.")?;
    let digest = hex_digest(raw.as_bytes());
    if pref(database, "google_digest").as_deref() == Some(&digest) {
        return Ok(());
    }
    let device = if let Some(id) = pref(database, "device_id") {
        id
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        put(database, "device_id", &id)?;
        id
    };
    let name = format!("daymark-{device}.json");
    let mut id = pref(database, "google_drive_id").filter(|s| !s.is_empty());
    if id.is_none() {
        let files = document(
            client
                .get("https://www.googleapis.com/drive/v3/files")
                .bearer_auth(token)
                .query(&[
                    ("spaces", "appDataFolder"),
                    ("q", &format!("name='{name}' and trashed=false")),
                    ("fields", "files(id)"),
                ])
                .send(),
        )?;
        id = files["files"]
            .as_array()
            .and_then(|v| v.first())
            .and_then(|v| v["id"].as_str())
            .map(str::to_owned);
    }
    let payload=json!({"format":"daymark-workspace","version":2,"exportedAt":Utc::now().to_rfc3339(),"areas":workspace.areas,"courses":workspace.courses,"tasks":workspace.tasks,"events":workspace.events,"tags":workspace.tags}).to_string();
    let mut response = if let Some(id) = &id {
        Some(
            client
                .patch(format!(
                    "https://www.googleapis.com/upload/drive/v3/files/{id}?uploadType=media"
                ))
                .bearer_auth(token)
                .header("Content-Type", "application/json")
                .body(payload.clone())
                .send(),
        )
    } else {
        None
    };
    if response.as_ref().is_some_and(|r| {
        r.as_ref()
            .is_ok_and(|r| r.status() == StatusCode::NOT_FOUND || r.status() == StatusCode::GONE)
    }) {
        response = None;
    }
    let response = if let Some(response) = response {
        response
    } else {
        let boundary = nonce();
        let metadata =
            json!({"name":name,"parents":["appDataFolder"],"mimeType":"application/json"});
        let body=format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{payload}\r\n--{boundary}--\r\n");
        client
            .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
            .bearer_auth(token)
            .header(
                "Content-Type",
                format!("multipart/related; boundary={boundary}"),
            )
            .body(body)
            .send()
    };
    let response = document(response)?;
    if let Some(id) = response["id"].as_str() {
        put(database, "google_drive_id", id)?;
    }
    put(database, "google_digest", &digest)
}
pub fn sync(database: &Database) -> Result<GoogleStatus> {
    if !status(database)?.connected {
        return Err("Sign in to Google first.".into());
    }
    let run = (|| -> Result<()> {
        let client = client()?;
        let token = access_token(&client, database)?;
        let workspace = db(database, |s| s.snapshot())?;
        let published = publish(&client, &token, database, &workspace);
        drive_backup(&client, &token, database, &workspace)?;
        published?;
        put(database, "google_at", &Utc::now().to_rfc3339())?;
        put(database, "google_error", "")
    })();
    if let Err(error) = run {
        put(database, "google_error", &error)?;
    }
    status(database)
}
pub fn disconnect(database: &Database) -> Result<GoogleStatus> {
    if let Ok(entry) = credential("refresh-token") {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => {
                return Err("Could not remove Google access from the OS credential store.".into())
            }
        }
    }
    put(database, "google_connected", "0")?;
    put(database, "google_auto", "0")?;
    put(database, "google_error", "")?;
    status(database)
}
pub fn automatic(database: &Database, enabled: bool) -> Result<GoogleStatus> {
    put(database, "google_auto", if enabled { "1" } else { "0" })?;
    status(database)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_oauth_state_and_config() {
        assert_eq!(
            callback("/oauth/callback?code=a&state=right", "wrong").unwrap(),
            None
        );
        assert_eq!(
            callback("/oauth/callback?code=a&state=right", "right").unwrap(),
            Some("a".into())
        );
        assert!(callback("/oauth/callback?error=access_denied&state=s", "s").is_err());
        assert!(parse_config(r#"{"type":"service_account","private_key":"x"}"#).is_err());
        assert!(parse_config(
            r#"{"installed":{"client_id":"123.apps.googleusercontent.com","client_secret":"x"}}"#
        )
        .is_ok());
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn callback_accepts_fragmented_headers_and_rejects_oversized_input() {
        struct Fragments(std::io::Cursor<Vec<u8>>);
        impl Read for Fragments {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.0.read(&mut buf[..1])
            }
        }
        let mut input = Fragments(std::io::Cursor::new(
            b"GET /oauth/callback?code=x&state=y HTTP/1.1\r\nHost: localhost\r\n\r\n".to_vec(),
        ));
        assert_eq!(
            request_target(&mut input).unwrap(),
            "/oauth/callback?code=x&state=y"
        );
        assert!(request_target(&mut std::io::Cursor::new(vec![b'x'; 9000])).is_err());
    }
    #[test]
    fn retries_accept_google_time_normalization_but_preserve_remote_edits() {
        let local = json!({"summary":"Study","description":"Trees", "start":{"dateTime":"2026-10-15T10:00:00-07:00","timeZone":"America/Los_Angeles"},"end":{"dateTime":"2026-10-15T11:00:00-07:00","timeZone":"America/Los_Angeles"}});
        let mut remote = json!({"summary":"Study","description":"Trees","status":"confirmed","start":{"dateTime":"2026-10-15T17:00:00Z"},"end":{"dateTime":"2026-10-15T18:00:00Z"}});
        assert!(same_event(&remote, &local));
        remote["end"]["dateTime"] = json!("2026-10-15T19:00:00Z");
        assert!(!same_event(&remote, &local));
        remote["end"]["dateTime"] = json!("2026-10-15T18:00:00Z");
        remote["description"] = json!("Remote notes");
        assert!(!same_event(&remote, &local));
        assert!(!same_boundary(
            &json!({"date":"2026-10-15"}),
            &local["start"]
        ));
    }
    #[test]
    fn stable_google_ids_use_supported_alphabet() {
        assert_eq!(entity_id("event-a"), entity_id("event-a"));
        assert_ne!(entity_id("event-a"), entity_id("event-b"));
        assert!(entity_id("event-a")
            .chars()
            .all(|c| matches!(c,'0'..='9'|'a'..='v')));
    }
}

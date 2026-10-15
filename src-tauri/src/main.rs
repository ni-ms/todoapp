// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod calendar;
mod google;
mod ical;
mod services;
mod todo_utils;
mod workspace;

use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use workspace::{CourseInput, Store, TaskInput, Workspace};

type Database = Arc<Mutex<Store>>;
async fn with_store<T: Send + 'static>(
    db: Database,
    operation: impl FnOnce(&Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = db
            .lock()
            .map_err(|_| "The workspace is unavailable. Restart the app.".to_string())?;
        operation(&store)
    })
    .await
    .map_err(|_| "The workspace operation was interrupted.".to_string())?
}
#[tauri::command]
async fn load_workspace(db: State<'_, Database>) -> Result<Workspace, String> {
    with_store(db.inner().clone(), |store| store.snapshot()).await
}
#[tauri::command]
async fn save_course(db: State<'_, Database>, input: CourseInput) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.save_course(input)).await
}
#[tauri::command]
async fn save_task(db: State<'_, Database>, input: TaskInput) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.save_task(input)).await
}
#[tauri::command]
async fn set_deleted(
    db: State<'_, Database>,
    entity: String,
    id: String,
    deleted: bool,
) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| {
        store.set_deleted(&entity, &id, deleted)
    })
    .await
}
#[tauri::command]
async fn export_workspace(
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<String, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|_| "Your Downloads folder is unavailable.".to_string())?;
    let filename = format!("daymark-{}.json", uuid::Uuid::new_v4());
    with_store(db.inner().clone(), move |store| {
        let snapshot = store.snapshot()?;
        let document = serde_json::json!({
            "format": "daymark-workspace", "version": 2,
            "exportedAt": chrono::Utc::now().to_rfc3339(),
            "courses": snapshot.courses, "tasks": snapshot.tasks, "tags":snapshot.tags, "events":snapshot.events,
        });
        let destination = downloads.join(filename);
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|_| "Could not create an export in Downloads.".to_string())?;
        serde_json::to_writer_pretty(&file, &document)
            .map_err(|_| "The export could not be written.".to_string())?;
        file.sync_all()
            .map_err(|_| "The export could not be saved.".to_string())?;
        Ok(destination.to_string_lossy().to_string())
    })
    .await
}
#[tauri::command]
async fn delete_tag(db: State<'_, Database>, id: String) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.delete_tag(&id)).await
}
#[tauri::command]
async fn save_tag(db: State<'_, Database>, input: calendar::TagInput) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.save_tag(input)).await
}
#[tauri::command]
async fn save_event(
    db: State<'_, Database>,
    input: calendar::EventInput,
) -> Result<Workspace, String> {
    with_store(db.inner().clone(), move |store| store.save_event(input)).await
}
#[tauri::command]
async fn export_calendar(app: tauri::AppHandle, db: State<'_, Database>) -> Result<String, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|_| "Downloads is unavailable.")?;
    with_store(db.inner().clone(), move |store| {
        let output = ical::calendar(&store.snapshot()?);
        let path = downloads.join(format!("daymark-calendar-{}.ics", uuid::Uuid::new_v4()));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "Could not create calendar export.")?;
        std::io::Write::write_all(&mut file, output.as_bytes())
            .map_err(|_| "Could not write calendar export.")?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
}
#[tauri::command]
async fn backup_status(db: State<'_, Database>) -> Result<backup::BackupStatus, String> {
    with_store(db.inner().clone(), |store| Ok(store.backup_status())).await
}
#[tauri::command]
async fn configure_backup(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    action: String,
) -> Result<backup::BackupStatus, String> {
    match action.as_str() {
        "choose" => {
            use tauri_plugin_dialog::DialogExt;
            let chosen = tauri::async_runtime::spawn_blocking(move || {
                app.dialog()
                    .file()
                    .set_title("Choose a Google Drive, Dropbox, or backup folder")
                    .blocking_pick_folder()
            })
            .await
            .map_err(|_| "Folder selection was interrupted.")?;
            if let Some(path) = chosen {
                let path = path.into_path().map_err(|_| "Choose a local folder.")?;
                with_store(db.inner().clone(), move |store| {
                    store.choose_backup_folder(&path)
                })
                .await
            } else {
                with_store(db.inner().clone(), |store| Ok(store.backup_status())).await
            }
        }
        "disable" => with_store(db.inner().clone(), |store| store.disable_backup()).await,
        "now" => with_store(db.inner().clone(), |store| store.run_backup(true)).await,
        _ => Err("Unknown backup action.".into()),
    }
}
#[tauri::command]
async fn google_status(db: State<'_, Database>) -> Result<google::GoogleStatus, String> {
    google::status(db.inner())
}
#[tauri::command]
async fn google_action(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    lock: State<'_, google::GoogleLock>,
    action: String,
    time_zone: Option<String>,
) -> Result<google::GoogleStatus, String> {
    let database = db.inner().clone();
    let lock = lock.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .try_lock()
            .map_err(|_| "A Google operation is already running.")?;
        match action.as_str() {
            "configure" => {
                use tauri_plugin_dialog::DialogExt;
                if let Some(file) = app
                    .dialog()
                    .file()
                    .set_title("Choose your Google Desktop OAuth client JSON")
                    .add_filter("OAuth client", &["json"])
                    .blocking_pick_file()
                {
                    let path = file.into_path().map_err(|_| "Choose a local JSON file.")?;
                    let meta = std::fs::metadata(&path)
                        .map_err(|_| "Could not read the Google configuration file.")?;
                    if meta.len() > 65536 {
                        return Err("Choose a Google Desktop OAuth client JSON file.".into());
                    }
                    let data = std::fs::read_to_string(path)
                        .map_err(|_| "Could not read the Google configuration file.")?;
                    google::configure(&database, &data)
                } else {
                    google::status(&database)
                }
            }
            "help" => {
                use tauri_plugin_opener::OpenerExt;
                app.opener()
                    .open_url(
                        "https://console.cloud.google.com/apis/credentials",
                        None::<&str>,
                    )
                    .map_err(|_| "Could not open Google Cloud.")?;
                google::status(&database)
            }
            "connect" => google::connect(&app, &database, time_zone.as_deref().unwrap_or("UTC")),
            "sync" => google::sync(&database),
            "disconnect" => google::disconnect(&database),
            "pause" => google::automatic(&database, false),
            "resume" => google::automatic(&database, true),
            _ => Err("Unknown Google connection action.".into()),
        }
    })
    .await
    .map_err(|_| "The Google operation was interrupted.".to_string())?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let store =
                Store::open(&directory.join("learner.sqlite3")).map_err(std::io::Error::other)?;
            let shared = Arc::new(Mutex::new(store));
            let backup_db = shared.clone();
            let google_lock: google::GoogleLock = Arc::new(Mutex::new(()));
            let background_google = google_lock.clone();
            app.manage(google_lock);
            std::thread::Builder::new()
                .name("daymark-backup".into())
                .spawn(move || loop {
                    if let Ok(store) = backup_db.lock() {
                        let _ = store.run_backup(false);
                    }
                    if google::status(&backup_db).is_ok_and(|s| s.connected && s.automatic) {
                        if let Ok(_guard) = background_google.try_lock() {
                            let _ = google::sync(&backup_db);
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(60));
                })?;
            app.manage(shared);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_course,
            save_task,
            set_deleted,
            export_workspace,
            save_tag,
            delete_tag,
            save_event,
            export_calendar,
            backup_status,
            configure_backup,
            google_status,
            google_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running learner workspace");
}

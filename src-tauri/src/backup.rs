use crate::workspace::{sql_error, Result, Store};
use rusqlite::params;
use serde::Serialize;
use std::{io::Write, path::Path};
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub folder: Option<String>,
    pub enabled: bool,
    pub last_backup: Option<String>,
    pub error: Option<String>,
}
impl Store {
    pub(crate) fn preference(&self, key: &str) -> Option<String> {
        self.connection
            .query_row("SELECT value FROM preferences WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .ok()
    }
    pub(crate) fn put_preference(&self, key: &str, value: &str) -> Result<()> {
        self.connection.execute("INSERT INTO preferences(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(sql_error)?;
        Ok(())
    }
    pub fn backup_status(&self) -> BackupStatus {
        BackupStatus {
            folder: self.preference("backup_folder"),
            enabled: self.preference("backup_enabled").as_deref() == Some("1"),
            last_backup: self.preference("backup_at"),
            error: self.preference("backup_error").filter(|s| !s.is_empty()),
        }
    }
    pub fn choose_backup_folder(&self, folder: &Path) -> Result<BackupStatus> {
        if !folder.is_dir() {
            return Err("Choose an existing folder.".into());
        }
        let path = folder.join("Daymark backups");
        std::fs::create_dir_all(&path)
            .map_err(|_| "Could not create a Daymark backups folder. Choose a writable folder.")?;
        self.put_preference("backup_folder", &path.to_string_lossy())?;
        self.put_preference("backup_enabled", "1")?;
        self.put_preference("backup_digest", "")?;
        self.run_backup(true)?;
        Ok(self.backup_status())
    }
    pub fn disable_backup(&self) -> Result<BackupStatus> {
        self.put_preference("backup_enabled", "0")?;
        Ok(self.backup_status())
    }
    pub fn run_backup(&self, force: bool) -> Result<BackupStatus> {
        let status = self.backup_status();
        if !status.enabled {
            return Ok(status);
        }
        let result = (|| -> Result<()> {
            let folder = status.folder.ok_or("Choose a backup folder first.")?;
            let folder = Path::new(&folder);
            if !folder.is_dir() {
                return Err(
                    "The backup folder is unavailable. Check that your cloud drive is mounted."
                        .into(),
                );
            }
            let snapshot = self.snapshot()?;
            let serialized =
                serde_json::to_string(&snapshot).map_err(|_| "Could not prepare backup.")?;
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            serialized.hash(&mut hasher);
            let digest = hasher.finish().to_string();
            let device = if let Some(id) = self.preference("device_id") {
                id
            } else {
                let id = uuid::Uuid::new_v4().to_string();
                self.put_preference("device_id", &id)?;
                id
            };
            let json_path = folder.join(format!("daymark-{device}.json"));
            let ics_path = folder.join(format!("daymark-{device}.ics"));
            if !force
                && self.preference("backup_digest").as_deref() == Some(&digest)
                && json_path.is_file()
                && ics_path.is_file()
            {
                self.put_preference("backup_error", "")?;
                return Ok(());
            }
            let document = serde_json::json!({"format":"daymark-workspace","version":2,"exportedAt":chrono::Utc::now().to_rfc3339(),"areas":snapshot.areas,"courses":snapshot.courses,"tasks":snapshot.tasks,"tags":snapshot.tags,"events":snapshot.events});
            let bytes =
                serde_json::to_vec_pretty(&document).map_err(|_| "Could not prepare backup.")?;
            atomic_write(&json_path, &bytes)?;
            atomic_write(&ics_path, crate::ical::calendar(&snapshot).as_bytes())?;
            self.put_preference("backup_digest", &digest)?;
            self.put_preference("backup_at", &chrono::Utc::now().to_rfc3339())?;
            self.put_preference("backup_error", "")?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = self.put_preference("backup_error", &error);
            return Err(error);
        }
        Ok(self.backup_status())
    }
}
fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    let directory = path.parent().ok_or("Invalid backup folder.")?;
    let mut file = tempfile::NamedTempFile::new_in(directory)
        .map_err(|_| "The backup folder is not writable.")?;
    file.write_all(content)
        .map_err(|_| "Could not write the backup. Your previous backup was preserved.")?;
    file.as_file()
        .sync_all()
        .map_err(|_| "Could not save the backup.")?;
    file.persist(path)
        .map_err(|_| "Could not replace the backup. Your previous backup was preserved.")?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_replaces_own_files_and_disable_preserves_them() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(Path::new(":memory:")).unwrap();
        let state = store.choose_backup_folder(root.path()).unwrap();
        assert!(state.last_backup.is_some());
        let first = std::fs::read_dir(state.folder.as_ref().unwrap())
            .unwrap()
            .count();
        assert_eq!(first, 2);
        store.run_backup(true).unwrap();
        assert_eq!(std::fs::read_dir(state.folder.unwrap()).unwrap().count(), 2);
        assert!(!store.disable_backup().unwrap().enabled);
        assert_eq!(
            std::fs::read_dir(root.path().join("Daymark backups"))
                .unwrap()
                .count(),
            2
        );
    }
}

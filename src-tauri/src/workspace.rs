use crate::calendar::{CalendarEvent, Tag};
use chrono::{NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};
use uuid::Uuid;

pub(crate) type Result<T> = std::result::Result<T, String>;
pub(crate) fn sql_error(error: rusqlite::Error) -> String {
    format!("Local database operation failed: {error}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: String,
    pub name: String,
    pub code: String,
    pub kind: String,
    pub color: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CourseInput {
    pub id: Option<String>,
    pub name: String,
    pub code: String,
    pub kind: String,
    pub color: String,
    pub description: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub course_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub estimate_minutes: i64,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskInput {
    pub id: Option<String>,
    pub title: String,
    pub description: String,
    pub course_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub estimate_minutes: i64,
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Workspace {
    #[serde(default)]
    pub areas: Vec<crate::areas::Area>,
    pub courses: Vec<Course>,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub events: Vec<CalendarEvent>,
}

pub struct Store {
    pub(crate) connection: Connection,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path).map_err(sql_error)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(sql_error)?;
        connection
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
            .map_err(sql_error)?;
        let mut store = Self { connection };
        store.migrate()?;
        Ok(store)
    }
    pub(crate) fn migrate(&mut self) -> Result<()> {
        let transaction = self.connection.transaction().map_err(sql_error)?;
        let version: i64 = transaction
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(sql_error)?;
        if version > 5 {
            return Err(
                "This workspace was created by a newer app. Update the app before opening it."
                    .into(),
            );
        }
        if version == 0 {
            transaction
                .execute_batch(include_str!("../migrations/001_workspace.sql"))
                .map_err(sql_error)?;
        }
        if version < 2 {
            transaction
                .execute_batch(include_str!("../migrations/002_calendar_tags.sql"))
                .map_err(sql_error)?;
        }
        if version < 3 {
            transaction
                .execute_batch(include_str!("../migrations/003_google.sql"))
                .map_err(sql_error)?;
        }
        if version < 4 {
            transaction
                .execute_batch(include_str!("../migrations/004_unified_tags.sql"))
                .map_err(sql_error)?;
        }
        if version < 5 {
            transaction
                .execute_batch(include_str!("../migrations/005_areas.sql"))
                .map_err(sql_error)?;
        }
        transaction.commit().map_err(sql_error)
    }
    pub fn snapshot(&self) -> Result<Workspace> {
        let mut query = self.connection.prepare("SELECT id,name,code,kind,color,description,created_at,updated_at,deleted_at FROM courses ORDER BY created_at,id").map_err(sql_error)?;
        let courses = query
            .query_map([], |r| {
                Ok(Course {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    code: r.get(2)?,
                    kind: r.get(3)?,
                    color: r.get(4)?,
                    description: r.get(5)?,
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                    deleted_at: r.get(8)?,
                })
            })
            .map_err(sql_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        let mut query = self.connection.prepare("SELECT id,title,description,course_id,kind,status,priority,due_date,estimate_minutes,created_at,updated_at,deleted_at,tag_ids FROM tasks ORDER BY created_at,id").map_err(sql_error)?;
        let tasks = query
            .query_map([], |r| {
                Ok(Task {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    description: r.get(2)?,
                    course_id: r.get(3)?,
                    kind: r.get(4)?,
                    status: r.get(5)?,
                    priority: r.get(6)?,
                    due_date: r.get(7)?,
                    estimate_minutes: r.get(8)?,
                    created_at: r.get(9)?,
                    updated_at: r.get(10)?,
                    deleted_at: r.get(11)?,
                    tag_ids: serde_json::from_str(&r.get::<_, String>(12)?).unwrap_or_default(),
                })
            })
            .map_err(sql_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        Ok(Workspace {
            areas: self.areas()?,
            courses,
            tasks,
            tags: self.tags()?,
            events: self.events()?,
        })
    }
    pub fn save_course(&self, input: CourseInput) -> Result<Workspace> {
        let name = title(&input.name)?;
        bounded(&input.code, 30, "Code")?;
        bounded(&input.description, 4000, "Description")?;
        choice(&input.kind, &["course", "project", "career"], "area type")?;
        choice(
            &input.color,
            &["violet", "blue", "emerald", "amber", "rose"],
            "color",
        )?;
        let now = Utc::now().to_rfc3339();
        if let Some(id) = input.id {
            self.require_record("courses", &id, false)?;
            self.connection.execute("UPDATE courses SET name=?1,code=?2,kind=?3,color=?4,description=?5,updated_at=?6 WHERE id=?7", params![name,input.code.trim(),input.kind,input.color,input.description,now,id]).map_err(sql_error)?;
        } else {
            self.connection.execute("INSERT INTO courses (id,name,code,kind,color,description,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)", params![Uuid::new_v4().to_string(),name,input.code.trim(),input.kind,input.color,input.description,now]).map_err(sql_error)?;
        }
        self.snapshot()
    }
    pub fn save_task(&self, input: TaskInput) -> Result<Workspace> {
        let task_title = title(&input.title)?;
        bounded(&input.description, 4000, "Description")?;
        choice(
            &input.kind,
            &["study", "assignment", "coding", "career", "personal"],
            "task type",
        )?;
        choice(&input.status, &["todo", "doing", "done"], "status")?;
        choice(&input.priority, &["low", "medium", "high"], "priority")?;
        if !(5..=1440).contains(&input.estimate_minutes) {
            return Err("Duration must be between 5 and 1,440 minutes.".into());
        }
        if let Some(date) = &input.due_date {
            let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .map_err(|_| "Use a valid due date (YYYY-MM-DD).")?;
            if parsed.format("%Y-%m-%d").to_string() != *date {
                return Err("Use a valid due date (YYYY-MM-DD).".into());
            }
        }
        if let Some(course_id) = &input.course_id {
            // Existing tasks may retain an archived area, but cannot be moved into one.
            let unchanged = if let Some(id) = &input.id {
                self.connection
                    .query_row("SELECT course_id FROM tasks WHERE id=?1", [id], |r| {
                        r.get::<_, Option<String>>(0)
                    })
                    .ok()
                    .flatten()
                    .as_ref()
                    == Some(course_id)
            } else {
                false
            };
            if !unchanged {
                self.require_record("courses", course_id, false)?;
            }
        }
        let previous = if let Some(id) = &input.id {
            self.connection
                .query_row("SELECT tag_ids FROM tasks WHERE id=?1", [id], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap_or_else(|_| "[]".into())
        } else {
            "[]".into()
        };
        let previous_tags: Vec<String> = serde_json::from_str(&previous).unwrap_or_default();
        let tag_ids = input.tag_ids.clone().unwrap_or_else(|| {
            if input.id.is_some() {
                previous_tags.clone()
            } else {
                match input.kind.as_str() {
                    "study" | "assignment" => vec!["tag-learning".into()],
                    "coding" => vec!["tag-building".into()],
                    "career" => vec!["tag-career".into()],
                    _ => vec![],
                }
            }
        });
        self.validate_tags(&tag_ids, &previous_tags)?;
        let tag_json = serde_json::to_string(&tag_ids).map_err(|_| "Invalid tags.")?;
        let now = Utc::now().to_rfc3339();
        if let Some(id) = input.id {
            self.require_record("tasks", &id, false)?;
            self.connection.execute("UPDATE tasks SET title=?1,description=?2,course_id=?3,kind=?4,status=?5,priority=?6,due_date=?7,estimate_minutes=?8,updated_at=?9,tag_ids=?11 WHERE id=?10", params![task_title,input.description,input.course_id,input.kind,input.status,input.priority,input.due_date,input.estimate_minutes,now,id,tag_json]).map_err(sql_error)?;
        } else {
            self.connection.execute("INSERT INTO tasks (id,title,description,course_id,kind,status,priority,due_date,estimate_minutes,created_at,updated_at,tag_ids) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,?11)",params![Uuid::new_v4().to_string(),task_title,input.description,input.course_id,input.kind,input.status,input.priority,input.due_date,input.estimate_minutes,now,tag_json]).map_err(sql_error)?;
        }
        self.snapshot()
    }
    pub(crate) fn require_record(&self, table: &str, id: &str, deleted: bool) -> Result<()> {
        // Table names are selected internally, never supplied as SQL by the frontend.
        let exists:bool = self.connection.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1 AND (deleted_at IS NOT NULL)=?2)"), params![id,deleted], |r| r.get(0)).map_err(sql_error)?;
        if exists {
            Ok(())
        } else {
            Err("This record is no longer available. Refresh your workspace.".into())
        }
    }
    pub fn set_deleted(&self, entity: &str, id: &str, deleted: bool) -> Result<Workspace> {
        let table = match entity {
            "task" => "tasks",
            "course" => "courses",
            "tag" => "tags",
            "area" => "areas",
            "event" => "calendar_events",
            _ => return Err("Unknown record type.".into()),
        };
        self.require_record(table, id, !deleted)?;
        if ["tag", "area"].contains(&entity) && !deleted {
            let duplicate:bool=self.connection.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE deleted_at IS NULL AND id!=?1 AND lower(name)=(SELECT lower(name) FROM {table} WHERE id=?1))"),[id],|r|r.get(0)).map_err(sql_error)?;
            if duplicate {
                return Err(
                    "Another active item has this name. Rename it before restoring.".into(),
                );
            }
        }

        let now = Utc::now().to_rfc3339();
        self.connection
            .execute(
                &format!("UPDATE {table} SET deleted_at=?1,updated_at=?2 WHERE id=?3"),
                params![if deleted { Some(&now) } else { None }, now, id],
            )
            .map_err(sql_error)?;
        // Archived areas retain their tasks and assignments, making restore lossless.
        self.snapshot()
    }
}
fn title(value: &str) -> Result<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("A title is required.".into());
    }
    bounded(trimmed, 200, "Title")?;
    Ok(trimmed)
}
fn bounded(value: &str, max: usize, label: &str) -> Result<()> {
    if value.chars().count() > max {
        Err(format!("{label} must be at most {max} characters."))
    } else {
        Ok(())
    }
}
fn choice(value: &str, choices: &[&str], label: &str) -> Result<()> {
    if choices.contains(&value) {
        Ok(())
    } else {
        Err(format!("Invalid {label}."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn course() -> CourseInput {
        CourseInput {
            id: None,
            name: " Algorithms ".into(),
            code: "CS201".into(),
            kind: "course".into(),
            color: "violet".into(),
            description: "".into(),
        }
    }
    fn task(course_id: Option<String>) -> TaskInput {
        TaskInput {
            id: None,
            title: "Practice trees".into(),
            description: "Traversal exercises".into(),
            course_id,
            kind: "coding".into(),
            status: "todo".into(),
            priority: "high".into(),
            due_date: Some("2026-11-01".into()),
            estimate_minutes: 45,
            tag_ids: None,
        }
    }
    #[test]
    fn records_survive_reopen_and_migrations_are_idempotent() {
        let path = std::env::temp_dir().join(format!("learner-test-{}.sqlite3", Uuid::new_v4()));
        {
            let store = Store::open(&path).unwrap();
            let id = store.save_course(course()).unwrap().courses[0].id.clone();
            store.save_task(task(Some(id))).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            let snapshot = store.snapshot().unwrap();
            assert_eq!(snapshot.courses[0].name, "Algorithms");
            assert_eq!(snapshot.tasks[0].estimate_minutes, 45);
            assert_eq!(
                snapshot.tasks[0].course_id.as_ref(),
                Some(&snapshot.courses[0].id)
            );
            let mut edit = task(snapshot.tasks[0].course_id.clone());
            edit.id = Some(snapshot.tasks[0].id.clone());
            edit.title = "Updated task".into();
            edit.status = "done".into();
            let saved = store.save_task(edit).unwrap();
            assert_eq!(saved.tasks.len(), 1);
            assert_eq!(saved.tasks[0].status, "done");
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn archive_restore_preserves_assignments_and_rejects_unknown_ids() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let id = store.save_course(course()).unwrap().courses[0].id.clone();
        let task_id = store.save_task(task(Some(id.clone()))).unwrap().tasks[0]
            .id
            .clone();
        assert!(store.set_deleted("task", "missing", true).is_err());
        store.set_deleted("course", &id, true).unwrap();
        assert!(store.save_task(task(Some(id.clone()))).is_err());
        let restored = store.set_deleted("course", &id, false).unwrap();
        assert_eq!(restored.tasks[0].course_id.as_ref(), Some(&id));
        store.set_deleted("task", &task_id, true).unwrap();
        let restored = store.set_deleted("task", &task_id, false).unwrap();
        assert!(restored.tasks[0].deleted_at.is_none());
        assert_eq!(restored.tasks[0].description, "Traversal exercises");
    }
    #[test]
    fn validation_rejects_bad_inputs_without_writes() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let mut invalid = course();
        invalid.name = "  ".into();
        assert!(store.save_course(invalid).is_err());
        let mut invalid = task(None);
        invalid.due_date = Some("2026-02-30".into());
        assert!(store.save_task(invalid).is_err());
        let mut invalid = task(None);
        invalid.estimate_minutes = 0;
        assert!(store.save_task(invalid).is_err());
        let mut invalid = task(None);
        invalid.status = "unknown".into();
        assert!(store.save_task(invalid).is_err());
        assert!(store.save_task(task(Some("missing".into()))).is_err());
        assert!(store.snapshot().unwrap().tasks.is_empty());
    }
    #[test]
    fn refuses_newer_schema_without_modifying_it() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA user_version=99;").unwrap();
        let mut store = Store { connection };
        assert!(store.migrate().is_err());
        let version: i64 = store
            .connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 99);
    }
}

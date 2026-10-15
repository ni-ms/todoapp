use crate::workspace::{sql_error, Result, Store};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TagInput {
    pub id: Option<String>,
    pub name: String,
    pub color: String,
    pub icon: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub description: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub time_zone: String,
    pub tag_ids: Vec<String>,
    pub task_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventInput {
    pub id: Option<String>,
    pub title: String,
    pub description: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub time_zone: String,
    pub tag_ids: Vec<String>,
    pub task_id: Option<String>,
}
impl Store {
    pub fn delete_tag(&self, id: &str) -> Result<crate::workspace::Workspace> {
        let transaction = self.connection.unchecked_transaction().map_err(sql_error)?;
        let removed = transaction
            .execute(
                "DELETE FROM tags WHERE id=?1 AND deleted_at IS NOT NULL",
                [id],
            )
            .map_err(sql_error)?;
        if removed != 1 {
            return Err("Only archived tags can be permanently deleted.".into());
        }
        let now = Utc::now().to_rfc3339();
        for table in ["tasks", "calendar_events"] {
            let records = transaction
                .prepare(&format!("SELECT id,tag_ids FROM {table}"))
                .map_err(sql_error)?
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(sql_error)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(sql_error)?;
            for (record_id, raw) in records {
                let mut tags: Vec<String> = serde_json::from_str(&raw)
                    .map_err(|_| "Tag assignments could not be read. No changes were made.")?;
                if tags.iter().any(|tag| tag == id) {
                    tags.retain(|tag| tag != id);
                    let tags = serde_json::to_string(&tags)
                        .map_err(|_| "Could not update tag assignments.")?;
                    transaction
                        .execute(
                            &format!("UPDATE {table} SET tag_ids=?1,updated_at=?2 WHERE id=?3"),
                            params![tags, now, record_id],
                        )
                        .map_err(sql_error)?;
                }
            }
        }
        transaction.commit().map_err(sql_error)?;
        self.snapshot()
    }
    pub fn tags(&self) -> Result<Vec<Tag>> {
        self.connection.prepare("SELECT id,name,color,icon,created_at,updated_at,deleted_at FROM tags ORDER BY created_at,id").map_err(sql_error)?.query_map([],|r|Ok(Tag{id:r.get(0)?,name:r.get(1)?,color:r.get(2)?,icon:r.get(3)?,created_at:r.get(4)?,updated_at:r.get(5)?,deleted_at:r.get(6)?})).map_err(sql_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(sql_error)
    }
    pub fn events(&self) -> Result<Vec<CalendarEvent>> {
        self.connection.prepare("SELECT id,title,description,start,end,all_day,time_zone,tag_ids,task_id,created_at,updated_at,deleted_at FROM calendar_events ORDER BY start,id").map_err(sql_error)?.query_map([],|r|Ok(CalendarEvent{id:r.get(0)?,title:r.get(1)?,description:r.get(2)?,start:r.get(3)?,end:r.get(4)?,all_day:r.get(5)?,time_zone:r.get(6)?,tag_ids:serde_json::from_str(&r.get::<_,String>(7)?).unwrap_or_default(),task_id:r.get(8)?,created_at:r.get(9)?,updated_at:r.get(10)?,deleted_at:r.get(11)?})).map_err(sql_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(sql_error)
    }
    pub fn validate_tags(&self, ids: &[String], existing: &[String]) -> Result<()> {
        if ids.len() > 20 {
            return Err("Choose at most 20 tags.".into());
        }
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        if unique.len() != ids.len() {
            return Err("A tag cannot be selected twice.".into());
        }
        for id in ids {
            if !existing.contains(id) {
                self.require_record("tags", id, false)?;
            }
        }
        Ok(())
    }
    pub fn save_tag(&self, input: TagInput) -> Result<crate::workspace::Workspace> {
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 40 {
            return Err("Tag names must be 1–40 characters.".into());
        }
        if !["violet", "blue", "emerald", "amber", "rose"].contains(&input.color.as_str()) {
            return Err("Invalid tag color.".into());
        }
        validate_icon(&input.icon)?;
        let duplicate:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM tags WHERE lower(name)=lower(?1) AND deleted_at IS NULL AND id!=?2)",params![name,input.id.as_deref().unwrap_or("")],|r|r.get(0)).map_err(sql_error)?;
        if duplicate {
            return Err("A tag with this name already exists.".into());
        }
        let now = Utc::now().to_rfc3339();
        if let Some(id) = input.id {
            self.require_record("tags", &id, false)?;
            self.connection
                .execute(
                    "UPDATE tags SET name=?1,color=?2,icon=?3,updated_at=?4 WHERE id=?5",
                    params![name, input.color, input.icon, now, id],
                )
                .map_err(sql_error)?;
        } else {
            self.connection.execute("INSERT INTO tags (id,name,color,icon,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)",params![Uuid::new_v4().to_string(),name,input.color,input.icon,now]).map_err(sql_error)?;
        }
        self.snapshot()
    }
    pub fn save_event(&self, input: EventInput) -> Result<crate::workspace::Workspace> {
        validate_event(&input)?;
        let previous: Vec<String> = if let Some(id) = &input.id {
            self.connection
                .query_row(
                    "SELECT tag_ids FROM calendar_events WHERE id=?1",
                    [id],
                    |r| r.get::<_, String>(0),
                )
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            vec![]
        };
        self.validate_tags(&input.tag_ids, &previous)?;
        if let Some(task_id) = &input.task_id {
            let unchanged = input
                .id
                .as_ref()
                .and_then(|id| {
                    self.connection
                        .query_row(
                            "SELECT task_id FROM calendar_events WHERE id=?1",
                            [id],
                            |r| r.get::<_, Option<String>>(0),
                        )
                        .ok()
                })
                .flatten()
                .as_ref()
                == Some(task_id);
            if !unchanged {
                self.require_record("tasks", task_id, false)?;
            }
        }
        let now = Utc::now().to_rfc3339();
        let ids = serde_json::to_string(&input.tag_ids).map_err(|_| "Invalid tags.")?;
        if let Some(id) = input.id {
            self.require_record("calendar_events", &id, false)?;
            self.connection.execute("UPDATE calendar_events SET title=?1,description=?2,start=?3,end=?4,all_day=?5,time_zone=?6,tag_ids=?7,task_id=?8,updated_at=?9 WHERE id=?10",params![input.title.trim(),input.description,input.start,input.end,input.all_day,input.time_zone,ids,input.task_id,now,id]).map_err(sql_error)?;
        } else {
            self.connection.execute("INSERT INTO calendar_events (id,title,description,start,end,all_day,time_zone,tag_ids,task_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",params![Uuid::new_v4().to_string(),input.title.trim(),input.description,input.start,input.end,input.all_day,input.time_zone,ids,input.task_id,now]).map_err(sql_error)?;
        }
        self.snapshot()
    }
}
pub fn validate_icon(icon: &str) -> Result<()> {
    if [
        "book",
        "code",
        "briefcase",
        "brain",
        "flask",
        "heart",
        "dumbbell",
        "music",
        "palette",
        "globe",
        "star",
        "coffee",
        "hash",
        "target",
    ]
    .contains(&icon)
    {
        return Ok(());
    }
    let data = icon
        .strip_prefix("data:image/png;base64,")
        .ok_or("Choose a preset or upload a PNG, JPEG, or WebP image.")?;
    if data.len() > 90_000 {
        return Err("Icon is too large.".into());
    }
    let bytes = STANDARD.decode(data).map_err(|_| "Invalid icon image.")?;
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().map_err(|_| "Invalid PNG icon.")?;
    let info = reader.info();
    if info.width == 0 || info.height == 0 || info.width > 128 || info.height > 128 {
        return Err("Icons must be at most 128 × 128 pixels.".into());
    }
    let mut output = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("Invalid image dimensions.")?
    ];
    reader
        .next_frame(&mut output)
        .map_err(|_| "Invalid PNG image.")?;
    Ok(())
}
pub fn validate_event(input: &EventInput) -> Result<()> {
    if input.title.trim().is_empty() || input.title.trim().chars().count() > 200 {
        return Err("Enter an event title (1–200 characters).".into());
    }
    if input.description.chars().count() > 4000 {
        return Err("Keep notes under 4,000 characters.".into());
    }
    input
        .time_zone
        .parse::<chrono_tz::Tz>()
        .map_err(|_| "Choose a valid time zone.")?;
    if input.all_day {
        let parse = |s: &str| -> Result<NaiveDate> {
            let d =
                NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "Invalid all-day date.")?;
            if d.format("%Y-%m-%d").to_string() != s {
                return Err("Invalid all-day date.".into());
            }
            Ok(d)
        };
        let days = (parse(&input.end)? - parse(&input.start)?).num_days();
        if !(1..=366).contains(&days) {
            return Err("End date must follow the start date, within one year.".into());
        }
    } else {
        let start =
            DateTime::parse_from_rfc3339(&input.start).map_err(|_| "Invalid start time.")?;
        let end = DateTime::parse_from_rfc3339(&input.end).map_err(|_| "Invalid end time.")?;
        let seconds = (end - start).num_seconds();
        if !(60..=366 * 86400).contains(&seconds) {
            return Err("End time must be after start time, within one year.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event() -> EventInput {
        EventInput {
            id: None,
            title: "Study".into(),
            description: "Review".into(),
            start: "2026-03-08T09:30:00Z".into(),
            end: "2026-03-08T10:30:00Z".into(),
            all_day: false,
            time_zone: "America/Los_Angeles".into(),
            tag_ids: vec!["tag-learning".into()],
            task_id: None,
        }
    }
    #[test]
    fn event_and_custom_tags_persist_and_restore() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("test.db");
        let id;
        {
            let store = Store::open(&path).unwrap();
            let snapshot = store
                .save_tag(TagInput {
                    id: None,
                    name: "Research".into(),
                    color: "blue".into(),
                    icon: "flask".into(),
                })
                .unwrap();
            let tag = snapshot
                .tags
                .iter()
                .find(|t| t.name == "Research")
                .unwrap()
                .id
                .clone();
            let mut input = event();
            input.tag_ids.push(tag.clone());
            let saved = store.save_event(input).unwrap();
            id = saved.events[0].id.clone();
            store.set_deleted("event", &id, true).unwrap();
            assert!(store.snapshot().unwrap().events[0].deleted_at.is_some());
            store.set_deleted("event", &id, false).unwrap();
            assert!(store
                .save_tag(TagInput {
                    id: None,
                    name: "research".into(),
                    color: "blue".into(),
                    icon: "flask".into()
                })
                .is_err());
        }
        {
            let store = Store::open(&path).unwrap();
            let e = store.snapshot().unwrap().events.remove(0);
            assert_eq!(e.id, id);
            assert_eq!(e.tag_ids.len(), 2);
            assert!(e.deleted_at.is_none());
            assert_eq!(e.start, "2026-03-08T09:30:00Z");
        }
    }
    #[test]
    fn deleting_archived_tag_cleans_assignments_without_losing_records() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("tags.db");
        let store = Store::open(&path).unwrap();
        store.connection.execute("INSERT INTO tasks(id,title,description,kind,status,priority,estimate_minutes,created_at,updated_at,tag_ids,deleted_at) VALUES('task','Keep task','notes','study','todo','medium',30,'2026-01-01','2026-01-01','[\"tag-learning\",\"tag-building\"]','2026-01-02')", []).unwrap();
        let mut input = event();
        input.tag_ids.push("tag-building".into());
        let snapshot = store.save_event(input).unwrap();
        let event_id = snapshot.events[0].id.clone();
        store.set_deleted("event", &event_id, true).unwrap();
        assert!(store.delete_tag("tag-learning").is_err());
        assert!(store.delete_tag("unknown").is_err());
        store.set_deleted("tag", "tag-learning", true).unwrap();
        store.delete_tag("tag-learning").unwrap();
        drop(store);
        let snapshot = Store::open(&path).unwrap().snapshot().unwrap();
        assert!(!snapshot.tags.iter().any(|t| t.id == "tag-learning"));
        assert_eq!(snapshot.tasks.len(), 1);
        assert_eq!(snapshot.tasks[0].title, "Keep task");
        assert_eq!(snapshot.tasks[0].tag_ids, vec!["tag-building"]);
        assert!(snapshot.tasks[0].deleted_at.is_some());
        assert_eq!(snapshot.events.len(), 1);
        assert_eq!(snapshot.events[0].tag_ids, vec!["tag-building"]);
        assert!(snapshot.events[0].deleted_at.is_some());
    }
    #[test]
    fn tag_deletion_rolls_back_if_assignment_cleanup_fails() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        store.save_event(event()).unwrap();
        store.set_deleted("tag", "tag-learning", true).unwrap();
        store
            .connection
            .execute("UPDATE calendar_events SET tag_ids='invalid'", [])
            .unwrap();
        assert!(store.delete_tag("tag-learning").is_err());
        assert!(store.tags().unwrap().iter().any(|t| t.id == "tag-learning"));
    }
    #[test]
    fn rejects_bad_time_ranges_zones_and_icon_payloads() {
        let mut input = event();
        input.end = input.start.clone();
        assert!(validate_event(&input).is_err());
        let mut input = event();
        input.time_zone = "Mars/Olympus".into();
        assert!(validate_event(&input).is_err());
        let mut input = event();
        input.all_day = true;
        input.start = "2026-02-30".into();
        input.end = "2026-03-02".into();
        assert!(validate_event(&input).is_err());
        assert!(validate_icon("data:image/svg+xml,<svg/>").is_err());
        assert!(validate_icon("data:image/png;base64,aW52YWxpZA==").is_err());
    }
    #[test]
    fn version_one_migration_preserves_tasks_and_assigns_tags() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(include_str!("../migrations/001_workspace.sql"))
            .unwrap();
        connection.execute("INSERT INTO tasks(id,title,description,kind,status,priority,estimate_minutes,created_at,updated_at) VALUES('old-task','Keep me','notes','coding','doing','high',60,'2026-01-01','2026-01-01')",[]).unwrap();
        let mut store = Store { connection };
        store.migrate().unwrap();
        store.migrate().unwrap();
        let snapshot = store.snapshot().unwrap();
        assert_eq!(snapshot.tasks[0].title, "Keep me");
        assert_eq!(snapshot.tasks[0].tag_ids, vec!["tag-building"]);
        assert_eq!(snapshot.tags.len(), 3);
        assert!(snapshot.events.is_empty());
        assert_eq!(
            store
                .connection
                .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            3
        );
    }
}

use crate::workspace::{sql_error, Result, Store, TaskInput, Workspace};
use chrono::Utc;
use rusqlite::params;
impl Store {
    pub fn purge_record(&self, entity: &str, id: &str) -> Result<Workspace> {
        if entity == "tag" {
            return self.delete_tag(id);
        }
        let table = match entity {
            "task" => "tasks",
            "course" => "courses",
            "area" => "areas",
            "event" => "calendar_events",
            _ => return Err("Unknown record type.".into()),
        };
        let tx = self.connection.unchecked_transaction().map_err(sql_error)?;
        self.require_record(table, id, true)?;
        let now = Utc::now().to_rfc3339();
        if entity == "task" {
            tx.execute(
                "UPDATE calendar_events SET task_id=NULL,updated_at=?1 WHERE task_id=?2",
                params![now, id],
            )
            .map_err(sql_error)?;
        }
        if entity == "course" {
            tx.execute(
                "UPDATE tasks SET course_id=NULL,updated_at=?1 WHERE course_id=?2",
                params![now, id],
            )
            .map_err(sql_error)?;
        }
        tx.execute(
            &format!("DELETE FROM {table} WHERE id=?1 AND deleted_at IS NOT NULL"),
            [id],
        )
        .map_err(sql_error)?;
        tx.commit().map_err(sql_error)?;
        self.snapshot()
    }
    pub fn save_tasks(&self, inputs: Vec<TaskInput>) -> Result<Workspace> {
        if inputs.is_empty() || inputs.len() > 20 || inputs.iter().any(|t| t.id.is_some()) {
            return Err("Choose 1–20 new tasks.".into());
        }
        let tx = self.connection.unchecked_transaction().map_err(sql_error)?;
        let ids: Vec<String> = inputs
            .iter()
            .map(|_| uuid::Uuid::new_v4().to_string())
            .collect();
        for (i, mut input) in inputs.into_iter().enumerate() {
            if let Some(s) = &mut input.scheduling {
                for dep in &mut s.dependencies {
                    if let Some(index) = dep.strip_prefix("draft:") {
                        *dep = ids
                            .get(
                                index
                                    .parse::<usize>()
                                    .map_err(|_| "Invalid draft dependency.")?,
                            )
                            .ok_or("Unknown draft dependency.")?
                            .clone();
                    }
                }
            }
            self.save_task_record(input, Some(ids[i].clone()))?;
        }
        tx.commit().map_err(sql_error)?;
        self.snapshot()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn purge_requires_trash_and_keeps_related_records() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        store.connection.execute("INSERT INTO tasks(id,title,kind,status,priority,estimate_minutes,created_at,updated_at) VALUES('t','Keep session','study','todo','medium',30,'now','now')",[]).unwrap();
        store.connection.execute("INSERT INTO calendar_events(id,title,description,start,end,all_day,time_zone,task_id,created_at,updated_at) VALUES('e','Session','','2026-10-15','2026-10-16',1,'UTC','t','now','now')",[]).unwrap();
        assert!(store.purge_record("task", "t").is_err());
        store.set_deleted("task", "t", true).unwrap();
        let w = store.purge_record("task", "t").unwrap();
        assert!(w.tasks.is_empty());
        assert_eq!(w.events.len(), 1);
        assert!(w.events[0].task_id.is_none());
        assert!(store.purge_record("event", "e").is_err());
        store.set_deleted("event", "e", true).unwrap();
        assert!(store.purge_record("event", "e").unwrap().events.is_empty());
    }
    #[test]
    fn invalid_batch_rolls_back_every_task() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        let input = TaskInput {
            id: None,
            title: "Good".into(),
            description: "".into(),
            course_id: None,
            kind: "study".into(),
            status: "todo".into(),
            priority: "medium".into(),
            due_date: None,
            estimate_minutes: 30,
            scheduling: None,
            tag_ids: Some(vec![]),
        };
        let mut invalid = input.clone();
        invalid.estimate_minutes = 0;
        assert!(store.save_tasks(vec![input, invalid]).is_err());
        assert!(store.snapshot().unwrap().tasks.is_empty());
    }
    #[test]
    fn course_migration_preserves_metadata_and_assignments() {
        let mut store = Store {
            connection: rusqlite::Connection::open_in_memory().unwrap(),
        };
        store
            .connection
            .execute_batch(include_str!("../migrations/001_workspace.sql"))
            .unwrap();
        store.connection.execute("INSERT INTO courses VALUES('c','Algorithms','CS201','course','blue','Read trees','old','old',NULL)",[]).unwrap();
        store.connection.execute("INSERT INTO tasks(id,title,course_id,kind,status,priority,estimate_minutes,created_at,updated_at) VALUES('t','Study','c','study','todo','medium',30,'old','old')",[]).unwrap();
        store.migrate().unwrap();
        let w = store.snapshot().unwrap();
        assert!(w.courses.is_empty());
        assert!(w.tasks[0].course_id.is_none());
        assert!(w.tasks[0].tag_ids.contains(&"course-c".into()));
        let tag = w.tags.iter().find(|t| t.id == "course-c").unwrap();
        assert_eq!(tag.code, "CS201");
        assert_eq!(tag.description, "Read trees");
        assert_eq!(tag.kind, "course");
    }
}

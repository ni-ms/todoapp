use crate::workspace::Result;
use chrono::{DateTime, Timelike};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StudyWindow {
    pub days: Vec<u32>,
    pub start: String,
    pub end: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskScheduling {
    pub time_zone: String,
    pub work_date: Option<String>,
    pub deadline_at: Option<String>,
    pub earliest_start: Option<String>,
    pub fixed_start: Option<String>,
    pub fixed_end: Option<String>,
    pub remaining_minutes: Option<i64>,
    pub dependencies: Vec<String>,
    pub splittable: bool,
    pub minimum_session_minutes: i64,
    pub preferred_session_minutes: i64,
    pub allowed_windows: Vec<StudyWindow>,
    pub preferred_windows: Vec<StudyWindow>,
    pub unresolved: Vec<String>,
}
pub fn instant(s: &str) -> Result<i64> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .map_err(|_| "Use an exact time with a time zone offset.".into())
}
impl TaskScheduling {
    pub fn validate(&self, estimate: i64) -> Result<()> {
        if let Some(d) = &self.work_date {
            if d.len() != 10 || chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_err() {
                return Err("Invalid work date.".into());
            }
        }
        self.time_zone
            .parse::<chrono_tz::Tz>()
            .map_err(|_| "Choose a valid time zone.")?;
        for s in [
            &self.deadline_at,
            &self.earliest_start,
            &self.fixed_start,
            &self.fixed_end,
        ]
        .into_iter()
        .flatten()
        {
            instant(s)?;
        }
        if !(5..=1440).contains(&self.minimum_session_minutes)
            || !(self.minimum_session_minutes..=1440).contains(&self.preferred_session_minutes)
            || self
                .remaining_minutes
                .is_some_and(|m| m < 0 || m > estimate)
            || self.dependencies.len() > 20
            || self
                .dependencies
                .iter()
                .any(|s| s.is_empty() || s.len() > 200)
            || self
                .dependencies
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.dependencies.len()
            || self.unresolved.len() > 20
            || self
                .unresolved
                .iter()
                .any(|s| s.is_empty() || s.chars().count() > 500)
        {
            return Err("Check remaining effort and session lengths.".into());
        }
        if let (Some(a), Some(b)) = (&self.fixed_start, &self.fixed_end) {
            if (instant(b)? - instant(a)?) % 60000 != 0 {
                return Err("Fixed block duration must be a whole number of minutes.".into());
            }
        }
        if self.fixed_start.is_some() != self.fixed_end.is_some()
            || self
                .fixed_start
                .as_ref()
                .zip(self.fixed_end.as_ref())
                .is_some_and(|(a, b)| instant(a).unwrap() >= instant(b).unwrap())
        {
            return Err("A fixed block needs a start and a later end.".into());
        }
        if self
            .earliest_start
            .as_ref()
            .zip(self.deadline_at.as_ref())
            .is_some_and(|(a, b)| instant(a).unwrap() >= instant(b).unwrap())
        {
            return Err("Earliest start must precede the deadline.".into());
        }
        if let Some(start) = &self.fixed_start {
            if self
                .earliest_start
                .as_ref()
                .is_some_and(|a| instant(start).unwrap() < instant(a).unwrap())
                || self.deadline_at.as_ref().is_some_and(|d| {
                    instant(self.fixed_end.as_ref().unwrap()).unwrap() > instant(d).unwrap()
                })
            {
                return Err("The fixed block conflicts with the start or deadline.".into());
            }
        }
        for list in [&self.allowed_windows, &self.preferred_windows] {
            if list.len() > 14 {
                return Err("Too many time windows.".into());
            }
            for w in list {
                let a = chrono::NaiveTime::parse_from_str(&w.start, "%H:%M")
                    .map_err(|_| "Invalid window time.")?;
                let b = chrono::NaiveTime::parse_from_str(&w.end, "%H:%M")
                    .map_err(|_| "Invalid window time.")?;
                if a >= b
                    || a.second() != 0
                    || w.start.len() != 5
                    || w.end.len() != 5
                    || w.days.is_empty()
                    || w.days.len() > 7
                    || w.days.iter().any(|d| !(1..=7).contains(d))
                    || w.days
                        .iter()
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        != w.days.len()
                {
                    return Err("Invalid time window.".into());
                }
            }
        }
        Ok(())
    }
}
// Validate required fields against the exact contract used by browser inference.
// Patterns and calendar semantics are additionally validated by typed validators.
pub fn check_contract(v: &serde_json::Value, s: &serde_json::Value) -> Result<()> {
    let kind = if v.is_null() {
        "null"
    } else if v.is_object() {
        "object"
    } else if v.is_array() {
        "array"
    } else if v.is_string() {
        "string"
    } else if v.is_boolean() {
        "boolean"
    } else if v.as_i64().is_some() {
        "integer"
    } else {
        "number"
    };
    if !(s["type"].as_str() == Some(kind)
        || s["type"]
            .as_array()
            .is_some_and(|a| a.iter().any(|t| t.as_str() == Some(kind))))
    {
        return Err("Invalid capture field type.".into());
    }
    if s["enum"].as_array().is_some_and(|a| !a.contains(v)) {
        return Err("Invalid capture field value.".into());
    }
    if let Some(o) = v.as_object() {
        let p = s["properties"].as_object().ok_or("Invalid schema.")?;
        if o.keys().any(|k| !p.contains_key(k))
            || s["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|k| !o.contains_key(k.as_str().unwrap()))
        {
            return Err("Missing or unsupported fields.".into());
        }
        for (k, v) in o {
            check_contract(v, &p[k])?;
        }
    }
    if let Some(a) = v.as_array() {
        if a.len() < s["minItems"].as_u64().unwrap_or(0) as usize
            || a.len() > s["maxItems"].as_u64().unwrap_or(u64::MAX) as usize
            || (s["uniqueItems"] == true
                && a.iter()
                    .map(|v| v.to_string())
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    != a.len())
        {
            return Err("Invalid or repeated list entries.".into());
        }
        for v in a {
            check_contract(v, &s["items"])?;
        }
    }
    if let Some(n) = v.as_i64() {
        if n < s["minimum"].as_i64().unwrap_or(i64::MIN)
            || n > s["maximum"].as_i64().unwrap_or(i64::MAX)
        {
            return Err("Capture number out of range.".into());
        }
    }
    if let Some(v) = v.as_str() {
        if v.chars().count() < s["minLength"].as_u64().unwrap_or(0) as usize
            || v.chars().count() > s["maxLength"].as_u64().unwrap_or(u64::MAX) as usize
        {
            return Err("Capture text out of range.".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn shares_browser_capture_contract_fixtures() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/capture-benchmark.json"))
                .unwrap();
        for c in cases.as_array().unwrap() {
            let raw = serde_json::json!({"tasks":c["tasks"]}).to_string();
            assert!(
                crate::local_ai::validate_drafts(&raw, &[]).is_ok(),
                "{}",
                c["name"]
            );
        }
    }
    #[test]
    fn version_five_upgrade_preserves_records_and_new_fields_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.sqlite");
        let connection = rusqlite::Connection::open(&path).unwrap();
        for sql in [
            include_str!("../migrations/001_workspace.sql"),
            include_str!("../migrations/002_calendar_tags.sql"),
            include_str!("../migrations/003_google.sql"),
            include_str!("../migrations/004_unified_tags.sql"),
            include_str!("../migrations/005_areas.sql"),
        ] {
            connection.execute_batch(sql).unwrap();
        }
        connection.execute("INSERT INTO tasks(id,title,kind,status,priority,estimate_minutes,created_at,updated_at,deleted_at) VALUES('old','Keep me','study','todo','medium',30,'created','updated','trashed')",[]).unwrap();
        drop(connection);
        let store = crate::workspace::Store::open(&path).unwrap();
        let before = store.snapshot().unwrap();
        assert_eq!(before.tasks[0].deleted_at.as_deref(), Some("trashed"));
        assert!(before.tasks[0].scheduling.is_none());
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/capture-benchmark.json"))
                .unwrap();
        let mut inputs = vec![];
        for d in fixture[2]["tasks"].as_array().unwrap() {
            let mut d = d.clone();
            d.as_object_mut().unwrap().remove("estimatedFields");
            d["courseId"] = serde_json::Value::Null;
            d["kind"] = serde_json::json!("study");
            d["status"] = serde_json::json!("todo");
            inputs.push(serde_json::from_value(d).unwrap());
        }
        let saved = store.save_tasks(inputs).unwrap();
        let read = saved
            .tasks
            .iter()
            .find(|t| t.title == "Read chapter two")
            .unwrap();
        let exercise = saved
            .tasks
            .iter()
            .find(|t| t.title == "Attempt exercises")
            .unwrap();
        assert_eq!(
            exercise.scheduling.as_ref().unwrap().dependencies,
            vec![read.id.clone()]
        );
        let expected = serde_json::to_value(saved).unwrap();
        drop(store);
        assert_eq!(
            serde_json::to_value(
                crate::workspace::Store::open(&path)
                    .unwrap()
                    .snapshot()
                    .unwrap()
            )
            .unwrap(),
            expected
        );
    }
}

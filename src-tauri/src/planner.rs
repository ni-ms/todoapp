use crate::{
    calendar::EventInput,
    workspace::{sql_error, Result, Store, Workspace},
    Database,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub start_date: String,
    pub time_zone: String,
    pub start_hour: u32,
    pub end_hour: u32,
    pub weekends: bool,
    pub break_minutes: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unscheduled {
    pub title: String,
    pub minutes: i64,
    pub reason: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: String,
    pub events: Vec<EventInput>,
    pub unscheduled: Vec<Unscheduled>,
    pub fingerprint: String,
}
pub type PendingPlan = Arc<Mutex<Option<Proposal>>>;
fn fingerprint(w: &Workspace) -> Result<String> {
    Ok(
        Sha256::digest(serde_json::to_vec(w).map_err(|_| "Could not read planning context.")?)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
    )
}
pub fn plan(w: &Workspace, options: &Options, now: DateTime<Utc>) -> Result<Proposal> {
    let zone: chrono_tz::Tz = options
        .time_zone
        .parse()
        .map_err(|_| "Invalid planning time zone.")?;
    let first = NaiveDate::parse_from_str(&options.start_date, "%Y-%m-%d")
        .map_err(|_| "Choose a valid start date.")?;
    if options.start_hour >= options.end_hour
        || options.end_hour > 23
        || options.break_minutes < 0
        || options.break_minutes > 60
        || first < now.with_timezone(&zone).date_naive()
        || first > now.with_timezone(&zone).date_naive() + Duration::days(31)
    {
        return Err("Choose future dates, valid study hours, and breaks of 0–60 minutes.".into());
    }
    let mut gaps: Vec<(DateTime<Utc>, DateTime<Utc>)> = vec![];
    for day in 0..7 {
        let date = first + Duration::days(day);
        if !options.weekends && date.weekday().number_from_monday() > 5 {
            continue;
        }
        let (Some(start), Some(end)) = (
            zone.from_local_datetime(&date.and_hms_opt(options.start_hour, 0, 0).unwrap())
                .single(),
            zone.from_local_datetime(&date.and_hms_opt(options.end_hour, 0, 0).unwrap())
                .single(),
        ) else {
            continue;
        };
        let mut start = start.with_timezone(&Utc);
        let end = end.with_timezone(&Utc);
        let rounded = DateTime::from_timestamp(((now.timestamp() + 899) / 900) * 900, 0)
            .ok_or("Invalid current time.")?;
        start = start.max(rounded);
        if start >= end {
            continue;
        }
        let mut blocked = vec![];
        for e in w.events.iter().filter(|e| e.deleted_at.is_none()) {
            let pair = if e.all_day {
                let a = NaiveDate::parse_from_str(&e.start, "%Y-%m-%d")
                    .ok()
                    .and_then(|d| {
                        zone.from_local_datetime(&d.and_hms_opt(0, 0, 0)?)
                            .earliest()
                    })
                    .map(|d| d.with_timezone(&Utc));
                let b = NaiveDate::parse_from_str(&e.end, "%Y-%m-%d")
                    .ok()
                    .and_then(|d| zone.from_local_datetime(&d.and_hms_opt(0, 0, 0)?).latest())
                    .map(|d| d.with_timezone(&Utc));
                a.zip(b)
            } else {
                DateTime::parse_from_rfc3339(&e.start)
                    .ok()
                    .zip(DateTime::parse_from_rfc3339(&e.end).ok())
                    .map(|(a, b)| (a.with_timezone(&Utc), b.with_timezone(&Utc)))
            };
            if let Some((a, b)) = pair {
                if a < end && b + Duration::minutes(options.break_minutes) > start {
                    blocked.push((a, b + Duration::minutes(options.break_minutes)));
                }
            }
        }
        blocked.sort_by_key(|(a, _)| *a);
        let mut cursor = start;
        for (a, b) in blocked {
            if a - Duration::minutes(options.break_minutes) > cursor {
                gaps.push((
                    cursor,
                    (a - Duration::minutes(options.break_minutes)).min(end),
                ));
            }
            cursor = cursor.max(b);
            if cursor >= end {
                break;
            }
        }
        if cursor < end {
            gaps.push((cursor, end));
        }
    }
    let (events, unscheduled) =
        crate::schedule_engine::schedule(w, gaps, &options.time_zone, now, options.break_minutes)?;
    Ok(Proposal {
        id: uuid::Uuid::new_v4().to_string(),
        events,
        unscheduled,
        fingerprint: fingerprint(w)?,
    })
}
pub fn preview(db: &Database, pending: &PendingPlan, options: Options) -> Result<Proposal> {
    let w = db.lock().map_err(|_| "Planner unavailable.")?.snapshot()?;
    let p = plan(&w, &options, Utc::now())?;
    *pending.lock().map_err(|_| "Planner unavailable.")? = Some(p.clone());
    Ok(p)
}
pub fn apply(db: &Database, pending: &PendingPlan, id: String) -> Result<Workspace> {
    let mut pending = pending.lock().map_err(|_| "Planner unavailable.")?;
    let p = pending
        .as_ref()
        .filter(|p| p.id == id)
        .ok_or("This proposal expired. Preview a new plan.")?;
    let store = db.lock().map_err(|_| "Planner unavailable.")?;
    let before = store.snapshot()?;
    if fingerprint(&before)? != p.fingerprint {
        return Err(
            "Your tasks or calendar changed. Preview a new plan before applying it.".into(),
        );
    }
    if p.events.is_empty() {
        return Err("There are no sessions to add.".into());
    }
    if p.events.iter().any(|e| {
        DateTime::parse_from_rfc3339(&e.start)
            .is_ok_and(|start| start.with_timezone(&Utc) < Utc::now())
    }) {
        return Err(
            "This plan is out of date. Preview again to avoid scheduling in the past.".into(),
        );
    }
    let tx = store
        .connection
        .unchecked_transaction()
        .map_err(sql_error)?;
    for input in &p.events {
        store.save_event(input.clone())?;
    }
    let after = store.snapshot()?;
    let inserted = after
        .events
        .iter()
        .filter(|e| !before.events.iter().any(|old| old.id == e.id))
        .map(|e| (e.id.clone(), e.updated_at.clone()))
        .collect::<Vec<_>>();
    store.put_preference(
        "last_plan",
        &serde_json::to_string(&inserted).map_err(|_| "Could not save undo history.")?,
    )?;
    tx.commit().map_err(sql_error)?;
    *pending = None;
    Ok(after)
}
pub fn undo(store: &Store) -> Result<Workspace> {
    let raw = store
        .preference("last_plan")
        .ok_or("There is no plan to undo.")?;
    let records: Vec<(String, String)> =
        serde_json::from_str(&raw).map_err(|_| "There is no plan to undo.")?;
    if records.is_empty() {
        return Err("There is no plan to undo.".into());
    }
    let snapshot = store.snapshot()?;
    if records.iter().any(|(id, revision)| {
        snapshot
            .events
            .iter()
            .find(|e| &e.id == id)
            .is_none_or(|e| &e.updated_at != revision || e.deleted_at.is_some())
    }) {
        return Err("A planned session was edited or removed. Undo was stopped to preserve your changes; adjust those sessions in Calendar.".into());
    }
    let tx = store
        .connection
        .unchecked_transaction()
        .map_err(sql_error)?;
    for (id, _) in records {
        store.set_deleted("event", &id, true)?;
    }
    store.put_preference("last_plan", "[]")?;
    tx.commit().map_err(sql_error)?;
    store.snapshot()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn undo_moves_only_untouched_generated_sessions_to_trash() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        store.connection.execute("INSERT INTO tasks(id,title,kind,status,priority,estimate_minutes,created_at,updated_at) VALUES('t','Study','study','todo','high',60,'old','old')",[]).unwrap();
        let db = Arc::new(Mutex::new(store));
        let pending = PendingPlan::default();
        let options = Options {
            start_date: Utc::now().date_naive().to_string(),
            time_zone: "UTC".into(),
            start_hour: 0,
            end_hour: 23,
            weekends: true,
            break_minutes: 0,
        };
        let proposal = preview(&db, &pending, options).unwrap();
        let applied = apply(&db, &pending, proposal.id).unwrap();
        assert!(!applied.events.is_empty());
        let snapshot = undo(&db.lock().unwrap()).unwrap();
        assert_eq!(snapshot.tasks.len(), 1);
        assert!(snapshot.tasks[0].deleted_at.is_none());
        assert!(snapshot.events.iter().all(|e| e.deleted_at.is_some()));
    }
    #[test]
    fn spring_dst_and_all_day_events_use_local_dates() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        store.connection.execute("INSERT INTO tasks(id,title,kind,status,priority,estimate_minutes,due_date,created_at,updated_at) VALUES('t','Study','study','todo','high',180,'2026-03-08','old','old')",[]).unwrap();
        let mut w = store.snapshot().unwrap();
        let options = Options {
            start_date: "2026-03-08".into(),
            time_zone: "America/Los_Angeles".into(),
            start_hour: 0,
            end_hour: 4,
            weekends: true,
            break_minutes: 0,
        };
        let now = DateTime::parse_from_rfc3339("2026-03-07T23:00:00-08:00")
            .unwrap()
            .with_timezone(&Utc);
        let p = plan(&w, &options, now).unwrap();
        assert!(p.unscheduled.is_empty());
        let total = p
            .events
            .iter()
            .map(|e| {
                (DateTime::parse_from_rfc3339(&e.end).unwrap()
                    - DateTime::parse_from_rfc3339(&e.start).unwrap())
                .num_minutes()
            })
            .sum::<i64>();
        assert_eq!(total, 180);
        w.events.push(crate::calendar::CalendarEvent {
            id: "busy".into(),
            title: "Away".into(),
            description: "".into(),
            start: "2026-03-08".into(),
            end: "2026-03-09".into(),
            all_day: true,
            time_zone: options.time_zone.clone(),
            tag_ids: vec![],
            task_id: None,
            created_at: "old".into(),
            updated_at: "old".into(),
            deleted_at: None,
        });
        let p = plan(&w, &options, now).unwrap();
        assert!(p.events.is_empty());
        assert_eq!(p.unscheduled[0].minutes, 180);
    }
    #[test]
    fn stale_proposals_and_edited_sessions_are_protected() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        store.connection.execute("INSERT INTO tasks(id,title,kind,status,priority,estimate_minutes,created_at,updated_at) VALUES('t','Study','study','todo','high',60,'old','old')",[]).unwrap();
        let db = Arc::new(Mutex::new(store));
        let pending = PendingPlan::default();
        let options = Options {
            start_date: Utc::now().date_naive().to_string(),
            time_zone: "UTC".into(),
            start_hour: 0,
            end_hour: 23,
            weekends: true,
            break_minutes: 5,
        };
        let proposal = preview(&db, &pending, options.clone()).unwrap();
        db.lock()
            .unwrap()
            .connection
            .execute("UPDATE tasks SET title='Changed'", [])
            .unwrap();
        assert!(apply(&db, &pending, proposal.id).is_err());
        let proposal = preview(&db, &pending, options).unwrap();
        assert!(!proposal.events.is_empty());
        let after = apply(&db, &pending, proposal.id).unwrap();
        assert!(!after.events.is_empty());
        let store = db.lock().unwrap();
        store
            .connection
            .execute("UPDATE calendar_events SET updated_at='edited'", [])
            .unwrap();
        assert!(undo(&store).is_err());
        assert!(store
            .snapshot()
            .unwrap()
            .events
            .iter()
            .all(|e| e.deleted_at.is_none()));
    }
    #[test]
    fn avoids_fixed_events_deadlines_and_all_day_blocks() {
        let mut w = Workspace {
            areas: vec![],
            courses: vec![],
            tasks: vec![],
            tags: vec![],
            events: vec![],
        };
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        store.connection.execute("INSERT INTO tasks(id,title,kind,status,priority,estimate_minutes,due_date,created_at,updated_at) VALUES('t','Study','study','todo','high',120,'2026-10-15','old','old')",[]).unwrap();
        w.tasks = store.snapshot().unwrap().tasks;
        let o = Options {
            start_date: "2026-10-15".into(),
            time_zone: "America/Los_Angeles".into(),
            start_hour: 9,
            end_hour: 10,
            weekends: false,
            break_minutes: 10,
        };
        let now = DateTime::parse_from_rfc3339("2026-10-15T08:00:00-07:00")
            .unwrap()
            .with_timezone(&Utc);
        let p = plan(&w, &o, now).unwrap();
        assert_eq!(p.events.len(), 1);
        assert_eq!(p.unscheduled[0].minutes, 60);
        let input = &p.events[0];
        let event = crate::calendar::CalendarEvent {
            id: "e".into(),
            title: "Busy".into(),
            description: "".into(),
            start: input.start.clone(),
            end: input.end.clone(),
            all_day: false,
            time_zone: o.time_zone.clone(),
            tag_ids: vec![],
            task_id: None,
            created_at: "old".into(),
            updated_at: "old".into(),
            deleted_at: None,
        };
        w.events.push(event);
        assert!(plan(&w, &o, now).unwrap().events.is_empty());
    }
}

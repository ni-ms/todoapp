use crate::{
    calendar::EventInput,
    planner::Unscheduled,
    task_scheduling::{instant, StudyWindow, TaskScheduling},
    workspace::{Result, Task, Workspace},
};
use chrono::{DateTime, Datelike, Duration, NaiveTime, TimeZone, Utc};
use std::collections::{HashMap, HashSet};
type Interval = (i64, i64);
const MINUTE: i64 = 60000;
fn subtract(gaps: &mut Vec<Interval>, a: i64, b: i64) {
    *gaps = gaps
        .iter()
        .flat_map(|&(x, y)| {
            if a < y && b > x {
                vec![(x, a.min(y)), (b.max(x), y)]
                    .into_iter()
                    .filter(|(s, e)| s < e)
                    .collect()
            } else {
                vec![(x, y)]
            }
        })
        .collect();
}
fn windows(gaps: &[Interval], list: &[StudyWindow], zone: chrono_tz::Tz) -> Vec<Interval> {
    if list.is_empty() {
        return gaps.to_vec();
    }
    let mut result = vec![];
    for &(a, b) in gaps {
        let mut date = DateTime::from_timestamp_millis(a)
            .unwrap()
            .with_timezone(&zone)
            .date_naive();
        let last = DateTime::from_timestamp_millis(b)
            .unwrap()
            .with_timezone(&zone)
            .date_naive();
        while date <= last {
            for w in list
                .iter()
                .filter(|w| w.days.contains(&date.weekday().number_from_monday()))
            {
                let start = NaiveTime::parse_from_str(&w.start, "%H:%M").unwrap();
                let end = NaiveTime::parse_from_str(&w.end, "%H:%M").unwrap();
                if let (Some(x), Some(y)) = (
                    zone.from_local_datetime(&date.and_time(start)).single(),
                    zone.from_local_datetime(&date.and_time(end)).single(),
                ) {
                    let x = x.timestamp_millis().max(a);
                    let y = y.timestamp_millis().min(b);
                    if x < y {
                        result.push((x, y));
                    }
                }
            }
            date += Duration::days(1);
        }
    }
    result.sort();
    let mut merged: Vec<Interval> = vec![];
    for (a, b) in result {
        if let Some(last) = merged.last_mut() {
            if a <= last.1 {
                last.1 = last.1.max(b);
                continue;
            }
        }
        merged.push((a, b));
    }
    merged
}
fn defaults(zone: &str) -> TaskScheduling {
    TaskScheduling {
        time_zone: zone.into(),
        work_date: None,
        deadline_at: None,
        earliest_start: None,
        fixed_start: None,
        fixed_end: None,
        remaining_minutes: None,
        dependencies: vec![],
        splittable: true,
        minimum_session_minutes: 5,
        preferred_session_minutes: 90,
        allowed_windows: vec![],
        preferred_windows: vec![],
        unresolved: vec![],
    }
}
fn work_bounds(s: &TaskScheduling) -> Interval {
    if let Some(d) = &s.work_date {
        let zone: chrono_tz::Tz = s.time_zone.parse().unwrap();
        let d = chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").unwrap();
        (
            zone.from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
                .earliest()
                .map(|d| d.timestamp_millis())
                .unwrap_or(i64::MAX),
            zone.from_local_datetime(&d.succ_opt().unwrap().and_hms_opt(0, 0, 0).unwrap())
                .latest()
                .map(|d| d.timestamp_millis())
                .unwrap_or(i64::MIN),
        )
    } else {
        (i64::MIN, i64::MAX)
    }
}
fn deadline(t: &Task, s: &TaskScheduling) -> i64 {
    let zone: chrono_tz::Tz = s.time_zone.parse().unwrap();
    let day = t
        .due_date
        .as_ref()
        .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        .and_then(|d| d.succ_opt())
        .and_then(|d| zone.from_local_datetime(&d.and_hms_opt(0, 0, 0)?).latest())
        .map(|d| d.timestamp_millis())
        .unwrap_or(i64::MAX);
    day.min(work_bounds(s).1).min(
        s.deadline_at
            .as_ref()
            .map(|s| instant(s).unwrap())
            .unwrap_or(i64::MAX),
    )
}
struct Engine<'a> {
    w: &'a Workspace,
    zone: &'a str,
    now: i64,
    pause: i64,
    gaps: Vec<Interval>,
    reservations: HashMap<String, Interval>,
    visiting: HashSet<String>,
    visited: HashSet<String>,
    completion: HashMap<String, i64>,
    events: Vec<EventInput>,
    unscheduled: Vec<Unscheduled>,
}
impl Engine<'_> {
    fn add(&mut self, t: &Task, s: &TaskScheduling, a: i64, b: i64) {
        self.events.push(EventInput {
            id: None,
            title: t.title.clone(),
            description: "Planned from your task's scheduling details. Move or resize to adjust."
                .into(),
            start: DateTime::from_timestamp_millis(a).unwrap().to_rfc3339(),
            end: DateTime::from_timestamp_millis(b).unwrap().to_rfc3339(),
            all_day: false,
            time_zone: s.time_zone.clone(),
            tag_ids: t
                .tag_ids
                .iter()
                .filter(|id| {
                    self.w
                        .tags
                        .iter()
                        .any(|tag| &tag.id == *id && tag.deleted_at.is_none())
                })
                .cloned()
                .collect(),
            task_id: Some(t.id.clone()),
        });
    }
    fn visit(&mut self, t: &Task) -> bool {
        if self.visited.contains(&t.id) {
            return self.completion.contains_key(&t.id);
        }
        if !self.visiting.insert(t.id.clone()) {
            return false;
        }
        let s = t.scheduling.clone().unwrap_or_else(|| defaults(self.zone));
        let zone: chrono_tz::Tz = s.time_zone.parse().unwrap();
        let mut earliest = self.now.max(work_bounds(&s).0).max(
            s.earliest_start
                .as_ref()
                .map(|s| instant(s).unwrap())
                .unwrap_or(self.now),
        );
        let mut reason = String::new();
        if !s.unresolved.is_empty() {
            reason =
                "Resolve the questions in this task's scheduling details before planning.".into();
        }
        let mut blockers = vec![];
        for dep in &s.dependencies {
            let p = self.w.tasks.iter().find(|p| &p.id == dep).cloned();
            match p {
                None => blockers.push(format!("Prerequisite task ({dep}) no longer exists. Remove it in Scheduling details.")),
                Some(p) if p.deleted_at.is_some() => blockers.push(format!("“{}” is in Trash. Restore it or remove it as a prerequisite.", p.title)),
                Some(_) if dep == &t.id => blockers.push(format!("“{}” lists itself as a prerequisite. Remove it in Scheduling details.", t.title)),
                Some(p) if p.status == "done" => {},
                Some(p) if self.visiting.contains(dep) => blockers.push(format!("Prerequisite loop involving “{}” and “{}”. Remove a dependency to break the loop.", t.title, p.title)),
                Some(p) => {
                    if self.visit(&p) {
                        earliest = earliest.max(*self.completion.get(dep).unwrap_or(&self.now));
                    } else {
                        blockers.push(format!("Waiting for “{}”, which could not be fully scheduled. Check its planning warning.", p.title));
                    }
                }
            }
        }
        if !blockers.is_empty() {
            if !reason.is_empty() {
                reason.push(' ');
            }
            reason.push_str(&blockers.join(" "));
        }
        let limit = deadline(t, &s);
        let effort = s.remaining_minutes.unwrap_or(t.estimate_minutes);
        let mut existing: Vec<Interval> = self
            .w
            .events
            .iter()
            .filter(|e| {
                e.deleted_at.is_none() && !e.all_day && e.task_id.as_deref() == Some(t.id.as_str())
            })
            .filter_map(|e| instant(&e.start).ok().zip(instant(&e.end).ok()))
            .filter(|&(a, b)| {
                a >= earliest
                    && b <= limit
                    && s.fixed_start.as_ref().is_none_or(|x| {
                        a == instant(x).unwrap()
                            && b == instant(s.fixed_end.as_ref().unwrap()).unwrap()
                    })
                    && windows(&[(a, b)], &s.allowed_windows, zone)
                        .iter()
                        .any(|&(x, y)| x <= a && y >= b)
            })
            .collect();
        existing.sort();
        let mut reserved = 0;
        let mut cursor = i64::MIN;
        let mut finish = earliest;
        for (a, b) in existing {
            reserved += (b - a.max(cursor)).max(0);
            cursor = cursor.max(b);
            finish = finish.max(b);
        }
        let mut remaining = (effort - reserved / MINUTE).max(0);
        if reason.is_empty() && remaining > 0 && s.fixed_start.is_some() {
            let pair = self.reservations.get(&t.id).copied();
            match pair {
                Some((a, b))
                    if a >= earliest
                        && (b - a) / MINUTE <= remaining
                        && (s.splittable || (b - a) / MINUTE == remaining)
                        && (b - a) / MINUTE >= s.minimum_session_minutes
                        && self.events.len() < 100 =>
                {
                    self.add(t, &s, a, b);
                    remaining = (remaining - (b - a) / MINUTE).max(0);
                    finish = finish.max(b);
                    if remaining > 0 {
                        reason="The fixed block covers only part of the remaining effort. Adjust it or remove the fixed time.".into();
                    }
                }
                _ => {
                    reason="The fixed block conflicts with commitments, availability, prerequisites, or remaining effort.".into();
                }
            }
        } else if reason.is_empty() && remaining > 0 {
            while remaining > 0 && self.events.len() < 100 {
                let bounded: Vec<Interval> = self
                    .gaps
                    .iter()
                    .map(|&(a, b)| (a.max(earliest), b.min(limit)))
                    .filter(|(a, b)| a < b)
                    .collect();
                let hard = windows(&bounded, &s.allowed_windows, zone);
                let mut candidates = if s.preferred_windows.is_empty() {
                    vec![]
                } else {
                    windows(&hard, &s.preferred_windows, zone)
                };
                candidates.extend(hard);
                let length = |a: i64, b: i64| {
                    let mut n = remaining
                        .min(if s.splittable {
                            s.preferred_session_minutes
                        } else {
                            remaining
                        })
                        .min((b - a) / MINUTE);
                    if s.splittable && remaining > n && remaining - n < s.minimum_session_minutes {
                        n = remaining - s.minimum_session_minutes;
                    }
                    n
                };
                let choice = candidates.into_iter().find(|&(a, b)| {
                    let n = length(a, b);
                    n >= s.minimum_session_minutes
                        && (s.splittable || n == remaining)
                        && (remaining - n == 0 || remaining - n >= s.minimum_session_minutes)
                });
                let Some((a, b)) = choice else {
                    break;
                };
                let n = length(a, b);
                let end = a + n * MINUTE;
                self.add(t, &s, a, end);
                remaining -= n;
                finish = finish.max(end);
                subtract(
                    &mut self.gaps,
                    a - self.pause * MINUTE,
                    end + self.pause * MINUTE,
                );
            }
        }
        if !reason.is_empty() || remaining > 0 {
            self.unscheduled.push(Unscheduled{task_id:t.id.clone(),title:t.title.clone(),minutes:remaining,reason:if !reason.is_empty(){reason}else if limit<=self.now{"Deadline has passed.".into()}else{"Not enough free time within the deadline, start, and session limits. Try more availability or smaller sessions.".into()}});
        } else {
            self.completion.insert(t.id.clone(), finish);
        }
        self.visiting.remove(&t.id);
        self.visited.insert(t.id.clone());
        self.completion.contains_key(&t.id)
    }
}
pub fn schedule(
    w: &Workspace,
    gaps: Vec<(DateTime<Utc>, DateTime<Utc>)>,
    zone: &str,
    now: DateTime<Utc>,
    pause: i64,
) -> Result<(Vec<EventInput>, Vec<Unscheduled>)> {
    let mut engine = Engine {
        w,
        zone,
        now: now.timestamp_millis(),
        pause,
        gaps: gaps
            .into_iter()
            .map(|(a, b)| (a.timestamp_millis(), b.timestamp_millis()))
            .collect(),
        reservations: HashMap::new(),
        visiting: HashSet::new(),
        visited: HashSet::new(),
        completion: HashMap::new(),
        events: vec![],
        unscheduled: vec![],
    };
    let mut tasks: Vec<Task> = w
        .tasks
        .iter()
        .filter(|t| t.deleted_at.is_none() && t.status != "done")
        .cloned()
        .collect();
    for t in &tasks {
        if let Some(s) = &t.scheduling {
            s.validate(t.estimate_minutes)?;
        }
    }
    let mut fixed: Vec<_> = tasks
        .iter()
        .filter(|t| {
            t.scheduling
                .as_ref()
                .is_some_and(|s| s.fixed_start.is_some())
        })
        .collect();
    fixed.sort_by_key(|t| {
        (
            instant(t.scheduling.as_ref().unwrap().fixed_start.as_ref().unwrap()).unwrap(),
            t.id.clone(),
        )
    });
    for t in fixed {
        let s = t.scheduling.as_ref().unwrap();
        if s.remaining_minutes == Some(0) {
            continue;
        }
        let a = instant(s.fixed_start.as_ref().unwrap())?;
        let b = instant(s.fixed_end.as_ref().unwrap())?;
        if s.unresolved.is_empty()
            && a >= engine.now.max(work_bounds(s).0)
            && b <= deadline(t, s)
            && a >= s
                .earliest_start
                .as_ref()
                .map(|s| instant(s).unwrap())
                .unwrap_or(engine.now)
            && windows(
                &engine.gaps,
                &s.allowed_windows,
                s.time_zone.parse().unwrap(),
            )
            .iter()
            .any(|&(x, y)| x <= a && y >= b)
        {
            engine.reservations.insert(t.id.clone(), (a, b));
            subtract(&mut engine.gaps, a - pause * MINUTE, b + pause * MINUTE);
        }
    }
    let rank = |t: &Task| match t.priority.as_str() {
        "high" => 0,
        "medium" => 1,
        _ => 2,
    };
    tasks.sort_by_key(|t| {
        (
            deadline(t, &t.scheduling.clone().unwrap_or_else(|| defaults(zone))),
            rank(t),
            t.created_at.clone(),
            t.id.clone(),
        )
    });
    for t in tasks {
        engine.visit(&t);
    }
    Ok((engine.events, engine.unscheduled))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shares_browser_scheduling_fixtures() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/scheduling-parity.json"))
                .unwrap();
        for c in fixtures.as_array().unwrap() {
            let w: Workspace = serde_json::from_value(c["workspace"].clone()).unwrap();
            let options = serde_json::from_value(c["options"].clone()).unwrap();
            let p = crate::planner::plan(
                &w,
                &options,
                DateTime::parse_from_rfc3339(c["now"].as_str().unwrap())
                    .unwrap()
                    .with_timezone(&Utc),
            )
            .unwrap();
            let actual:Vec<_>=p.events.iter().map(|e|serde_json::json!({"taskId":e.task_id,"start":instant(&e.start).unwrap(),"end":instant(&e.end).unwrap()})).collect();
            let expected:Vec<_>=c["blocks"].as_array().unwrap().iter().map(|e|serde_json::json!({"taskId":e["taskId"],"start":instant(e["start"].as_str().unwrap()).unwrap(),"end":instant(e["end"].as_str().unwrap()).unwrap()})).collect();
            assert_eq!(actual, expected, "{}", c["name"]);
            let actual: Vec<_> = p
                .unscheduled
                .iter()
                .map(|e| serde_json::json!({"title":e.title,"minutes":e.minutes}))
                .collect();
            let expected: Vec<_> = c["unscheduled"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| serde_json::json!({"title": e["title"], "minutes": e["minutes"]}))
                .collect();
            assert_eq!(actual, expected, "{}", c["name"]);
            for warning in c["unscheduled"].as_array().unwrap() {
                if let Some(reason) = warning["reason"].as_str() {
                    let actual = p
                        .unscheduled
                        .iter()
                        .find(|e| e.task_id == warning["taskId"].as_str().unwrap())
                        .unwrap();
                    assert_eq!(actual.reason, reason, "{}", c["name"]);
                }
            }
        }
    }
}

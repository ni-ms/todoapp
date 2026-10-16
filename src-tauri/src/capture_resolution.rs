use crate::{local_ai::Draft, workspace::Result};
use chrono::{Datelike, Duration, NaiveDate, TimeZone};
use regex::Regex;
use serde_json::Value;
fn re(p: &str) -> Regex {
    Regex::new(&format!("(?i){p}")).unwrap()
}
#[derive(Clone, Copy)]
struct Clock {
    minutes: u32,
    ambiguous: bool,
}
fn clock(c: Option<regex::Captures<'_>>, offset: usize) -> Option<Clock> {
    let c = c?;
    let hour: u32 = c.get(offset)?.as_str().parse().ok()?;
    let minute: u32 = c
        .get(offset + 1)
        .map(|v| v.as_str().parse().ok())
        .unwrap_or(Some(0))?;
    let meridiem = c.get(offset + 2).map(|v| v.as_str().to_lowercase());
    if minute > 59 || hour > 23 || meridiem.as_ref().is_some_and(|_| !(1..=12).contains(&hour)) {
        return None;
    }
    Some(Clock {
        minutes: (meridiem
            .as_ref()
            .map(|m| hour % 12 + if m == "pm" { 12 } else { 0 })
            .unwrap_or(hour))
            * 60
            + minute,
        ambiguous: meridiem.is_none() && (1..=12).contains(&hour),
    })
}
fn hhmm(n: u32) -> String {
    format!("{:02}:{:02}", n / 60, n % 60)
}
fn window(start: &str, end: &str) -> crate::task_scheduling::StudyWindow {
    crate::task_scheduling::StudyWindow {
        days: (1..=7).collect(),
        start: start.into(),
        end: end.into(),
    }
}
fn date_for(word: &str, today: NaiveDate) -> Result<NaiveDate> {
    let word = word.to_lowercase();
    if word == "today" {
        return Ok(today);
    }
    if word == "tomorrow" {
        return Ok(today + Duration::days(1));
    }
    if let Some(day) = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ]
    .iter()
    .position(|d| *d == word)
    {
        return Ok(today
            + Duration::days(
                (day as i64 + 1 - today.weekday().number_from_monday() as i64 + 7) % 7,
            ));
    }
    NaiveDate::parse_from_str(&word, "%Y-%m-%d").map_err(|_| "Invalid explicit date.".into())
}
pub fn resolve(
    mut drafts: Vec<Draft>,
    request: &str,
    today: &str,
    time_zone: &str,
    calendar: &[Value],
) -> Result<Vec<Draft>> {
    let rules: Value = serde_json::from_str(include_str!("../../lib/capture-rules.json")).unwrap();
    let pattern = |name: &str| re(rules[name].as_str().unwrap());
    struct Effort {
        minutes: i64,
        session: bool,
        remaining: bool,
    }
    let mut durations = vec![];
    for c in pattern("duration").captures_iter(request) {
        if pattern("compoundNumberPrefix").is_match(&request[..c.get(0).unwrap().start()]) {
            continue;
        }
        let value = c[1].to_lowercase();
        let n = rules["numbers"][&value]
            .as_f64()
            .or_else(|| value.parse().ok())
            .unwrap();
        let minutes = n * if c[2].to_lowercase().starts_with('h') {
            60.0
        } else {
            1.0
        };
        if minutes.fract() != 0.0 || !(0.0..=1440.0).contains(&minutes) {
            continue;
        }
        let m = c.get(0).unwrap();
        let suffix = &request[m.end()..];
        let prefix = &request[..m.start()];
        durations.push(Effort {
            minutes: minutes as i64,
            session: pattern("sessionSuffix").is_match(suffix),
            remaining: pattern("remainingSuffix").is_match(suffix)
                || pattern("remainingPrefix").is_match(prefix),
        });
    }
    let totals: Vec<_> = durations
        .iter()
        .filter(|v| !v.session && !v.remaining)
        .collect();
    for d in &mut drafts {
        if !pattern("priority").is_match(request) {
            d.priority = "medium".into();
            if !d.estimated_fields.iter().any(|f| f == "priority") {
                d.estimated_fields.push("priority".into());
            }
        }
        if totals.iter().any(|v| v.minutes == d.estimate_minutes) {
            d.estimated_fields.retain(|f| f != "estimateMinutes");
        } else if !pattern("durationUnit").is_match(request)
            && !d.estimated_fields.iter().any(|f| f == "estimateMinutes")
        {
            d.estimated_fields.push("estimateMinutes".into());
        }
    }
    if drafts.len() == 2
        && re(r"\bbefore\b").find_iter(request).count() == 1
        && !pattern("deadlineDay").is_match(request)
        && !re(r"\b(?:after|unless|if)\b").is_match(request)
    {
        drafts[0].scheduling.dependencies.clear();
        drafts[1].scheduling.dependencies = vec!["draft:0".into()];
    }
    if drafts.len() != 1 {
        return Ok(drafts);
    }
    let d = &mut drafts[0];
    let s = &mut d.scheduling;
    if totals.len() == 1 || totals.len() > 1 && pattern("correction").is_match(request) {
        d.estimate_minutes = totals.last().unwrap().minutes;
        d.estimated_fields.retain(|f| f != "estimateMinutes");
    }
    if totals.len() > 1 && pattern("correction").is_match(request) {
        d.title = pattern("duration")
            .replace_all(&d.title, |c: &regex::Captures| {
                let number = c[1].to_lowercase();
                let value = rules["numbers"][&number]
                    .as_f64()
                    .or_else(|| number.parse().ok())
                    .unwrap()
                    * if c[2].to_lowercase().starts_with('h') {
                        60.0
                    } else {
                        1.0
                    };
                if value != d.estimate_minutes as f64
                    && totals.iter().any(|v| v.minutes as f64 == value)
                {
                    format!("{} minutes", d.estimate_minutes)
                } else {
                    c[0].to_string()
                }
            })
            .into_owned();
    }
    if let Some(v) = durations.iter().rev().find(|v| v.remaining) {
        s.remaining_minutes = Some(v.minutes);
    }
    let session = durations.iter().rev().find(|v| v.session);
    if let Some(v) = session {
        if !re(r"\bbreaks?\b").is_match(request) {
            s.minimum_session_minutes = v.minutes;
            s.preferred_session_minutes = v.minutes;
        }
    }
    if pattern("split").is_match(request) {
        s.splittable = true;
    }
    if pattern("singleSitting").is_match(request) {
        s.splittable = false;
        if session.is_none() {
            s.minimum_session_minutes = 5;
            s.preferred_session_minutes = 90;
        }
    }
    let mut questions = vec![];
    let recurring = pattern("recurrence").is_match(request);
    let question = |name: &str| rules["questions"][name].as_str().unwrap().to_string();
    if recurring {
        questions.push(question("recurrence"));
    }
    let today = NaiveDate::parse_from_str(today, "%Y-%m-%d").map_err(|_| "Invalid local date.")?;
    let mut days = vec![];
    for c in pattern("relativeDay").captures_iter(request) {
        days.push(date_for(&c[1], today)?);
    }
    for c in pattern("isoDate").captures_iter(request) {
        days.push(date_for(&c[0], today)?);
    }
    days.sort();
    days.dedup();
    let deadline = pattern("deadlineDay");
    let deadline = deadline.captures(request);
    let simple_day = days.len() == 1 && !re(r"\bnext\s").is_match(request) && !recurring;
    let zone_match = pattern("zone");
    let zone_text = zone_match
        .find(request)
        .map(|m| m.as_str())
        .unwrap_or(time_zone);
    let zone_text = if zone_text.eq_ignore_ascii_case("UTC") {
        "UTC"
    } else {
        zone_text
    };
    let zone: chrono_tz::Tz = zone_text
        .parse()
        .map_err(|_| "Invalid explicit time zone.")?;
    let instant = |date: NaiveDate, n: u32| -> Result<String> {
        zone.from_local_datetime(
            &date
                .and_hms_opt(n / 60, n % 60, 0)
                .ok_or("Invalid local time.")?,
        )
        .single()
        .map(|d| {
            d.with_timezone(&chrono::Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        })
        .ok_or("That local time is ambiguous or does not exist because of a clock change.".into())
    };
    let clock_pattern = rules["clock"].as_str().unwrap();
    let at_re = re(&format!(r"\bat\s+{clock_pattern}"));
    let at = clock(at_re.captures(request), 1);
    let cutoff_re = re(&format!(r"\bnever\s+after\s+{clock_pattern}"));
    let cutoff = clock(cutoff_re.captures(request), 1);
    let lower_re = re(&format!(r"\bonly\s+after\s+{clock_pattern}"));
    let lower = clock(lower_re.captures(request), 1);
    let conflict = cutoff
        .zip(lower)
        .is_some_and(|(a, b)| !a.ambiguous && !b.ambiguous && b.minutes >= a.minutes);
    if conflict {
        questions.push(question("conflict"));
        s.allowed_windows.clear();
        if !pattern("preferenceCue").is_match(request) {
            s.preferred_windows.clear();
        }
        s.earliest_start = None;
    } else if let Some(t) = cutoff.filter(|t| !t.ambiguous) {
        s.allowed_windows = vec![window("00:00", &hhmm(t.minutes))];
    }
    if re(r"\bprefer\s+evenings?\b").is_match(request) {
        s.preferred_windows = vec![window(
            "18:00",
            &hhmm(
                cutoff
                    .filter(|t| !t.ambiguous)
                    .map(|t| t.minutes.min(1260))
                    .unwrap_or(1260),
            ),
        )];
    }
    let range_re = re(&format!(
        r"\bfrom\s+{clock_pattern}\s+(?:to|until|–|-)\s+{clock_pattern}"
    ));
    let range_start = clock(range_re.captures(request), 1);
    let range_end = clock(range_re.captures(request), 4);
    if simple_day {
        s.time_zone = zone_text.into();
        if let Some(deadline) = &deadline {
            let date = date_for(&deadline[1], today)?;
            d.due_date = Some(date.to_string());
            s.work_date = None;
            s.deadline_at = match at {
                Some(t) if !t.ambiguous => Some(instant(date, t.minutes)?),
                _ => None,
            };
        } else if !pattern("deadlineCue").is_match(request)
            && !pattern("workDateExclusion").is_match(
                &request[..pattern("relativeDay")
                    .find(request)
                    .map(|m| m.start())
                    .into_iter()
                    .chain(pattern("isoDate").find(request).map(|m| m.start()))
                    .min()
                    .unwrap_or(0)],
            )
        {
            d.due_date = None;
            s.deadline_at = None;
            s.work_date = Some(days[0].to_string());
        }
        if let Some((a, b)) = range_start
            .zip(range_end)
            .filter(|(a, b)| !a.ambiguous && !b.ambiguous)
        {
            s.fixed_start = Some(instant(days[0], a.minutes)?);
            s.fixed_end = Some(instant(days[0], b.minutes)?);
            s.work_date = None;
            s.splittable = false;
            if totals.is_empty() {
                let elapsed = (crate::task_scheduling::instant(s.fixed_end.as_ref().unwrap())?
                    - crate::task_scheduling::instant(s.fixed_start.as_ref().unwrap())?)
                    / 60000;
                if (5..=1440).contains(&elapsed) {
                    d.estimate_minutes = elapsed;
                    d.estimated_fields.retain(|f| f != "estimateMinutes");
                }
            }
            if s.earliest_start.as_ref().is_some_and(|t| {
                crate::task_scheduling::instant(t).ok()
                    == s.fixed_start
                        .as_ref()
                        .and_then(|s| crate::task_scheduling::instant(s).ok())
            }) {
                s.earliest_start = None;
            }
        }
    }
    if at.is_some_and(|t| t.ambiguous) {
        questions.push(question("ambiguousTime"));
        s.fixed_start = None;
        s.fixed_end = None;
        if deadline.is_some() {
            s.deadline_at = None;
        }
    }
    if pattern("afterClass").is_match(request) && !pattern("classEnd").is_match(request) {
        let events: Vec<_> = calendar
            .iter()
            .filter(|e| e["allDay"] == false)
            .filter(|e| {
                !simple_day
                    || e["end"]
                        .as_str()
                        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                        .is_some_and(|t| t.with_timezone(&zone).date_naive() == days[0])
            })
            .collect();
        if events.len() == 1 {
            s.earliest_start = events[0]["end"].as_str().map(str::to_owned);
            s.unresolved.retain(|q| !re(r"\bclass\b").is_match(q));
        } else {
            questions.push(question("class"));
            s.earliest_start = None;
        }
    }
    if !questions.is_empty() {
        for q in std::mem::take(&mut s.unresolved) {
            if !questions.contains(&q) {
                questions.push(q);
            }
        }
        s.unresolved = questions;
    }
    Ok(drafts)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replay_real_model_failures_and_independent_phrase_fixtures() {
        let cases: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/capture-resolution.json"))
                .unwrap();
        for c in cases.as_array().unwrap() {
            let drafts = crate::local_ai::validate_drafts(
                &serde_json::json!({"tasks":c["raw"]}).to_string(),
                &[],
            )
            .unwrap();
            let result = resolve(
                drafts,
                c["request"].as_str().unwrap(),
                c["today"].as_str().unwrap(),
                c["timeZone"].as_str().unwrap(),
                c["calendarContext"].as_array().unwrap(),
            )
            .unwrap();
            assert_eq!(
                serde_json::to_value(result).unwrap(),
                c["expected"],
                "{}",
                c["name"]
            );
        }
    }
    #[test]
    fn shared_prompt_and_examples_are_identical_to_browser() {
        let c: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/capture-message-parity.json"
        ))
        .unwrap();
        let actual = crate::local_ai::capture_messages(
            c["request"].as_str().unwrap(),
            c["context"].as_array().unwrap(),
            c["calendarContext"].as_array().unwrap(),
            c["today"].as_str().unwrap(),
            c["timeZone"].as_str().unwrap(),
            c["now"].as_str().unwrap(),
            c["tags"].as_array().unwrap(),
        )
        .unwrap();
        assert_eq!(serde_json::json!(actual), c["messages"]);
    }
}

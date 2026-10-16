use crate::workspace::Workspace;
use chrono::{DateTime, NaiveDate, Utc};
fn escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\\n")
        .replace(';', "\\;")
        .replace(',', "\\,")
}
fn line(output: &mut String, value: &str) {
    let mut count = 0;
    for c in value.chars() {
        if count + c.len_utf8() > 75 {
            output.push_str("\r\n ");
            count = 1;
        }
        output.push(c);
        count += c.len_utf8();
    }
    output.push_str("\r\n");
}
fn stamp(value: &str) -> String {
    DateTime::parse_from_rfc3339(value)
        .map(|v| v.with_timezone(&Utc).format("%Y%m%dT%H%M%SZ").to_string())
        .unwrap_or_else(|_| "19700101T000000Z".into())
}
pub fn calendar(workspace: &Workspace) -> String {
    let mut out = String::new();
    for s in [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Daymark//Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Daymark",
    ] {
        line(&mut out, s);
    }
    for event in workspace.events.iter().filter(|v| v.deleted_at.is_none()) {
        line(&mut out, "BEGIN:VEVENT");
        line(&mut out, &format!("UID:event-{}@daymark.local", event.id));
        line(&mut out, &format!("DTSTAMP:{}", stamp(&event.updated_at)));
        line(
            &mut out,
            &format!("LAST-MODIFIED:{}", stamp(&event.updated_at)),
        );
        if event.all_day {
            line(
                &mut out,
                &format!("DTSTART;VALUE=DATE:{}", event.start.replace('-', "")),
            );
            line(
                &mut out,
                &format!("DTEND;VALUE=DATE:{}", event.end.replace('-', "")),
            );
        } else {
            line(&mut out, &format!("DTSTART:{}", stamp(&event.start)));
            line(&mut out, &format!("DTEND:{}", stamp(&event.end)));
        }
        line(&mut out, &format!("SUMMARY:{}", escape(&event.title)));
        line(
            &mut out,
            &format!("DESCRIPTION:{}", escape(&event.description)),
        );
        line(&mut out, "END:VEVENT");
    }
    for task in workspace
        .tasks
        .iter()
        .filter(|t| t.deleted_at.is_none() && t.status != "done" && t.due_date.is_some())
    {
        if let Ok(date) =
            NaiveDate::parse_from_str(task.due_date.as_deref().unwrap_or(""), "%Y-%m-%d")
        {
            if let Some(end) = date.succ_opt() {
                line(&mut out, "BEGIN:VEVENT");
                line(&mut out, &format!("UID:task-{}@daymark.local", task.id));
                line(&mut out, &format!("DTSTAMP:{}", stamp(&task.updated_at)));
                line(
                    &mut out,
                    &format!("DTSTART;VALUE=DATE:{}", date.format("%Y%m%d")),
                );
                line(
                    &mut out,
                    &format!("DTEND;VALUE=DATE:{}", end.format("%Y%m%d")),
                );
                line(
                    &mut out,
                    &format!("SUMMARY:{}", escape(&format!("Due: {}", task.title))),
                );
                line(
                    &mut out,
                    &format!("DESCRIPTION:{}", escape(&task.description)),
                );
                line(&mut out, "TRANSP:TRANSPARENT");
                line(&mut out, "END:VEVENT");
            }
        }
    }
    line(&mut out, "END:VCALENDAR");
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn escapes_and_folds_utf8_without_breaking_codepoints() {
        let mut out = String::new();
        let value = format!(
            "SUMMARY:{}",
            escape(&format!("{}\nmeet, code; learn\\", "é".repeat(70)))
        );
        line(&mut out, &value);
        assert!(out.split("\r\n").all(|l| l.len() <= 75));
        assert_eq!(out.replace("\r\n ", "").trim_end(), value);
        assert!(out.contains("\\nmeet\\, code\\; learn\\\\"));
    }
    #[test]
    fn exports_deadline_as_exclusive_all_day_date() {
        let store = crate::workspace::Store::open(std::path::Path::new(":memory:")).unwrap();
        store
            .save_task(crate::workspace::TaskInput {
                id: None,
                title: "A, B".into(),
                description: "line\nnext".into(),
                course_id: None,
                kind: "study".into(),
                status: "todo".into(),
                priority: "medium".into(),
                due_date: Some("2026-12-31".into()),
                estimate_minutes: 30,
                scheduling: None,
                tag_ids: None,
            })
            .unwrap();
        let w = store.snapshot().unwrap();
        let text = calendar(&w);
        assert!(text.contains("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101"));
        assert!(text.contains("SUMMARY:Due: A\\, B"));
        assert!(text.ends_with("END:VCALENDAR\r\n"));
        assert_eq!(text, calendar(&w));
    }
}

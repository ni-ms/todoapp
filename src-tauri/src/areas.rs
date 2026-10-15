use crate::workspace::{sql_error, Result, Store, Workspace};
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub tag_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AreaInput {
    pub id: Option<String>,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub tag_ids: Vec<String>,
}
impl Store {
    pub fn areas(&self) -> Result<Vec<Area>> {
        self.connection.prepare("SELECT id,name,color,icon,tag_ids,created_at,updated_at,deleted_at FROM areas ORDER BY created_at,id").map_err(sql_error)?
            .query_map([], |r| Ok(Area { id:r.get(0)?, name:r.get(1)?, color:r.get(2)?, icon:r.get(3)?, tag_ids:serde_json::from_str(&r.get::<_,String>(4)?).unwrap_or_default(), created_at:r.get(5)?, updated_at:r.get(6)?, deleted_at:r.get(7)? })).map_err(sql_error)?
            .collect::<std::result::Result<Vec<_>,_>>().map_err(sql_error)
    }
    pub fn save_area(&self, input: AreaInput) -> Result<Workspace> {
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 200 {
            return Err("Area names must be 1–200 characters.".into());
        }
        if !["violet", "blue", "emerald", "amber", "rose"].contains(&input.color.as_str()) {
            return Err("Invalid area color.".into());
        }
        crate::calendar::validate_icon(&input.icon)?;
        if input.tag_ids.is_empty() {
            return Err("Choose at least one tag for this area.".into());
        }
        let existing = if let Some(id) = &input.id {
            self.require_record("areas", id, false)?;
            self.areas()?
                .into_iter()
                .find(|a| &a.id == id)
                .map(|a| a.tag_ids)
                .unwrap_or_default()
        } else {
            vec![]
        };
        self.validate_tags(&input.tag_ids, &existing)?;
        let duplicate:bool = self.connection.query_row("SELECT EXISTS(SELECT 1 FROM areas WHERE lower(name)=lower(?1) AND deleted_at IS NULL AND id!=?2)", params![name,input.id.as_deref().unwrap_or("")], |r|r.get(0)).map_err(sql_error)?;
        if duplicate {
            return Err("An area with this name already exists.".into());
        }
        let now = Utc::now().to_rfc3339();
        let tags = serde_json::to_string(&input.tag_ids).map_err(|_| "Invalid tags.")?;
        if let Some(id) = input.id {
            self.connection.execute("UPDATE areas SET name=?1,color=?2,icon=?3,tag_ids=?4,updated_at=?5 WHERE id=?6", params![name,input.color,input.icon,tags,now,id]).map_err(sql_error)?;
        } else {
            self.connection.execute("INSERT INTO areas(id,name,color,icon,tag_ids,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)", params![uuid::Uuid::new_v4().to_string(),name,input.color,input.icon,tags,now]).map_err(sql_error)?;
        }
        self.snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> AreaInput {
        AreaInput {
            id: None,
            name: "Developer journey".into(),
            color: "blue".into(),
            icon: "code".into(),
            tag_ids: vec!["tag-learning".into(), "tag-career".into()],
        }
    }
    #[test]
    fn areas_are_independent_and_migration_seeds_only_once() {
        let mut store = Store::open(std::path::Path::new(":memory:")).unwrap();
        assert_eq!(store.areas().unwrap().len(), 3);
        store.connection.execute("INSERT INTO tags(id,name,color,icon,created_at,updated_at) VALUES('new','New tag','blue','hash','now','now')", []).unwrap();
        store.migrate().unwrap();
        assert_eq!(store.areas().unwrap().len(), 3);
        let w = store.save_area(input()).unwrap();
        let area = w
            .areas
            .iter()
            .find(|a| a.name == "Developer journey")
            .unwrap();
        let id = area.id.clone();
        assert_eq!(area.tag_ids.len(), 2);
        store
            .connection
            .execute("UPDATE tags SET name='Renamed' WHERE id='tag-learning'", [])
            .unwrap();
        assert_eq!(
            store
                .areas()
                .unwrap()
                .iter()
                .find(|a| a.id == id)
                .unwrap()
                .name,
            "Developer journey"
        );
        let mut edit = input();
        edit.id = Some(id.clone());
        edit.name = "Programming".into();
        store.save_area(edit).unwrap();
        assert_eq!(
            store
                .tags()
                .unwrap()
                .iter()
                .find(|t| t.id == "tag-learning")
                .unwrap()
                .name,
            "Renamed"
        );
        store.set_deleted("area", &id, true).unwrap();
        store.purge_record("area", &id).unwrap();
        assert_eq!(store.tags().unwrap().len(), 4);
        assert!(store.tags().unwrap().iter().all(|t| t.deleted_at.is_none()));
    }
    #[test]
    fn validates_area_associations_and_tag_deletion_keeps_area() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        let before = store.areas().unwrap().len();
        let mut invalid = input();
        invalid.tag_ids.clear();
        assert!(store.save_area(invalid).is_err());
        let mut invalid = input();
        invalid.tag_ids.push("missing".into());
        assert!(store.save_area(invalid).is_err());
        let mut invalid = input();
        invalid.tag_ids.push("tag-learning".into());
        assert!(store.save_area(invalid).is_err());
        assert_eq!(store.areas().unwrap().len(), before);
        store.save_area(input()).unwrap();
        assert!(store.save_area(input()).is_err());
        store.set_deleted("tag", "tag-learning", true).unwrap();
        let w = store.delete_tag("tag-learning").unwrap();
        let area = w
            .areas
            .iter()
            .find(|a| a.name == "Developer journey")
            .unwrap();
        assert_eq!(area.tag_ids, vec!["tag-career"]);
        assert!(area.deleted_at.is_none());
        assert_eq!(w.areas.len(), before + 1);
    }
}

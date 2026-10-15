ALTER TABLE tasks ADD COLUMN tag_ids TEXT NOT NULL DEFAULT '[]';
CREATE TABLE tags (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, icon TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
INSERT INTO tags (id,name,color,icon,created_at,updated_at) VALUES
 ('tag-learning','Learning','violet','book',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('tag-building','Building','blue','code',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('tag-career','Career','emerald','briefcase',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
UPDATE tasks SET tag_ids=CASE WHEN kind IN ('study','assignment') THEN '["tag-learning"]' WHEN kind='coding' THEN '["tag-building"]' WHEN kind='career' THEN '["tag-career"]' ELSE '[]' END;
CREATE TABLE calendar_events (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
 start TEXT NOT NULL, end TEXT NOT NULL, all_day INTEGER NOT NULL CHECK(all_day IN (0,1)),
 time_zone TEXT NOT NULL, tag_ids TEXT NOT NULL DEFAULT '[]', task_id TEXT REFERENCES tasks(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX events_start ON calendar_events(deleted_at,start);
CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 2;

CREATE TABLE areas (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, icon TEXT NOT NULL,
 tag_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
-- Preserve the previously visible spaces once; future tag changes never create or rename areas.
INSERT INTO areas SELECT 'area-' || id,name,color,icon,json_array(id),created_at,updated_at,NULL FROM tags WHERE deleted_at IS NULL;
PRAGMA user_version=5;

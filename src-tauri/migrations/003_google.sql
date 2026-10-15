CREATE TABLE google_event_state (
 entity_key TEXT PRIMARY KEY, google_id TEXT NOT NULL, revision TEXT NOT NULL, etag TEXT NOT NULL
);
PRAGMA user_version=3;

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  code TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('course', 'project', 'career')),
  color TEXT NOT NULL CHECK(color IN ('violet', 'blue', 'emerald', 'amber', 'rose')),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  course_id TEXT REFERENCES courses(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('study', 'assignment', 'coding', 'career', 'personal')),
  status TEXT NOT NULL CHECK(status IN ('todo', 'doing', 'done')),
  priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')),
  due_date TEXT,
  estimate_minutes INTEGER NOT NULL CHECK(estimate_minutes BETWEEN 5 AND 1440),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX tasks_course ON tasks(course_id);
CREATE INDEX tasks_deadline ON tasks(deleted_at, due_date);
PRAGMA user_version = 1;

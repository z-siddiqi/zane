-- Events (WebSocket relay logs)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  turn_id TEXT,
  direction TEXT NOT NULL,
  role TEXT NOT NULL,
  method TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_thread ON events(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_events_method ON events(method);

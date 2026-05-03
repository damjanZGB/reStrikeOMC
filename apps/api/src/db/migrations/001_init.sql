CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE connections (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  host                TEXT NOT NULL,
  port                INTEGER NOT NULL,
  password_ciphertext BLOB,
  password_iv         BLOB,
  created_at          INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action  TEXT NOT NULL,
  targets TEXT NOT NULL,
  result  TEXT NOT NULL
);

CREATE INDEX idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id);

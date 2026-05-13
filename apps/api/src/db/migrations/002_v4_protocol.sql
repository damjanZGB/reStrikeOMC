-- obs-websocket protocol selection — per-connection override + global default.
--
-- connections.protocol is NULL when the row should follow the global default.
-- 'v4' or 'v5' overrides it for that connection. Existing rows are NULL so
-- they inherit the seeded 'v5' default, preserving pre-feature behaviour.

ALTER TABLE connections ADD COLUMN protocol TEXT;

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_settings (key, value) VALUES ('defaultProtocol', 'v5');

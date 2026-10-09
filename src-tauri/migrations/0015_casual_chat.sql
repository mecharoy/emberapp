-- Casual chat: talk about anything, any time, apart from the day's journal
-- conversation. A thread is one chat; its messages hang off thread_uid.
--
-- No foreign key on purpose: a sync batch can bring a message before the
-- thread it belongs to lands, and a stray message is harmless (the thread
-- list is read from chat_threads).
--
-- approach: the style this chat was started in (friend | coach | therapist),
-- "" = whatever Settings says.

CREATE TABLE chat_threads (
  uid TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  approach TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chat_messages (
  uid TEXT PRIMARY KEY,
  thread_uid TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_chat_messages_thread ON chat_messages (thread_uid, created_at);

CREATE TRIGGER sync_chat_threads_insert AFTER INSERT ON chat_threads WHEN NEW.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'chat_threads' AND pk = CAST(NEW.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'chat_threads', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_chat_threads_update AFTER UPDATE ON chat_threads WHEN OLD.uid IS NOT NEW.uid OR OLD.title IS NOT NEW.title OR OLD.approach IS NOT NEW.approach OR OLD.created_at IS NOT NEW.created_at OR OLD.updated_at IS NOT NEW.updated_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'chat_threads' AND pk = CAST(OLD.uid AS TEXT) AND OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'chat_threads', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  DELETE FROM sync_changes WHERE tbl = 'chat_threads' AND pk = CAST(NEW.uid AS TEXT) AND NEW.uid IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'chat_threads', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.uid IS NOT NULL;
END;

CREATE TRIGGER sync_chat_threads_delete AFTER DELETE ON chat_threads WHEN OLD.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'chat_threads' AND pk = CAST(OLD.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'chat_threads', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

CREATE TRIGGER sync_chat_messages_insert AFTER INSERT ON chat_messages WHEN NEW.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'chat_messages' AND pk = CAST(NEW.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'chat_messages', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL;
END;

CREATE TRIGGER sync_chat_messages_update AFTER UPDATE ON chat_messages WHEN OLD.uid IS NOT NEW.uid OR OLD.thread_uid IS NOT NEW.thread_uid OR OLD.role IS NOT NEW.role OR OLD.content IS NOT NEW.content OR OLD.created_at IS NOT NEW.created_at BEGIN
  DELETE FROM sync_changes WHERE tbl = 'chat_messages' AND pk = CAST(OLD.uid AS TEXT) AND OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'chat_messages', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL WHERE OLD.uid IS NOT NULL AND ((OLD.uid IS NOT NEW.uid));
  DELETE FROM sync_changes WHERE tbl = 'chat_messages' AND pk = CAST(NEW.uid AS TEXT) AND NEW.uid IS NOT NULL;
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'chat_messages', CAST(NEW.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL WHERE NEW.uid IS NOT NULL;
END;

CREATE TRIGGER sync_chat_messages_delete AFTER DELETE ON chat_messages WHEN OLD.uid IS NOT NULL BEGIN
  DELETE FROM sync_changes WHERE tbl = 'chat_messages' AND pk = CAST(OLD.uid AS TEXT);
  INSERT INTO sync_changes (tbl, pk, rev, changed_at, deleted, origin)
  SELECT 'chat_messages', CAST(OLD.uid AS TEXT), (SELECT COALESCE(MAX(rev), 0) + 1 FROM sync_changes), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, NULL;
END;

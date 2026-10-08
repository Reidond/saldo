PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscriptions(id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id), data TEXT NOT NULL CHECK(json_valid(data)), duplicate_key TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(account_id,id), UNIQUE(account_id,duplicate_key));
CREATE TABLE IF NOT EXISTS reviews(account_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(account_id,request_id));
CREATE TABLE IF NOT EXISTS conversations(id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(account_id,id));
CREATE TABLE IF NOT EXISTS attachments(id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id), object_key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(account_id,id));

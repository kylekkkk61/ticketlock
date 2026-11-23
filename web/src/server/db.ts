import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "./config";

// SQLite holds login mapping and workflow state. Ownership and use state are read from the chain.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  privy_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tx_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL CHECK (operation IN ('issue', 'transfer', 'checkin')),
  ref_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_id INTEGER,
  args TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'signed', 'broadcast', 'confirmed', 'failed')),
  tx_nonce INTEGER,
  tx_hash TEXT,
  raw_tx TEXT,
  block_number INTEGER,
  block_time INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (operation, ref_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  checkout_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  buyer_address TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL REFERENCES tx_jobs(id),
  token_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admission_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  ticket_number INTEGER NOT NULL,
  payload TEXT NOT NULL,
  owner_signature TEXT NOT NULL,
  gate_signature TEXT,
  short_code TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'rejected', 'expired', 'superseded', 'processing', 'confirmed', 'failed')),
  job_id INTEGER REFERENCES tx_jobs(id),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS admission_event_status ON admission_requests (event_id, status);
`;

const globals = globalThis as { __ticketlockDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!globals.__ticketlockDb) {
    const { dbFile } = getConfig();
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new DatabaseSync(dbFile);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    globals.__ticketlockDb = db;
  }
  return globals.__ticketlockDb;
}

export const now = () => Math.floor(Date.now() / 1000);

/** Run several statements atomically. */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

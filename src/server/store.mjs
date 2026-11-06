import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function createStore(path = process.env.DATABASE_PATH || resolve('data/buywise.db')) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));');
  return {
    get(kind, id) { const r = db.prepare('SELECT body FROM documents WHERE kind=? AND id=?').get(kind, id); return r ? JSON.parse(r.body) : null; },
    list(kind, owner) { return db.prepare('SELECT body FROM documents WHERE kind=? AND owner=?').all(kind, owner).map(r => JSON.parse(r.body)); },
    put(kind, value) { db.prepare('INSERT INTO documents(kind,id,owner,body) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET owner=excluded.owner,body=excluded.body').run(kind, value.id, value.owner, JSON.stringify(value)); return value; },
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } },
    close() { db.close(); },
  };
}

let singleton;
export function getStore() { singleton ??= createStore(); return singleton; }

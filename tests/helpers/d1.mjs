// tests/helpers/d1.mjs — a tiny Cloudflare D1 look-alike backed by real SQLite
// (node:sqlite), loaded with db/schema.sql. Tests run the actual SQL.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8'));
  const prepare = (sql) => {
    let args = [];
    const stmt = {
      bind(...a) { args = a.map(v => (v === undefined ? null : v)); return stmt; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { db.prepare(sql).run(...args); return { success: true }; }
    };
    return stmt;
  };
  return { prepare, raw: db };
}

const path = require('path');

// One SQL dialect, two drivers. With DATABASE_URL set we talk to real Postgres
// (Neon in production); without it we fall back to PGlite, which is Postgres
// compiled to WASM running against a local folder. Same SQL either way, so
// what you test locally is what runs in production.
const CONNECTION = process.env.DATABASE_URL;
const LOCAL_DIR = process.env.PGLITE_DIR || path.join(__dirname, '.pgdata');

let query;          // (sql, params) => { rows, rowCount }
let withClient;     // (fn) => fn(query) inside a dedicated connection
let closeDb;

if (CONNECTION) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: CONNECTION,
    // Neon terminates TLS at its pooler and does not present a chain node-pg
    // verifies by default. Encryption stays on; set PGSSL_STRICT=true on a
    // provider with a conventional chain.
    ssl: String(process.env.PGSSL_STRICT) === 'true' ? true : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 10000,
  });
  pool.on('error', (err) => console.error('Unexpected idle client error:', err.message));

  query = (sql, params) => pool.query(sql, params);
  withClient = async (fn) => {
    const client = await pool.connect();
    try {
      return await fn((sql, params) => client.query(sql, params));
    } finally {
      client.release();
    }
  };
  closeDb = () => pool.end();
} else {
  const { PGlite } = require('@electric-sql/pglite');
  const fs = require('fs');
  const LOCK = path.join(LOCAL_DIR, 'pe.lock');

  // PGlite is an in-process database: two Node processes opening the same
  // directory corrupts it, with no error until everything starts failing.
  // That is easy to do by accident - run a script while the server is up -
  // so take an advisory lock and fail loudly instead.
  function acquireLock() {
    if (fs.existsSync(LOCK)) {
      const owner = Number(fs.readFileSync(LOCK, 'utf8').trim());
      let alive = false;
      try {
        process.kill(owner, 0);
        alive = owner !== process.pid;
      } catch {
        alive = false; // stale lock from a process that died
      }
      if (alive) {
        throw new Error(
          `the local database is already open in process ${owner}.\n` +
          '  PGlite allows one process at a time. Stop the server before running\n' +
          '  scripts, or set DATABASE_URL to use a real Postgres instead.'
        );
      }
    }
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(LOCK, String(process.pid));
  }

  const releaseLock = () => {
    try {
      if (fs.existsSync(LOCK) && fs.readFileSync(LOCK, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(LOCK);
      }
    } catch { /* best effort */ }
  };
  process.on('exit', releaseLock);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { releaseLock(); process.exit(0); });
  }

  let db = null;
  const ready = async () => {
    if (!db) {
      acquireLock();
      db = await PGlite.create(LOCAL_DIR);
    }
    return db;
  };

  query = async (sql, params) => {
    const instance = await ready();
    const result = await instance.query(sql, params);
    return { rows: result.rows || [], rowCount: result.affectedRows ?? (result.rows || []).length };
  };
  // PGlite is a single in-process connection, so "checking one out" is a no-op.
  withClient = async (fn) => fn(query);
  closeDb = async () => {
    if (db) await db.close();
    db = null;
    releaseLock();
  };
}

// Queries throughout this project use `?` placeholders. Postgres wants $1, $2 -
// convert on the way through so every call site stays readable.
function toPositional(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function wrap(runner) {
  return {
    run: async (sql, params = []) => {
      const result = await runner(toPositional(sql), params);
      return { changes: result.rowCount };
    },
    get: async (sql, params = []) => {
      const result = await runner(toPositional(sql), params);
      return result.rows[0];
    },
    all: async (sql, params = []) => {
      const result = await runner(toPositional(sql), params);
      return result.rows;
    },
  };
}

const { run, get, all } = wrap(query);

// The callback gets its own { run, get, all } bound to one connection, so the
// statements inside genuinely share a transaction rather than scattering
// across the pool.
async function transaction(fn) {
  return withClient(async (runner) => {
    const tx = wrap(runner);
    await runner('BEGIN', []);
    try {
      const result = await fn(tx);
      await runner('COMMIT', []);
      return result;
    } catch (err) {
      await runner('ROLLBACK', []).catch(() => {});
      throw err;
    }
  });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    results_released BOOLEAN NOT NULL DEFAULT FALSE
  )`,

  `CREATE TABLE IF NOT EXISTS candidates (
    id UUID PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    name TEXT NOT NULL,
    blurb TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,

  // THE REGISTRY (identified). Answers "did everyone vote?".
  // Deliberately has no timestamp column of any kind - not created_at, not
  // updated_at, not voted_at. A timestamp here is a login-order log, and a
  // login-order log next to the ballot box de-anonymizes it.
  // `code` is the parent's permanent voting code, stored readable so the admin
  // page can look it up and resend it.
  `CREATE TABLE IF NOT EXISTS voters (
    id UUID PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    code TEXT NOT NULL,
    has_voted BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts INTEGER NOT NULL DEFAULT 0
  )`,

  // THE BALLOT BOX (anonymous). No voter reference, no timestamp.
  // Seeded with one blank row per eligible voter before voting opens. Casting
  // a vote UPDATEs a randomly chosen blank row rather than inserting, so
  // insertion order carries nothing. Postgres additionally exposes row version
  // order through the hidden xmin column, which update order WOULD leak - that
  // is what `election.js finalize` rewrites away before results are read.
  `CREATE TABLE IF NOT EXISTS ballots (
    id UUID PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    filled BOOLEAN NOT NULL DEFAULT FALSE,
    choice_ids JSONB
  )`,

  `CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    code TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'site',
    site_id TEXT REFERENCES sites(id),
    failed_attempts INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE INDEX IF NOT EXISTS idx_ballots_open ON ballots(site_id, filled)`,
  `CREATE INDEX IF NOT EXISTS idx_voters_site ON voters(site_id)`,
];

// Run by `npm run migrate`, not on boot. On a serverless host the app cold
// starts constantly; re-running DDL every time is wasteful and lets two
// invocations race each other.
async function migrate() {
  for (const stmt of SCHEMA) {
    await run(stmt);
  }
}

module.exports = { run, get, all, transaction, migrate, closeDb, usingPostgres: !!CONNECTION };

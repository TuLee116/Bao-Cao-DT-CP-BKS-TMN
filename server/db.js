// Kết nối PostgreSQL qua biến môi trường DATABASE_URL (Railway, Neon/Vercel đều cung cấp).
const { Pool, types } = require('pg');
const schema = require('./schema');

types.setTypeParser(1700, v => (v === null ? null : parseFloat(v))); // numeric → số
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10))); // bigint (count) → số
types.setTypeParser(1082, v => v); // date → chuỗi 'YYYY-MM-DD', không đổi múi giờ

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const pool = url
  ? new Pool({ connectionString: url, max: process.env.VERCEL ? 3 : 10, idleTimeoutMillis: 30000 })
  : null;
if (pool) pool.on('error', e => console.error('PostgreSQL pool error:', e.message));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function db() {
  if (!pool) throw new HttpError(500, 'Máy chủ chưa kết nối cơ sở dữ liệu: thiếu biến môi trường DATABASE_URL.');
  return pool;
}

let migrated = null;
function migrate() {
  if (!migrated) {
    migrated = tx(async c => {
      await c.query('select pg_advisory_xact_lock(724531)');
      await c.query(schema);
    }).catch(e => { migrated = null; throw e; });
  }
  return migrated;
}

async function tx(fn) {
  const c = await db().connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const query = (text, params) => db().query(text, params);

module.exports = { query, tx, migrate, HttpError, hasDb: !!pool };

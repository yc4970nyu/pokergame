// 数据库：线上用 Postgres（设置 DATABASE_URL），本地没设置就用 PGlite（嵌入式 Postgres，存在 data/ 里）。
// 两边都是同一套 SQL。
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Q {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Q {
  /** 一组语句要么全部生效，要么全部不生效 */
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SCHEMA = `
create table if not exists users (
  id text primary key,
  name text not null,
  avatar text,
  picture text,
  google_sub text unique,
  email text,
  username text,
  password_hash text,
  created_at timestamptz not null default now()
);
create unique index if not exists users_username on users (lower(username));
create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table if not exists groups (
  id text primary key,
  name text not null,
  icon text not null,
  invite_code text not null unique,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists group_members (
  group_id text not null references groups(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null default 'member',
  balance integer not null default 0,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create table if not exists ledger (
  id bigserial primary key,
  group_id text not null references groups(id) on delete cascade,
  kind text not null,
  actor_id text,
  gainer_id text,
  loser_id text,
  amount integer not null default 0,
  note text,
  data jsonb,
  reverses bigint,
  reversed_by bigint,
  created_at timestamptz not null default now()
);
create index if not exists ledger_group on ledger (group_id, created_at desc);
create table if not exists matches (
  id text primary key,
  group_id text references groups(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  rounds integer not null default 0,
  players jsonb not null,
  deltas jsonb not null default '{}'
);
create index if not exists matches_group on matches (group_id, updated_at desc);
create table if not exists round_results (
  id bigserial primary key,
  match_id text not null,
  group_id text,
  user_id text not null,
  round integer not null,
  players integer not null,
  won boolean not null,
  amount integer not null,
  cards_left integer not null,
  twos_left integer not null,
  tricks_won integer not null,
  created_at timestamptz not null default now()
);
create index if not exists round_results_user on round_results (user_id, created_at desc);
`;

export async function openDb(opts: { url?: string; dir?: string | null } = {}): Promise<Db> {
  const url = opts.url ?? process.env.DATABASE_URL;
  let db: Db;
  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    db = {
      query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
      tx: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('begin');
          const out = await fn({ query: async (sql, params) => (await c.query(sql, params as unknown[])).rows });
          await c.query('commit');
          return out;
        } catch (e) {
          await c.query('rollback').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
    await pool.query(SCHEMA);
  } else {
    if (process.env.NODE_ENV === 'production' && opts.dir === undefined)
      console.warn('⚠️  没有设置 DATABASE_URL：账号和账本存在本地文件里，Render 这类平台重新部署会清空。');
    const { PGlite } = await import('@electric-sql/pglite');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dir = opts.dir === undefined ? path.resolve(here, '../../data/pglite') : opts.dir;
    if (dir) fs.mkdirSync(dir, { recursive: true });
    const lite = dir ? new PGlite(dir) : new PGlite();
    db = {
      query: async (sql, params) => (await lite.query(sql, params as unknown[])).rows as never,
      tx: (fn) => lite.transaction((t) => fn({ query: async (sql, params) => (await t.query(sql, params as unknown[])).rows as never })),
      close: () => lite.close(),
    };
    await lite.exec(SCHEMA);
  }
  return db;
}

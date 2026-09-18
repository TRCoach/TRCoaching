import { assertNoSensitivePayload } from "../sensitive.js";
import { emptyData, migrate, type ConsoleStore, type StoreData } from "./store.js";

export const D1_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS console_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  writer_id TEXT,
  writer_expires_at TEXT,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_from TEXT
);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  visible INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  icon TEXT NOT NULL,
  description TEXT NOT NULL,
  confirm INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  correlation_id TEXT
);

CREATE TABLE IF NOT EXISTS evidence_cards (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  freshness TEXT NOT NULL,
  last_attempted_at TEXT NOT NULL,
  last_verified_at TEXT,
  evidence_ref TEXT,
  reason TEXT NOT NULL,
  next_setup_requirement TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correlations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  parent_action TEXT NOT NULL,
  event_ids TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  executor TEXT NOT NULL,
  status TEXT NOT NULL,
  bounded_action TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  external_id TEXT,
  run_id TEXT,
  model TEXT,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS result_envelopes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  collected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT PRIMARY KEY,
  attempts TEXT NOT NULL
);`;
export const SINGLE_WRITER_TTL_MS = 15_000;
export const REFRESH_THROTTLE_MS = 15_000;

export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1Like {
  prepare(sql: string): D1Prepared;
  batch(statements: D1Prepared[]): Promise<unknown[]>;
  exec(sql: string): Promise<unknown>;
}

export class RevisionConflictError extends Error {
  constructor() {
    super("D1 optimistic revision conflict");
  }
}

export class WriterLockError extends Error {
  constructor() {
    super("D1 single-active-writer lock is held");
  }
}

export class MemoryD1 implements D1Like {
  meta: { revision: number; writer_id?: string; writer_expires_at?: string; payload: string; updated_at: string } | null =
    null;
  tables = new Map<string, Record<string, unknown>[]>();

  prepare(sql: string): D1Prepared {
    const values: unknown[] = [];
    const self = this;
    const stmt: D1Prepared = {
      bind(...next: unknown[]) {
        values.push(...next);
        return stmt;
      },
      async first<T>() {
        if (/FROM console_meta/i.test(sql)) {
          return (self.meta as T) ?? null;
        }
        return null;
      },
      async run() {
        if (/UPDATE console_meta SET writer_id/i.test(sql)) {
          if (self.meta) {
            self.meta.writer_id = (values[0] as string | undefined) ?? undefined;
            self.meta.writer_expires_at = (values[1] as string | undefined) ?? undefined;
          }
          return { success: true };
        }
        if (/INSERT OR REPLACE INTO console_meta|UPDATE console_meta/i.test(sql)) {
          const expected = sql.includes("WHERE id = 1 AND revision") ? Number(values[5] ?? values[0]) : undefined;
          if (sql.includes("AND revision") && self.meta && expected !== undefined && self.meta.revision !== expected) {
            throw new RevisionConflictError();
          }
          if (/INSERT OR REPLACE INTO console_meta/i.test(sql)) {
            self.meta = {
              revision: Number(values[0]),
              writer_id: values[1] as string | undefined,
              writer_expires_at: values[2] as string | undefined,
              payload: String(values[3]),
              updated_at: String(values[4]),
            };
          } else {
            self.meta = {
              revision: Number(values[0]),
              writer_id: values[1] as string | undefined,
              writer_expires_at: values[2] as string | undefined,
              payload: String(values[3]),
              updated_at: String(values[4]),
            };
          }
        }
        if (/DELETE FROM (sessions|preferences|decisions|audits|evidence_cards|correlations|jobs|result_envelopes|rate_limits)/i.test(sql)) {
          const table = sql.match(/DELETE FROM (\w+)/i)?.[1];
          if (table) self.tables.set(table, []);
        }
        if (/INSERT INTO (\w+)/i.test(sql) && !/console_meta/i.test(sql)) {
          const table = sql.match(/INSERT INTO (\w+)/i)?.[1];
          if (table) {
            const rows = self.tables.get(table) ?? [];
            rows.push({ values: [...values] });
            self.tables.set(table, rows);
          }
        }
        return { success: true };
      },
      async all<T>() {
        const table = sql.match(/FROM (\w+)/i)?.[1];
        return { results: (self.tables.get(table ?? "") ?? []) as T[] };
      },
    };
    return stmt;
  }

  async batch(statements: D1Prepared[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const statement of statements) {
      out.push(await statement.run());
    }
    return out;
  }

  async exec(): Promise<unknown> {
    return { success: true };
  }
}

export class D1Store {
  constructor(
    private db: D1Like,
    private writerId = `writer_${Math.random().toString(16).slice(2)}`,
  ) {}

  async ensureSchema(): Promise<void> {
    try {
      await this.db.prepare("SELECT id FROM console_meta WHERE id = 1").first();
    } catch {
      await this.db.exec(D1_SCHEMA_SQL);
    }
  }

  async load(): Promise<StoreData> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT revision, writer_id, writer_expires_at, payload, updated_at FROM console_meta WHERE id = 1").first<{
      revision: number;
      payload: string;
    }>();
    if (!row?.payload) return emptyData();
    const parsed = migrate(JSON.parse(row.payload) as StoreData);
    parsed.revision = row.revision ?? parsed.revision;
    return parsed;
  }

  async save(data: StoreData, expectedRevision?: number): Promise<StoreData> {
    assertNoSensitivePayload(data, "d1-store");
    const next = migrate(structuredClone(data));
    const current = await this.load();
    const base = expectedRevision ?? current.revision;
    if (current.revision !== base && current.revision !== 0) {
      throw new RevisionConflictError();
    }
    next.revision = base + 1;
    const now = new Date().toISOString();
    const payload = JSON.stringify(next);
    await this.db
      .prepare(
        "INSERT OR REPLACE INTO console_meta (id, revision, writer_id, writer_expires_at, payload, updated_at) VALUES (1, ?, ?, ?, ?, ?)",
      )
      .bind(next.revision, this.writerId, next.writerExpiresAt ?? null, payload, now)
      .run();
    await this.project(next);
    return next;
  }

  async exclusive<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
    await this.acquireWriter();
    try {
      const data = await this.load();
      data.writerId = this.writerId;
      data.writerExpiresAt = new Date(Date.now() + SINGLE_WRITER_TTL_MS).toISOString();
      const expected = data.revision;
      const result = await fn(data);
      await this.save(data, expected);
      return result;
    } finally {
      await this.releaseWriter();
    }
  }

  hydrate(data: StoreData): ConsoleStore {
    let cache = migrate(structuredClone(data));
    return {
      load: () => structuredClone(cache),
      save: (next) => {
        cache = migrate(structuredClone(next));
      },
      exclusive: (fn) => {
        const copy = structuredClone(cache);
        const result = fn(copy);
        cache = migrate(copy);
        return result;
      },
    };
  }

  async acquireWriter(): Promise<void> {
    const row = await this.db.prepare("SELECT writer_id, writer_expires_at, revision, payload, updated_at FROM console_meta WHERE id = 1").first<{
      writer_id?: string;
      writer_expires_at?: string;
    }>();
    const now = Date.now();
    if (row?.writer_id && row.writer_id !== this.writerId && row.writer_expires_at && Date.parse(row.writer_expires_at) > now) {
      throw new WriterLockError();
    }
    const expires = new Date(now + SINGLE_WRITER_TTL_MS).toISOString();
    if (row) {
      await this.db.prepare("UPDATE console_meta SET writer_id = ?, writer_expires_at = ? WHERE id = 1").bind(this.writerId, expires).run();
    }
  }

  async releaseWriter(): Promise<void> {
    await this.db.prepare("UPDATE console_meta SET writer_id = ?, writer_expires_at = ? WHERE id = 1").bind(null, null).run();
  }

  private async project(data: StoreData): Promise<void> {
    const deletes = [
      "DELETE FROM sessions",
      "DELETE FROM preferences",
      "DELETE FROM decisions",
      "DELETE FROM audits",
      "DELETE FROM evidence_cards",
      "DELETE FROM correlations",
      "DELETE FROM jobs",
      "DELETE FROM result_envelopes",
      "DELETE FROM rate_limits",
    ].map((sql) => this.db.prepare(sql));
    const inserts: D1Prepared[] = [];
    for (const session of data.sessions) {
      inserts.push(
        this.db
          .prepare("INSERT INTO sessions (id, token_hash, csrf, created_at, expires_at, rotated_from) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(session.id, session.tokenHash, session.csrf, session.createdAt, session.expiresAt, session.rotatedFrom ?? null),
      );
    }
    for (const pref of data.preferences) {
      inserts.push(
        this.db
          .prepare("INSERT INTO preferences (id, visible, sort_order, display_name, icon, description, confirm) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(pref.id, pref.visible ? 1 : 0, pref.order, pref.displayName, pref.icon, pref.description, pref.confirm ? 1 : 0),
      );
    }
    for (const decision of data.decisions) {
      inserts.push(
        this.db
          .prepare("INSERT INTO decisions (id, kind, title, subject_ref, status, notes, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(decision.id, decision.kind, decision.title, decision.subjectRef, decision.status, decision.notes, decision.createdAt, JSON.stringify(decision)),
      );
    }
    for (const audit of data.audits.slice(0, 200)) {
      inserts.push(
        this.db
          .prepare("INSERT INTO audits (id, at, actor, type, summary, correlation_id) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(audit.id, audit.at, audit.actor, audit.type, audit.summary, audit.correlationId ?? null),
      );
    }
    for (const card of data.evidenceCards) {
      inserts.push(
        this.db
          .prepare(
            "INSERT INTO evidence_cards (id, source, freshness, last_attempted_at, last_verified_at, evidence_ref, reason, next_setup_requirement, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            card.id,
            card.source,
            card.freshness,
            card.lastAttempted,
            card.lastVerified,
            card.evidenceRef,
            card.detail,
            card.setupRequirement,
            JSON.stringify({
              id: card.id,
              source: card.source,
              freshness: card.freshness,
              lastAttemptedAt: card.lastAttempted,
              lastVerifiedAt: card.lastVerified,
              evidenceRef: card.evidenceRef,
              reason: card.detail,
              nextSetupRequirement: card.setupRequirement,
            }),
          ),
      );
    }
    for (const corr of data.correlations) {
      inserts.push(
        this.db
          .prepare("INSERT INTO correlations (id, created_at, parent_action, event_ids) VALUES (?, ?, ?, ?)")
          .bind(corr.id, corr.createdAt, corr.parentAction, corr.eventIds.join(",")),
      );
    }
    for (const job of data.jobs) {
      inserts.push(
        this.db
          .prepare(
            "INSERT INTO jobs (id, correlation_id, parent_id, title, owner, executor, status, bounded_action, result_summary, created_at, updated_at, external_id, run_id, model, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            job.id,
            job.correlationId,
            job.parentId ?? null,
            job.title,
            job.owner,
            job.executor,
            job.status,
            job.boundedAction,
            job.resultSummary,
            job.createdAt,
            job.updatedAt,
            job.externalId ?? null,
            job.runId ?? null,
            job.model ?? null,
            JSON.stringify({ tests: job.tests, blockers: job.blockers, evidenceRefs: job.evidenceRefs, handoff: job.handoff }),
          ),
      );
    }
    for (const envelope of data.resultEnvelopes) {
      inserts.push(
        this.db
          .prepare("INSERT INTO result_envelopes (id, job_id, correlation_id, status, detail, collected_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(envelope.id, envelope.jobId, envelope.correlationId, envelope.status, envelope.detail, envelope.collectedAt),
      );
    }
    for (const [ip, attempts] of Object.entries(data.rateLimits ?? {})) {
      inserts.push(this.db.prepare("INSERT INTO rate_limits (ip, attempts) VALUES (?, ?)").bind(ip, JSON.stringify(attempts)));
    }
    await this.db.batch([...deletes, ...inserts]);
  }
}

export function throttleRefresh(lastRefreshAt: string | undefined, now = Date.now(), windowMs = REFRESH_THROTTLE_MS): boolean {
  if (!lastRefreshAt) return true;
  return now - Date.parse(lastRefreshAt) >= windowMs;
}

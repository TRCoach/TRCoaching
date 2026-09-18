import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNoSensitivePayload } from "../sensitive.js";

export const STORE_VERSION = 1;

export interface ActionPreference {
  id: string;
  visible: boolean;
  order: number;
  displayName: string;
  icon: string;
  description: string;
  confirm: boolean;
}

export interface StoredSession {
  id: string;
  tokenHash: string;
  csrf: string;
  createdAt: string;
  expiresAt: string;
  rotatedFrom?: string;
}

export interface StoredJob {
  id: string;
  correlationId: string;
  parentId?: string;
  title: string;
  owner: string;
  executor: string;
  status: DispatchStatus;
  boundedAction: string;
  evidenceRefs: string[];
  resultSummary: string;
  createdAt: string;
  updatedAt: string;
  externalId?: string;
  founderGate: boolean;
}

export type DispatchStatus =
  | "QUEUED"
  | "RUNNING"
  | "AWAITING_EXTERNAL"
  | "BLOCKED"
  | "FOUNDER_REQUIRED"
  | "COMPLETED"
  | "FAILED";

export interface StoredAudit {
  id: string;
  at: string;
  actor: string;
  type: string;
  summary: string;
  correlationId?: string;
}

export interface StoreData {
  version: number;
  sessions: StoredSession[];
  preferences: ActionPreference[];
  jobs: StoredJob[];
  audits: StoredAudit[];
}

export interface ConsoleStore {
  load(): StoreData;
  save(data: StoreData): void;
  exclusive<T>(fn: (data: StoreData) => T): T;
}

function emptyData(): StoreData {
  return { version: STORE_VERSION, sessions: [], preferences: [], jobs: [], audits: [] };
}

function migrate(raw: StoreData): StoreData {
  const data = raw ?? emptyData();
  if (!data.version || data.version < 1) {
    data.version = 1;
    data.sessions ??= [];
    data.preferences ??= [];
    data.jobs ??= [];
    data.audits ??= [];
  }
  if (data.version !== STORE_VERSION) {
    throw new Error(`unsupported store version ${data.version}`);
  }
  assertNoSensitivePayload(data, "store");
  return data;
}

export class MemoryStore implements ConsoleStore {
  private data = emptyData();
  private queue: Promise<unknown> = Promise.resolve();

  load(): StoreData {
    return structuredClone(this.data);
  }

  save(data: StoreData): void {
    assertNoSensitivePayload(data, "store");
    this.data = migrate(structuredClone(data));
  }

  exclusive<T>(fn: (data: StoreData) => T): T {
    const data = this.load();
    const result = fn(data);
    this.save(data);
    return result;
  }
}

export class JsonFileStore implements ConsoleStore {
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      this.writeAtomic(emptyData());
    }
  }

  load(): StoreData {
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as StoreData;
    return migrate(parsed);
  }

  save(data: StoreData): void {
    assertNoSensitivePayload(data, "store");
    this.writeAtomic(migrate(data));
  }

  exclusive<T>(fn: (data: StoreData) => T): T {
    const data = this.load();
    const result = fn(data);
    this.save(data);
    return result;
  }

  private writeAtomic(data: StoreData): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}

export function openStore(kind: "memory" | "file", filePath?: string): ConsoleStore {
  if (kind === "memory") return new MemoryStore();
  if (!filePath) throw new Error("production persistence unavailable: FOUNDER_CONSOLE_DATA_DIR is required");
  return new JsonFileStore(join(filePath, "console-store.json"));
}

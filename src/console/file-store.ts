import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNoSensitivePayload } from "../sensitive.js";
import { emptyData, migrate, MemoryStore, type ConsoleStore, type StoreData } from "./store.js";

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

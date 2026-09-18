import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function processCwd(): string {
  try {
    return process.cwd();
  } catch {
    return "/";
  }
}

export function importMetaDir(metaUrl: string | undefined = import.meta.url): string {
  try {
    if (!metaUrl) return processCwd();
    return fileURLToPath(new URL(".", metaUrl));
  } catch {
    return processCwd();
  }
}

export function repoRoot(start = importMetaDir()): string {
  try {
    let current = start;
    for (let i = 0; i < 8; i += 1) {
      try {
        if (existsSync(join(current, "package.json")) && existsSync(join(current, "model"))) {
          return current;
        }
      } catch {
        break;
      }
      current = dirname(current);
    }
  } catch {
    // Worker isolates have no repo filesystem.
  }
  return processCwd();
}

export function modelPath(...parts: string[]): string {
  return join(repoRoot(), "model", ...parts);
}

export function schemaPath(...parts: string[]): string {
  return join(repoRoot(), "schemas", ...parts);
}

export function fixturePath(...parts: string[]): string {
  return join(repoRoot(), "fixtures", ...parts);
}

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot(start = fileURLToPath(new URL(".", import.meta.url))): string {
  let current = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "model"))) {
      return current;
    }
    current = dirname(current);
  }
  return process.cwd();
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

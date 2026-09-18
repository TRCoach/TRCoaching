import { readFileSync } from "node:fs";
import bundledFounderActions from "./bundled/founder-actions.json";
import bundledLifecycle from "./bundled/lifecycle.json";
import bundledPermissions from "./bundled/permissions.json";
import type { FounderActionCatalog } from "./console/types.js";
import type { PermissionRegistry } from "./permissions.js";
import type { LifecycleModel } from "./types.js";

export const BUNDLED_PERMISSIONS = bundledPermissions as PermissionRegistry;
export const BUNDLED_FOUNDER_ACTIONS = bundledFounderActions as FounderActionCatalog;
export const BUNDLED_LIFECYCLE = bundledLifecycle as LifecycleModel;

export function loadJsonWithFallback<T>(path: string | undefined, bundled: T, defaultPath: string): T {
  const target = path ?? defaultPath;
  try {
    return JSON.parse(readFileSync(target, "utf8")) as T;
  } catch (error) {
    if (path) throw error;
    return structuredClone(bundled);
  }
}

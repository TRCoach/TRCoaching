import { readFileSync } from "node:fs";
import { modelPath } from "./paths.js";
import type { Owner } from "./types.js";

export type OperatingMode = "TEST" | "CONTROLLED_BETA" | "LIVE";
export type MaturityLevel =
  | "assisted"
  | "approval-gated"
  | "autonomous-within-boundaries"
  | "managed-by-exception";

export interface PermissionUnlock {
  id: string;
  capability: string;
  title: string;
  founderUnlock: string;
  allowedIn: OperatingMode[];
  maturity: MaturityLevel;
  defaultInTest: string;
  wake: Owner;
}

export interface PermissionRegistry {
  id: string;
  version: string;
  currentMode: OperatingMode;
  betaTarget: string;
  modes: OperatingMode[];
  maturityLevels: MaturityLevel[];
  unlocks: PermissionUnlock[];
}

export function loadPermissions(path = modelPath("permissions.json")): PermissionRegistry {
  return JSON.parse(readFileSync(path, "utf8")) as PermissionRegistry;
}

export function permissionAllowed(
  registry: PermissionRegistry,
  capability: string,
  mode = registry.currentMode,
): { ok: boolean; reason?: string; unlock?: PermissionUnlock } {
  const unlock = registry.unlocks.find((item) => item.capability === capability);
  if (!unlock) {
    return { ok: false, reason: `unknown capability ${capability} fails closed` };
  }
  if (capability === "policy_self_modify") {
    return { ok: false, reason: "agents must never self-modify policy", unlock };
  }
  if (!unlock.allowedIn.includes(mode)) {
    return {
      ok: false,
      reason: `${capability} blocked in ${mode}; founder unlock required (allowed: ${unlock.allowedIn.join(",") || "none"})`,
      unlock,
    };
  }
  return { ok: true, unlock };
}

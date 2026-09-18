import { readFileSync } from "node:fs";
import { modelPath } from "./paths.js";
import type { EvidenceMap, Owner } from "./types.js";

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
  paymentClearOwner?: "Sam";
  separateFromWholeBusinessLive?: boolean;
  namedEvidence?: string[];
  perCase?: boolean;
  neverAutomatic?: boolean;
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

const REFUND_DECISIONS = new Set([
  "refund_approved",
  "credit_approved",
  "no_refund",
  "no_credit",
  "decline_money_movement",
]);

function flag(evidence: EvidenceMap, key: string): boolean {
  return evidence[key] === true || evidence[key] === "true";
}

export function resolveMode(registry: PermissionRegistry): OperatingMode {
  return registry.currentMode;
}

/** Isolated tests only. Never accept mode from event evidence. */
export function withTrustedMode(registry: PermissionRegistry, mode: OperatingMode): PermissionRegistry {
  if (mode !== "TEST" && mode !== "CONTROLLED_BETA" && mode !== "LIVE") {
    throw new Error("invalid trusted operating mode");
  }
  return { ...registry, currentMode: mode };
}

export function loadPermissions(path = modelPath("permissions.json")): PermissionRegistry {
  return JSON.parse(readFileSync(path, "utf8")) as PermissionRegistry;
}

export function permissionAllowed(
  registry: PermissionRegistry,
  capability: string,
  mode = registry.currentMode,
  evidence: EvidenceMap = {},
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
  if (capability === "payments") {
    if (evidence.payment_clear_owner !== "Sam") {
      return { ok: false, reason: "payment_clear must be owned by Sam", unlock };
    }
    if (!flag(evidence, "founder_stripe_live_unlock") || !evidence.founder_payment_unlock_ref) {
      return {
        ok: false,
        reason: "payments require named founder Stripe-live/payment unlock evidence; whole-business LIVE is not required",
        unlock,
      };
    }
  }
  if (capability === "refunds_credits") {
    if (flag(evidence, "automatic_refund") || flag(evidence, "automatic_credit")) {
      return { ok: false, reason: "refund/credit must remain per-case and human-only", unlock };
    }
    const decision = evidence.founder_refund_credit_decision;
    if (typeof decision !== "string" || !REFUND_DECISIONS.has(decision) || !evidence.founder_decision_ref) {
      return {
        ok: false,
        reason: "refund/credit requires a per-case founder decision in CONTROLLED_BETA or LIVE",
        unlock,
      };
    }
  }
  return { ok: true, unlock };
}

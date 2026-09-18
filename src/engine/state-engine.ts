import { invokeAdapter } from "../adapters/dry-run.js";
import { assertDryRun } from "../adapters/contracts.js";
import { BUNDLED_LIFECYCLE, loadJsonWithFallback } from "../model-json.js";
import { modelPath } from "../paths.js";
import { assertNoSensitivePayload } from "../sensitive.js";
import type {
  ApplyResult,
  BusinessEvent,
  ControlState,
  EvidenceMap,
  LifecycleModel,
  LifecycleTransition,
} from "../types.js";
import {
  loadPermissions,
  permissionAllowed,
  resolveMode,
  type PermissionRegistry,
} from "../permissions.js";
import { missingEvidence, runGuard } from "./guards.js";
import { wakeFor } from "./wake.js";
import type { LifecycleTrack } from "../types.js";

const TRANSITION_FIELDS = [
  "id",
  "from",
  "to",
  "event",
  "owner",
  "requiredEvidence",
  "systemOfRecord",
  "automatedAction",
  "guard",
  "stopCondition",
  "retryPolicy",
  "nextTrigger",
  "founderGate",
  "idempotencyKey",
] as const;

export function loadLifecycle(path?: string): LifecycleModel {
  return loadJsonWithFallback(path, BUNDLED_LIFECYCLE, () => modelPath("lifecycle.json"));
}

export function assertTransitionShape(transition: LifecycleTransition): string[] {
  const missing: string[] = [];
  for (const field of TRANSITION_FIELDS) {
    if (transition[field] === undefined || transition[field] === null || transition[field] === "") {
      missing.push(field);
    }
  }
  return missing;
}

export function coverage(model: LifecycleModel): { states: number; transitions: number; required_fields_present: boolean } {
  const required_fields_present = model.transitions.every((t) => assertTransitionShape(t).length === 0);
  return {
    states: model.states.length,
    transitions: model.transitions.length,
    required_fields_present,
  };
}

export function emptyState(model: LifecycleModel): ControlState {
  return {
    current: model.initialState,
    tracks: {
      commercial: model.initialState,
      marketing_cycle: "marketing_cycle_idle",
      learning: "learning_idle",
    },
    seenEventIds: [],
    seenIdempotencyKeys: [],
    evidence: {},
    history: [],
  };
}

function trackOf(transition: LifecycleTransition): LifecycleTrack {
  return transition.track ?? "commercial";
}

function trackPosition(state: ControlState, track: LifecycleTrack): string {
  if (track === "commercial") return state.current;
  return state.tracks?.[track] ?? (track === "marketing_cycle" ? "marketing_cycle_idle" : "learning_idle");
}

export function materialiseKey(template: string, evidence: EvidenceMap): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (_, key: string) => {
    const value = evidence[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function reject(event: BusinessEvent, reason: string): ApplyResult {
  return {
    status: "rejected",
    reason,
    event_id: event.event_id,
    dryRun: true,
    externalWrite: false,
  };
}

export class StateEngine {
  constructor(
    readonly model: LifecycleModel,
    public state: ControlState = emptyState(model),
    readonly permissions: PermissionRegistry = loadPermissions(),
  ) {}

  next(): Pick<ApplyResult, "nextOwner" | "nextAction" | "nextTrigger" | "from"> {
    const outgoing = this.model.transitions.filter((t) => t.from === this.state.current);
    const first = outgoing[0];
    return {
      from: this.state.current,
      nextOwner: first?.owner,
      nextAction: first?.automatedAction,
      nextTrigger: first?.nextTrigger ?? first?.event,
    };
  }

  apply(event: BusinessEvent): ApplyResult {
    assertNoSensitivePayload(event, "event");
    if (this.state.seenEventIds.includes(event.event_id)) {
      return this.duplicate(event, "event_id");
    }
    if (this.state.seenIdempotencyKeys.includes(event.idempotency_key)) {
      return this.duplicate(event, "idempotency_key");
    }

    const transition = this.model.transitions.find((item) => {
      const track = trackOf(item);
      return item.event === event.type && item.from === trackPosition(this.state, track);
    });
    if (!transition) {
      return reject(
        event,
        `no transition for ${event.type} from ${this.state.current} (fail closed)`,
      );
    }

    const evidence: EvidenceMap = { ...this.state.evidence, ...event.evidence };
    const missing = missingEvidence(transition.requiredEvidence, evidence);
    if (missing.length > 0) {
      return reject(event, `missing required evidence: ${missing.join(", ")}`);
    }

    const computedKey = materialiseKey(transition.idempotencyKey, evidence);
    if (computedKey && this.state.seenIdempotencyKeys.includes(computedKey)) {
      return this.duplicate(event, "computed_idempotency_key");
    }

    const guard = runGuard(transition.guard, evidence, transition);
    if (!guard.ok) {
      return reject(event, guard.reason ?? transition.stopCondition);
    }

    if (transition.founderGate && transition.guard === "founder_golive_required") {
      const founder = runGuard("founder_golive_required", evidence, transition);
      if (!founder.ok) return reject(event, founder.reason ?? "founder gate failed");
    }

    if (transition.requiredPermission) {
      const mode = resolveMode(this.permissions);
      const permitted = permissionAllowed(
        this.permissions,
        transition.requiredPermission,
        mode,
        evidence,
      );
      if (!permitted.ok) {
        return reject(event, permitted.reason ?? "permission denied");
      }
    }

    const adapterResult = invokeAdapter(
      transition.systemOfRecord,
      transition.automatedAction,
      evidence,
    );
    assertDryRun(adapterResult);
    if (!adapterResult.accepted) {
      return reject(event, adapterResult.detail);
    }

    const result: ApplyResult = {
      status: "applied",
      event_id: event.event_id,
      transition_id: transition.id,
      from: transition.from,
      to: transition.to,
      nextOwner: transition.owner,
      nextAction: transition.automatedAction,
      nextTrigger: transition.nextTrigger,
      founderGate: transition.founderGate,
      automatedAction: transition.automatedAction,
      guard: transition.guard,
      dryRun: true,
      externalWrite: false,
    };

    const track = trackOf(transition);
    if (track === "commercial") {
      this.state.current = transition.to;
    }
    this.state.tracks = this.state.tracks ?? emptyState(this.model).tracks;
    this.state.tracks[track] = transition.to;
    this.state.evidence = evidence;
    result.nextOwner = wakeFor(transition).owner;
    this.state.seenEventIds.push(event.event_id);
    this.state.seenIdempotencyKeys.push(event.idempotency_key);
    if (computedKey) this.state.seenIdempotencyKeys.push(computedKey);
    this.state.history.push(result);
    return result;
  }

  private duplicate(event: BusinessEvent, via: string): ApplyResult {
    const previous = this.state.history.find((item) => item.event_id === event.event_id);
    return {
      status: "ignored_duplicate",
      reason: `duplicate ${via} ignored`,
      event_id: event.event_id,
      transition_id: previous?.transition_id,
      from: previous?.from ?? this.state.current,
      to: previous?.to ?? this.state.current,
      nextOwner: previous?.nextOwner,
      nextAction: previous?.nextAction,
      nextTrigger: previous?.nextTrigger,
      founderGate: previous?.founderGate,
      automatedAction: previous?.automatedAction,
      dryRun: true,
      externalWrite: false,
    };
  }
}

export function applyHappyPath(
  engine: StateEngine,
  events: BusinessEvent[],
): ApplyResult[] {
  return events.map((event) => engine.apply(event));
}

import { invokeAdapter } from "../adapters/dry-run.js";
import { assertDryRun } from "../adapters/contracts.js";
import type { SystemOfRecord } from "../types.js";

export type Freshness = "VERIFIED" | "STALE" | "UNKNOWN" | "NOT_CONNECTED" | "DEMO_FIXTURE";

export interface EvidenceCard {
  id: string;
  source: string;
  lastAttempted: string;
  lastVerified: string | null;
  freshness: Freshness;
  evidenceRef: string | null;
  detail: string;
  setupRequirement: string;
  credentialsExposed: false;
  demoFixture: boolean;
}

export interface EvidenceEnv {
  demoFixtures: boolean;
  driveKey?: string;
  crmKey?: string;
  metricoolKey?: string;
  stripeKey?: string;
  supersetKey?: string;
  slackToken?: string;
  slackChannel?: string;
  slackDispatchEnabled?: boolean;
  cursorToken?: string;
  cursorAllowRepo?: string;
  openaiKey?: string;
  chatgptDispatchEnabled?: boolean;
  githubToken?: string;
}

export function readEvidenceEnv(env: NodeJS.ProcessEnv = process.env): EvidenceEnv {
  return {
    demoFixtures: env.FOUNDER_CONSOLE_DEMO_FIXTURES === "1" && env.FOUNDER_CONSOLE_DEV_AUTH === "1",
    driveKey: env.TR_DRIVE_READONLY_TOKEN,
    crmKey: env.TR_CRM_READONLY_TOKEN,
    metricoolKey: env.TR_METRICOOL_READONLY_TOKEN,
    stripeKey: env.TR_STRIPE_READONLY_TOKEN,
    supersetKey: env.TR_SUPERSET_READONLY_TOKEN,
    slackToken: env.SLACK_BOT_TOKEN,
    slackChannel: env.SLACK_AI_OPS_CHANNEL,
    slackDispatchEnabled: env.SLACK_DISPATCH_ENABLED === "1",
    cursorToken: env.CURSOR_CLOUD_AGENT_TOKEN,
    cursorAllowRepo: env.CURSOR_ALLOW_REPO ?? "TRCoach/TRCoaching",
    openaiKey: env.OPENAI_API_KEY,
    chatgptDispatchEnabled: env.FOUNDER_CHATGPT_DISPATCH === "1",
    githubToken: env.GITHUB_READONLY_TOKEN,
  };
}

function attempted(): string {
  return new Date().toISOString();
}

function disconnected(id: string, source: string, setup: string, extra = ""): EvidenceCard {
  return {
    id,
    source,
    lastAttempted: attempted(),
    lastVerified: null,
    freshness: "NOT_CONNECTED",
    evidenceRef: null,
    detail: extra || `${source} credentials are not configured. Status is NOT_CONNECTED, never green.`,
    setupRequirement: setup,
    credentialsExposed: false,
    demoFixture: false,
  };
}

function demoCard(id: string, source: string, ref: string, detail: string): EvidenceCard {
  return {
    id,
    source,
    lastAttempted: attempted(),
    lastVerified: null,
    freshness: "DEMO_FIXTURE",
    evidenceRef: ref,
    detail: `${detail} DEMO_FIXTURE only — not a live verified read.`,
    setupRequirement: "Disable FOUNDER_CONSOLE_DEMO_FIXTURES and supply a least-privilege read token.",
    credentialsExposed: false,
    demoFixture: true,
  };
}

function dryInspect(system: SystemOfRecord): string {
  const result = invokeAdapter(system, "dry_run.ping", {});
  assertDryRun(result);
  return result.detail;
}

export function collectEvidence(env: EvidenceEnv = readEvidenceEnv()): EvidenceCard[] {
  const cards: EvidenceCard[] = [];

  cards.push(
    env.driveKey
      ? {
          id: "drive",
          source: "Drive",
          lastAttempted: attempted(),
          lastVerified: null,
          freshness: "UNKNOWN",
          evidenceRef: "title-pointer-only",
          detail: "Drive token present but live document bodies are never copied. Titles only; read not yet verified this process.",
          setupRequirement: "TR_DRIVE_READONLY_TOKEN with metadata-only Drive scope. Titles stay in model/current-state.json.",
          credentialsExposed: false,
          demoFixture: false,
        }
      : env.demoFixtures
        ? demoCard("drive", "Drive", "CURRENT STATE & PROJECT CONTINUITY LOG — 18 Sep 2026 — 12:36 BST", dryInspect("Drive"))
        : disconnected(
            "drive",
            "Drive",
            "Set TR_DRIVE_READONLY_TOKEN (metadata-only). Never commit file IDs or document bodies.",
          ),
  );

  cards.push(
    env.crmKey
      ? {
          id: "crm",
          source: "CRM",
          lastAttempted: attempted(),
          lastVerified: null,
          freshness: "UNKNOWN",
          evidenceRef: "non_pii_enquiry_ref",
          detail: "CRM token present. Live lead records are not pulled into git; status UNKNOWN until a verified read succeeds.",
          setupRequirement: "TR_CRM_READONLY_TOKEN with non-PII commercial refs only.",
          credentialsExposed: false,
          demoFixture: false,
        }
      : env.demoFixtures
        ? demoCard("crm", "CRM", "ENQ-CONSOLE-001", dryInspect("CRM"))
        : disconnected("crm", "CRM", "Set TR_CRM_READONLY_TOKEN for non-PII lead/commercial refs."),
  );

  cards.push(
    env.metricoolKey
      ? {
          id: "metricool",
          source: "Metricool",
          lastAttempted: attempted(),
          lastVerified: null,
          freshness: "UNKNOWN",
          evidenceRef: "asset_checksum",
          detail: "Metricool token present. Schedule/publish remain blocked. Read not verified this process.",
          setupRequirement: "TR_METRICOOL_READONLY_TOKEN analytics/read only. No publish scope.",
          credentialsExposed: false,
          demoFixture: false,
        }
      : env.demoFixtures
        ? demoCard("metricool", "Metricool", "ASSET-CONSOLE-001", dryInspect("Metricool"))
        : disconnected("metricool", "Metricool", "Set TR_METRICOOL_READONLY_TOKEN (read/analytics only)."),
  );

  cards.push(
    env.stripeKey
      ? {
          id: "stripe",
          source: "Stripe",
          lastAttempted: attempted(),
          lastVerified: null,
          freshness: "UNKNOWN",
          evidenceRef: "stripe_payment_ref",
          detail: "Stripe restricted read key present. No charges/refunds/credits/payment links. Read not verified this process.",
          setupRequirement: "TR_STRIPE_READONLY_TOKEN restricted to read PaymentIntents only. Never a write key.",
          credentialsExposed: false,
          demoFixture: false,
        }
      : env.demoFixtures
        ? demoCard("stripe", "Stripe", "pi_test_console_not_live", dryInspect("Stripe"))
        : disconnected("stripe", "Stripe", "Set TR_STRIPE_READONLY_TOKEN (restricted read). Hard-stop all money movement."),
  );

  cards.push(
    env.supersetKey
      ? {
          id: "superset",
          source: "Superset",
          lastAttempted: attempted(),
          lastVerified: null,
          freshness: "UNKNOWN",
          evidenceRef: "assignment_ref",
          detail: "Superset token present. Neutral delivery codes only. Zone C/health content is forbidden on this bus.",
          setupRequirement: "TR_SUPERSET_READONLY_TOKEN scoped to assignment/check-in codes. No Zone C fields.",
          credentialsExposed: false,
          demoFixture: false,
        }
      : env.demoFixtures
        ? demoCard("superset", "Superset", "COACH-CONSOLE-001", dryInspect("Superset"))
        : disconnected("superset", "Superset", "Set TR_SUPERSET_READONLY_TOKEN for delivery codes only. No Zone C."),
  );

  const slackReady = Boolean(env.slackToken && env.slackDispatchEnabled && env.slackChannel && /^#?ai-ops$|^C[A-Z0-9]+$/.test(env.slackChannel));
  cards.push(
    slackReady
      ? {
          id: "slack",
          source: "Slack",
          lastAttempted: attempted(),
          lastVerified: null,
          freshness: "UNKNOWN",
          evidenceRef: "ops_event",
          detail: "Slack dispatch is configured for the allowlisted #ai-ops channel. Not verified until a real OPS_EVENT is accepted.",
          setupRequirement: "SLACK_DISPATCH_ENABLED=1, SLACK_BOT_TOKEN, SLACK_AI_OPS_CHANNEL=#ai-ops (or C… id).",
          credentialsExposed: false,
          demoFixture: false,
        }
      : env.demoFixtures
        ? demoCard("slack", "Slack", "Grok_Alex: OPS_EVENT", dryInspect("Slack"))
        : disconnected(
            "slack",
            "Slack",
            "Set SLACK_DISPATCH_ENABLED=1, SLACK_BOT_TOKEN, and SLACK_AI_OPS_CHANNEL=#ai-ops. Tests use a fake transport.",
          ),
  );

  cards.push(
    env.cursorToken
      ? {
          id: "cursor",
          source: "Cursor Cloud",
          lastAttempted: attempted(),
          lastVerified: null,
          freshness: "UNKNOWN",
          evidenceRef: "cursor_job",
          detail: "A Cursor token is present, but this repo has no stable public Cloud Agent dispatch API. Status stays UNKNOWN until that connector exists.",
          setupRequirement:
            "CURSOR_CLOUD_AGENT_TOKEN plus CURSOR_ALLOW_REPO=TRCoach/TRCoaching and a documented Cloud Agent dispatch endpoint. Until Cursor publishes that API, the adapter stays NOT_CONNECTED/UNKNOWN and never fakes success.",
          credentialsExposed: false,
          demoFixture: false,
        }
      : disconnected(
          "cursor",
          "Cursor Cloud",
          "No stable Cursor Cloud Agent HTTP dispatch API is wired in this repo. Required later: server-only token, repo/branch allowlist TRCoach/TRCoaching, bounded templates, idempotency. Do not fake COMPLETED.",
        ),
  );

  cards.push(
    env.chatgptDispatchEnabled && env.openaiKey
      ? {
          id: "chatgpt",
          source: "ChatGPT",
          lastAttempted: attempted(),
          lastVerified: null,
          freshness: "UNKNOWN",
          evidenceRef: "chatgpt_review",
          detail: "OpenAI dispatch flag is on. Live calls are still not made unless an explicit dispatch job is approved. Cost is unknown until billed.",
          setupRequirement: "FOUNDER_CHATGPT_DISPATCH=1 and OPENAI_API_KEY. Founder must approve spend. Default remains NOT_CONNECTED.",
          credentialsExposed: false,
          demoFixture: false,
        }
      : disconnected(
          "chatgpt",
          "ChatGPT",
          "Set FOUNDER_CHATGPT_DISPATCH=1 and OPENAI_API_KEY only after founder spend approval. Until then the worker/manager adapter is NOT_CONNECTED.",
        ),
  );

  cards.push(
    env.githubToken
      ? {
          id: "github",
          source: "GitHub",
          lastAttempted: attempted(),
          lastVerified: null,
          freshness: "UNKNOWN",
          evidenceRef: "TRCoach/TRCoaching",
          detail: "GitHub read token present. Repo metadata only; not verified this process.",
          setupRequirement: "GITHUB_READONLY_TOKEN with public repo metadata for TRCoach/TRCoaching.",
          credentialsExposed: false,
          demoFixture: false,
        }
      : env.demoFixtures
        ? demoCard("github", "GitHub", "TRCoach/TRCoaching", "Local repo pointer only.")
        : disconnected("github", "GitHub", "Set GITHUB_READONLY_TOKEN for TRCoach/TRCoaching metadata reads."),
  );

  return cards;
}

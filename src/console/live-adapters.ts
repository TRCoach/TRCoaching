import { discardBodyProbe, type FetchLike } from "./http-probe.js";
import { presentEvidence, type EvidenceCard, type EvidenceEnv } from "./evidence.js";

const STRIPE_LIVE = /^(sk_live_|rk_live_)/;
const STRIPE_TEST_RESTRICTED = /^rk_test_/;
const STRIPE_ALLOW_PATH = /^https:\/\/api\.stripe\.com\/v1\/account$/;

export function assertStripeReadOnlyKey(key: string): void {
  if (STRIPE_LIVE.test(key)) {
    throw new Error("live Stripe keys are rejected");
  }
  if (!STRIPE_TEST_RESTRICTED.test(key)) {
    throw new Error("Stripe key must be restricted rk_test_ (read-only TEST)");
  }
}

export function assertStripeReadOnlyRequest(method: string, url: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new Error("Stripe mutation methods are rejected");
  }
  if (!STRIPE_ALLOW_PATH.test(url.split("?")[0] ?? url)) {
    throw new Error("Stripe mutation/unallowlisted paths are rejected");
  }
}

function card(
  id: string,
  source: string,
  freshness: EvidenceCard["freshness"],
  detail: string,
  setup: string,
  extra: Partial<EvidenceCard> = {},
): EvidenceCard {
  const now = extra.lastAttempted ?? new Date().toISOString();
  return presentEvidence({
    id,
    source,
    lastAttempted: now,
    lastVerified: extra.lastVerified ?? null,
    freshness,
    evidenceRef: extra.evidenceRef ?? null,
    detail,
    setupRequirement: setup,
    credentialsExposed: false,
    demoFixture: false,
    ...extra,
  });
}

export async function collectLiveEvidence(
  env: EvidenceEnv,
  fetchImpl: FetchLike = fetch,
): Promise<EvidenceCard[]> {
  const cards: EvidenceCard[] = [];

  if (env.driveKey) {
    const probe = await discardBodyProbe(
      "drive",
      "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(name,modifiedTime,mimeType)",
      { headers: { authorization: `Bearer ${env.driveKey}` } },
      fetchImpl,
    );
    cards.push(
      card(
        "drive",
        "Drive",
        probe.ok ? "VERIFIED" : "UNKNOWN",
        probe.ok
          ? "Drive metadata probe succeeded. Title/modifiedTime labels only; document bodies discarded."
          : "Drive metadata probe failed. Status UNKNOWN, never green.",
        "TR_DRIVE_READONLY_TOKEN metadata-only. File IDs stay in env placeholders, never in git.",
        {
          lastAttempted: probe.lastAttempted,
          lastVerified: probe.ok ? probe.lastAttempted : null,
          evidenceRef: probe.ok ? "drive_metadata_title_pointer" : null,
        },
      ),
    );
  } else {
    cards.push(
      card("drive", "Drive", "NOT_CONNECTED", "Drive is not configured.", "Set TR_DRIVE_READONLY_TOKEN (metadata-only)."),
    );
  }

  if (env.crmKey && env.crmUrl) {
    const probe = await discardBodyProbe("crm", env.crmUrl, { headers: { authorization: `Bearer ${env.crmKey}` } }, fetchImpl);
    cards.push(
      card(
        "crm",
        "CRM",
        probe.ok ? "VERIFIED" : "UNKNOWN",
        probe.ok
          ? "CRM spreadsheet metadata/aggregate count only. No lead names or contact data persisted."
          : "CRM metadata probe failed.",
        "TR_CRM_READONLY_TOKEN + TR_CRM_READONLY_URL for Google Sheet metadata. No values/PII.",
        {
          lastAttempted: probe.lastAttempted,
          lastVerified: probe.ok ? probe.lastAttempted : null,
          evidenceRef: probe.ok ? "crm_sheet_aggregate_count" : null,
        },
      ),
    );
  } else {
    cards.push(
      card(
        "crm",
        "CRM",
        env.crmKey ? "UNKNOWN" : "NOT_CONNECTED",
        env.crmKey ? "CRM token present but TR_CRM_READONLY_URL is missing." : "CRM is not configured.",
        "Set TR_CRM_READONLY_TOKEN and TR_CRM_READONLY_URL (Sheet metadata only).",
      ),
    );
  }

  if (env.metricoolKey && env.metricoolUrl) {
    const probe = await discardBodyProbe(
      "metricool",
      env.metricoolUrl,
      { headers: { authorization: `Bearer ${env.metricoolKey}` } },
      fetchImpl,
    );
    cards.push(
      card(
        "metricool",
        "Metricool",
        probe.ok ? "VERIFIED" : "UNKNOWN",
        probe.ok
          ? "Metricool account/calendar metadata only. Schedule/publish remain blocked."
          : "Metricool metadata probe failed.",
        "TR_METRICOOL_READONLY_TOKEN + TR_METRICOOL_READONLY_URL (documented read API). No publish scope.",
        {
          lastAttempted: probe.lastAttempted,
          lastVerified: probe.ok ? probe.lastAttempted : null,
          evidenceRef: probe.ok ? "metricool_calendar_metadata" : null,
        },
      ),
    );
  } else {
    cards.push(
      card(
        "metricool",
        "Metricool",
        "NOT_CONNECTED",
        "Metricool is not connected. Exact setup: TR_METRICOOL_READONLY_TOKEN and TR_METRICOOL_READONLY_URL pointing at Metricool's documented read/analytics API. No schedule or publish.",
        "Set TR_METRICOOL_READONLY_TOKEN and TR_METRICOOL_READONLY_URL (read/analytics only).",
      ),
    );
  }

  if (env.stripeKey) {
    assertStripeReadOnlyKey(env.stripeKey);
    const url = "https://api.stripe.com/v1/account";
    assertStripeReadOnlyRequest("GET", url);
    const probe = await discardBodyProbe("stripe", url, { headers: { authorization: `Bearer ${env.stripeKey}` } }, fetchImpl);
    cards.push(
      card(
        "stripe",
        "Stripe",
        probe.ok ? "VERIFIED" : "UNKNOWN",
        probe.ok
          ? "Stripe TEST account metadata only. No customer or payment objects persisted."
          : "Stripe TEST account probe failed.",
        "TR_STRIPE_READONLY_TOKEN must be rk_test_ restricted read. Live keys and writes are rejected.",
        {
          lastAttempted: probe.lastAttempted,
          lastVerified: probe.ok ? probe.lastAttempted : null,
          evidenceRef: probe.ok ? "stripe_test_account" : null,
        },
      ),
    );
  } else {
    cards.push(
      card("stripe", "Stripe", "NOT_CONNECTED", "Stripe TEST read key is not configured.", "Set rk_test_ restricted read token only."),
    );
  }

  if (env.supersetKey && env.supersetUrl) {
    const probe = await discardBodyProbe(
      "superset",
      env.supersetUrl,
      { headers: { authorization: `Bearer ${env.supersetKey}` } },
      fetchImpl,
    );
    cards.push(
      card(
        "superset",
        "Superset",
        probe.ok ? "VERIFIED" : "UNKNOWN",
        probe.ok
          ? "Superset neutral assignment/check-in codes only. Zone C/health content discarded."
          : "Superset metadata probe failed.",
        "TR_SUPERSET_READONLY_TOKEN + TR_SUPERSET_READONLY_URL for assignment codes only. No Zone C.",
        {
          lastAttempted: probe.lastAttempted,
          lastVerified: probe.ok ? probe.lastAttempted : null,
          evidenceRef: probe.ok ? "superset_assignment_codes" : null,
        },
      ),
    );
  } else {
    cards.push(
      card(
        "superset",
        "Superset",
        "NOT_CONNECTED",
        "Superset has no supported API credentials configured.",
        "Set TR_SUPERSET_READONLY_TOKEN and TR_SUPERSET_READONLY_URL for neutral delivery codes only. No Zone C.",
      ),
    );
  }

  return cards;
}

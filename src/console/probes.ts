import { discardBodyProbe, skippedProbe, type FetchLike, type ProbeResult } from "./http-probe.js";
import type { EvidenceEnv } from "./evidence.js";
import { CURSOR_API_BASE } from "./cursor-v1.js";

export async function probeConnectors(
  env: EvidenceEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  if (env.driveKey) {
    results.push(
      await discardBodyProbe(
        "drive",
        "https://www.googleapis.com/drive/v3/about?fields=kind",
        { headers: { authorization: `Bearer ${env.driveKey}` } },
        fetchImpl,
      ),
    );
  } else {
    results.push(skippedProbe("drive", "NOT_CONNECTED"));
  }

  if (env.crmKey && env.crmUrl) {
    results.push(await discardBodyProbe("crm", env.crmUrl, { headers: { authorization: `Bearer ${env.crmKey}` } }, fetchImpl));
  } else {
    results.push(skippedProbe("crm", env.crmKey ? "UNKNOWN" : "NOT_CONNECTED"));
  }

  if (env.metricoolKey && env.metricoolUrl) {
    results.push(
      await discardBodyProbe(
        "metricool",
        env.metricoolUrl,
        { headers: { authorization: `Bearer ${env.metricoolKey}` } },
        fetchImpl,
      ),
    );
  } else {
    results.push(skippedProbe("metricool", env.metricoolKey ? "UNKNOWN" : "NOT_CONNECTED"));
  }

  if (env.stripeKey) {
    results.push(
      await discardBodyProbe(
        "stripe",
        "https://api.stripe.com/v1/account",
        { headers: { authorization: `Bearer ${env.stripeKey}` } },
        fetchImpl,
      ),
    );
  } else {
    results.push(skippedProbe("stripe", "NOT_CONNECTED"));
  }

  if (env.supersetKey && env.supersetUrl) {
    results.push(
      await discardBodyProbe(
        "superset",
        env.supersetUrl,
        { headers: { authorization: `Bearer ${env.supersetKey}` } },
        fetchImpl,
      ),
    );
  } else {
    results.push(skippedProbe("superset", env.supersetKey ? "UNKNOWN" : "NOT_CONNECTED"));
  }

  if (env.slackToken) {
    results.push(
      await discardBodyProbe(
        "slack",
        "https://slack.com/api/auth.test",
        {
          method: "POST",
          headers: { authorization: `Bearer ${env.slackToken}`, "content-type": "application/x-www-form-urlencoded" },
        },
        fetchImpl,
      ),
    );
  } else {
    results.push(skippedProbe("slack", "NOT_CONNECTED"));
  }

  if (env.cursorToken) {
    results.push(
      await discardBodyProbe(
        "cursor",
        `${CURSOR_API_BASE}/v1/models`,
        { headers: { authorization: `Bearer ${env.cursorToken}` } },
        fetchImpl,
      ),
    );
  } else {
    results.push(skippedProbe("cursor", "NOT_CONNECTED"));
  }

  if (env.githubToken) {
    results.push(
      await discardBodyProbe(
        "github",
        "https://api.github.com/repos/TRCoach/TRCoaching",
        { headers: { authorization: `Bearer ${env.githubToken}`, accept: "application/vnd.github+json" } },
        fetchImpl,
      ),
    );
  } else {
    results.push(skippedProbe("github", "NOT_CONNECTED"));
  }

  return results;
}

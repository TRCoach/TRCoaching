export interface ProbeResult {
  id: string;
  ok: boolean;
  status: number | null;
  evidenceLabel: string;
  lastAttempted: string;
  bodyDiscarded: true;
  credentialsExposed: false;
}

export type FetchLike = typeof fetch;

export async function discardBodyProbe(
  id: string,
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<ProbeResult> {
  const lastAttempted = new Date().toISOString();
  const response = await fetchImpl(url, { ...init, redirect: "manual" });
  if (response.body) {
    await response.body.cancel();
  }
  return {
    id,
    ok: response.ok,
    status: response.status,
    evidenceLabel: response.ok ? "auth_or_metadata_probe_http_ok" : "auth_or_metadata_probe_http_failed",
    lastAttempted,
    bodyDiscarded: true,
    credentialsExposed: false,
  };
}

export function skippedProbe(id: string, label: string): ProbeResult {
  return {
    id,
    ok: false,
    status: null,
    evidenceLabel: label,
    lastAttempted: new Date().toISOString(),
    bodyDiscarded: true,
    credentialsExposed: false,
  };
}

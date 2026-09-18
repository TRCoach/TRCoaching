const FORBIDDEN_KEY =
  /^(email|e-mail|phone|tel|mobile|name|full_name|first_name|last_name|address|dob|date_of_birth|ssn|ni_number|passport|health|diagnosis|injury|medication|condition|zone_c|zonec|symptoms|clinical|patient)$/i;

const FORBIDDEN_SUBSTRING =
  /(email|phone_number|full_name|date_of_birth|zone[_-]?c|diagnos|medications?|injur|symptom|clinical_note)/i;

export function forbiddenKeys(payload: unknown, path = ""): string[] {
  if (payload === null || payload === undefined) return [];
  if (Array.isArray(payload)) {
    return payload.flatMap((item, i) => forbiddenKeys(item, `${path}[${i}]`));
  }
  if (typeof payload !== "object") return [];
  const hits: string[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEY.test(key) || FORBIDDEN_SUBSTRING.test(key)) {
      hits.push(next);
    }
    hits.push(...forbiddenKeys(value, next));
  }
  return hits;
}

export function assertNoSensitivePayload(payload: unknown, label = "payload"): void {
  const hits = forbiddenKeys(payload);
  if (hits.length > 0) {
    throw new Error(`${label} contains forbidden client/Zone C fields: ${hits.join(", ")}`);
  }
}

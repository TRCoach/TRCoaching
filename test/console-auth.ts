export const TEST_FOUNDER = {
  username: "founder",
  password: "phase-b-test-password",
};

export async function loginFounder(url: string) {
  const response = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(TEST_FOUNDER),
  });
  const body = (await response.json()) as { ok?: boolean; csrf?: string; reason?: string };
  const setCookie = response.headers.getSetCookie();
  return {
    status: response.status,
    csrf: body.csrf ?? "",
    cookie: setCookie.map((part) => part.split(";")[0]).join("; "),
    body,
  };
}

export function authHeaders(session: { cookie: string; csrf: string }, extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
    ...extra,
  };
}

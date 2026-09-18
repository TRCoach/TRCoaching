import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { ConsoleStore, StoredSession } from "./store.js";

const SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 5;

export interface AuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  secureCookies: boolean;
  allowDev: boolean;
}

export interface AuthResult {
  ok: boolean;
  status: number;
  reason?: string;
  session?: StoredSession;
  token?: string;
}

export class FounderAuth {
  private attempts = new Map<string, number[]>();

  constructor(
    readonly store: ConsoleStore,
    readonly config: AuthConfig,
  ) {
    if (config.sessionSecret.length < 32) {
      throw new Error("FOUNDER_SESSION_SECRET must be at least 32 characters");
    }
  }

  static hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
    const hash = scryptSync(password, salt, 32).toString("hex");
    return `scrypt$${salt}$${hash}`;
  }

  static verifyPassword(password: string, encoded: string): boolean {
    const [scheme, salt, hash] = encoded.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const actual = scryptSync(password, salt, 32);
    const expected = Buffer.from(hash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  static testing(): AuthConfig {
    return {
      username: "founder",
      passwordHash: FounderAuth.hashPassword("phase-b-test-password", "test-salt"),
      sessionSecret: "tr-founder-test-session-secret-32ch",
      secureCookies: false,
      allowDev: true,
    };
  }

  hashToken(token: string): string {
    return createHash("sha256").update(`${this.config.sessionSecret}:${token}`).digest("hex");
  }

  login(username: string, password: string, ip: string): AuthResult {
    if (!this.rateOk(ip)) {
      return { ok: false, status: 429, reason: "login rate limit" };
    }
    const userOk = username === this.config.username;
    const passOk = FounderAuth.verifyPassword(password, this.config.passwordHash);
    if (!userOk || !passOk) {
      this.recordAttempt(ip);
      return { ok: false, status: 401, reason: "invalid founder credentials" };
    }
    this.attempts.delete(ip);
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    const session: StoredSession = {
      id: `sess_${randomBytes(6).toString("hex")}`,
      tokenHash: this.hashToken(token),
      csrf: randomBytes(24).toString("hex"),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_MS).toISOString(),
    };
    this.store.exclusive((data) => {
      data.sessions = data.sessions.filter((item) => Date.parse(item.expiresAt) > now);
      data.sessions.push(session);
      data.audits.unshift({
        id: `aud_${randomBytes(4).toString("hex")}`,
        at: session.createdAt,
        actor: "Founder",
        type: "login",
        summary: "Founder session created. Password not stored.",
      });
    });
    return { ok: true, status: 200, session, token };
  }

  logout(token: string | undefined): void {
    if (!token) return;
    const hash = this.hashToken(token);
    this.store.exclusive((data) => {
      data.sessions = data.sessions.filter((item) => item.tokenHash !== hash);
      data.audits.unshift({
        id: `aud_${randomBytes(4).toString("hex")}`,
        at: new Date().toISOString(),
        actor: "Founder",
        type: "logout",
        summary: "Founder session revoked.",
      });
    });
  }

  resolve(token: string | undefined): StoredSession | undefined {
    if (!token) return undefined;
    const hash = this.hashToken(token);
    const now = Date.now();
    return this.store.load().sessions.find((item) => item.tokenHash === hash && Date.parse(item.expiresAt) > now);
  }

  rotate(token: string): AuthResult {
    const current = this.resolve(token);
    if (!current) return { ok: false, status: 401, reason: "session expired" };
    this.logout(token);
    const newToken = randomBytes(32).toString("hex");
    const session: StoredSession = {
      id: `sess_${randomBytes(6).toString("hex")}`,
      tokenHash: this.hashToken(newToken),
      csrf: randomBytes(24).toString("hex"),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
      rotatedFrom: current.id,
    };
    this.store.exclusive((data) => {
      data.sessions.push(session);
    });
    return { ok: true, status: 200, session, token: newToken };
  }

  assertCsrf(session: StoredSession, header: string | undefined): boolean {
    if (!header || header.length < 16) return false;
    const a = Buffer.from(session.csrf);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private recordAttempt(ip: string): void {
    const now = Date.now();
    const recent = (this.attempts.get(ip) ?? []).filter((ts) => now - ts < LOGIN_WINDOW_MS);
    recent.push(now);
    this.attempts.set(ip, recent);
  }

  private rateOk(ip: string): boolean {
    const now = Date.now();
    const recent = (this.attempts.get(ip) ?? []).filter((ts) => now - ts < LOGIN_WINDOW_MS);
    this.attempts.set(ip, recent);
    const max = ip === "127.0.0.1" || ip === "::1" || ip === ":ffff:127.0.0.1" ? LOGIN_MAX + 10 : LOGIN_MAX;
    return recent.length < max;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) out[key] = decodeURIComponent(rest.join("="));
  }
  return out;
}

export function sessionCookie(token: string, secure: boolean, maxAge = SESSION_MS / 1000): string {
  return [
    `tr_session=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${Math.floor(maxAge)}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function csrfCookie(token: string, secure: boolean): string {
  return [
    `tr_csrf=${token}`,
    "Path=/",
    "SameSite=Strict",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearCookies(secure: boolean): string[] {
  const extra = secure ? "; Secure" : "";
  return [
    `tr_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${extra}`,
    `tr_csrf=; Path=/; SameSite=Strict; Max-Age=0${extra}`,
  ];
}

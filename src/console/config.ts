import { join } from "node:path";
import { FounderAuth, type AuthConfig } from "./auth.js";
import { type ConsoleStore } from "./store.js";
import { openStore } from "./file-store.js";

export interface ConsoleRuntimeConfig {
  production: boolean;
  host: string;
  port: number;
  auth: AuthConfig;
  store: ConsoleStore;
  storeKind: "memory" | "file";
  dataDir?: string;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ConsoleRuntimeConfig {
  const production = env.NODE_ENV === "production";
  const host = env.FOUNDER_CONSOLE_HOST ?? "127.0.0.1";
  const port = Number(env.FOUNDER_CONSOLE_PORT ?? 8787);
  const secret = env.FOUNDER_SESSION_SECRET;
  const passwordHash = env.FOUNDER_AUTH_PASSWORD_HASH;
  const username = env.FOUNDER_AUTH_USER ?? "founder";
  const devAuth = env.FOUNDER_CONSOLE_DEV_AUTH === "1";
  const devPassword = env.FOUNDER_DEV_PASSWORD;
  const localhost = host === "127.0.0.1" || host === "localhost";

  if (production) {
    if (!secret || secret.length < 32) {
      throw new Error("production fail-closed: FOUNDER_SESSION_SECRET (>=32) is required");
    }
    if (!passwordHash || !/^(scrypt|pbkdf2)\$/.test(passwordHash)) {
      throw new Error("production fail-closed: FOUNDER_AUTH_PASSWORD_HASH is required (scrypt$ or pbkdf2$, no default credential)");
    }
    if (host !== "127.0.0.1" && host !== "localhost" && env.FOUNDER_CONSOLE_ALLOW_REMOTE !== "1") {
      throw new Error("production fail-closed: set FOUNDER_CONSOLE_ALLOW_REMOTE=1 only for private HTTPS");
    }
    if (!env.FOUNDER_CONSOLE_DATA_DIR) {
      throw new Error("production fail-closed: FOUNDER_CONSOLE_DATA_DIR is required");
    }
    return {
      production: true,
      host,
      port,
      auth: {
        username,
        passwordHash,
        sessionSecret: secret,
        secureCookies: env.FOUNDER_CONSOLE_SECURE_COOKIES !== "0",
        allowDev: false,
      },
      store: openStore("file", env.FOUNDER_CONSOLE_DATA_DIR),
      storeKind: "file",
      dataDir: env.FOUNDER_CONSOLE_DATA_DIR,
    };
  }

  if (!localhost) {
    throw new Error("non-production Founder Console binds localhost only");
  }
  if (!devAuth || !devPassword) {
    throw new Error(
      "dev auth required: FOUNDER_CONSOLE_DEV_AUTH=1 and FOUNDER_DEV_PASSWORD (localhost only, never commit)",
    );
  }
  const dataDir = env.FOUNDER_CONSOLE_DATA_DIR ?? join(process.cwd(), ".tmp/console-data");
  return {
    production: false,
    host,
    port,
    auth: {
      username,
      passwordHash: FounderAuth.hashPassword(devPassword, "dev-salt"),
      sessionSecret: secret && secret.length >= 32 ? secret : "tr-founder-dev-session-secret-32ch",
      secureCookies: false,
      allowDev: true,
    },
    store: openStore(env.FOUNDER_CONSOLE_STORE === "memory" ? "memory" : "file", dataDir),
    storeKind: env.FOUNDER_CONSOLE_STORE === "memory" ? "memory" : "file",
    dataDir,
  };
}

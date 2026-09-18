import { assertActionCompleteness, loadFounderActions } from "./actions.js";
import { startConsoleServer } from "./http.js";
import { ConsoleService } from "./service.js";
import { EXACT_PROMPTS } from "./router.js";
import { FOUNDER_ACTION_TITLES } from "./types.js";
import { loadPermissions } from "../permissions.js";

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  const catalog = loadFounderActions();
  const completeness = assertActionCompleteness(catalog);
  const service = new ConsoleService(loadPermissions());
  const daily = service.runAction("run_daily_business_cycle");
  const started = await startConsoleServer({ port: 0, service: new ConsoleService() });
  try {
    const health = await fetchJson(`${started.url}/api/health`);
    const mode = await fetchJson(`${started.url}/api/mode`);
    const home = await fetch(`${started.url}/`);
    const manifest = await fetch(`${started.url}/manifest.webmanifest`);
    const sensitive = await fetchJson(`${started.url}/api/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello", email: "hidden@example.com" }),
    });
    const spoof = started.service.runAction("run_controlled_beta_readiness_audit", undefined, {
      operating_mode: "CONTROLLED_BETA",
    });
    const ok =
      completeness.length === 0 &&
      catalog.actions.length === 17 &&
      FOUNDER_ACTION_TITLES.every((title) => catalog.actions.some((item) => item.title === title)) &&
      daily.ok &&
      daily.externalWrites === 0 &&
      daily.providerCalled === false &&
      health.status === 200 &&
      mode.body?.mode === "TEST" &&
      home.ok &&
      manifest.ok &&
      sensitive.status === 400 &&
      spoof.mode === "TEST" &&
      loadPermissions().currentMode === "TEST";
    const report = {
      ok,
      actions: catalog.actions.length,
      completeness,
      daily_writes: daily.externalWrites,
      mode: mode.body?.mode,
      static_ok: home.ok && manifest.ok,
      sensitive_rejected: sensitive.status === 400,
      spoof_ignored: spoof.mode === "TEST",
      exact_prompts: EXACT_PROMPTS,
      url: started.url,
      external_writes: 0,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!ok) process.exitCode = 1;
  } finally {
    started.server.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

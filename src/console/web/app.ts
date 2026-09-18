type LaneOutcome = "progressed" | "blocked" | "awaiting_external" | "founder_required";
type ActivityStatus = "requested" | "queued" | "scheduled" | "pending" | "published" | "completed";

interface ActionConfig {
  id: string;
  title: string;
  workflowId: string;
  owner: string;
  system: string;
  founderGate: boolean;
  success: string;
}

interface LaneSnapshot {
  id: string;
  title: string;
  owner: string;
  outcome: LaneOutcome;
  items: Array<{ ref: string; reason: string; outcome: LaneOutcome }>;
}

interface DecisionItem {
  id: string;
  kind: string;
  title: string;
  subjectRef: string;
  status: string;
  notes: string;
}

interface ActivityRecord {
  id: string;
  title: string;
  status: ActivityStatus;
  summary: string;
  owner: string;
}

interface Snapshot {
  mode: string;
  exceptionFirst: LaneSnapshot[];
  actions: ActionConfig[];
  inbox: DecisionItem[];
  activity: ActivityRecord[];
  status: Array<{ label: string; role: string; reachability: string; detail: string }>;
  usage: { jobs: number; model: string; runtimeMs: number; retries: number; estimatedCostUsd: null; costStatus: string; note: string };
}

const resultEl = document.querySelector("#result") as HTMLElement;
const overviewEl = document.querySelector("#overview") as HTMLElement;
const actionsEl = document.querySelector("#actions") as HTMLElement;
const inboxEl = document.querySelector("#inbox") as HTMLElement;
const activityEl = document.querySelector("#activity") as HTMLElement;
const statusEl = document.querySelector("#status") as HTMLElement;
const usageEl = document.querySelector("#usage") as HTMLElement;
const modeEl = document.querySelector("#mode-badge") as HTMLElement;

function showResult(text: string): void {
  resultEl.textContent = text;
  resultEl.focus();
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await response.json()) as T & { reason?: string };
  if (!response.ok) throw new Error(data.reason ?? `${response.status}`);
  return data;
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function badge(status: string): string {
  const safe = status === "PENDING" ? "pending" : status;
  return `<span class="badge ${escape(safe)}">${escape(safe)}</span>`;
}

function renderOverview(lanes: LaneSnapshot[]): void {
  overviewEl.innerHTML = lanes
    .map(
      (lane) => `
      <article class="lane ${lane.outcome}">
        <h3>${escape(lane.title)}</h3>
        <p>${badge(lane.outcome)} · ${escape(lane.owner)}</p>
        <ul>${lane.items.map((item) => `<li><code>${escape(item.ref)}</code> — ${escape(item.reason)}</li>`).join("")}</ul>
      </article>`,
    )
    .join("");
}

function renderActions(actions: ActionConfig[]): void {
  actionsEl.innerHTML = actions
    .map(
      (action) => `
      <article class="card">
        <h3>${escape(action.title)}</h3>
        <p><strong>${escape(action.owner)}</strong> · ${escape(action.system)} · ${escape(action.workflowId)}</p>
        <p>${escape(action.success)}</p>
        <button type="button" data-action="${escape(action.id)}">${escape(action.title)}</button>
      </article>`,
    )
    .join("");
  for (const button of Array.from(actionsEl.querySelectorAll<HTMLButtonElement>("button[data-action]"))) {
    button.addEventListener("click", () => void runAction(button.dataset.action ?? ""));
  }
}

function renderInbox(items: DecisionItem[]): void {
  inboxEl.innerHTML = items
    .map(
      (item) => `
      <article class="row">
        <h3>${escape(item.title)}</h3>
        <p>${badge(item.status)} · ${escape(item.kind)} · ${escape(item.subjectRef)}</p>
        <p>${escape(item.notes)}</p>
        <div class="actions">
          <button type="button" data-decide="${item.id}" data-act="approve">Approve</button>
          <button type="button" class="danger" data-decide="${item.id}" data-act="reject">Reject</button>
          <button type="button" class="secondary" data-decide="${item.id}" data-act="request-evidence">Request more evidence</button>
        </div>
      </article>`,
    )
    .join("");
  for (const button of Array.from(inboxEl.querySelectorAll<HTMLButtonElement>("button[data-decide]"))) {
    button.addEventListener("click", () => void decide(button.dataset.decide ?? "", button.dataset.act ?? ""));
  }
}

function renderActivity(items: ActivityRecord[]): void {
  activityEl.innerHTML = items
    .map((item) => {
      const status = item.status;
      return `<article class="row"><h3>${escape(item.title)}</h3><p>${badge(status)} · ${escape(item.owner)}</p><p>${escape(item.summary)}</p></article>`;
    })
    .join("");
}

function renderStatus(items: Snapshot["status"]): void {
  statusEl.innerHTML = items
    .map((item) => `<article class="card"><h3>${escape(item.label)}</h3><p>${escape(item.role)}</p><p>${badge(item.reachability)}</p><p>${escape(item.detail)}</p></article>`)
    .join("");
}

function renderUsage(usage: Snapshot["usage"]): void {
  usageEl.innerHTML = `
    <article class="row">
      <p>Jobs: ${usage.jobs} · Model: ${usage.model} · Runtime: ${usage.runtimeMs} ms · Retries: ${usage.retries}</p>
      <p>Estimated cost: unknown (never shown as $0.00). Status: ${usage.costStatus}.</p>
      <p>${usage.note}</p>
    </article>`;
}

async function refresh(): Promise<void> {
  const snap = await api<Snapshot>("/api/overview");
  modeEl.textContent = `MODE: ${snap.mode} · DEMO · trusted registry only`;
  renderOverview(snap.exceptionFirst);
  renderActions(snap.actions);
  renderInbox(snap.inbox);
  renderActivity(snap.activity);
  renderStatus(snap.status);
  renderUsage(snap.usage);
}

async function runAction(id: string): Promise<void> {
  const result = await api<{ founderFriendlySummary: string; mode: string; externalWrites: number }>(`/api/actions/${id}`, {
    method: "POST",
    body: "{}",
  });
  showResult(`${result.founderFriendlySummary}\n\nTrusted mode: ${result.mode}. External writes: ${result.externalWrites}.`);
  await refresh();
}

async function decide(id: string, act: string): Promise<void> {
  const result = await api<{ ok: boolean; reason?: string; providerCalled: boolean }>(`/api/inbox/${id}/${act}`, { method: "POST", body: "{}" });
  showResult(result.ok ? `Decision ${act} recorded. Provider called: ${result.providerCalled}.` : result.reason ?? "Decision failed.");
  await refresh();
}

document.querySelector("#command-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = (document.querySelector("#command-input") as HTMLTextAreaElement).value;
  void api<{ founderFriendlySummary: string; correlationId: string; mode: string }>("/api/command", {
    method: "POST",
    body: JSON.stringify({ text }),
  }).then(async (result) => {
    showResult(`${result.founderFriendlySummary}\n\nCorrelation: ${result.correlationId}. Mode: ${result.mode}.`);
    await refresh();
  }).catch((error: unknown) => {
    showResult(error instanceof Error ? error.message : String(error));
  });
});

void refresh().catch((error: unknown) => {
  showResult(error instanceof Error ? error.message : String(error));
});

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}

type Outcome = string;

interface Pref {
  id: string;
  visible: boolean;
  order: number;
  displayName: string;
  icon: string;
  description: string;
  confirm: boolean;
}

interface Snapshot {
  mode: string;
  exceptionFirst: Array<{
    id: string;
    title: string;
    owner: string;
    outcome: Outcome;
    items: Array<{ ref: string; reason: string; outcome: Outcome }>;
  }>;
  actions: Array<{ id: string; title: string; owner: string; system: string; workflowId: string; success: string; founderGate: boolean; _pref?: Pref }>;
  inbox: Array<{ id: string; title: string; kind: string; status: string; subjectRef: string; notes: string; impact?: string }>;
  activity: Array<{ id: string; title: string; status: string; summary: string; owner: string }>;
  jobs?: Array<{ id: string; title: string; status: string; owner: string; resultSummary: string; executor: string }>;
  status: Array<{ label: string; role: string; reachability: string; detail: string }>;
  evidence?: Array<{ id: string; source: string; freshness: string; detail: string; setupRequirement: string }>;
  usage: { jobs: number; model: string; runtimeMs: number; retries: number; estimatedCostUsd: null; costStatus: string; note: string };
  preferences?: Pref[];
  lastDispatch?: { founderFriendlySummary: string; correlationId: string };
}

let csrf = "";

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function badge(status: string): string {
  const safe = status === "PENDING" ? "pending" : status;
  return `<span class="badge ${escape(safe)}">${escape(safe)}</span>`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json()) as T & { reason?: string };
  if (!response.ok) throw new Error(data.reason ?? `${response.status}`);
  return data;
}

function show(view: "login" | "app"): void {
  const login = document.querySelector("#login-view") as HTMLElement;
  const app = document.querySelector("#app-view") as HTMLElement;
  login.hidden = view !== "login";
  app.hidden = view !== "app";
}

function openDrawer(html: string): void {
  const drawer = document.querySelector("#drawer") as HTMLDialogElement;
  (document.querySelector("#drawer-body") as HTMLElement).innerHTML = html;
  drawer.showModal();
}

function render(snap: Snapshot): void {
  (document.querySelector("#mode-badge") as HTMLElement).textContent = `MODE: ${snap.mode} · trusted registry`;
  const result = document.querySelector("#result") as HTMLElement;
  if (snap.lastDispatch) result.textContent = snap.lastDispatch.founderFriendlySummary;
  (document.querySelector("#overview") as HTMLElement).innerHTML = snap.exceptionFirst
    .map(
      (lane) => `
      <article class="lane ${lane.outcome}" data-detail="lane/${lane.id}">
        <h3>${escape(lane.title)}</h3>
        <p>${badge(lane.outcome)} · ${escape(lane.owner)}</p>
        <p>${escape(lane.items[0]?.reason ?? "")}</p>
      </article>`,
    )
    .join("");
  (document.querySelector("#actions") as HTMLElement).innerHTML = snap.actions
    .map(
      (action) => `
      <article class="card">
        <h3>${escape(action._pref?.icon ?? "◆")} ${escape(action.title)}</h3>
        <p>${escape(action.owner)} · ${escape(action.system)}</p>
        <p>${escape(action._pref?.description ?? action.success)}</p>
        <button type="button" data-action="${escape(action.id)}" data-confirm="${action._pref?.confirm ? "1" : "0"}">${escape(action.title)}</button>
      </article>`,
    )
    .join("");
  (document.querySelector("#inbox") as HTMLElement).innerHTML = snap.inbox
    .map(
      (item) => `
      <article class="row" data-detail="decision/${item.id}">
        <h3>${escape(item.title)}</h3>
        <p>${badge(item.status)} · ${escape(item.kind)} · ${escape(item.subjectRef)}</p>
        <p>${escape(item.notes)}</p>
        <div class="actions">
          <button type="button" data-decide="${item.id}" data-act="approve">Approve</button>
          <button type="button" data-decide="${item.id}" data-act="reject">Reject</button>
          <button type="button" class="ghost" data-decide="${item.id}" data-act="request-evidence">Request evidence</button>
        </div>
      </article>`,
    )
    .join("");
  (document.querySelector("#jobs") as HTMLElement).innerHTML = (snap.jobs ?? [])
    .map(
      (job) => `
      <article class="row lane ${job.status}" data-detail="job/${job.id}">
        <h3>${escape(job.title)}</h3>
        <p>${badge(job.status)} · ${escape(job.executor)} · ${escape(job.owner)}</p>
        <p>${escape(job.resultSummary)}</p>
      </article>`,
    )
    .join("");
  (document.querySelector("#activity") as HTMLElement).innerHTML = snap.activity
    .map(
      (item) => `<article class="row" data-detail="activity/${item.id}"><h3>${escape(item.title)}</h3><p>${badge(item.status)} · ${escape(item.owner)}</p><p>${escape(item.summary)}</p></article>`,
    )
    .join("");
  const connectors = (snap.evidence ?? []).map(
    (item) => `<article class="card lane ${item.freshness}" data-detail="action/${item.id}"><h3>${escape(item.source)}</h3><p>${badge(item.freshness)}</p><p>${escape(item.detail)}</p><p>${escape(item.setupRequirement)}</p></article>`,
  );
  (document.querySelector("#status") as HTMLElement).innerHTML = connectors.join("");
  const usage = snap.usage;
  (document.querySelector("#usage") as HTMLElement).innerHTML = `<article class="row"><p>Jobs ${usage.jobs} · ${escape(usage.model)} · ${usage.runtimeMs}ms · retries ${usage.retries}</p><p>Cost: unknown (${usage.costStatus}), never $0.00.</p><p>${escape(usage.note)}</p></article>`;
  bind(snap);
}

function bind(snap: Snapshot): void {
  for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-detail]"))) {
    node.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      const key = node.dataset.detail ?? "";
      void api<Record<string, unknown>>(`/api/detail/${key}`).then((detail) => {
        openDrawer(`<pre class="result">${escape(JSON.stringify(detail, null, 2))}</pre>`);
      });
    });
  }
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-action]"))) {
    button.addEventListener("click", async () => {
      if (button.dataset.confirm === "1" && !window.confirm(`Run ${button.textContent}? This stays TEST-gated.`)) return;
      const result = await api<{ founderFriendlySummary: string; mode: string; externalWrites: number }>(
        `/api/actions/${button.dataset.action}`,
        { method: "POST", body: "{}" },
      );
      (document.querySelector("#result") as HTMLElement).textContent = `${result.founderFriendlySummary}\n\nMode ${result.mode}. Writes ${result.externalWrites}.`;
      await refresh();
    });
  }
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-decide]"))) {
    button.addEventListener("click", async () => {
      const result = await api<{ ok: boolean; reason?: string; providerCalled: boolean }>(
        `/api/inbox/${button.dataset.decide}/${button.dataset.act}`,
        { method: "POST", body: "{}" },
      );
      (document.querySelector("#result") as HTMLElement).textContent = result.ok
        ? `Decision recorded. Provider called: ${result.providerCalled}.`
        : result.reason ?? "Decision failed";
      await refresh();
    });
  }
  const prefsBody = document.querySelector("#prefs-body") as HTMLElement;
  prefsBody.innerHTML = (snap.preferences ?? [])
    .map(
      (pref) => `
      <div class="pref-row" data-id="${escape(pref.id)}">
        <strong>${escape(pref.id)}</strong>
        <label><input type="checkbox" data-k="visible" ${pref.visible ? "checked" : ""} /> Visible</label>
        <label>Order <input data-k="order" type="number" value="${pref.order}" /></label>
        <label>Display <input data-k="displayName" value="${escape(pref.displayName)}" /></label>
        <label>Icon <input data-k="icon" value="${escape(pref.icon)}" /></label>
        <label>Description <input data-k="description" value="${escape(pref.description)}" /></label>
        <label><input type="checkbox" data-k="confirm" ${pref.confirm ? "checked" : ""} /> Confirm</label>
      </div>`,
    )
    .join("");
}

async function refresh(): Promise<void> {
  const snap = await api<Snapshot>("/api/overview");
  render(snap);
}

async function boot(): Promise<void> {
  const session = await api<{ authenticated: boolean; csrf?: string }>("/api/session");
  if (!session.authenticated) {
    show("login");
    return;
  }
  csrf = session.csrf ?? "";
  show("app");
  await refresh();
}

document.querySelector("#login-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = (document.querySelector("#username") as HTMLInputElement).value;
  const password = (document.querySelector("#password") as HTMLInputElement).value;
  void api<{ csrf: string }>("/api/login", { method: "POST", body: JSON.stringify({ username, password }) })
    .then(async (result) => {
      csrf = result.csrf;
      show("app");
      await refresh();
    })
    .catch((error: unknown) => {
      (document.querySelector("#login-error") as HTMLElement).textContent =
        error instanceof Error ? error.message : String(error);
    });
});

document.querySelector("#logout")?.addEventListener("click", () => {
  void api("/api/logout", { method: "POST", body: "{}" }).then(() => {
    csrf = "";
    show("login");
  });
});

document.querySelector("#command-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = (document.querySelector("#command-input") as HTMLTextAreaElement).value;
  void api<{ founderFriendlySummary: string; correlationId?: string; mode: string }>("/api/command", {
    method: "POST",
    body: JSON.stringify({ text }),
  })
    .then(async (result) => {
      (document.querySelector("#result") as HTMLElement).textContent = `${result.founderFriendlySummary}\n\n${result.correlationId ?? ""} ${result.mode}`;
      await refresh();
    })
    .catch((error: unknown) => {
      (document.querySelector("#result") as HTMLElement).textContent =
        error instanceof Error ? error.message : String(error);
    });
});

document.querySelector("#customize")?.addEventListener("click", () => {
  (document.querySelector("#prefs") as HTMLDialogElement).showModal();
});

document.querySelector("#save-prefs")?.addEventListener("click", () => {
  const items = Array.from(document.querySelectorAll<HTMLElement>("#prefs-body .pref-row")).map((row) => {
    const val = (key: string) => row.querySelector<HTMLInputElement>(`[data-k="${key}"]`);
    return {
      id: row.dataset.id ?? "",
      visible: val("visible")?.checked ?? true,
      order: Number(val("order")?.value ?? 0),
      displayName: val("displayName")?.value ?? "",
      icon: val("icon")?.value ?? "◆",
      description: val("description")?.value ?? "",
      confirm: val("confirm")?.checked ?? false,
    };
  });
  void api("/api/preferences", { method: "POST", body: JSON.stringify({ items }) }).then(async () => {
    (document.querySelector("#prefs") as HTMLDialogElement).close();
    await refresh();
  });
});

void boot().catch(() => show("login"));
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}

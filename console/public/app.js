"use strict";
const resultEl = document.querySelector("#result");
const overviewEl = document.querySelector("#overview");
const actionsEl = document.querySelector("#actions");
const inboxEl = document.querySelector("#inbox");
const activityEl = document.querySelector("#activity");
const statusEl = document.querySelector("#status");
const usageEl = document.querySelector("#usage");
const modeEl = document.querySelector("#mode-badge");
function showResult(text) {
    resultEl.textContent = text;
    resultEl.focus();
}
async function api(path, init) {
    const response = await fetch(path, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const data = (await response.json());
    if (!response.ok)
        throw new Error(data.reason ?? `${response.status}`);
    return data;
}
function escape(value) {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
function badge(status) {
    const safe = status === "PENDING" ? "pending" : status;
    return `<span class="badge ${escape(safe)}">${escape(safe)}</span>`;
}
function renderOverview(lanes) {
    overviewEl.innerHTML = lanes
        .map((lane) => `
      <article class="lane ${lane.outcome}">
        <h3>${escape(lane.title)}</h3>
        <p>${badge(lane.outcome)} · ${escape(lane.owner)}</p>
        <ul>${lane.items.map((item) => `<li><code>${escape(item.ref)}</code> — ${escape(item.reason)}</li>`).join("")}</ul>
      </article>`)
        .join("");
}
function renderActions(actions) {
    actionsEl.innerHTML = actions
        .map((action) => `
      <article class="card">
        <h3>${escape(action.title)}</h3>
        <p><strong>${escape(action.owner)}</strong> · ${escape(action.system)} · ${escape(action.workflowId)}</p>
        <p>${escape(action.success)}</p>
        <button type="button" data-action="${escape(action.id)}">${escape(action.title)}</button>
      </article>`)
        .join("");
    for (const button of Array.from(actionsEl.querySelectorAll("button[data-action]"))) {
        button.addEventListener("click", () => void runAction(button.dataset.action ?? ""));
    }
}
function renderInbox(items) {
    inboxEl.innerHTML = items
        .map((item) => `
      <article class="row">
        <h3>${escape(item.title)}</h3>
        <p>${badge(item.status)} · ${escape(item.kind)} · ${escape(item.subjectRef)}</p>
        <p>${escape(item.notes)}</p>
        <div class="actions">
          <button type="button" data-decide="${item.id}" data-act="approve">Approve</button>
          <button type="button" class="danger" data-decide="${item.id}" data-act="reject">Reject</button>
          <button type="button" class="secondary" data-decide="${item.id}" data-act="request-evidence">Request more evidence</button>
        </div>
      </article>`)
        .join("");
    for (const button of Array.from(inboxEl.querySelectorAll("button[data-decide]"))) {
        button.addEventListener("click", () => void decide(button.dataset.decide ?? "", button.dataset.act ?? ""));
    }
}
function renderActivity(items) {
    activityEl.innerHTML = items
        .map((item) => {
        const status = item.status;
        return `<article class="row"><h3>${escape(item.title)}</h3><p>${badge(status)} · ${escape(item.owner)}</p><p>${escape(item.summary)}</p></article>`;
    })
        .join("");
}
function renderStatus(items) {
    statusEl.innerHTML = items
        .map((item) => `<article class="card"><h3>${escape(item.label)}</h3><p>${escape(item.role)}</p><p>${badge(item.reachability)}</p><p>${escape(item.detail)}</p></article>`)
        .join("");
}
function renderUsage(usage) {
    usageEl.innerHTML = `
    <article class="row">
      <p>Jobs: ${usage.jobs} · Model: ${usage.model} · Runtime: ${usage.runtimeMs} ms · Retries: ${usage.retries}</p>
      <p>Estimated cost: unknown (never shown as $0.00). Status: ${usage.costStatus}.</p>
      <p>${usage.note}</p>
    </article>`;
}
async function refresh() {
    const snap = await api("/api/overview");
    modeEl.textContent = `MODE: ${snap.mode} · DEMO · trusted registry only`;
    renderOverview(snap.exceptionFirst);
    renderActions(snap.actions);
    renderInbox(snap.inbox);
    renderActivity(snap.activity);
    renderStatus(snap.status);
    renderUsage(snap.usage);
}
async function runAction(id) {
    const result = await api(`/api/actions/${id}`, {
        method: "POST",
        body: "{}",
    });
    showResult(`${result.founderFriendlySummary}\n\nTrusted mode: ${result.mode}. External writes: ${result.externalWrites}.`);
    await refresh();
}
async function decide(id, act) {
    const result = await api(`/api/inbox/${id}/${act}`, { method: "POST", body: "{}" });
    showResult(result.ok ? `Decision ${act} recorded. Provider called: ${result.providerCalled}.` : result.reason ?? "Decision failed.");
    await refresh();
}
document.querySelector("#command-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = document.querySelector("#command-input").value;
    void api("/api/command", {
        method: "POST",
        body: JSON.stringify({ text }),
    }).then(async (result) => {
        showResult(`${result.founderFriendlySummary}\n\nCorrelation: ${result.correlationId}. Mode: ${result.mode}.`);
        await refresh();
    }).catch((error) => {
        showResult(error instanceof Error ? error.message : String(error));
    });
});
void refresh().catch((error) => {
    showResult(error instanceof Error ? error.message : String(error));
});
if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js");
}

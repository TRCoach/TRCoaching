"use strict";
let csrf = "";
function escape(value) {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
function badge(status) {
    const safe = status === "PENDING" ? "pending" : status;
    return `<span class="badge ${escape(safe)}">${escape(safe)}</span>`;
}
async function api(path, init) {
    const response = await fetch(path, {
        credentials: "same-origin",
        mode: "same-origin",
        ...init,
        headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf,
            ...(init?.headers ?? {}),
        },
    });
    const raw = await response.text();
    let data;
    try {
        data = JSON.parse(raw);
    }
    catch {
        throw new Error(response.ok
            ? "Founder Console API returned a non-JSON response"
            : `Founder Console API unavailable (${response.status})`);
    }
    if (!response.ok)
        throw new Error(data.reason ?? `${response.status}`);
    return data;
}
function show(view) {
    const login = document.querySelector("#login-view");
    const app = document.querySelector("#app-view");
    login.hidden = view !== "login";
    app.hidden = view !== "app";
}
function openDrawer(html) {
    const drawer = document.querySelector("#drawer");
    document.querySelector("#drawer-body").innerHTML = html;
    if (!drawer.open)
        drawer.showModal();
}
function auditList(items = []) {
    if (!items.length)
        return `<p class="muted">No founder interactions recorded yet.</p>`;
    return `<ol class="audit-list">${items.map((item) => `<li><strong>${escape(item.type.replaceAll("_", " "))}</strong><span>${escape(item.actor)} · ${escape(new Date(item.at).toLocaleString())}</span><p>${escape(item.summary)}</p></li>`).join("")}</ol>`;
}
function laneItemHtml(item) {
    const controls = item.controls;
    const decision = controls.decisionId
        ? `<button type="button" data-open-decision="${escape(controls.decisionId)}">Open founder decision</button>`
        : "";
    return `<article class="detail-item ${escape(item.outcome)}">
    <div class="detail-head"><div><p class="eyebrow">${escape(item.ref)}</p><h3>${escape(item.state)}</h3></div>${badge(item.outcome)}</div>
    <dl class="detail-grid">
      <div><dt>Owner</dt><dd>${escape(item.owner)}</dd></div>
      <div><dt>Source</dt><dd>${escape(item.source ?? "control_plane")}</dd></div>
      <div><dt>Updated</dt><dd>${escape(item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "Unknown")}</dd></div>
      <div><dt>Next action</dt><dd>${escape(item.nextAction ?? "Inspect")}</dd></div>
    </dl>
    <h4>Blocker / current reason</h4><p>${escape(item.reason)}</p>
    <h4>Evidence</h4><p>${escape((item.evidenceRefs ?? []).join(", ") || "No evidence reference recorded")}</p>
    <label for="note-${escape(item.ref)}">Founder instruction or comment</label>
    <textarea id="note-${escape(item.ref)}" data-lane-note="${escape(item.ref)}" rows="3" placeholder="Add context, an instruction, or the evidence you expect."></textarea>
    <div class="actions detail-actions">
      ${controls.canComment ? `<button type="button" data-lane-act="add-instruction" data-lane="${escape(item.lane)}" data-ref="${escape(item.ref)}">Add instruction</button>` : ""}
      ${controls.canRequestEvidence ? `<button type="button" class="ghost" data-lane-act="request-evidence" data-lane="${escape(item.lane)}" data-ref="${escape(item.ref)}">Request evidence</button>` : ""}
      ${controls.canRetry ? `<button type="button" class="ghost" data-lane-act="retry" data-lane="${escape(item.lane)}" data-ref="${escape(item.ref)}">Retry permitted step</button>` : ""}
      ${controls.canAcknowledge ? `<button type="button" class="ghost" data-lane-act="acknowledge" data-lane="${escape(item.lane)}" data-ref="${escape(item.ref)}">Acknowledge</button>` : ""}
      ${controls.canResolve ? `<button type="button" class="ghost" data-lane-act="resolve" data-lane="${escape(item.lane)}" data-ref="${escape(item.ref)}">Resolve</button>` : ""}
      ${decision}
    </div>
    <details><summary>Audit history (${item.auditHistory?.length ?? 0})</summary>${auditList(item.auditHistory)}</details>
  </article>`;
}
function renderDetail(detail) {
    if (detail.kind === "lane") {
        return `<header class="drawer-title"><p class="eyebrow">Exception lane</p><h2>${escape(detail.title ?? detail.id)}</h2><p>${badge(detail.state ?? "UNKNOWN")} · ${escape(detail.owner ?? "Unassigned")}</p></header>
      ${detail.blockerReason ? `<aside class="callout"><strong>Primary blocker</strong><p>${escape(detail.blockerReason)}</p></aside>` : ""}
      <div class="detail-stack">${(detail.items ?? []).map(laneItemHtml).join("")}</div>`;
    }
    if (detail.kind === "decision") {
        return `<header class="drawer-title"><p class="eyebrow">Founder decision</p><h2>${escape(detail.title ?? detail.id)}</h2><p>${badge(detail.state ?? "UNKNOWN")}</p></header>
      <p>${escape(detail.request ?? "")}</p><p class="muted">${escape(detail.impact ?? "No provider action occurs from this packet in TEST.")}</p>
      <div class="actions"><button type="button" data-decide="${escape(detail.id)}" data-act="approve">Approve</button><button type="button" class="danger" data-decide="${escape(detail.id)}" data-act="reject">Reject</button><button type="button" class="ghost" data-decide="${escape(detail.id)}" data-act="request-evidence">Request evidence</button></div>
      <h3>Audit</h3>${auditList(detail.audit)}`;
    }
    return `<header class="drawer-title"><p class="eyebrow">${escape(detail.kind)}</p><h2>${escape(detail.title ?? detail.id)}</h2><p>${badge(detail.state ?? "UNKNOWN")}</p></header><dl class="detail-grid"><div><dt>Owner</dt><dd>${escape(detail.owner ?? "Unknown")}</dd></div><div><dt>Source</dt><dd>${escape(detail.source ?? "Unknown")}</dd></div><div><dt>Next action</dt><dd>${escape(detail.nextAction ?? "None")}</dd></div></dl><pre class="result">${escape(JSON.stringify(detail.evidence ?? detail, null, 2))}</pre>`;
}
async function openDetail(key) {
    const detail = await api(`/api/detail/${key}`);
    openDrawer(renderDetail(detail));
    bindDrawerControls();
}
function bindDrawerControls() {
    for (const button of Array.from(document.querySelectorAll("#drawer [data-lane-act]"))) {
        button.addEventListener("click", async () => {
            const ref = button.dataset.ref ?? "";
            const note = document.querySelector(`#drawer [data-lane-note="${CSS.escape(ref)}"]`)?.value ?? "";
            try {
                const result = await api(`/api/lanes/${button.dataset.lane}/${ref}/${button.dataset.laneAct}`, { method: "POST", body: JSON.stringify({ comment: note }) });
                document.querySelector("#result").textContent = result.reason;
                document.querySelector("#drawer").close();
                await refresh();
            }
            catch (error) {
                document.querySelector("#drawer-message")?.remove();
                const message = document.createElement("p");
                message.id = "drawer-message";
                message.className = "error";
                message.textContent = error instanceof Error ? error.message : String(error);
                document.querySelector("#drawer-body").prepend(message);
            }
        });
    }
    for (const button of Array.from(document.querySelectorAll("#drawer [data-open-decision]"))) {
        button.addEventListener("click", () => void openDetail(`decision/${button.dataset.openDecision}`));
    }
    bindDecisionButtons("#drawer [data-decide]");
}
function bindDecisionButtons(selector = "[data-decide]") {
    for (const button of Array.from(document.querySelectorAll(selector))) {
        button.addEventListener("click", async () => {
            const result = await api(`/api/inbox/${button.dataset.decide}/${button.dataset.act}`, { method: "POST", body: "{}" });
            document.querySelector("#result").textContent = result.ok ? `Decision recorded. Provider called: ${result.providerCalled}.` : result.reason ?? "Decision failed";
            document.querySelector("#drawer").close();
            await refresh();
        });
    }
}
function render(snap) {
    document.querySelector("#mode-badge").textContent = `MODE: ${snap.mode} · trusted registry`;
    const result = document.querySelector("#result");
    if (snap.lastDispatch)
        result.textContent = snap.lastDispatch.founderFriendlySummary;
    document.querySelector("#overview").innerHTML = snap.exceptionFirst
        .map((lane) => `
      <article class="lane ${lane.outcome}" data-detail="lane/${lane.id}" tabindex="0" role="button" aria-label="Open ${escape(lane.title)} lane">
        <div class="lane-top"><h3>${escape(lane.title)}</h3><span class="count">${lane.items.length}</span></div>
        <p>${badge(lane.outcome)} · ${escape(lane.owner)}</p>
        <p>${escape(lane.items[0]?.reason ?? "")}</p>
        <span class="open-hint">Open controls →</span>
      </article>`)
        .join("");
    document.querySelector("#actions").innerHTML = snap.actions
        .map((action) => `
      <article class="card" data-detail="action/${escape(action.id)}">
        <h3>${escape(action._pref?.icon ?? "◆")} ${escape(action.title)}</h3>
        <p>${escape(action.owner)} · ${escape(action.system)}</p>
        <p>${escape(action._pref?.description ?? action.success)}</p>
        <button type="button" data-action="${escape(action.id)}" data-confirm="${action._pref?.confirm ? "1" : "0"}">${escape(action.title)}</button>
      </article>`)
        .join("");
    document.querySelector("#inbox").innerHTML = snap.inbox
        .map((item) => `
      <article class="row" data-detail="decision/${item.id}">
        <h3>${escape(item.title)}</h3>
        <p>${badge(item.status)} · ${escape(item.kind)} · ${escape(item.subjectRef)}</p>
        <p>${escape(item.notes)}</p>
        <div class="actions">
          <button type="button" data-decide="${item.id}" data-act="approve">Approve</button>
          <button type="button" data-decide="${item.id}" data-act="reject">Reject</button>
          <button type="button" class="ghost" data-decide="${item.id}" data-act="request-evidence">Request evidence</button>
        </div>
      </article>`)
        .join("");
    document.querySelector("#jobs").innerHTML = (snap.jobs ?? [])
        .map((job) => `
      <article class="row lane ${job.status}" data-detail="job/${job.id}">
        <h3>${escape(job.title)}</h3>
        <p>${badge(job.status === "pending" || job.status === "requested" ? "pending" : job.status)} · ${escape(job.executor)} · ${escape(job.owner)}</p>
        <p>correlation ${escape(job.correlationId ?? "")}${job.parentId ? ` · parent ${escape(job.parentId)}` : ""}</p>
        <p>${escape(job.resultSummary)}</p>
      </article>`)
        .join("");
    document.querySelector("#activity").innerHTML = snap.activity
        .map((item) => `<article class="row" data-detail="activity/${item.id}"><h3>${escape(item.title)}</h3><p>${badge(item.status)} · ${escape(item.owner)}</p><p>${escape(item.summary)}</p></article>`)
        .join("");
    const connectors = (snap.evidence ?? []).map((item) => `<article class="card lane ${item.freshness}" data-detail="connector/${item.id}"><h3>${escape(item.source)}</h3><p>${badge(item.freshness === "VERIFIED" && !item.detail ? "UNKNOWN" : item.freshness)}</p><p>${escape(item.detail)}</p><p>${escape(item.setupRequirement)}</p></article>`);
    document.querySelector("#status").innerHTML = connectors.join("");
    const usage = snap.usage;
    document.querySelector("#usage").innerHTML = `<article class="row"><p>Jobs ${usage.jobs} · ${escape(usage.model)} · ${usage.runtimeMs}ms · retries ${usage.retries}</p><p>Unauthorized business writes: ${snap.unauthorizedBusinessWrites ?? 0}. Authorised governed dispatch: ${snap.authorisedGovernedDispatchCount ?? 0}. Write scope: ${escape(snap.writeScope ?? "none")}.</p><p>Cost: unknown (${usage.costStatus}), never $0.00.</p><p>${escape(usage.note)}</p></article>`;
    bind(snap);
}
function bind(snap) {
    for (const node of Array.from(document.querySelectorAll("[data-detail]"))) {
        node.addEventListener("click", (event) => {
            if (event.target.closest("button"))
                return;
            const key = node.dataset.detail ?? "";
            void openDetail(key);
        });
        node.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void openDetail(node.dataset.detail ?? "");
            }
        });
    }
    for (const button of Array.from(document.querySelectorAll("[data-action]"))) {
        button.addEventListener("click", async () => {
            if (button.dataset.confirm === "1" && !window.confirm(`Run ${button.textContent}? This stays TEST-gated.`))
                return;
            const result = await api(`/api/actions/${button.dataset.action}`, { method: "POST", body: "{}" });
            document.querySelector("#result").textContent = `${result.founderFriendlySummary}\n\nMode ${result.mode}. Writes ${result.externalWrites}.`;
            await refresh();
        });
    }
    bindDecisionButtons("#inbox [data-decide]");
    const prefsBody = document.querySelector("#prefs-body");
    prefsBody.innerHTML = (snap.preferences ?? [])
        .map((pref) => `
      <div class="pref-row" data-id="${escape(pref.id)}">
        <strong>${escape(pref.id)}</strong>
        <label><input type="checkbox" data-k="visible" ${pref.visible ? "checked" : ""} /> Visible</label>
        <label>Order <input data-k="order" type="number" value="${pref.order}" /></label>
        <label>Display <input data-k="displayName" value="${escape(pref.displayName)}" /></label>
        <label>Icon <input data-k="icon" value="${escape(pref.icon)}" /></label>
        <label>Description <input data-k="description" value="${escape(pref.description)}" /></label>
        <label><input type="checkbox" data-k="confirm" ${pref.confirm ? "checked" : ""} /> Confirm</label>
      </div>`)
        .join("");
}
async function refresh() {
    const snap = await api("/api/overview");
    render(snap);
}
async function boot() {
    const session = await api("/api/session");
    if (!session.authenticated) {
        show("login");
        return;
    }
    csrf = session.csrf ?? "";
    show("app");
    await refresh();
    window.setInterval(() => {
        if (csrf)
            void refresh();
    }, 45_000);
}
document.querySelector("#login-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = document.querySelector("#username").value;
    const password = document.querySelector("#password").value;
    void api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) })
        .then(async (result) => {
        csrf = result.csrf;
        show("app");
        await refresh();
    })
        .catch((error) => {
        document.querySelector("#login-error").textContent =
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
    const text = document.querySelector("#command-input").value;
    void api("/api/command", {
        method: "POST",
        body: JSON.stringify({ text }),
    })
        .then(async (result) => {
        document.querySelector("#result").textContent = `${result.founderFriendlySummary}\n\n${result.correlationId ?? ""} ${result.mode}`;
        await refresh();
    })
        .catch((error) => {
        document.querySelector("#result").textContent =
            error instanceof Error ? error.message : String(error);
    });
});
document.querySelector("#prepare-social")?.addEventListener("click", () => {
    const button = document.querySelector("#prepare-social");
    button.disabled = true;
    void api("/api/actions/generate_next_weeks_marketing", { method: "POST", body: "{}" })
        .then(async (result) => {
        document.querySelector("#result").textContent = `${result.founderFriendlySummary}\n\nCorrelation ${result.correlationId ?? "not created"}.`;
        await refresh();
    })
        .catch((error) => {
        document.querySelector("#result").textContent = error instanceof Error ? error.message : String(error);
    })
        .finally(() => { button.disabled = false; });
});
document.querySelector("#rehearsal-slack")?.addEventListener("click", () => {
    void api("/api/rehearsal/slack", { method: "POST", body: "{}" }).then(async (result) => {
        document.querySelector("#result").textContent = result.job?.resultSummary ?? "Slack rehearsal finished.";
        await refresh();
    });
});
document.querySelector("#rehearsal-cursor")?.addEventListener("click", () => {
    void api("/api/rehearsal/cursor", { method: "POST", body: "{}" }).then(async (result) => {
        document.querySelector("#result").textContent = result.job?.resultSummary ?? "Cursor rehearsal finished.";
        await refresh();
    });
});
document.querySelector("#refresh-evidence")?.addEventListener("click", () => {
    void api("/api/evidence/refresh", { method: "POST", body: "{}" }).then(async () => {
        await refresh();
    });
});
document.querySelector("#refresh-jobs")?.addEventListener("click", () => {
    void api("/api/jobs/refresh", { method: "POST", body: "{}" })
        .then(async (result) => {
        document.querySelector("#result").textContent =
            `Collected ${result.collected} worker result(s). Rejected ${result.rejected.length}. Unauthorized business writes: ${result.unauthorizedBusinessWrites}. Authorised governed dispatch: ${result.authorisedGovernedDispatchCount}.`;
        await refresh();
    })
        .catch((error) => {
        document.querySelector("#result").textContent =
            error instanceof Error ? error.message : String(error);
    });
});
document.querySelector("#customize")?.addEventListener("click", () => {
    document.querySelector("#prefs").showModal();
});
document.querySelector("#save-prefs")?.addEventListener("click", () => {
    const items = Array.from(document.querySelectorAll("#prefs-body .pref-row")).map((row) => {
        const val = (key) => row.querySelector(`[data-k="${key}"]`);
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
        document.querySelector("#prefs").close();
        await refresh();
    });
});
void boot().catch(() => show("login"));
if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js");
}

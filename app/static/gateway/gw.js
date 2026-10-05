"use strict";
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  let T = {currency: "USD", fx_per_usd: 1}, signedIn = false, models = [], history = [];
  const money = (usd, dp) => {
    if (usd == null || !isFinite(usd)) return "—";
    const v = usd * (T.fx_per_usd || 1), d = dp ?? (Math.abs(v) < 0.01 ? 5 : 2);
    return `${T.currency} ${v.toFixed(d)}`;
  };
  // minimal, escape-first markdown: fenced code, inline code, bold
  const md = (t) => esc(t).split(/```/).map((part, i) => i % 2
    ? `<pre><code>${part.replace(/^[a-zA-Z0-9_+-]*\n/, "")}</code></pre>`
    : part.replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")).join("");
  const perM = (usd) => usd == null ? "—" : `${T.currency} ${(usd * (T.fx_per_usd || 1)).toFixed(2)}`;
  async function api(path, opt = {}) {
    const r = await fetch(path, {headers: {"Content-Type": "application/json"}, credentials: "same-origin", ...opt});
    let b = null; try { b = await r.json(); } catch { b = null; }
    if (!r.ok) { const e = new Error((b && (b.detail || b.error)) || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return b;
  }

  // ---- theme (light/dark + white-label)
  const saved = localStorage.getItem("gw-theme"); if (saved) document.documentElement.dataset.theme = saved;
  $("#themeBtn").onclick = () => {
    const t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = t; localStorage.setItem("gw-theme", t); applyAccent();
  };
  function applyAccent() {
    const light = document.documentElement.dataset.theme === "light", s = document.documentElement.style;
    if (!T.accent) return;
    s.setProperty("--acc-fill", light ? (T.accent_light || T.accent) : T.accent);
    s.setProperty("--acc-fill-hover", `color-mix(in srgb, ${light ? (T.accent_light || T.accent) : T.accent} 85%, black)`);
    s.setProperty("--acc", light ? (T.accent_light || T.accent) : `color-mix(in srgb, ${T.accent} 70%, white)`);
    if (T.accent2) s.setProperty("--acc2", T.accent2);
  }
  async function loadTheme() {
    T = await api("/api/gw/theme");
    document.title = `${T.name}: one endpoint for every model`;
    $("#b-name").textContent = T.name; $("#fName").textContent = T.name; $("#b-mark").textContent = T.logo_text || T.name[0];
    $("#tagline").textContent = T.tagline;
    $("#ver").textContent = T.version; $("#fVer").textContent = `version ${T.version}`;
    $("#ep").textContent = T.endpoint ? `${T.endpoint}/chat/completions` : "Not configured";
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect rx='8' width='32' height='32' fill='${T.accent}'/><text x='16' y='21' font-size='13' font-family='sans-serif' font-weight='800' fill='white' text-anchor='middle'>${esc(T.logo_text || "")}</text></svg>`;
    $("#fav").href = "data:image/svg+xml," + encodeURIComponent(svg);
    $("meta[name=theme-color]").content = T.accent;
    applyAccent();
  }
  $("#copyEp").onclick = () => { navigator.clipboard?.writeText($("#ep").textContent); $("#copyEp").textContent = "Copied"; setTimeout(() => $("#copyEp").textContent = "Copy", 1500); };

  // ---- nav
  const menu = $("#menu"), nav = $("#nav");
  menu.onclick = () => { const o = nav.classList.toggle("open"); menu.setAttribute("aria-expanded", o); };
  const PROTECTED = new Set(["playground", "usage", "admin"]);
  let pendingTab = null;
  async function show() {
    let tab = (location.hash || "#catalogue").slice(1);
    if (!["catalogue", "playground", "usage", "admin"].includes(tab)) tab = "catalogue";
    nav.classList.remove("open"); menu.setAttribute("aria-expanded", "false");
    nav.querySelectorAll("a").forEach((a) => a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    document.querySelectorAll(".tab").forEach((s) => s.hidden = true);
    if (PROTECTED.has(tab) && !signedIn) { pendingTab = tab; $("#t-login").hidden = false; $("#pw").focus(); return; }
    $(`#t-${tab}`).hidden = false;
    if (tab === "usage") loadUsage();
    if (tab === "admin") loadAdmin();
    if (tab === "playground") $("#pgIn").focus({preventScroll: true});
  }
  window.addEventListener("hashchange", show);

  // ---- login
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault(); const b = $("#loginBtn"), err = $("#loginErr");
    b.disabled = true; b.textContent = "Signing in…"; err.hidden = true;
    try { await api("/api/gw/login", {method: "POST", body: JSON.stringify({password: $("#pw").value})}); signedIn = true; $("#pw").value = ""; show(); }
    catch (x) { err.textContent = x.status === 401 ? "That password is not right." : x.message; err.hidden = false; }
    finally { b.disabled = false; b.textContent = "Sign in"; }
  };
  $("#logout").onclick = async () => { await api("/api/gw/logout", {method: "POST"}); signedIn = false; location.hash = "#catalogue"; };

  // ---- catalogue
  async function loadCatalogue() {
    try {
      const c = await api("/api/gw/catalogue"); models = c.models;
      $("#priceSrc").textContent = `Prices per 1M tokens in ${T.currency}${T.currency !== "USD" ? ` (at ${T.fx_per_usd} per USD)` : ""}. Source: ${c.price_source}.`.replace("; USD per 1M tokens", "");
      $("#cards").innerHTML = models.map((m) => {
        const st = m.status === "available" ? "good" : "warn";
        const res = m.residency === "tenant" ? "Data stays in your tenant" : m.residency === "vendor" ? "Vendor API" : "Global processing";
        return `<article class="card"><div class="mtop"><div><div class="mname">${esc(m.id)}</div><div class="mut">${esc(m.provider)} · ${esc(m.family)}</div></div><span class="tag ${st}">${esc(m.status)}</span></div>
          <p class="mut" style="margin:0">${esc(m.summary)}</p>
          <div class="tags"><span class="tag ${m.kind === "router" ? "acc" : ""}">${m.kind === "router" ? "Router" : "Chat completions"}</span><span class="tag res">${esc(res)}</span></div>
          <div class="hint">${esc(m.region)}</div>
          <div class="prices"><div>Input<b>${m.kind === "router" && m.in == null ? "Your VM" : perM(m.in)}</b></div><div>Output<b>${m.kind === "router" ? (m.in == null ? "—" : "free") : perM(m.out)}</b></div></div></article>`;
      }).join("");
      const sel = $("#pgModel"), fb = $("#polFb"), chats = models.filter((m) => m.kind === "chat");
      sel.innerHTML = `<option value="auto">Auto-routed</option>` + chats.map((m) => `<option value="${esc(m.id)}">${esc(m.id)}</option>`).join("");
      fb.innerHTML = chats.map((m) => `<option value="${esc(m.id)}">${esc(m.id)}</option>`).join("");
      $("#kModels").innerHTML = `<label><input type="checkbox" value="*" id="kAll" checked>All models</label>` + chats.map((m) => `<label><input type="checkbox" value="${esc(m.id)}" class="km">${esc(m.id)}</label>`).join("");
      $("#kAll").onchange = () => document.querySelectorAll(".km").forEach((x) => { x.disabled = $("#kAll").checked; });
      document.querySelectorAll(".km").forEach((x) => x.disabled = true);
    } catch (e) { $("#cards").innerHTML = `<p class="err state" role="alert">Couldn't load the catalogue: ${esc(e.message)}. <button type="button" id="retryCat" class="ghost sm">Retry</button></p>`; $("#retryCat").onclick = loadCatalogue; }
  }

  // ---- playground
  const EX = ["Hi! How are you today?", "A train leaves at 9:40 and travels 210 km at 84 km/h. When does it arrive?", "Write a Python function that removes duplicates from a list but keeps the order.", "Explain the trade-offs of a 30-year fixed vs. adjustable-rate mortgage when rates are expected to fall."];
  $("#examples").innerHTML = EX.map((x, i) => `<button type="button" data-i="${i}">${esc(x.length > 40 ? x.slice(0, 38) + "…" : x)}</button>`).join("");
  $("#examples").onclick = (e) => { const b = e.target.closest("button"); if (b) { $("#pgIn").value = EX[b.dataset.i]; $("#pgIn").focus(); } };
  $("#pgTemp").oninput = () => $("#pgTempV").textContent = $("#pgTemp").value;
  $("#pgClear").onclick = () => { history = []; $("#log").innerHTML = ""; $("#log").append(Object.assign(document.createElement("p"), {className: "mut state", id: "pgEmpty", textContent: "Chat cleared. Ask anything."})); };
  $("#pgIn").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#pgForm").requestSubmit(); } });
  function bubble(cls, html) { $("#pgEmpty")?.remove(); const d = document.createElement("div"); d.className = `msg ${cls}`; d.innerHTML = html; $("#log").append(d); d.scrollIntoView({block: "end", behavior: "smooth"}); return d; }
  $("#pgForm").onsubmit = async (e) => {
    e.preventDefault(); const text = $("#pgIn").value.trim(); if (!text) return;
    const send = $("#pgSend"); send.disabled = true; send.textContent = "Sending…";
    bubble("u", esc(text)); $("#pgIn").value = "";
    history.push({role: "user", content: text});
    const wait = bubble("a", `<span class="mut">Routing and generating…</span>`);
    const sys = $("#pgSys").value.trim(), msgs = (sys ? [{role: "system", content: sys}] : []).concat(history);
    try {
      const r = await api("/api/gw/chat", {method: "POST", body: JSON.stringify({model: $("#pgModel").value, temperature: +$("#pgTemp").value, messages: msgs})});
      const m = r.meta || {};
      if (r.error) { wait.className = "msg e"; wait.innerHTML = `${esc(r.error)}<div class="meta"><span class="tag">HTTP ${r.status}</span>${m.model ? `<span class="tag">${esc(m.model)}</span>` : ""}</div>`; history.pop(); return; }
      history.push({role: "assistant", content: r.text});
      wait.innerHTML = `${md(r.text || "(empty reply)")}<div class="meta"><span class="tag acc">→ ${esc(m.model)}</span>${m.confidence ? `<span class="tag">confidence ${(+m.confidence).toFixed(2)}</span>` : ""}<span class="tag">${r.prompt_tokens} in / ${r.completion_tokens} out tokens</span><span class="tag">${(r.latency_ms / 1000).toFixed(2)} s</span><span class="tag good">${money(r.usd)}</span></div><div class="why">Route: ${esc(m.reason || "—")}${m.classifier && m.classifier !== "none" ? ` · classifier: ${esc(m.classifier)}` : ""}</div>`;
    } catch (x) { wait.className = "msg e"; wait.textContent = x.status === 401 ? "Your session ended. Sign in again." : `Couldn't reach the gateway: ${x.message}`; history.pop(); if (x.status === 401) { signedIn = false; show(); } }
    finally { send.disabled = false; send.textContent = "Send"; }
  };

  // ---- usage
  async function loadUsage() {
    const tb = $("#keysTbl tbody"); tb.innerHTML = `<tr><td colspan="6" class="mut">Loading…</td></tr>`;
    try {
      const u = await api("/api/gw/usage");
      $("#useSrc").textContent = u.source.startsWith("appinsights") ? "Metered by the gateway; durable copy in Application Insights (1–3 min lag)." : "Metered by the gateway (this instance).";
      const credits = u.keys.reduce((a, k) => a + k.credits_usd, 0), ok = u.recent.filter((r) => +r.status < 400).length;
      $("#kpis").innerHTML = [["Spend (30 days)", money(u.total_usd, 4)], ["Prepaid credits", money(credits)], ["Calls", u.calls], ["Models used", Object.keys(u.by_model).filter((k) => k && k !== "(rejected)").length]]
        .map(([a, b]) => `<div class="kpi"><span>${a}</span><b>${b}</b></div>`).join("");
      $("#keysTbl").classList.add("stack");
      tb.innerHTML = u.keys.length ? u.keys.map((k) => { const pct = k.credits_usd ? Math.min(100, 100 * k.usd / k.credits_usd) : 0;
        return `<tr><td data-l="Key"><b>${esc(k.name)}</b><div class="hint">${esc(k.id)}</div></td><td data-l="Calls" class="n">${k.calls}</td><td data-l="Tokens" class="n">${k.tin} / ${k.tout}</td><td data-l="Spend" class="n">${money(k.usd, 4)}</td><td data-l="Credits" class="n">${money(k.credits_usd)}</td><td data-l="Balance" class="n">${money(k.balance_usd)}<div class="bar" aria-hidden="true"><i style="width:${pct.toFixed(1)}%"></i></div></td></tr>`; }).join("")
        : `<tr><td colspan="6" class="mut">No keys yet. Create one in Admin.</td></tr>`;
      $("#recentTbl").classList.add("stack");
      $("#recentTbl tbody").innerHTML = u.recent.length ? u.recent.map((r) => `<tr><td data-l="Time">${esc(String(r.t).slice(11, 19))}</td><td data-l="Key">${esc(r.sub)}</td><td data-l="Asked">${esc(r.requested || "—")}</td><td data-l="Routed to">${esc(r.model || r.reason)}</td><td data-l="Status" class="n"><span class="tag ${+r.status < 400 ? "good" : "warn"}">${r.status}</span></td><td data-l="Cost" class="n">${money(+r.usd, 5)}</td></tr>`).join("")
        : `<tr><td colspan="6" class="mut">No calls yet. Send one from the Playground.</td></tr>`;
    } catch (e) { tb.innerHTML = `<tr><td colspan="6" class="err" role="alert">Couldn't load usage: ${esc(e.message)}</td></tr>`; if (e.status === 401) { signedIn = false; show(); } }
  }

  // ---- admin
  let CFG = null;
  async function loadAdmin() {
    try {
      const a = await api("/api/gw/admin"); CFG = a.config; const p = CFG.policy;
      $("#polCls").value = p.classifier; $("#polCheap").value = p.cheapest_p; $("#polConf").value = p.min_confidence;
      $("#polFb").value = p.fallback; $("#polBudget").value = p.budget_guard_pct; syncOut();
      $("#selfhostSt").textContent = `Self-hosted classifier: ${a.selfhost}. If it is offline, auto-routing falls back to ${p.fallback}.`;
      const rows = Object.entries(CFG.keys);
      $("#admKeys").classList.add("stack");
      $("#admKeys tbody").innerHTML = (rows.length ? rows : []).map(([id, k]) => `<tr><td data-l="Name"><b>${esc(k.name)}</b></td><td data-l="ID"><code>${esc(id)}</code></td><td data-l="Models">${k.models === "*" ? "All" : k.models.map(esc).join(", ")}</td><td data-l="Req/min" class="n">${k.cpm}</td><td data-l="Credits" class="n">${money(k.credits_usd)}</td><td data-l="Actions">${id === "playground" ? "" : `<button type="button" class="ghost sm" data-del="${esc(id)}">Revoke</button>`}</td></tr>`).join("")
        || `<tr><td colspan="6" class="mut">No keys yet.</td></tr>`;
    } catch (e) { $("#admKeys tbody").innerHTML = `<tr><td colspan="6" class="err" role="alert">Couldn't load admin: ${esc(e.message)}</td></tr>`; if (e.status === 401) { signedIn = false; show(); } }
  }
  const syncOut = () => { $("#polCheapV").textContent = (+$("#polCheap").value).toFixed(2); $("#polConfV").textContent = (+$("#polConf").value).toFixed(2); };
  $("#polCheap").oninput = syncOut; $("#polConf").oninput = syncOut;
  $("#polForm").onsubmit = async (e) => {
    e.preventDefault(); const msg = $("#polMsg"), b = e.submitter; b.disabled = true; b.textContent = "Saving…";
    try { await api("/api/gw/policy", {method: "PUT", body: JSON.stringify({classifier: $("#polCls").value, cheapest_p: +$("#polCheap").value, min_confidence: +$("#polConf").value, fallback: $("#polFb").value, budget_guard_pct: +$("#polBudget").value})});
      msg.className = "ok"; msg.textContent = "Saved. The gateway uses it within 20 seconds."; }
    catch (x) { msg.className = "err"; msg.textContent = `Not saved: ${x.message}`; }
    finally { msg.hidden = false; b.disabled = false; b.textContent = "Save policy"; }
  };
  $("#keyForm").onsubmit = async (e) => {
    e.preventDefault(); const err = $("#keyErr"), b = $("#keyBtn"); err.hidden = true;
    const all = $("#kAll").checked, sel = [...document.querySelectorAll(".km:checked")].map((x) => x.value);
    if (!all && !sel.length) { err.textContent = "Pick at least one model, or allow all."; err.hidden = false; return; }
    b.disabled = true; b.textContent = "Creating…";
    try {
      const r = await api("/api/gw/keys", {method: "POST", body: JSON.stringify({name: $("#kName").value, models: all ? "*" : sel, cpm: +$("#kCpm").value, credits_usd: +$("#kCred").value})});
      $("#newKeyV").textContent = r.key; $("#newKey").hidden = false;
      $("#curl").textContent = `curl ${T.endpoint}/chat/completions \\\n  -H "api-key: ${r.key}" -H "Content-Type: application/json" \\\n  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'`;
      $("#kName").value = ""; loadAdmin();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
    finally { b.disabled = false; b.textContent = "Create key"; }
  };
  $("#copyKey").onclick = () => { navigator.clipboard?.writeText($("#newKeyV").textContent); $("#copyKey").textContent = "Copied"; };
  $("#admKeys").onclick = async (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    if (!confirm(`Revoke key ${b.dataset.del}? Apps using it stop working.`)) return;
    b.disabled = true; b.textContent = "Revoking…";
    try { await api(`/api/gw/keys/${encodeURIComponent(b.dataset.del)}`, {method: "DELETE"}); loadAdmin(); } catch (x) { b.disabled = false; b.textContent = "Revoke"; alert(x.message); }
  };

  (async () => {
    try { await loadTheme(); } catch { /* defaults stay */ }
    try { signedIn = (await api("/api/gw/session")).signed_in; } catch { signedIn = false; }
    await loadCatalogue(); show();
  })();
})();

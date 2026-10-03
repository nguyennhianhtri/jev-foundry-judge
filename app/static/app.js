// Jev Foundry Judge — client. Dataset + results live only in this tab.
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const M = { intent_resolution: "Intent Resolution", task_adherence: "Task Adherence", tool_call_accuracy: "Tool Call Accuracy", groundedness: "Groundedness" };
const SHORT = { intent_resolution: "IR", task_adherence: "TA", tool_call_accuracy: "TC", groundedness: "GR" };

const S = { pv: null, key: null, cfg: null, samples: [], rows: [], results: [], runRows: [], summary: null, selected: new Set(), queue: null, covAll: new Set(), view: "all", metric: "all", order: "run", editedSinceRun: new Set(), lpBase: new Map(), lastSave: null, undoMsg: "", chk: null, ocv: null, ho: null, hi: null, imp: null };

// ---------- helpers
function userText(q) {
  if (typeof q === "string") return q;
  const u = (q || []).filter(m => m.role === "user");
  const c = u.length ? u[u.length - 1].content : "";
  return typeof c === "string" ? c : JSON.stringify(c);
}
function finalText(r) {
  if (typeof r === "string") return r;
  for (const m of [...(r || [])].reverse()) {
    if (m.role !== "assistant") continue;
    if (typeof m.content === "string") return m.content;
    const t = (m.content || []).filter(c => c.type === "text").map(c => c.text).join(" ");
    if (t) return t;
  }
  return "";
}
function toolNames(r) {
  const n = [];
  for (const m of (Array.isArray(r) ? r : [])) for (const c of (Array.isArray(m.content) ? m.content : [])) if (c.type === "tool_call") n.push(c.name);
  return n;
}
function pill(v) {
  if (typeof v !== "number" || !isFinite(v)) return `<span class="pill p-na">—</span>`;
  const n = v, th = S.summary?.threshold ?? 3, cls = n >= Math.max(4, th) ? "p-good" : n >= th ? "p-mid" : "p-bad";
  // never let display rounding cross the run's pass threshold (e.g. 2.98 must not read "3.0")
  let dp = n % 1 ? 1 : 0;
  while (dp < 4 && ((+n.toFixed(dp) >= th) !== (n >= th))) dp++;
  return `<span class="pill ${cls}">${n.toFixed(dp)}</span>`;
}
const fmt$ = v => v == null ? "—" : v < 0.01 ? "$" + v.toFixed(5) : "$" + v.toFixed(3);
const fmtMs = v => v == null ? "—" : v >= 1000 ? (v / 1000).toFixed(2) + " s" : Math.round(v) + " ms";
const pct = v => v == null ? "—" : Math.round(v * 100) + "%";
function log(s) { const l = $("#log"); l.textContent += s + "\n"; l.scrollTop = l.scrollHeight; }
function download(name, text, type = "application/json") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function api(path, opts = {}) {
  const h = { "Content-Type": "application/json" };
  if (opts.key) h["X-Jev-Key"] = S.key;
  const r = await fetch(path, { method: opts.body ? "POST" : (opts.method || "GET"), headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.error || r.statusText);
  return j;
}

// ---------- nav
function go(step) {
  $$(".steps button").forEach(b => { const on = b.dataset.step === step; b.classList.toggle("on", on); if (on) { b.setAttribute("aria-current", "step"); b.scrollIntoView?.({ block: "nearest", inline: "nearest" }); } else b.removeAttribute("aria-current"); });
  $$(".panel").forEach(p => p.classList.toggle("on", p.id === "s-" + step));
  if (step === "run") renderRun();
  // t_d0deefc7: an open Prepare preview must never show stale counts after a Dataset edit. Returning to its step
  // re-derives it through the SAME prepareRerun projection (prepSig check in each renderer); 0 calls, no selection change.
  if (step === "dash" && (S.rfp || S.disPrep || S.failPrep || S.slowPrep)) renderRows();
  if (step === "export" && S.pv?.rc?.prep) renderRunCompare();
  if (step === "export") { renderSnippet(); renderBrief(); renderEvalExport(); renderPkgExport(); }
  // tall (non-sticky) header: land on the step content, not the header (t_2420fece)
  const top = document.querySelector(".top.tall"), pan = document.getElementById("s-" + step);
  if (top && pan && step !== "key") { pan.scrollIntoView({ block: "start" }); const h = pan.querySelector("h2"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } } else window.scrollTo(0, 0);
}
$$(".steps button").forEach(b => b.onclick = () => go(b.dataset.step));
// t_2420fece: a sticky header must never cover much of the screen (enlarged text / narrow phones).
(() => { const top = document.querySelector(".top"); if (!top) return;
  let lastW = "";
  const fit = () => { const h = top.offsetHeight, was = top.classList.contains("tall");
    // t_8cf9e0ff: hysteresis — go non-sticky above 15% of the screen (a wrapped phone header was 20% and
    // covered Dashboard evidence), back to sticky only below 12%. Sticky height feeds scroll-padding so
    // scrollIntoView / focus never lands under the header.
    if (!was && h > innerHeight * 0.15) top.classList.add("tall"); else if (was) { top.classList.remove("tall"); if (top.offsetHeight > innerHeight * 0.12) top.classList.add("tall"); }
    document.documentElement.style.setProperty("--toph", top.classList.contains("tall") ? "0px" : top.offsetHeight + "px");
    // keep the active step visible in the step row when its width changes (resize or enlarged text), horizontal only
    const st = top.querySelector(".steps"), on = st && st.querySelector("button.on"), key = st ? innerWidth + ":" + st.scrollWidth : "";
    if (key !== lastW) { lastW = key; if (on && st.scrollWidth > st.clientWidth) st.scrollLeft = on.offsetLeft - st.offsetLeft - 8; } };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.body); addEventListener("resize", fit); fit(); })();
$("#theme").onclick = () => { const h = document.documentElement; h.dataset.theme = h.dataset.theme === "dark" ? "light" : "dark"; const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = h.dataset.theme === "dark" ? "#0d1117" : "#f5f7fb"; };

// ---------- key
$("#verify").onclick = async () => {
  const k = $("#key").value.replace(/[\s\u200b-\u200f\u2028\u2029\u202f\u2060\ufeff]+/g, "").replace(/^["'`]+|["'`]+$/g, "").replace(/^bearer/i, ""); const st = $("#keystatus");
  if (!k) { st.innerHTML = `<span class="err">Paste a key first.</span>`; return; }
  S.key = k; st.textContent = "Checking with Jev…";
  try {
    const r = await api("/api/verify-key", { key: true, body: {} });
    st.innerHTML = `<span class="ok">Connected · ${esc(r.model)} · ${fmtMs(r.latency_ms)} round trip.</span> Key held in this tab only.`;
    $("#key").value = ""; $("#key").placeholder = "key connected (held in memory)";
    $('[data-step="key"]').classList.add("done"); renderDataNext();
    setTimeout(() => go("data"), 600);
  } catch (e) { S.key = null; const hint = /rejected the key \((401|403)\)/.test(e.message) ? ` Jev says this key is invalid. Check it is the full key from typesafe.ai (starts with apik…, about 108 characters); you pasted ${k.length}.` : ""; st.innerHTML = `<span class="err">${esc(e.message)}${esc(hint)}</span>`; renderDataNext(); }
};
$("#key").addEventListener("keydown", e => { if (e.key === "Enter") $("#verify").click(); });

// ---------- dataset
function renderData() {
  const tb = $("#dtable tbody");
  tb.innerHTML = S.rows.map((r, i) => `<tr class="${S.selected.has(i) ? "sel" : ""}" data-i="${i}">
    <td><input type="checkbox" class="rs" aria-label="Select case ${esc(r.id)}" ${S.selected.has(i) ? "checked" : ""}></td>
    <td><b>${esc(r.id)}</b>${r.generated ? ` <span class="tag">generated</span>` : ""}${r.source === "user-authored" ? ` <span class="tag">user-authored</span>` : ""}${r.derived_from?.id != null ? ` <span class="tag var">variant of ${esc(r.derived_from.id)}</span>` : ""}<div class="hint">${esc(r.note || "")}</div></td>
    <td><span class="tag">${esc(r.scenario || "custom")}</span></td>
    <td class="txt"><div>${esc(userText(r.query))}</div></td>
    <td class="txt"><div>${esc(finalText(r.response))}</div></td>
    <td>${toolNames(r.response).map(n => `<code>${esc(n)}</code>`).join(" ") || '<span class="hint">none</span>'}</td>
    ${Object.keys(M).map(m => `<td><input class="lab" data-m="${m}" type="number" min="1" max="5" step="1" value="${r["human_" + m] ?? ""}" placeholder="–"></td>`).join("")}
    <td><button class="ghost flabel" title="Review this case: see the trace and enter all applicable labels together" aria-label="Review labels for case ${esc(r.id)}">Labels</button> <button class="ghost fedit" title="Edit in form" aria-label="Edit case ${esc(r.id)} in form">Edit</button> <button class="ghost fvar" title="Create an edited copy (contrast case); this row is not changed" aria-label="Create variant of ${esc(r.id)}">Variant</button> <button class="ghost edit" title="Edit JSON">✎</button> <button class="ghost del" title="Delete">✕</button></td></tr>`).join("");
  $("#dempty").hidden = S.rows.length > 0;
  $("#count").textContent = `${S.rows.length} rows · ${S.rows.filter(r => Object.keys(M).some(m => labelState(r["human_" + m]) === "ok")).length} labelled`;
  renderDataNext(); renderSamplePreview(); renderImport();
  renderCoverage();
  applyFind();
  if (S.rows.length) $('[data-step="data"]').classList.add("done");
}
// ---------- case search: VIEW-ONLY. Hides <tr>s; never touches S.rows, order, selection, labels, runRows or exports.
function applyFind() {
  const inp = $("#dfind"); if (!inp) return;
  const bar = $("#dfindbar"); bar.hidden = !S.rows.length;
  const f = findCases(S.rows.map(r => ({ id: r?.id, req: userText(r?.query), ans: finalText(r?.response) })), inp.value);
  const on = new Set(f.shown);
  $$("#dtable tbody tr").forEach(tr => { tr.hidden = !on.has(+tr.dataset.i); });
  $("#dfindClear").hidden = !f.active; $("#dfindNote").hidden = !f.active;
  const st = $("#dfindStatus");
  st.textContent = !f.active ? "" : f.shown.length ? `Showing ${f.shown.length} of ${f.total} cases` : `No case matches “${inp.value.trim()}” (0 of ${f.total}). Nothing was changed.`;
  st.classList.toggle("warn", f.active && !f.shown.length);
  $("#dempty").hidden = S.rows.length > 0;
  S.findShown = f.active ? f.shown : null; renderSel();
}
// ---------- selected-cases export (t_39302f7d): counts selected vs shown vs total; exports only ticked rows,
// with the same serializers as the whole-dataset export. Never changes selection, rows, run scope or exports.
function selState() { return buildSelectedExport({ rows: S.rows, selected: S.selected, shown: S.findShown ?? null, key: S.key }); }
function renderSel() {
  const bar = $("#selbar"); if (!bar) return;
  bar.hidden = !S.rows.length; if (!S.rows.length) return;
  const e = selState(), pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const scope = e.search ? `${e.shown} shown by search · ${e.total} in dataset` : `${pl(e.total, "case")} in dataset`;
  $("#selStatus").innerHTML = e.n
    ? `<b>${e.n} selected</b> · ${scope}${e.hidden_selected ? `<span class="selwarn">⚠ ${e.hidden_selected} selected case${e.hidden_selected === 1 ? " is" : "s are"} hidden by the search and will be included. Clear the search to see ${e.hidden_selected === 1 ? "it" : "them"}.</span>` : ""}`
    : `No cases selected · ${scope}. Tick cases to export a subset.`;
  const vis = e.search ? S.findShown : S.rows.map((_, i) => i), on = vis.filter(i => S.selected.has(i)).length, sa = $("#selall");
  sa.checked = !!vis.length && on === vis.length; sa.indeterminate = on > 0 && on < vis.length;
  for (const b of [$("#exSelJ"), $("#exSelC")]) b.disabled = !e.n;
  $("#selClear").hidden = !e.n;
  if (S.cfg) renderRun();        // Run step "Selected cases only" reads the same selection
}
function exportSelected(csv) {
  const e = selState();
  if (!e.ok) { $("#selStatus").innerHTML = `<span class="err" role="alert">${e.reason === "key_in_rows" ? "A selected case contains your API key text, so nothing was downloaded." : "No cases selected, so nothing was downloaded."}</span>`; return; }
  const name = `dataset-selected-${e.n}-of-${e.total}-${stamp()}`;
  if (csv) download(name + ".csv", toCSV(e.rows.map(r => Object.fromEntries(Object.entries(r)))), "text/csv");
  else download(name + ".jsonl", e.text, "application/x-ndjson");
  $("#selStatus").innerHTML = `<span class="ok">Downloaded ${e.n} selected case${e.n === 1 ? "" : "s"} (${csv ? "CSV" : "JSONL"}).</span> ${e.search ? `${e.shown} shown · ` : ""}${e.total} in dataset. Selection kept.`;
}
$("#exSelJ").onclick = () => exportSelected(false);
$("#exSelC").onclick = () => exportSelected(true);
$("#selClear").onclick = () => { S.selected.clear(); renderData(); $("#selall").focus(); };
function revealRow(i) {           // a jump to a row the search hides clears the search first, so the target is visible
  const tr = $(`#dtable tbody tr[data-i="${i}"]`);
  if (tr && tr.hidden) { $("#dfind").value = ""; applyFind(); }
  return tr;
}
$("#dfind").addEventListener("input", applyFind);
$("#dfind").addEventListener("keydown", e => {
  if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.target.value = ""; applyFind(); }
  if (e.key === "Enter") { e.preventDefault(); const tr = $$("#dtable tbody tr").find(t => !t.hidden); const b = tr && $(".flabel", tr); if (b) { tr.scrollIntoView({ block: "center" }); b.focus(); } }
});
$("#dfindClear").onclick = () => { $("#dfind").value = ""; applyFind(); $("#dfind").focus(); };
// ---------- per-metric label coverage (draft = S.rows now; frozen = S.runRows at last run start). Counts only; no scores.
function covCell(x, m) {
  const ids = [...x.invalid.map(r => ({ ...r, bad: true })), ...x.missing], MAX = 8, all = S.covAll.has(m);
  const link = r => `<button class="linkish covgo${r.bad ? " bad" : ""}" data-idx="${r.idx}" data-m="${esc(r.m)}" title="${r.bad ? `invalid label ${esc(JSON.stringify(r.value))} (must be a whole number 1–5)` : "no label"}: go to this row">${esc(r.id ?? "(no id) row " + (r.idx + 1))}${r.bad ? " ⚠" : ""}</button>`;
  if (!ids.length) return `<span class="hint">none</span>`;
  const shown = all ? ids : ids.slice(0, MAX);
  return shown.map(link).join(" ") + (ids.length > MAX ? ` <button class="linkish covmore" data-m="${m}">${all ? "show fewer" : `+${ids.length - MAX} more — show all`}</button>` : "")
    + ` <div><button class="ghost qstart" data-m="${m}" title="Step through every ${esc(M[m])} row that needs a label, one at a time">Review ${ids.length} missing label${ids.length > 1 ? "s" : ""} →</button></div>`;
}
// ---------- label queue: a POINTER into S.rows (metric + current row object), never a copy. Recomputed from the
// current draft on every render/Next via labelQueue (same projection as the coverage table). Advances only on Next.
function qIdLabel(e) { return e.id ?? "(no id) row " + (e.idx + 1); }
function gotoLabel(i, m) {
  const r = S.rows[i]; if (!r) return false;
  const tr = revealRow(i); if (!tr) return false;
  tr.scrollIntoView({ block: "center" }); tr.classList.remove("flash"); void tr.offsetWidth; tr.classList.add("flash");
  if (labelState(r["human_" + m]) === "invalid") { editRow(i, `the ${M[m]} label ${JSON.stringify(r["human_" + m])} is not a whole number 1–5; fix or remove human_${m}.`); return true; }
  const inp = $(`input.lab[data-m="${m}"]`, tr); if (inp) inp.focus();
  return true;
}
function qAt(q) {
  let at = q.row ? S.rows.indexOf(q.row) : -1;
  if (at < 0 && q.id != null) { const hits = S.rows.map((r, i) => String(r?.id) === q.id ? i : -1).filter(i => i >= 0); if (hits.length === 1) { at = hits[0]; q.row = S.rows[at]; } }
  return at;
}
function qMove(m, from) {       // explicit start / Next: recompute against the CURRENT draft, then navigate
  const e = nextInQueue(S.rows, m, from);
  S.queue = { m, row: e ? S.rows[e.idx] : null, id: e ? e.id : null, idx: e ? e.idx : -1, done: !e };
  renderQueue(); if (e) gotoLabel(e.idx, m);
}
function renderQueue() {
  const el = $("#labelq"); if (!el) return;
  const q = S.queue; if (!q || !S.rows.length) { el.hidden = true; el.innerHTML = ""; if (!S.rows.length) S.queue = null; return; }
  el.hidden = false;
  const list = labelQueue(S.rows, q.m), ap = buildCoverage(S.rows).metrics[q.m].applicable;
  const head = `<b>Labelling ${esc(M[q.m])}</b> <span class="hint">· ${list.length} of ${ap} applicable row${ap === 1 ? "" : "s"} still need a label</span>`;
  const btns = (next) => `<button class="primary qnext"${next ? "" : " disabled"}>Next needing a label →</button> <button class="ghost qstop">Stop</button>`;
  if (!list.length) { el.innerHTML = `${head}<div class="ok">Every applicable row has a valid ${esc(M[q.m])} label. Nothing left to review.</div> ${btns(false)}`; return; }
  const at = qAt(q);
  let cur;
  if (!q.row && q.id == null) cur = `${list.length} row${list.length > 1 ? "s" : ""} need a label again. Press Next to go to the first one.`;
  else if (at < 0) cur = `<span class="err">Case <code>${esc(q.id ?? "?")}</code> was removed, renamed or the dataset was replaced; it is no longer in the draft.</span> Press Next to continue from here with the current draft.`;
  else {
    const r = S.rows[at], st = labelState(r["human_" + q.m]), pos = list.findIndex(e => e.idx === at);
    cur = `Current case <code>${esc(qIdLabel({ id: r.id == null ? null : String(r.id), idx: at }))}</code> — `
      + (st === "ok" ? `<span class="ok">labelled ${r["human_" + q.m]}</span>. Press Next for the next one.`
        : st === "invalid" ? `<span class="err">invalid label ${esc(JSON.stringify(r["human_" + q.m]))}</span> (must be a whole number 1–5): fix it in the JSON editor.`
        : !applicable(r, q.m) ? `<span class="hint">${esc(M[q.m])} no longer applies to this row (the judge will not score it), so it left the queue.</span> Press Next.`
        : `needs a label (1–5) in the ${esc(SHORT[q.m])} box of that row.`)
      + (pos >= 0 ? ` <span class="hint">(${pos + 1} of ${list.length} remaining)</span>` : "")
      + ` <button class="linkish qgo">go to row</button>`;
  }
  el.innerHTML = `${head}<div>${cur}</div>${btns(true)} <span class="hint">Only your typed labels are saved; nothing is guessed, copied or sent.</span>`;
}
$("#labelq").addEventListener("click", e => {
  const q = S.queue; if (!q) return;
  if (e.target.closest(".qstop")) { S.queue = null; renderQueue(); return; }
  if (e.target.closest(".qnext")) { const at = qAt(q); qMove(q.m, at >= 0 ? at : q.idx - 1); return; }  // stale: resume at the old position in the current draft
  if (e.target.closest(".qgo")) { const at = qAt(q); if (at >= 0) gotoLabel(at, q.m); else renderQueue(); }
});
// label-pass session strip: cases whose labels differ from their state before this session's first label-pass save
// (no-op saves / undone saves count 0) vs cases still needing an applicable label, plus Undo of exactly the last save.
function progressHTML() {
  const p = sessionProgress(S.rows, S.lpBase), ls = S.lastSave;
  const who = ls ? esc(ls.row.id ?? "(no id)") : "";
  return `<div class="lpprog" role="status" aria-live="polite"><span class="nw"><b class="lpchanged">${p.changed}</b> case${p.changed === 1 ? "" : "s"} relabelled this session</span> · <span class="nw"><b class="lpneed">${p.needing}</b> of ${p.total} still need${p.needing === 1 ? "s" : ""} an applicable label</span>${ls ? ` <button type="button" class="ghost lpundo" title="Put back exactly the labels case ${who} had before your last save; refused if that case changed since">Undo last save: case <code>${who}</code></button>` : ""}${S.undoMsg ? ` <span class="hint lpundomsg">${esc(S.undoMsg)}</span>` : ""}</div>${changesHTML()}`;
}
// Session label changes: small preview + explicit local download (.json). Same baseline as the strip.
function lblTxt(x) { return x.present ? esc(JSON.stringify(x.value)) : "blank"; }
function changesHTML() {
  const cs = sessionChanges(S.rows, S.lpBase);
  if (!cs.length) return ` <span class="hint lpnochg">No label changes to download this session.</span>`;
  const idTxt = v => v == null ? "(no id)" : typeof v === "string" ? v : JSON.stringify(v);
  const MAX = 5, items = cs.slice(0, MAX).map(c => `<li>case <code>${esc(idTxt(c.id))}</code> <span class="hint">row ${c.row_index + 1}</span>: ${c.changes.map(x => `<span class="nw">${esc(M[x.metric] || x.metric)} ${lblTxt(x.before)} → ${lblTxt(x.after)}</span>`).join(", ")}</li>`).join("");
  return `<details class="lpchg"><summary>Preview label changes (${cs.length} case${cs.length === 1 ? "" : "s"})</summary><ul>${items}</ul>${cs.length > MAX ? `<p class="hint">…and ${cs.length - MAX} more in the download.</p>` : ""}<p class="hint">This browser session only; not saved anywhere else. Saved labels only (anything typed but not saved is not included). No traces, keys or scores.</p><button type="button" class="ghost lpdl">Download label changes (.json)</button></details>`;
}
function downloadChanges() {
  const pk = changesPacket(S.rows, S.lpBase, { version: S.cfg?.version ?? null, at: new Date().toISOString() });
  if (!pk.cases_changed) return false;
  download(`label-changes-${stamp()}.json`, JSON.stringify(pk, null, 2)); return true;
}
// Undo the most recent label-pass save (one level). Returns the restored row index, or -1 (refused / nothing).
function undoLastSave() {
  const rec = S.lastSave; if (!rec) return -1;
  const id = rec.row.id ?? "(no id)", r = undoSave(S.rows, rec);
  S.lastSave = null;
  for (const k of S.lpBase.keys()) if (!S.rows.includes(k)) S.lpBase.delete(k);   // prune deleted/replaced rows
  if (!r.ok) { S.undoMsg = `Undo refused for case ${id}: ${r.reason}. Nothing was changed.`; renderCoverage(); return -1; }
  S.undoMsg = `Undid the last save: case ${id} has its previous labels again.`;
  noteEdited(null, rec.row.id); renderData(); return r.idx;
}
function renderCoverage() {
  const el = $("#coverage"); if (!el) return;
  if (!S.rows.length && !S.runRows.length) { el.hidden = true; el.innerHTML = ""; renderQueue(); renderChecklist(); renderOutcomeView(); renderHandoff(); renderHandoffInspect(); return; }
  el.hidden = false;
  const d = buildCoverage(S.rows), f = S.runRows.length ? buildCoverage(S.runRows) : null;
  const prov = x => { const p = x.by_provenance, parts = [["user-authored", "authored"], ["generated", "generated"], ["not recorded", "provenance not recorded"]].filter(([k]) => p[k]).map(([k, t]) => `${p[k]} ${t}`); return parts.length ? `<div class="hint">${parts.join(" · ")}</div>` : ""; };
  const rows = Object.keys(M).map(m => {
    const x = d.metrics[m]; x.missing.forEach(r => r.m = m); x.invalid.forEach(r => r.m = m);
    const fz = f ? f.metrics[m] : null;
    const na = x.not_applicable ? `${x.not_applicable}${m === "tool_call_accuracy" ? ' <span class="hint">no tool call or tool list</span>' : m === "groundedness" ? ' <span class="hint">no context or tool result</span>' : ""}${x.label_on_not_applicable.length ? ` <span class="hint">(${x.label_on_not_applicable.length} labelled but not scored)</span>` : ""}` : "0";
    return `<tr><td>${M[m]}</td><td><b class="${x.comparable ? "" : "err"}">${x.comparable}</b> / ${x.applicable}${prov(x)}</td><td>${na}</td><td class="covids">${covCell(x, m)}</td>${f ? `<td class="hint">${fz.comparable} / ${fz.applicable}</td>` : ""}</tr>`;
  }).join("");
  const cn = casesNeedingLabels(S.rows).length;
  const prog = S.rows.length ? progressHTML() : "";
  const pass = S.rows.length ? `<p class="lpass">${cn ? `<b>${cn} of ${S.rows.length} case${S.rows.length === 1 ? "" : "s"}</b> ${cn === 1 ? "still needs" : "still need"} at least one applicable label. <button class="ghost lpstart" title="Open one case at a time with its trace and every applicable metric">Label cases one at a time (all metrics) →</button>` : `<span class="ok">Every case has a valid label for every metric that applies to it.</span>`}</p>` : "";
  el.innerHTML = `<summary><b>Human-label coverage per metric</b> <span class="hint">· current draft (${d.rows} rows)${f ? ` vs last run's frozen snapshot (${f.rows} rows)` : ""}</span></summary>
    <p class="hint">Labelled = rows with a 1–5 label where the metric applies (the Jev judge rule; the optional LLM baseline scores Tool Call Accuracy only when a tool list is given, and may differ on Groundedness). Jev ↔ human agreement for a metric can use at most this many rows; a row the judge cannot score adds nothing. Counts only: nothing is scored, labelled or sent. Click an ID to label that row.</p>
    <div style="overflow-x:auto"><table class="agtab covtab"><thead><tr><th>Metric</th><th>Labelled / applicable</th><th>Not applicable</th><th>Needs a label</th>${f ? "<th>Last run (frozen)</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>${pass}${prog}`;
  renderQueue(); renderChecklist(); renderOutcomeView(); renderHandoff(); renderHandoffInspect();
}
// ---------- label-changes file as a LOCAL review checklist. S.chk = {name, meta, items (parsed file entries), mode
// "preview"|"queue", pos (index into items), skipped:Set}. Every render re-resolves each item against the CURRENT
// S.rows by exact id (never row_index), so edits/deletes/imports show up as drift/missing/ambiguous immediately.
// Importing, previewing, Next and Skip only change S.chk: S.rows / S.runRows are never touched here.
const CHK_ST = { matched: "matches file", drifted: "differs from file", missing: "missing", ambiguous: "ambiguous id", invalid: "invalid entry" };
function chkIdTxt(v) { return v == null ? "(no id)" : typeof v === "string" ? v : JSON.stringify(v); }
function chkReviewable(x) { return x.status === "matched" || x.status === "drifted"; }
function chkNext(cl, from) { for (let i = from + 1; i < cl.items.length; i++) if (chkReviewable(cl.items[i])) return i; return -1; }
function chkRecord(c, k, action, row, m, changed = false) {
  const key = "human_" + m;
  // trace fingerprint: the projection is FROZEN synchronously here (action time); only the hashing is async and it
  // writes into THIS record object only, so a later edit/replace/another action can never be bound into it.
  const rec = { action, changed, at: new Date().toISOString(), row, sig: JSON.stringify(row), value: Object.hasOwn(row, key) ? { present: true, value: row[key] } : { present: false } };
  let proj = null; try { proj = traceProjection(row); } catch { }   // non-JSON value (e.g. BigInt): record the action, no fingerprint
  rec.snap = proj;   // the exact projection string hashed now; exported ONLY if the reviewer opts in
  rec.fpP = (proj == null ? Promise.resolve(null) : sha256Hex(proj)).then(h => { rec.fp = h; return h; });
  c.acts.set(k, rec);
}
const OC_TXT = { saved: "saved", confirmed: "confirmed", skipped: "skipped", not_reviewed: "not reviewed" };
function outcomeHTML(c) {
  const o = checklistOutcome(S.rows, c), n = o.outcome_counts;
  return `<p class="chkoutcome"><b>Your outcome:</b> <span class="nw">${n.saved} saved</span> · <span class="nw">${n.confirmed} confirmed</span> · <span class="nw">${n.skipped} skipped</span> · <span class="nw">${n.not_reviewed} not reviewed</span>${o.evidence_counts.stale ? ` · <span class="err nw">${o.evidence_counts.stale} stale (case changed since)</span>` : ""} <button type="button" class="ghost chkdl">Download checklist outcome (.json)</button></p>
    <p class="chktr"><label><input type="checkbox" class="chkinctr"${c.incTrace ? " checked" : ""}> Include reviewed trace</label> <span class="hint">${c.incTrace ? `<b class="err">The download will contain the case text and tool data</b> (request, answer, tool calls/results, context and every other stored field except labels) exactly as they were when you pressed Save/Confirm, so a later reviewer can see which fields changed. Share it only where that content may go. It is saved to your computer only; nothing is uploaded. No key is ever included.` : "Off: the file holds only a fingerprint per Save/Confirm (no case text). Tick to let a later reviewer see exactly which fields changed; the file will then contain the reviewed case content."}</span></p>`;
}
async function downloadOutcome() {
  const c = S.chk; if (!c) return false;
  // wait for action-time digests (never recomputed now); loop in case another action landed while waiting
  for (let i = 0; i < 20 && [...c.acts.values()].some(a => a.fp === undefined); i++) await Promise.all([...c.acts.values()].map(a => a.fpP));
  if (S.chk !== c) return false;                            // checklist closed/replaced meanwhile: export nothing
  const pk = checklistOutcome(S.rows, c, { version: S.cfg?.version ?? null, at: new Date().toISOString(), includeTrace: c.incTrace === true });
  let txt = JSON.stringify(pk, null, 2);
  if (txt.length > MAX_OUTCOME_BYTES) txt = JSON.stringify(pk);   // compact form before refusing
  if (txt.length > MAX_OUTCOME_BYTES) { alert(`This outcome${pk.reviewed_trace_included ? " with the reviewed traces" : ""} would be ${(txt.length / 1e6).toFixed(1)} MB, over the ${MAX_OUTCOME_BYTES / 1e6} MB a reviewer can open here, so nothing was downloaded.${pk.reviewed_trace_included ? " Untick Include reviewed trace to download the fingerprint-only file." : ""}`); return false; }
  download(`label-checklist-outcome-${stamp()}.json`, txt); return true;
}
function renderChecklist() {
  const el = $("#chklist"); if (!el) return;
  const c = S.chk; if (!c) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  const cl = buildChecklist(S.rows, c.items), n = cl.counts;
  const head = `<b>Label-changes checklist</b> <span class="hint">· ${esc(c.name)}${c.meta.generated_at ? ` · exported ${esc(c.meta.generated_at)}` : ""}${c.meta.app_version ? ` from ${esc(c.meta.app_version)}` : ""}</span>`;
  const cnt = `<p class="chkcounts"><span class="nw"><b class="ck-matched">${n.matched}</b> match the file</span> · <span class="nw"><b class="ck-drifted">${n.drifted}</b> differ now</span> · <span class="nw"><b class="ck-missing">${n.missing}</b> missing</span> · <span class="nw"><b class="ck-ambiguous">${n.ambiguous}</b> ambiguous</span> · <span class="nw"><b class="ck-invalid">${n.invalid}</b> invalid</span> <span class="hint">(${cl.items.length} case·metric entr${cl.items.length === 1 ? "y" : "ies"})</span></p>`;
  const note = `<p class="hint">The file's before → after values are what was changed in an earlier session. They are shown for comparison only and are never applied. Cases are matched by exact ID only; the file holds labels, not traces, so it cannot prove a matched case's trace is unchanged: check the trace in the label dialog. Nothing is uploaded.</p>`;
  const line = (x, i) => `<li class="ck-${x.status}${c.mode === "queue" && i === c.pos ? " on" : ""}" data-k="${i}"><code>${esc(chkIdTxt(x.id))}</code>${x.metric ? ` · ${esc(M[x.metric] || x.metric)}` : ""} — <b>${CHK_ST[x.status]}</b>${x.before ? ` · <span class="hint nw">file: ${lblTxt(x.before)} → ${lblTxt(x.after)}</span>` : ""}${x.current ? ` · <span class="nw">now: ${lblTxt(x.current)}</span>` : ""}${x.reason ? ` · <span class="hint">${esc(x.reason)}</span>` : ""}${c.acts.has(i) ? ` <span class="tag">${OC_TXT[c.acts.get(i).action]}</span>` : c.skipped.has(i) ? ` <span class="tag">skipped</span>` : ""}</li>`;
  const list = `<details class="chkall"${c.mode === "preview" ? " open" : ""}><summary>All entries</summary><ul class="chkitems">${cl.items.map(line).join("")}</ul></details>`;
  if (c.mode === "preview") {
    el.innerHTML = `${head}${cnt}${outcomeHTML(c)}${note}${list}<div class="row"><button class="primary chkstart"${cl.reviewable ? "" : " disabled"}>Review ${cl.reviewable} matched entr${cl.reviewable === 1 ? "y" : "ies"} one at a time →</button> <button class="ghost chkclose">Close checklist</button>${cl.reviewable ? "" : ` <span class="hint">Nothing in this file matches exactly one case in the current dataset.</span>`}</div>`;
    return;
  }
  const x = cl.items[c.pos], nx = chkNext(cl, c.pos), done = cl.items.filter((y, i) => chkReviewable(y) && i <= c.pos).length;
  let cur;
  if (x && nx < 0 && chkReviewable(x)) x.last = true;
  if (!x) cur = `<div class="ok">End of checklist.</div>`;
  else if (!chkReviewable(x)) cur = `<div>Entry <code>${esc(chkIdTxt(x.id))}</code>${x.metric ? ` · ${esc(M[x.metric] || x.metric)}` : ""} is now <b class="err">${CHK_ST[x.status]}</b>: ${esc(x.reason || "")}. It cannot be opened; press Next or Skip.</div>`;
  else cur = `<div class="chkcur">Entry ${done} of ${cl.reviewable}: case <code>${esc(chkIdTxt(x.id))}</code> <span class="hint">row ${x.idx + 1}</span> · <b>${esc(M[x.metric])}</b><br>file: ${lblTxt(x.before)} → ${lblTxt(x.after)} · now: <b>${lblTxt(x.current)}</b> — ${x.status === "matched" ? `<span class="ok">matches the file's "after"</span>` : `<span class="err">differs from the file's "after"; the current label is kept unless you type a new one</span>`}${x.applicable ? "" : ` <span class="hint">(this metric is n/a for this case, so it cannot be edited in the dialog)</span>`}${x.last ? ` <div class="hint chkend">This is the last entry to review. Close the checklist when you are done.</div>` : ""}</div>`;
  el.innerHTML = `${head}${cnt}${outcomeHTML(c)}${cur}<div class="row">${x && chkReviewable(x) ? `<button class="primary chkopen">Open in label dialog</button> <button class="chkconfirm"${x.applicable ? "" : " disabled"} title="Record that you checked this case and its current label is right. Changes nothing.">Confirm current label</button> ` : ""}<button class="chknext"${nx < 0 ? " disabled" : ""}>Next →</button> <button class="ghost chkskip"${nx < 0 ? " disabled" : ""}>Skip →</button> <button class="ghost chkback">Back to summary</button> <button class="ghost chkclose">Close checklist</button></div>${note}${list}`;
}
$("#chklist").addEventListener("click", e => {
  const c = S.chk; if (!c) return;
  if (e.target.closest(".chkclose")) { S.chk = null; renderChecklist(); return; }
  if (e.target.closest(".chkback")) { c.mode = "preview"; renderChecklist(); return; }
  const cl = buildChecklist(S.rows, c.items);
  if (e.target.closest(".chkstart")) { c.mode = "queue"; c.pos = chkNext(cl, -1); renderChecklist(); return; }
  if (e.target.closest(".chkskip")) { c.skipped.add(c.pos); const nx = chkNext(cl, c.pos); if (nx >= 0) c.pos = nx; renderChecklist(); return; }
  if (e.target.closest(".chknext")) { const nx = chkNext(cl, c.pos); if (nx >= 0) c.pos = nx; renderChecklist(); return; }
  if (e.target.closest(".chkopen")) { const x = cl.items[c.pos]; if (x && chkReviewable(x)) openLabelPass(x.idx, { metric: x.metric, before: x.before, after: x.after, row: x.row, k: c.pos, chk: c }); return; }
  if (e.target.closest(".chkconfirm")) { const x = cl.items[c.pos]; if (x && chkReviewable(x) && x.applicable) { chkRecord(c, c.pos, "confirmed", x.row, x.metric); renderChecklist(); } return; }
  if (e.target.closest(".chkdl")) { downloadOutcome(); return; }
});
$("#chklist").addEventListener("change", e => { const c = S.chk; if (c && e.target.closest(".chkinctr")) { c.incTrace = e.target.checked; renderChecklist(); $("#chklist .chkinctr")?.focus(); } });
$("#chkfile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  let t; try { t = await f.text(); } catch { alert("Could not read that file. Nothing was changed."); return; }
  const p = parseChangesFile(t);
  if (!p.ok) { alert(`This is not a usable label-changes file: ${p.error}. Nothing was changed.`); return; }
  S.chk = { name: f.name, meta: p.meta, items: p.items, mode: "preview", pos: -1, skipped: new Set(), acts: new Map() };
  renderChecklist(); $("#chklist").scrollIntoView({ block: "start" });
};
// ---------- READ-ONLY inspection of a downloaded checklist-outcome file. S.ocv = {name, parsed}; only S.ocv is ever
// set. Every render re-resolves against the CURRENT S.rows (no labels applied, S.chk / S.rows / S.runRows untouched).
const TR_TXT = { same: "trace same as at their action", changed: "trace CHANGED since their action", unavailable: "trace: no fingerprint in file", unsupported: "trace: unsupported fingerprint", malformed: "trace: malformed fingerprint", not_checkable: "trace: no single current case", pending: "trace: computing…", cannot_compute: "trace: cannot compute here" };
// in-memory digest cache keyed by the canonical projection STRING (content-addressed: can never bind to another row)
const OC_HASH = new Map();
function ocDigest(c) {
  if (OC_HASH.has(c)) return OC_HASH.get(c);
  if (!OC_HASH.has("~" + c)) { OC_HASH.set("~" + c, 1);
    sha256Hex(c).catch(() => null).then(h => { OC_HASH.set(c, h); OC_HASH.delete("~" + c); if (S.ocv) { renderOutcomeView(); ocCaseTrace(); } if (S.ho) renderHandoff(); if (S.hi) { renderHandoffInspect(); hiCaseTrace(); } }); }
  return undefined;
}
const CMP_TXT = { same: "claimed label = label now", different: "claimed label ≠ label now", not_checkable: "cannot check now", no_claim: "no label claimed" };
function renderOutcomeView() {
  const el = $("#ocview"); if (!el) return;
  const v = S.ocv; if (!v) { el.hidden = true; el.innerHTML = ""; ocCaseRecheck(); return; }
  el.hidden = false;
  const r = inspectOutcome(S.rows, v.parsed, ocDigest), m = v.parsed.meta, cc = v.parsed.claimed_counts, n = r.now_counts, q = r.claimed_label_vs_now;
  const head = `<b>Checklist outcome — read-only</b> <span class="hint">· ${esc(v.name)}${m.generated_at ? ` · exported ${esc(m.generated_at)}` : ""}${m.app_version ? ` from ${esc(m.app_version)}` : ""}${m.dataset_rows != null ? ` · their dataset had ${esc(String(m.dataset_rows))} rows` : ""}</span>`;
  const scope = `<p class="hint ocscope">This file is <b>what an earlier reviewer's browser claims</b>. It is not signed and has no reviewer identity. Newer files carry a trace fingerprint per Save/Confirm, checked below; older files do not, and for those a label that matches now does not show the trace is the one they reviewed. Nothing here is applied, changed or uploaded.</p>`;
  const claimed = `<p class="occlaimed"><b>Claimed in file (at their export):</b> <span class="nw">${cc.outcome.saved} saved</span> · <span class="nw">${cc.outcome.confirmed} confirmed</span> · <span class="nw">${cc.outcome.skipped} skipped</span> · <span class="nw">${cc.outcome.not_reviewed} not reviewed</span>${cc.evidence_at_export.stale ? ` · <span class="nw">${cc.evidence_at_export.stale} they already marked stale</span>` : ""}</p>`;
  const now = `<p class="ocnow"><b>Checked now: ${r.entries_total} entries against this dataset (${S.rows.length} rows):</b> <span class="nw"><b class="ck-matched">${n.matched}</b> match the file's "after"</span> · <span class="nw"><b class="ck-drifted">${n.drifted}</b> differ</span> · <span class="nw"><b class="ck-missing">${n.missing}</b> missing</span> · <span class="nw"><b class="ck-ambiguous">${n.ambiguous}</b> ambiguous</span> · <span class="nw"><b class="ck-invalid">${n.invalid}</b> invalid</span><br><span class="nw">Label they saved/confirmed vs label now: <b>${q.same}</b> same label now</span> · <span class="nw"><b>${q.different}</b> different now</span> · <span class="nw"><b>${q.not_checkable}</b> cannot check</span> <span class="hint">(same label is not proof the trace is unchanged)</span></p>`;
  const t = r.trace_vs_now;
  const tr = `<p class="octrace"><b>Trace at their action vs trace now</b> <span class="hint">(${esc(FP_SCHEME)} SHA-256 fingerprint in the file, recomputed here from the one current case with that exact ID)</span>: <span class="nw"><b class="tr-same">${t.same}</b> same</span> · <span class="nw"><b class="tr-changed">${t.changed}</b> changed</span> · <span class="nw"><b>${t.unavailable}</b> no fingerprint</span>${t.unsupported ? ` · <span class="nw"><b>${t.unsupported}</b> unsupported</span>` : ""}${t.malformed ? ` · <span class="nw err"><b>${t.malformed}</b> malformed</span>` : ""}${t.not_checkable ? ` · <span class="nw"><b>${t.not_checkable}</b> cannot match a case</span>` : ""}${t.pending ? ` · <span class="nw">${t.pending} computing…</span>` : ""}${t.cannot_compute ? ` · <span class="nw err">${t.cannot_compute} cannot compute here</span>` : ""}<br><span class="hint">Unsigned content comparison of every stored field except labels (key order ignored, message order kept). "Same" means the stored trace hashes the same as at their Save/Confirm, not that they are who they say or that the label is right; "changed" cannot say which field changed. Older files without a fingerprint are "no fingerprint", never "same".</span></p>`;
  const sv = r.snapshot, sn = k => sv[k] || 0, bad = sn("unverifiable") + sn("unsupported") + sn("malformed") + sn("cannot_compute");
  const snx = sn("verified") + sn("mismatch") + bad + sn("pending");
  const snl = snx ? `<p class="ocsnap"><b>Reviewed trace included in file:</b> <span class="nw"><b class="tr-same">${sn("verified")}</b> match their fingerprint (field comparison available)</span>${sn("mismatch") ? ` · <span class="nw err"><b>${sn("mismatch")}</b> do NOT match their fingerprint (not used)</span>` : ""}${bad ? ` · <span class="nw err"><b>${bad}</b> unusable (no valid fingerprint / unsupported / malformed)</span>` : ""}${sn("pending") ? ` · <span class="nw">${sn("pending")} checking…</span>` : ""}<br><span class="hint">The earlier reviewer chose to include each trace as it was at their Save/Confirm. It is used only when it hashes to that entry's own fingerprint. Unsigned content: it shows what changed, not who reviewed or whether any label is right. Open a case to see every changed field with earlier and current values.</span></p>` : "";
  const SN_TXT = { mismatch: ` · <b class="err">included trace does not match its fingerprint: not compared</b>`, unverifiable: ` · <b class="err">included trace has no valid fingerprint: not compared</b>`, unsupported: ` · <b class="err">included trace unsupported: not compared</b>`, malformed: ` · <b class="err">included trace malformed: not compared</b>`, pending: " · checking included trace…", cannot_compute: ` · <b class="err">cannot check included trace here</b>` };
  const dline = x => x.snap === "verified" && x.diff ? ` · <b class="${x.diff.length ? "tr-changed" : "tr-same"}">${x.diff.length ? `${x.diff.length >= DIFF_MAX ? DIFF_MAX + "+" : x.diff.length} field${x.diff.length === 1 ? "" : "s"} changed: ${esc(x.diff.slice(0, 3).map(d => d.path).join(", "))}${x.diff.length > 3 ? "…" : ""}` : "no field differs"}</b>` : SN_TXT[x.snap] ?? "";
  const line = x => { const c = x.claimed;
    return `<li class="ck-${x.now.status}" data-e="${x.entry}"><code>${esc(chkIdTxt(x.id))}</code>${x.metric ? ` · ${esc(Object.hasOwn(M, x.metric) ? M[x.metric] : x.metric)}` : ""}${x.before && x.after && x.now.status !== "invalid" ? ` · <span class="hint nw">file: ${lblTxt(x.before)} → ${lblTxt(x.after)}</span>` : ""}
      <div class="occlm"><span class="tag">claimed: ${esc(OC_TXT[c.outcome])}</span>${c.outcome_label ? ` label ${lblTxt(c.outcome_label)}` : ""}${c.label_changed_by_save === true ? " (their Save changed it)" : c.label_changed_by_save === false ? " (their Save changed nothing)" : ""}${c.outcome_at ? ` <span class="hint nw">at ${esc(c.outcome_at)}</span>` : ""} <span class="hint">· at their export: ${CHK_ST[c.status_at_export]}${c.label_at_export ? `, label ${lblTxt(c.label_at_export)}` : ""}</span>${c.evidence_at_export ? ` <span class="hint">· evidence they exported: ${esc(c.evidence_at_export)}${c.evidence_note ? `: ${esc(c.evidence_note)}` : ""}</span>` : ""}</div>
      <div class="ocnw">now: <b>${CHK_ST[x.now.status]}</b>${x.now.label ? ` · label ${lblTxt(x.now.label)}` : ""}${x.now.row != null ? ` <span class="hint">row ${x.now.row + 1}</span>` : ""} · <b class="oc-${x.claimed_vs_now}">${CMP_TXT[x.claimed_vs_now]}</b>${x.now.reason ? ` · <span class="hint">${esc(x.now.reason)}</span>` : ""}
      ${x.now.status === "matched" || x.now.status === "drifted" ? ` <button type="button" class="linkish ocopen" data-e="${x.entry}" aria-label="Open current case ${esc(chkIdTxt(x.id))} (entry ${x.entry}) read-only">Open current case</button>` : ` <span class="hint ocna">· case view unavailable</span>`}</div>
      <div class="octr">Trace: <b class="tr-${x.trace_vs_now}">${TR_TXT[x.trace_vs_now]}</b>${dline(x)}${x.claimed.trace_fp?.reason ? ` <span class="hint">(${esc(x.claimed.trace_fp.reason)})</span>` : ""}</div></li>`; };
  const keepY = el.querySelector(".ocitems")?.scrollTop ?? 0;
  const live = changedTraces(r), ctOn = !!v.ct, inQ = ctOn ? new Set(v.ct.ct.queue) : null;
  const shown = ctOn ? r.entries.filter(x => inQ.has(x.entry)) : r.entries;
  el.innerHTML = `${head}${scope}${claimed}${now}${tr}${snl}${ctPanelHTML(v, live)}<details class="chkall" open><summary>${ctOn ? `Changed-trace entries only (${shown.length} of ${r.entries_total}; status below is live)` : "All entries"}</summary><ul class="chkitems ocitems">${shown.map(line).join("") || `<li class="hint">No entries in this filter.</li>`}</ul></details><div class="row"><button class="ghost occlose">Close outcome view</button></div>`;
  const li = el.querySelector(".ocitems"); if (li) li.scrollTop = keepY;
  ocCaseRecheck();
}
// ---------- RE-LABEL HANDOFF (changed-traces-comparison v2 with reviewer decisions), opened read-only.
// S.ho = {name, parsed, chk (frozen checkHandoff result), rows (identity), tsig (trace-only signature of the dataset at
// check time), mode "preview"|"pass", pos, saved: Map(targetKey -> {changed}), skipped: Set}. The file's decisions/notes
// are CLAIMS: they never apply a label or score. Only a typed Save in the existing label dialog changes a label, and
// only the target's own metric. Any trace edit / row add / delete / replace makes the handoff stale until Re-check.
const HO_ST = { current: "current (trace = reviewed current)", changed_since: "trace changed since the comparison", missing: "missing", ambiguous: "ambiguous id", invalid: "invalid entry", pending: "checking…" };
const HO_EA = { verified: "file's diff consistent with its earlier fingerprint (self-check, not independent proof)", mismatch: "file diff does NOT reproduce its earlier fingerprint", not_verifiable: "earlier trace not independently verified", not_checked: "earlier trace not checked" };
const HO_DT = { accept_change: "accept change", needs_relabel: "needs re-label", unreviewed: "unreviewed" };
function hoTraceSig(rows) { try { return JSON.stringify(rows.map(r => traceProjection(r))); } catch { return null; } }
function hoFresh(h) { return !!h?.chk && h.rows === S.rows && h.tsig !== null && hoTraceSig(S.rows) === h.tsig; }
function hoCheck() {
  const h = S.ho; if (!h) return;
  const r = checkHandoff(S.rows, h.parsed, ocDigest);
  if (!r.ready) { if (h.chk) h.lastChk = h.chk; h.chk = null; h.pendingCheck = true; renderHandoff(); return; }
  const cr = handoffCarry(h.chk || h.lastChk, h.acts, h.skipped, r);   // only exact same row+trace targets keep an action
  h.pendingCheck = false; h.chk = r; h.lastChk = r; h.rows = S.rows; h.tsig = hoTraceSig(S.rows); h.at = new Date().toISOString();
  h.acts = cr.acts; h.skipped = cr.skipped; h.dropped = (h.dropped || 0) + cr.dropped;
  h.mode = "preview"; h.pos = 0; renderHandoff();
}
function hoDownload() {
  const h = S.ho; if (!h?.chk) return false;
  const pk = handoffOutcome(S.rows, h, { version: S.cfg?.version ?? null, at: new Date().toISOString(), datasetChanged: !hoFresh(h) });
  download(`relabel-handoff-outcome-${stamp()}.json`, JSON.stringify(pk, null, 2)); return true;
}
function hoTarget(h) { return h?.chk?.targets[h.pos] || null; }
function renderHandoff() {
  const el = $("#hoview"); if (!el) return;
  const h = S.ho; if (!h) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  if (!h.chk && h.pendingCheck) { const r = checkHandoff(S.rows, h.parsed, ocDigest); if (r.ready) { hoCheck(); return; } }
  const m = h.parsed.meta, cc = h.parsed.claimed_counts;
  const head = `<b>Re-label handoff — read-only check</b> <span class="hint">· ${esc(h.name)}${m.generated_at ? ` · exported ${esc(m.generated_at)}` : ""}${m.app_version ? ` from ${esc(m.app_version)}` : ""}${m.dataset_rows != null ? ` · their dataset had ${m.dataset_rows} rows` : ""}</span>`;
  const scope = `<p class="hint ocscope">This comparison file is <b>what another reviewer's browser claims</b>: unsigned, no verified identity. Their decisions and notes are shown as claims only; they never change a label or a score. Each entry is re-matched here by exact typed ID + metric, and the current trace is re-fingerprinted and compared with the fingerprint they reviewed. Nothing is uploaded; no model is called.</p>`;
  const claimed = `<p class="hoclaimed"><b>Claimed in file:</b> <span class="nw">${cc.needs_relabel} needs re-label</span> · <span class="nw">${cc.accept_change} accept change</span> · <span class="nw">${cc.unreviewed} unreviewed</span> <span class="hint">(${h.parsed.entries.length} changed entries)</span></p>`;
  if (!h.chk) { el.innerHTML = `${head}${scope}${claimed}<p class="hint">Checking fingerprints against this dataset…</p><div class="row"><button class="ghost hoclose">Close handoff</button></div>`; return; }
  const c = h.chk, st = c.status_counts, ea = c.earlier_counts, fresh = hoFresh(h);
  const now = `<p class="honow"><b>Checked now (${esc(h.at)}) against this dataset (${h.rows.length} rows):</b> <span class="nw"><b class="ck-matched">${st.current}</b> current</span> · <span class="nw"><b class="ck-drifted">${st.changed_since}</b> trace changed since</span> · <span class="nw"><b class="ck-missing">${st.missing}</b> missing</span> · <span class="nw"><b class="ck-ambiguous">${st.ambiguous}</b> ambiguous</span> · <span class="nw"><b class="ck-invalid">${st.invalid}</b> invalid</span><br><span class="hint">Of the current ones: ${ea.verified} file diff consistent with its own earlier fingerprint (a self-check of the file, not independent proof of the earlier trace) · ${ea.not_verifiable} earlier trace not independently verified (hash-only or capped) · ${ea.mismatch} file diff inconsistent (not eligible).</span></p>`;
  const tc = c.targets.length;
  const elig = `<p class="hoelig"><b>Ready to re-label: ${c.eligible_entries} needs-re-label entr${c.eligible_entries === 1 ? "y" : "ies"} → ${tc} case·metric target${tc === 1 ? "" : "s"} on ${c.target_cases} case${c.target_cases === 1 ? "" : "s"}</b> <span class="hint">(repeated entries for the same case + metric are labelled once; accept-change and unreviewed entries are never targets)</span></p>`;
  const line = x => `<li class="ck-${x.status === "current" ? "matched" : x.status === "changed_since" ? "drifted" : x.status}${x.eligible ? " hoel" : ""}" data-p="${x.pos}"><code>${esc(chkIdTxt(x.id))}</code>${x.metric && Object.hasOwn(M, x.metric) ? ` · ${esc(M[x.metric])}` : x.metric ? ` · ${esc(String(x.metric))}` : ""} <span class="hint">entry ${esc(String(x.entry ?? "?"))}</span>
    <div class="occlm"><span class="tag">claimed: ${HO_DT[x.claimed.decision]}</span>${x.claimed.note ? ` note: <q>${esc(x.claimed.note)}</q>` : ""}${x.claimed.decided_at ? ` <span class="hint nw">at ${esc(x.claimed.decided_at)}</span>` : ""}</div>
    <div class="ocnw">now: <b>${HO_ST[x.status]}</b>${x.idx != null ? ` <span class="hint">row ${x.idx + 1}</span>` : ""}${x.label_now ? ` · label ${lblTxt(x.label_now)}` : ""}${x.status === "current" ? ` · <span class="hint">${HO_EA[x.earlier]}${x.earlier_reason ? ` (${esc(x.earlier_reason)})` : ""}</span>` : ""}${x.reason ? ` · <span class="hint">${esc(x.reason)}</span>` : ""}${x.eligible ? ` · <b class="ok">eligible</b>` : x.why_not ? ` · <span class="err">not eligible: ${esc(x.why_not)}</span>` : ""}</div></li>`;
  const list = `<details class="chkall"${h.mode === "preview" ? " open" : ""}><summary>All entries</summary><ul class="chkitems hoitems">${c.entries.map(line).join("")}</ul></details>`;
  const done = h.acts.size, chgN = [...h.acts.values()].filter(a => a.changed).length;
  const prog = `<p class="hoprog"><b>Label pass:</b> <span class="nw">${done} saved (${chgN} changed · ${done - chgN} unchanged)</span> · <span class="nw">${h.skipped.size} skipped</span> · <span class="nw">${tc - done - h.skipped.size} not reached</span> <span class="hint">of ${tc} targets (Next/opening never label)${h.dropped ? ` · ${h.dropped} earlier outcome${h.dropped === 1 ? "" : "s"} dropped at re-check because the target changed` : ""}</span></p>`;
  const oc = handoffOutcome(S.rows, h, {}), ocn = oc.counts, occ = oc.outcome_counts;
  const pv = `<details class="hooc"${h.showOc ? " open" : ""}><summary><b>Outcome for the first reviewer</b> <span class="hint">· ${occ.saved_changed} saved changed · ${occ.saved_unchanged} saved unchanged · ${occ.skipped} skipped · ${occ.not_reached} not reached</span></summary>
    <p class="hint hooccount">${ocn.entries_in_file} entries in the file → ${ocn.eligible_entries} eligible needs-re-label → ${ocn.targets} case·metric targets (${ocn.duplicate_entries_merged} repeated entr${ocn.duplicate_entries_merged === 1 ? "y" : "ies"} merged) on ${ocn.target_cases} case${ocn.target_cases === 1 ? "" : "s"} · ${ocn.not_eligible_entries} not eligible (listed with the reason). Checked now: ${oc.checked_now_counts.current} current · ${oc.checked_now_counts.trace_changed} trace changed · ${oc.checked_now_counts.missing} missing · ${oc.checked_now_counts.ambiguous} ambiguous. Saved evidence: ${oc.evidence_counts.current} current · ${oc.evidence_counts.stale} stale.</p>
    <ul class="chkitems hoocitems">${oc.targets.map(o => `<li class="hooc-${o.action}"><code>${esc(chkIdTxt(o.id))}</code> · ${esc(M[o.metric])} <span class="hint">entr${o.source_entries.length === 1 ? "y" : "ies"} ${o.source_entries.join(", ")}</span> — <b>${o.action === "saved" ? (o.label_changed ? "saved, changed" : "saved, unchanged") : o.action === "skipped" ? "skipped" : "not reached"}</b>${o.action === "saved" ? ` ${lblTxt(o.label_before)} → ${lblTxt(o.label_after)}${o.evidence === "stale" ? ` · <span class="err">stale: ${esc(o.evidence_note)}</span>` : ""}` : ""} <span class="hint">· now ${esc(o.checked_now)}${o.label_now ? ` label ${lblTxt(o.label_now)}` : ""}</span></li>`).join("")}</ul>
    <div class="row"><button class="primary hodl">Download handoff outcome (.json)</button> <span class="hint">Local file only: IDs, metrics, entry numbers, labels, fingerprints. No trace text, notes, keys or scores.</span></div></details>`;
  if (!fresh) { el.innerHTML = `${head}${scope}${claimed}${now}<p class="err hostale" role="alert">The dataset changed after this check (a trace was edited, a case added or deleted, or the dataset replaced). The targets above may no longer point at the reviewed cases, so the label pass and saving are off until you re-check.</p><div class="row"><button class="primary horecheck">Re-check against current dataset</button> <button class="ghost hoclose">Close handoff</button></div>${tc ? pv : ""}${list}`; return; }
  if (h.mode === "preview") {
    el.innerHTML = `${head}${scope}${claimed}${now}${elig}${tc ? prog : ""}<div class="row"><button class="primary hostart"${tc ? "" : " disabled"}>Start label pass (${tc}) →</button> <button class="ghost horecheck">Re-check</button> <button class="ghost hoclose">Close handoff</button>${tc ? "" : ` <span class="hint">No needs-re-label entry is current and applicable in this dataset.</span>`}</div>${tc ? pv : ""}${list}`;
    return;
  }
  const t = hoTarget(h), sv = t && h.acts.get(t.key);
  const cur = !t ? `<div class="ok">End of the label pass.</div>` : `<div class="chkcur hocur">Target ${h.pos + 1} of ${tc}: case <code>${esc(chkIdTxt(t.id))}</code> <span class="hint">row ${S.rows.indexOf(t.row) + 1}</span> · <b>${esc(M[t.metric])}</b> · label now <b>${lblTxt(Object.hasOwn(t.row, "human_" + t.metric) ? { present: true, value: t.row["human_" + t.metric] } : { present: false })}</b> <span class="hint">· from entr${t.entries.length === 1 ? "y" : "ies"} ${t.entries.join(", ")}</span>${sv ? ` <span class="tag">saved${sv.changed ? "" : " (unchanged)"}</span>` : h.skipped.has(t.key) ? ` <span class="tag">skipped</span>` : ""}${t.notes.length ? `<div class="honotes"><b>Reviewer notes (context only):</b> ${t.notes.map(n => `<q>${esc(n.note)}</q> <span class="hint">(entry ${n.entry})</span>`).join(" · ")}</div>` : ""}</div>`;
  el.innerHTML = `${head}${claimed}${elig}${prog}${cur}<div class="row">${t ? `<button class="primary hoopen">Open in label dialog</button> ` : ""}<button class="hoprev"${h.pos <= 0 ? " disabled" : ""}>← Previous</button> <button class="honext"${h.pos >= tc - 1 ? " disabled" : ""}>Next →</button> <button class="ghost hoskip"${!t ? " disabled" : ""}>Skip →</button> <button class="ghost hoback">Back to summary</button> <button class="ghost hoclose">Close handoff</button></div>${pv}${list}`;
}
function hoOpen() {
  const h = S.ho; if (!hoFresh(h)) { alert("The dataset changed after the handoff check, so the label dialog was not opened. Re-check first."); renderHandoff(); return; }
  const t = hoTarget(h); if (!t) return;
  if (!handoffTargetFresh(S.rows, t)) { alert("This case changed, was removed or its ID is no longer unique, so it was not opened. Re-check first."); renderHandoff(); return; }
  const banner = `<p class="ckbanner" role="note"><b>Re-label handoff: ${esc(M[t.metric])}.</b> Another reviewer marked this case "needs re-label" after its trace changed (entr${t.entries.length === 1 ? "y" : "ies"} ${t.entries.join(", ")}). Their decision is a claim and changes nothing by itself.${t.notes.length ? ` Their note${t.notes.length > 1 ? "s" : ""}: ${t.notes.map(n => `<q>${esc(n.note)}</q>`).join(" · ")}.` : ""} Only this metric can be edited here; type your own 1–5 judgement and Save, or Close.</p>`;
  openLabelPass(S.rows.indexOf(t.row), { metric: t.metric, row: t.row, banner,
    guard: () => S.ho !== h || !hoFresh(h) ? "The dataset or handoff changed while this was open (re-check needed); nothing was saved." : !handoffTargetFresh(S.rows, t) ? "This case changed while this was open; nothing was saved." : "",
    onSaved: (editable, _c, prev) => { if (S.ho !== h || !editable) return;
      const cur = Object.hasOwn(t.row, "human_" + t.metric) ? { present: true, value: t.row["human_" + t.metric] } : { present: false };
      const old = h.acts.get(t.key), before = old ? old.before : prev, sameL = (a, b) => a.present === b.present && (!a.present || JSON.stringify(a.value) === JSON.stringify(b.value));
      h.acts.set(t.key, { before, after: cur, changed: !sameL(before, cur), saves: (old?.saves || 0) + 1, at: new Date().toISOString(), row: t.row, skippedBefore: old?.skippedBefore || h.skipped.has(t.key) });
      h.skipped.delete(t.key); renderHandoff(); } });
}
$("#hoview").addEventListener("click", e => {
  const h = S.ho; if (!h) return;
  if (e.target.closest(".hoclose")) { S.ho = null; renderHandoff(); return; }   // nothing unsaved lives here; saved labels stay in the dataset
  if (e.target.closest(".horecheck")) { hoCheck(); return; }
  if (e.target.closest(".hooc>summary")) { h.showOc = !e.target.closest("details").open; return; }
  if (e.target.closest(".hodl")) { hoDownload(); return; }
  if (!hoFresh(h)) { renderHandoff(); return; }
  if (e.target.closest(".hostart")) { h.mode = "pass"; h.pos = 0; renderHandoff(); $("#hoview .hoopen")?.focus(); return; }
  if (e.target.closest(".hoback")) { h.mode = "preview"; renderHandoff(); return; }
  if (e.target.closest(".honext")) { if (h.pos < h.chk.targets.length - 1) h.pos++; renderHandoff(); return; }
  if (e.target.closest(".hoprev")) { if (h.pos > 0) h.pos--; renderHandoff(); return; }
  if (e.target.closest(".hoskip")) { const t = hoTarget(h); if (t && !h.acts.has(t.key)) h.skipped.add(t.key); if (h.pos < h.chk.targets.length - 1) h.pos++; renderHandoff(); return; }
  if (e.target.closest(".hoopen")) { hoOpen(); return; }
});
$("#hofile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (f.size > MAX_OUTCOME_BYTES) { alert(`That file is too large (over ${MAX_OUTCOME_BYTES / 1e6} MB). Nothing was changed.`); return; }
  let t; try { t = await f.text(); } catch { alert("Could not read that file. Nothing was changed."); return; }
  const p = parseComparisonFile(t);
  if (!p.ok) { alert(`This is not a usable comparison + decisions file: ${p.error}. Nothing was changed.`); return; }
  S.ho = { name: f.name, meta: p.meta, parsed: p, chk: null, pendingCheck: true, mode: "preview", pos: 0, acts: new Map(), skipped: new Set(), dropped: 0 };
  hoCheck(); $("#hoview").scrollIntoView({ block: "start" });
};
// ---------- READ-ONLY inspection of a re-label HANDOFF OUTCOME file (first reviewer). S.hi = {name, parsed}; only S.hi
// is ever set. Every render re-resolves against the CURRENT S.rows by exact typed id + metric and re-fingerprints the
// trace; the file's historical action is shown apart from what is checked now. Nothing is applied, stored or sent.
const HI_ACT = { saved: "saved", skipped: "skipped", not_reached: "not reached" };
const HI_TR = { same: "trace same as reviewed", changed: "trace CHANGED since reviewed", not_checkable: "trace: no single current case", pending: "trace: computing…", cannot_compute: "trace: cannot compute here" };
const HI_RD = { consistent: "consistent: label now = their saved label, trace same", consistent_stale: "label and trace equal the file, but they marked this Save stale", label_differs: "label now ≠ their saved label", trace_changed: "trace changed since, so their Save is about another trace", not_checkable: "cannot check now", pending: "checking…" };
const HI_NOW = { matched: "one case with this exact ID", missing: "missing", ambiguous: "ambiguous id", invalid: "invalid target" };
function renderHandoffInspect() {
  const el = $("#hiview"); if (!el) return;
  const v = S.hi; if (!v) { el.hidden = true; el.innerHTML = ""; hiCaseRecheck(); return; }
  el.hidden = false;
  const p = v.parsed, m = p.meta, c = p.counts, cc = p.claimed_counts, r = inspectHandoffOutcome(S.rows, p, ocDigest);
  const n = r.now_counts, t = r.trace_counts, rd = r.saved_reading, sv = r.saved_claims;
  const head = `<b>Handoff outcome — read-only</b> <span class="hint">· ${esc(v.name)}${m.generated_at ? ` · exported ${esc(m.generated_at)}` : ""}${m.app_version ? ` from ${esc(m.app_version)}` : ""}${m.dataset_rows != null ? ` · their dataset had ${m.dataset_rows} rows` : ""}${m.comparison_file ? ` · from comparison ${esc(m.comparison_file)}` : ""}</span>`;
  const scope = `<p class="hint ocscope">This file is <b>what the other reviewer's browser claims</b> they did in a re-label pass. It is unsigned and has no verified identity, so it cannot prove any Save happened, and a label that matches now does not prove it either. Each target is re-matched here by exact typed ID + metric (missing or ambiguous IDs are refused, never guessed) and its current trace is re-fingerprinted against the fingerprint they reviewed. Nothing is applied, changed or uploaded.</p>`;
  const claimed = `<p class="hiclaimed"><b>Claimed in file (at their export):</b> <span class="nw">${cc.outcome.saved_changed} saved, changed</span> · <span class="nw">${cc.outcome.saved_unchanged} saved, unchanged</span> · <span class="nw">${cc.outcome.skipped} skipped</span> · <span class="nw">${cc.outcome.not_reached} not reached</span> <span class="hint">of ${c.targets} case·metric targets on ${c.target_cases} cases (${c.entries_in_file} comparison entries → ${c.eligible_entries} eligible, ${c.duplicate_entries_merged} merged, ${c.not_eligible_entries} not eligible${c.outcomes_dropped_at_recheck ? `, ${c.outcomes_dropped_at_recheck} dropped at their re-check` : ""})${cc.evidence.stale ? ` · they marked ${cc.evidence.stale} saved stale` : ""}${m.dataset_changed_since_check ? " · their dataset changed after their check" : ""}</span></p>`;
  const now = `<p class="hinow"><b>Checked now against this dataset (${S.rows.length} rows):</b> <span class="nw"><b class="ck-matched">${n.matched}</b> matched</span> · <span class="nw"><b class="ck-missing">${n.missing}</b> missing</span> · <span class="nw"><b class="ck-ambiguous">${n.ambiguous}</b> ambiguous</span> · <span class="nw"><b class="ck-invalid">${n.invalid}</b> invalid</span> · trace vs reviewed: <span class="nw"><b class="tr-same">${t.same}</b> same</span> · <span class="nw"><b class="tr-changed">${t.changed}</b> changed</span>${t.not_checkable ? ` · <span class="nw">${t.not_checkable} not checkable</span>` : ""}${t.pending ? ` · <span class="nw">${t.pending} computing…</span>` : ""}${t.cannot_compute ? ` · <span class="nw err">${t.cannot_compute} cannot compute</span>` : ""}</p>`;
  const sum = `<p class="hisum" aria-live="polite"><b>Of the ${sv} claimed Save${sv === 1 ? "" : "s"}:</b> <span class="nw"><b class="hi-consistent">${rd.consistent}</b> consistent with this dataset</span> · ${rd.consistent_stale ? `<span class="nw"><b>${rd.consistent_stale}</b> equal but marked stale by them</span> · ` : ""}<span class="nw"><b class="hi-label_differs">${rd.label_differs}</b> label differs now</span> · <span class="nw"><b class="hi-trace_changed">${rd.trace_changed}</b> trace changed since</span> · <span class="nw"><b>${rd.not_checkable}</b> cannot check</span>${rd.pending ? ` · <span class="nw">${rd.pending} checking…</span>` : ""}<br><span class="hint">"Consistent" only means the label and trace here equal what the file says; it is not proof they saved it. Skipped and not-reached targets make no label claim.</span></p>`;
  const line = x => { const cl = x.claimed;
    return `<li class="ck-${x.status}" data-t="${x.pos}"><code>${esc(chkIdTxt(x.id))}</code>${x.metric && Object.hasOwn(M, x.metric) ? ` · ${esc(M[x.metric])}` : x.metric ? ` · ${esc(String(x.metric))}` : ""} <span class="hint">target ${x.pos} · entr${x.source_entries.length === 1 ? "y" : "ies"} ${esc(x.source_entries.join(", "))}</span>
      <div class="occlm"><span class="tag">claimed: ${HI_ACT[cl.action]}${cl.action === "saved" ? (cl.label_changed ? ", changed" : ", unchanged") : ""}</span>${cl.label_before && cl.label_after ? ` ${lblTxt(cl.label_before)} → ${lblTxt(cl.label_after)}` : ""}${cl.action_at ? ` <span class="hint nw">at ${esc(cl.action_at)}</span>` : ""}${cl.evidence ? ` <span class="hint">· evidence they exported: ${esc(cl.evidence)}${cl.evidence_note ? `: ${esc(cl.evidence_note)}` : ""}</span>` : ""} <span class="hint">· at their export: ${esc(cl.checked_now_at_export)}${cl.label_now_at_export ? `, label ${lblTxt(cl.label_now_at_export)}` : ""}</span></div>
      <div class="ocnw">now: <b>${HI_NOW[x.status]}</b>${x.idx != null ? ` <span class="hint">row ${x.idx + 1}</span>` : ""}${x.label_now ? ` · label ${lblTxt(x.label_now)}` : ""} · <b class="tr-${x.trace}">${HI_TR[x.trace]}</b>${x.reading ? ` · <b class="hi-${x.reading}">${HI_RD[x.reading]}</b>` : ""}${x.reason ? ` · <span class="hint">${esc(x.reason)}</span>` : ""}
      ${x.status === "matched" ? ` <button type="button" class="linkish hiopen" data-t="${x.pos}" aria-label="Open current case ${esc(chkIdTxt(x.id))} (target ${x.pos}) read-only">Open current case</button>` : ` <span class="hint">· case view unavailable</span>`}</div></li>`; };
  const keepY = el.querySelector(".hiitems")?.scrollTop ?? 0;
  const dt = handoffDiffTargets(r), dx = dt.excluded, dn = dt.list.length;
  const dexc = `${dx.consistent + dx.consistent_stale} consistent · ${dx.trace_changed} trace changed since · ${dx.not_checkable} cannot check (missing, ambiguous or unresolved) · ${dx.no_save_claim} skipped/not reached (no label claim)`;
  const diff = !dt.ready ? "" : v.dp ? hiDiffPassHTML(v, dt) : `<div class="row hidiffrow"><button type="button" class="primary hidiff"${dn ? "" : " disabled"}>Review label differences (${dn}) →</button> <span class="hint">${dn ? `Steps through only the ${dn} claimed Save${dn === 1 ? "" : "s"} whose label now ≠ their saved label, in file order, in the existing label dialog. Left out: ${dexc}.` : `No claimed Save has a different label now. Left out: ${dexc}.`}</span></div>`;
  const hs = !dt.ready || v.dp ? "" : hiSummaryHTML(v, r, dt);
  el.innerHTML = `${head}${scope}${claimed}${now}${sum}${diff}${hs}<details class="chkall" open><summary>All targets</summary><ul class="chkitems hiitems">${r.targets.map(line).join("")}</ul></details><div class="row"><button class="ghost hiclose">Close handoff outcome</button></div>`;
  const li = el.querySelector(".hiitems"); if (li) li.scrollTop = keepY;
  const hp = el.querySelector("#hiSumText"); if (hp && v.sum) hp.textContent = v.sum.text;
  hiCaseRecheck();
}
// t_656eefbb: handoff review summary (.md) = handoff_summary.js over the SAME inspectHandoffOutcome result shown above.
// The text is frozen with the dataset it was read against (array object + full JSON incl. labels); any later change
// makes it stale: Download refuses until "Re-check against current dataset" rebuilds it. Reading/downloading mutates nothing.
function hiDataSig() { try { return JSON.stringify(S.rows); } catch { return null; } }
function hiSummaryText(v, r, dt, at) {
  return buildHandoffSummary({ inspect: r, parsed: v.parsed, diff: dt, meta: { file_name: v.name, file_bytes: v.bytes, file_sha256: v.sha, app_version: S.cfg?.version ?? null, generated_at: at, dataset_rows: S.rows.length } });
}
function hiSumStale(s) { return !s || s.rows !== S.rows || s.sig === null || s.sig !== hiDataSig(); }
function hiSummaryHTML(v, r, dt) {
  if (!v.sum) { const at = new Date().toISOString(), text = hiSummaryText(v, r, dt, at); if (!text) return ""; v.sum = { text, at, rows: S.rows, sig: hiDataSig() }; }
  const stale = hiSumStale(v.sum), ann = stale && !v.sum.announced; if (stale) v.sum.announced = true;
  return `<div class="rcbrief hisumdl"><div class="row"><button type="button" class="hisdl"${stale ? " disabled" : ""}>Download handoff review summary (.md)</button>${stale ? ` <button type="button" class="hisre">Re-check against current dataset</button>` : ""} <span class="hint">${stale ? `<span class="err"${ann ? ' role="alert"' : ""}>The dataset changed since this summary was read (${esc(v.sum.at)}), so it no longer describes the current dataset. Re-check to rebuild it before downloading.</span>` : `Your reading of this file (read ${esc(v.sum.at)}): counts, and each target's claim beside what is checked now. Typed IDs, metrics and labels only; no trace text, notes or keys. Not a verification of their work. Saved to this device only.`}</span></div><details class="rcbprev"><summary>Preview the handoff review summary${stale ? " (stale)" : ""}</summary><pre class="code" id="hiSumText" tabindex="0" aria-label="Handoff review summary text"></pre></details></div>`;
}
function hiSummaryDownload() {
  const v = S.hi, s = v?.sum; if (!s) return;
  const r = inspectHandoffOutcome(S.rows, v.parsed, ocDigest), dt = handoffDiffTargets(r);
  if (!hiSumStale(s) && !r.ready) { alert("Trace fingerprints are still being computed, so nothing was downloaded yet. Try again in a moment. Nothing was changed."); return; }
  const t = !hiSumStale(s) ? hiSummaryText(v, r, dt, s.at) : null;
  if (!t || t !== s.text) { alert("The dataset changed since this summary was read, so nothing was downloaded. Use Re-check against current dataset first. Nothing was changed."); renderHandoffInspect(); $("#hiview .hisre")?.focus(); return; }
  download(`handoff-review-summary-${stamp()}.md`, t, "text/markdown");
}
function hiSummaryRecheck() { const v = S.hi; if (!v) return; v.sum = null; renderHandoffInspect(); $("#hiview .hisdl")?.focus(); }
// t_8a886e42: focused pass over EXACTLY handoffDiffTargets(...).list frozen at start: S.hi.dp = {L:[{pos,id,metric,row}],
// i, rows, tsig, saved:Set(pos)}. Navigation never labels; only a typed Save in the existing dialog (this metric only).
// Stale (dataset replaced, trace edited, row added/removed, target no longer the same unique row) refuses every step.
function hiDiffFresh(dp) {
  if (!dp || !S.hi || S.hi.dp !== dp || dp.rows !== S.rows || dp.tsig === null || hoTraceSig(S.rows) !== dp.tsig) return false;
  return dp.L.every(t => { const r = resolveItem(S.rows, { id: t.id, metric: t.metric, before: { present: false }, after: { present: false } }); return (r.status === "matched" || r.status === "drifted") && r.row === t.row; });
}
function hiDiffPassHTML(v, dt) {
  const dp = v.dp, n = dp.L.length, t = dp.L[dp.i], fresh = hiDiffFresh(dp);
  if (!fresh) return `<div class="card hidp" role="group" aria-label="Label differences pass"><p class="err hidpstale" role="alert">The dataset changed since you started this pass (a case added, removed, replaced or its trace edited). The ${n} target${n === 1 ? "" : "s"} may no longer be the cases in the file, so nothing more is opened. Go back and start again.</p><div class="row"><button type="button" class="primary hidpback">← Back to handoff outcome</button></div></div>`;
  const cur = Object.hasOwn(t.row, "human_" + t.metric) ? { present: true, value: t.row["human_" + t.metric] } : { present: false };
  const same = sameLabel(t.claimed_after, cur);
  return `<div class="card hidp distnav" role="group" aria-label="Label differences pass"><p class="hint" aria-live="polite"><b>Label difference ${dp.i + 1} of ${n}</b> · case <code>${esc(chkIdTxt(t.id))}</code> <span class="nw">row ${S.rows.indexOf(t.row) + 1}</span> · <b>${esc(M[t.metric])}</b> · target ${t.pos} in the file · their saved label <b>${lblTxt(t.claimed_after)}</b> ${same ? "=" : "≠"} label now <b>${lblTxt(cur)}</b>${dp.saved.has(t.pos) ? ` <span class="tag">saved in this pass</span>` : ""}<br>Their file is an unsigned claim: it is never applied. Opening or stepping changes nothing; only what you type and Save in the dialog changes this one label.</p>
    <div class="navgrp"><button type="button" class="primary hidpopen" aria-label="Open in label dialog: label difference ${dp.i + 1} of ${n}">Open in label dialog</button> <button type="button" class="hidpprev"${dp.i <= 0 ? " disabled" : ""} aria-label="Previous label difference">‹ Previous</button> <button type="button" class="hidpnext"${dp.i >= n - 1 ? " disabled" : ""} aria-label="Next label difference">Next ›</button> <button type="button" class="ghost hidpback">← Back to handoff outcome</button></div></div>`;
}
function hiDiffStart() {
  const v = S.hi; if (!v) return;
  const dt = handoffDiffTargets(inspectHandoffOutcome(S.rows, v.parsed, ocDigest)); if (!dt.ready || !dt.list.length) { renderHandoffInspect(); return; }
  hiCaseClose(false);
  v.dp = { L: dt.list, i: 0, rows: S.rows, tsig: hoTraceSig(S.rows), saved: new Set() };
  renderHandoffInspect(); $("#hiview .hidpopen")?.focus();
}
function hiDiffBack() {
  const v = S.hi; if (!v) return; v.dp = null; renderHandoffInspect();
  const d = $("#hiview .hidiff"), b = d && !d.disabled ? d : $("#hiview .hiclose"); if (b) { b.scrollIntoView({ block: "center" }); b.focus({ preventScroll: true }); }
}
function hiDiffStep(d) {
  const dp = S.hi?.dp; if (!dp) return;
  if (!hiDiffFresh(dp)) { renderHandoffInspect(); $("#hiview .hidpback")?.focus(); return; }
  const j = dp.i + d; if (j < 0 || j >= dp.L.length) return; dp.i = j; renderHandoffInspect();
  const b = $(d < 0 ? "#hiview .hidpprev" : "#hiview .hidpnext"); (b && !b.disabled ? b : $("#hiview .hidpopen"))?.focus();
}
function hiDiffOpen() {
  const v = S.hi, dp = v?.dp; if (!dp) return;
  if (!hiDiffFresh(dp)) { alert("The dataset changed since this pass started, so no case was opened. Go back and start again."); renderHandoffInspect(); $("#hiview .hidpback")?.focus(); return; }
  const t = dp.L[dp.i], n = dp.L.length, k = dp.i;
  const banner = `<p class="ckbanner" role="note"><b>Handoff label difference ${k + 1} of ${n}: ${esc(M[t.metric])}.</b> The other reviewer's outcome file says they saved ${lblTxt(t.claimed_after)} (target ${t.pos}); the label here is different. Their value is a claim and is not applied or copied. Only this metric can be edited; type your own 1–5 judgement and Save, or Close to change nothing.</p>`;
  openLabelPass(S.rows.indexOf(t.row), { metric: t.metric, row: t.row, banner,
    guard: () => S.hi !== v || v.dp !== dp || !hiDiffFresh(dp) ? "The dataset or handoff outcome changed while this was open; nothing was saved." : "",
    onSaved: editable => { if (editable && S.hi === v && v.dp === dp) dp.saved.add(t.pos); },
    onClose: () => { if (S.hi === v && v.dp === dp) { renderHandoffInspect(); $("#hiview .hidpopen")?.focus(); } } });
}
var HIC = null;   // { d, oc, pos, stale, proj }
function hiCaseClose(refocus = true) {
  if (!HIC) return; const { d, pos } = HIC; HIC = null; if (d.open) d.close(); d.remove();
  if (!refocus) return;
  const b = $(`#hiview .hiopen[data-t="${pos}"]`) || $("#hiview .hiclose"); if (b) { b.scrollIntoView({ block: "center" }); b.focus({ preventScroll: true }); }
}
function hiCaseRecheck() {
  if (!HIC) return; if (!S.hi) { hiCaseClose(false); return; }
  if (HIC.stale || outcomeCaseFresh(S.rows, HIC.oc)) return;
  HIC.stale = true; const d = HIC.d, s = $(".occstale", d);
  s.hidden = false; s.textContent = "The dataset changed while this was open. What is below is a snapshot from when you opened it and is NO LONGER the current case. Close and open the target again.";
  d.classList.add("stale"); $(".occnowh", d).textContent = "Snapshot when opened (no longer current)"; hiCaseTrace();
}
function hiCaseTrace() {
  if (!HIC) return; const el = $(".occtrace", HIC.d); if (!el) return;
  if (HIC.stale) { el.innerHTML = "<b>Trace fingerprint:</b> not compared — this view is no longer the current case."; return; }
  const h = ocDigest(HIC.proj);
  el.innerHTML = h === undefined ? "<b>Trace fingerprint:</b> computing…" : h === null ? `<b class="err">Trace fingerprint:</b> cannot compute in this browser.`
    : h === HIC.oc.fp ? `<b class="tr-same">Trace same as the one they reviewed</b> <span class="hint">(unsigned SHA-256 content comparison; labels excluded)</span>` : `<b class="tr-changed">Trace CHANGED since the one they reviewed</b> <span class="hint">(which field cannot be shown: the file holds only a fingerprint)</span>`;
}
function openHandoffCase(pos) {
  if (!S.hi) return; hiCaseClose(false);
  const oc = handoffOutcomeCase(S.rows, S.hi.parsed, pos);
  if (!oc.ok) { alert(`Target ${pos} cannot be opened: ${oc.reason}. No other case is opened.`); renderHandoffInspect(); return; }
  const c = oc.claimed, mn = esc(M[oc.metric]);
  const nowLbl = !oc.label_now.present ? "blank (no label)" : oc.label_state === "ok" ? esc(String(oc.label_now.value)) : `${esc(JSON.stringify(oc.label_now.value))} <span class="err">(not a valid 1–5 label)</span>`;
  const same = c.label_after ? sameLabel(c.label_after, oc.label_now) : null;
  const d = document.createElement("dialog"); d.className = "lpass occase hicase"; d.setAttribute("aria-labelledby", "hic-h");
  d.innerHTML = `<h3 id="hic-h">Current case <code>${esc(chkIdTxt(oc.id))}</code> · ${mn} <span class="tag">read-only</span></h3>
    <p class="hint ocscope">The case <b>in your current dataset</b> with this exact ID (row ${oc.idx + 1} of ${S.rows.length}). The handoff outcome file is unsigned: this is not proof of what the other reviewer did. Opening it saves, applies or sends nothing.</p>
    <p class="err occstale" role="alert" hidden></p>
    <div class="occols"><section class="occlaim"><h4>Claimed in file (their re-label pass)</h4><p>${HI_ACT[c.action]}${c.action === "saved" ? (c.label_changed ? ", changed" : ", unchanged") : ""}${c.label_before && c.label_after ? ` · ${lblTxt(c.label_before)} → ${lblTxt(c.label_after)}` : ""}${c.action_at ? ` <span class="hint nw">at ${esc(c.action_at)}</span>` : ""}</p><p class="hint">From comparison entr${oc.source_entries.length === 1 ? "y" : "ies"} ${esc(oc.source_entries.join(", "))}${c.evidence ? ` · evidence they exported: ${esc(c.evidence)}` : ""}</p></section>
    <section class="occnow"><h4 class="occnowh">Current case now</h4><p>${mn}: <b>${nowLbl}</b> · ${oc.applicable ? "applies to this trace" : `<span class="tag">n/a</span> not scored: ${esc(oc.na_reason)}`}</p>${same !== null ? `<p class="occmp"><b class="oc-${same ? "same" : "different"}">Their saved label ${lblTxt(c.label_after)} ${same ? "=" : "≠"} label now ${lblTxt(oc.label_now)}</b></p>` : `<p class="hint">No label claimed (${HI_ACT[c.action]}).</p>`}</section></div>
    <p class="occtrace" aria-live="polite"></p>
    <details open><summary>Current trace (every stored field except labels)</summary><pre class="lptrace" tabindex="0" aria-label="Current trace, read-only">${esc(JSON.stringify(oc.trace, null, 2))}</pre></details>
    <div class="row"><button type="button" class="primary occback">← Back to handoff outcome</button></div>`;
  document.body.append(d); HIC = { d, oc, pos, stale: false, proj: traceProjection(oc.row) }; hiCaseTrace();
  $(".occback", d).onclick = () => hiCaseClose(true);
  d.addEventListener("cancel", e => { e.preventDefault(); hiCaseClose(true); });
  d.showModal(); $(".occback", d).focus();
}
$("#hiview").addEventListener("click", e => {
  const o = e.target.closest(".hiopen"); if (o) { openHandoffCase(+o.dataset.t); return; }
  if (e.target.closest(".hidiff")) { hiDiffStart(); return; }
  if (e.target.closest(".hidpopen")) { hiDiffOpen(); return; }
  if (e.target.closest(".hidpprev")) { hiDiffStep(-1); return; }
  if (e.target.closest(".hidpnext")) { hiDiffStep(1); return; }
  if (e.target.closest(".hidpback")) { hiDiffBack(); return; }
  if (e.target.closest(".hisdl")) { hiSummaryDownload(); return; }
  if (e.target.closest(".hisre")) { hiSummaryRecheck(); return; }
  if (e.target.closest(".hiclose")) { hiCaseClose(false); S.hi = null; renderHandoffInspect(); } });
$("#hifile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (f.size > MAX_OUTCOME_BYTES) { alert(`That file is too large (over ${MAX_OUTCOME_BYTES / 1e6} MB). Nothing was changed.`); return; }
  let t; try { t = await f.text(); } catch { alert("Could not read that file. Nothing was changed."); return; }
  const p = parseHandoffOutcomeFile(t);
  if (!p.ok) { alert(`This is not a usable handoff-outcome file: ${p.error}. Nothing was changed.`); return; }
  let sha = null; try { sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))].map(b => b.toString(16).padStart(2, "0")).join(""); } catch { }
  hiCaseClose(false); S.hi = { name: f.name, parsed: p, bytes: f.size, sha, sum: null };
  renderHandoffInspect(); $("#hiview").scrollIntoView({ block: "start" });
};
// ---------- READ-ONLY current case behind one outcome entry. Opens only on a unique exact typed id + metric match
// re-resolved at click time; shows the CURRENT stored trace + current label/applicability for that metric next to
// the file's claim. No inputs, no save/confirm, no network. Any dataset change while open marks it no longer current.
var OCC = null;   // { d, oc, entry }
function ocCaseRecheck() {
  if (!OCC) return;
  if (!S.ocv) { ocCaseClose(false); return; }
  if (OCC.stale || outcomeCaseFresh(S.rows, OCC.oc)) return;
  OCC.stale = true; const d = OCC.d;
  $(".occstale", d).hidden = false; $(".occstale", d).textContent = "The dataset changed while this was open (this case was edited, deleted, duplicated or the dataset was replaced). What is below is a snapshot from when you opened it and is NO LONGER the current case. Close and open the entry again to see the current case.";
  d.classList.add("stale"); $(".occnowh", d).textContent = "Snapshot when opened (no longer current)"; ocCaseTrace();
}
// fingerprint line in the open case dialog: the projection is taken from the row object captured at OPEN time; a
// stale dialog says so instead of claiming a current comparison.
function ocCaseTrace() {
  if (!OCC) return; const el = $(".occtrace", OCC.d); if (!el) return;
  const fp = OCC.oc.claimed.trace_fp || { state: "absent" };
  if (fp.state === "absent") { el.innerHTML = `<b>Trace fingerprint:</b> none in the file (older export or no Save/Confirm), so it <b>cannot</b> show whether this trace is the one they reviewed.`; return; }
  if (fp.state !== "present") { el.innerHTML = `<b class="err">Trace fingerprint ${esc(fp.state)}:</b> ${esc(fp.reason || "")}. Not compared.`; return; }
  if (OCC.stale) { el.innerHTML = `<b>Trace fingerprint:</b> not compared — this view is no longer the current case.`; return; }
  const h = ocDigest(OCC.proj);
  el.innerHTML = h === undefined ? "<b>Trace fingerprint:</b> computing…" : h === null ? `<b class="err">Trace fingerprint:</b> cannot compute in this browser.`
    : h === fp.digest ? `<b class="tr-same">Trace same as at their ${esc(OC_TXT[OCC.oc.claimed.outcome])}</b> <span class="hint">(unsigned SHA-256 content comparison; labels excluded)</span>`
    : `<b class="tr-changed">Trace CHANGED since their ${esc(OC_TXT[OCC.oc.claimed.outcome])}</b>`;
  if (h) el.innerHTML += ocSnapHTML(fp, h);
}
// field-level comparison in the case dialog: only from a reviewed trace that hashes to this entry's own fingerprint,
// against the row captured when the dialog opened (a stale dialog never reaches here). Values are shown as JSON text
// (esc'd, never HTML) so null vs absent, 9 vs "9" and exact string content stay visible.
const jtxt = v => { const t = JSON.stringify(v, null, 2); return t === undefined ? String(v) : t; };
const jkind = v => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
function ocSnapHTML(fp, curHash) {
  const sn = OCC.oc.claimed.trace_snap || { state: "absent" };
  if (sn.state === "absent") return curHash === fp.digest ? "" : ` <span class="hint">— the file does not include their reviewed trace, so which field changed cannot be shown (the earlier reviewer can export with "Include reviewed trace").</span>`;
  if (sn.state !== "present") return `<br><b class="err">Included reviewed trace ${esc(sn.state)}:</b> ${esc(sn.reason || "")}. Not compared.`;
  const sh = ocDigest(sn.canon);
  if (sh === undefined) return "<br>Checking the included reviewed trace…";
  if (sh === null) return `<br><b class="err">Cannot check the included reviewed trace in this browser.</b> Not compared.`;
  if (sh !== fp.digest) return `<br><b class="err">The included reviewed trace does not match its own fingerprint</b> (edited or corrupted after export), so it is not used. Not compared.`;
  const diff = cachedDiff(sn.canon, OCC.proj);
  if (!diff.length) return `<br><span class="hint">Their included trace matches the fingerprint and no field differs from the current case.</span>`;
  return diffTableHTML(diff, OCC.oc.claimed.outcome);
}
const DF_KT = { added: "added now", removed: "removed since", changed: "changed" };
function diffTableHTML(diff, outcome) {
  const cell = (d, side) => !Object.hasOwn(d, side) ? `<i class="hint">(absent)</i>` : `<span class="tag">${jkind(d[side])}</span><pre class="dfv">${esc(jtxt(d[side]))}</pre>`;
  return `<div class="ocdiff"><p><b>What changed since their ${esc(OC_TXT[outcome] || outcome)}: ${diff.length >= DIFF_MAX ? DIFF_MAX + "+" : diff.length} field${diff.length === 1 ? "" : "s"}</b> <span class="hint">(from the trace they chose to include, verified against its fingerprint; object key order ignored, array order kept; labels excluded. Unsigned content, not reviewer identity or proof any label is right.)</span></p>
    <div class="dfwrap"><table class="agtab dftab"><thead><tr><th>Field</th><th>Change</th><th>At their action</th><th>Now</th></tr></thead><tbody>${diff.map(d => `<tr class="df-${d.kind}"><td><code>${esc(d.path)}</code></td><td>${DF_KT[d.kind]}</td><td>${cell(d, "before")}</td><td>${cell(d, "after")}</td></tr>`).join("")}</tbody></table></div></div>`;
}
// ---------- CHANGED-TRACES review mode. Built on explicit click, only once every digest is computed, and FROZEN:
// S.ocv.ct = {ct, at, rows (array identity), sig (JSON of rows), pos}. Any dataset edit/import/delete/clear makes it
// stale (nav + download refused until rebuilt). Previous/Next walk ct.queue exactly once each, never re-resolving to
// another case; "Open current case" re-resolves at click with the existing exact typed-ID rule.
function ctFresh(v) { return !!v?.ct && v.ct.rows === S.rows && JSON.stringify(S.rows) === v.ct.sig; }
function ctPanelHTML(v, live) {
  if (!v.ct) {
    if (!live.ready) return `<div class="ctpanel"><button type="button" class="ctbuild" disabled>Review changed traces</button> <span class="hint">checking fingerprints…</span></div>`;
    return `<div class="ctpanel"><button type="button" class="ctbuild">Review changed traces (${live.counts.changed})</button> <span class="hint">shows only entries whose trace changed since their Save/Confirm and steps through them one by one.</span></div>`;
  }
  const f = v.ct, c = f.ct.counts, fresh = ctFresh(v), n = f.ct.queue.length;
  const unav = Object.entries(f.ct.unavailable_by_reason).map(([k, m]) => `${m} ${esc(k)}`).join("; ");
  let h = `<div class="ctpanel on${fresh ? "" : " stale"}"><p class="ctcounts"><b>Changed traces</b> <span class="hint">(all ${c.entries_total} entries of this file vs your ${f.rowsN} rows, frozen ${esc(f.at)})</span>: <span class="nw"><b class="tr-changed">${c.changed}</b> changed</span> = <span class="nw"><b>${c.field_comparable}</b> field-comparable</span> + <span class="nw"><b>${c.hash_only}</b> hash-only (which field changed cannot be shown)</span> · <span class="nw"><b class="tr-same">${c.unchanged}</b> unchanged</span> · <span class="nw"><b>${c.unavailable}</b> not checked</span>${unav ? ` <span class="hint">(${unav})</span>` : ""}</p>`;
  const rs = ctReviewState(f.ct, f.decs);
  if (n) h += `<p class="ctrev" aria-live="polite"><b>Your decisions:</b> <span class="nw"><b>${rs.counts.accept_change}</b> accept change</span> · <span class="nw"><b>${rs.counts.needs_relabel}</b> needs re-label</span> · <span class="nw"><b class="ctremain">${rs.remaining}</b> of ${n} still to review</span>${f.carry ? ` <span class="hint">(rebuild kept ${f.carry.kept} decision${f.carry.kept === 1 ? "" : "s"} whose entry, ID, metric and both fingerprints are unchanged; dropped ${f.carry.dropped} that no longer match)</span>` : ""}<br><span class="hint">Your own call, stored only in this browser tab: not a model verdict, not verified identity, not deployment approval, and no label is changed. Opening, Previous/Next never decide.</span></p>`;
  if (!fresh) return h + `<p class="err ctstale" role="alert">The dataset changed after this view was built (a case was edited, added, deleted or the dataset replaced). These counts, diffs and your decisions are no longer current, so stepping, deciding and download are off. Rebuilding keeps only decisions whose trace bytes are exactly the same. <button type="button" class="ctbuild">Rebuild from current dataset</button></p><div class="row"><button type="button" class="ghost ctexit">Show all entries</button></div></div>`;
  if (!n) return h + `<p class="ctnone"><b>No changed traces in this file.</b> Nothing to step through.</p><div class="row"><button type="button" class="ghost ctexit">Show all entries</button></div></div>`;
  const pos = f.pos, e = f.ct.entries.find(x => x.entry === f.ct.queue[pos]);
  h += `<p class="ctpos" tabindex="-1" aria-live="polite"><b>Changed trace ${pos + 1} of ${n}</b> · entry ${e.entry} · <code>${esc(chkIdTxt(e.id))}</code> · ${esc(Object.hasOwn(M, e.metric) ? M[e.metric] : String(e.metric))}${e.row != null ? ` <span class="hint">row ${e.row + 1}</span>` : ""}</p>`;
  h += e.bucket === "field_comparable" ? diffTableHTML(e.diff, e.claimed.outcome) : `<p class="cthash"><b class="tr-changed">Trace changed</b> — hash-only: ${esc(e.reason)}, so which field changed cannot be shown.</p>`;
  h += ctDecHTML(f, e);
  h += `<div class="row ctnav"><button type="button" class="ctprev"${pos <= 0 ? " disabled" : ""}>← Previous</button><button type="button" class="primary ctnext"${pos >= n - 1 ? " disabled" : ""}>Next changed trace →</button><button type="button" class="linkish ocopen" data-e="${e.entry}">Open current case</button>${pos >= n - 1 ? ` <span class="hint">last changed trace</span>` : ""}</div>`;
  h += `<p class="ctdl"><button type="button" class="ctdlb">Download comparison + decisions (.json)</button> <span class="hint"><b class="err">Contains case text and tool data</b> (earlier and current values of every changed field, all ${n} changed entries, no truncation beyond the ${DIFF_MAX}-field per-case cap), plus your decision and note per entry (unreviewed ones marked unreviewed). Made in this browser only when you click; nothing is uploaded; no keys.</span></p>`;
  return h + `<div class="row"><button type="button" class="ghost ctexit">Show all entries</button></div></div>`;
}
const CT_DTXT = { accept_change: "Accept change", needs_relabel: "Needs re-label" };
function ctDecHTML(f, e) {
  const d = f.decs.get(ctDecisionKey(e)), ok = !!(e.fp_then && e.fp_now);
  if (!ok) return `<p class="ctdec hint">No decision possible: this entry lacks a fingerprint to bind it to.</p>`;
  const cur = d ? `<b class="ctdcur dec-${d.decision}">Your decision: ${CT_DTXT[d.decision]}${d.revised ? " (revised)" : ""}</b>${d.note ? ` · note: <q>${esc(d.note)}</q>` : ""} <span class="hint nw">at ${esc(d.decided_at)}</span>` : `<b class="ctdcur">Unreviewed</b> <span class="hint">— no decision yet</span>`;
  return `<fieldset class="ctdec"><legend>Your review of this changed trace</legend><p>${cur}</p>
    <label class="ctnotel">Note (optional, max ${CT_NOTE_MAX}) <input type="text" class="ctnote" aria-describedby="ctnoteh" maxlength="${CT_NOTE_MAX}" value="${esc(d?.note || "")}" aria-label="Note for entry ${e.entry}"></label><span class="hint" id="ctnoteh">The note is kept only when you click Accept change or Needs re-label.</span>
    <div class="row"><button type="button" class="ctacc" data-d="accept_change" aria-pressed="${d?.decision === "accept_change"}">Accept change</button><button type="button" class="ctrel" data-d="needs_relabel" aria-pressed="${d?.decision === "needs_relabel"}">Needs re-label</button>${d ? `<button type="button" class="ghost ctclr">Clear decision</button>` : ""}<button type="button" class="linkish ctnextun">Next unreviewed</button></div>
    <p class="hint">Bound to entry ${e.entry}, ID <code>${esc(chkIdTxt(e.id))}</code>, this metric, file fingerprint <code>${esc(e.fp_then.slice(0, 12))}…</code> and current <code>${esc(e.fp_now.slice(0, 12))}…</code>.</p></fieldset>`;
}
function ctDiscardOk() { return !S.ocv?.ct?.decs?.size || confirm(`This discards your ${S.ocv.ct.decs.size} changed-trace decision(s); they are not saved anywhere. Use "Download comparison + decisions" first if you need them. Continue?`); }
function ctCur(v) { return v.ct.ct.entries.find(x => x.entry === v.ct.ct.queue[v.ct.pos]); }
function ctDecideUI(decision) {
  const v = S.ocv; if (!v?.ct || !ctFresh(v)) { alert("The dataset changed after the changed-traces view was built, so no decision was recorded. Rebuild it first."); renderOutcomeView(); return false; }
  const e = ctCur(v), note = $("#ocview .ctnote")?.value ?? "";
  const r = ctDecide(v.ct.decs, e, decision, note, new Date().toISOString());
  if (!r.ok) { alert(`Not recorded: ${r.reason}.`); return false; }
  renderOutcomeView(); $(`#ocview .ctdec button[data-d="${decision}"]`)?.focus({ preventScroll: true }); return true;
}
function ctClear() {
  const v = S.ocv; if (!v?.ct || !ctFresh(v)) { renderOutcomeView(); return; }
  v.ct.decs.delete(ctDecisionKey(ctCur(v))); renderOutcomeView(); $("#ocview .ctacc")?.focus({ preventScroll: true });
}
function ctNextUnreviewed() {
  const v = S.ocv; if (!v?.ct || !ctFresh(v)) { renderOutcomeView(); return; }
  const q = v.ct.ct.queue, n = q.length, by = new Map(v.ct.ct.entries.map(x => [x.entry, x]));
  for (let i = 1; i <= n; i++) { const p = (v.ct.pos + i) % n; if (!v.ct.decs.has(ctDecisionKey(by.get(q[p])))) { v.ct.pos = p; renderOutcomeView(); $("#ocview .ctpos")?.focus({ preventScroll: true }); return; } }
  alert("Every changed trace has a decision. Nothing left to review.");
}
function ctBuild() {
  const v = S.ocv; if (!v) return;
  const live = changedTraces(inspectOutcome(S.rows, v.parsed, ocDigest));
  if (!live.ready) { renderOutcomeView(); return; }
  const prev = v.ct?.decs, carry = prev && prev.size ? ctCarry(prev, live) : null;
  v.ct = { ct: live, at: new Date().toISOString(), rows: S.rows, rowsN: S.rows.length, sig: JSON.stringify(S.rows), pos: 0, decs: carry ? carry.decs : new Map(), carry: carry ? { kept: carry.kept, dropped: carry.dropped } : null };
  renderOutcomeView(); $("#ocview .ctpanel")?.scrollIntoView({ block: "start" }); ($("#ocview .ctnext:not([disabled])") || $("#ocview .ctpanel button"))?.focus({ preventScroll: true });
}
function ctStep(d) {
  const v = S.ocv; if (!v?.ct || !ctFresh(v)) { renderOutcomeView(); return; }
  const p = v.ct.pos + d; if (p < 0 || p >= v.ct.ct.queue.length) return;
  v.ct.pos = p; renderOutcomeView();
  const f = $(d > 0 ? "#ocview .ctnext:not([disabled])" : "#ocview .ctprev:not([disabled])") || $(d > 0 ? "#ocview .ctprev:not([disabled])" : "#ocview .ctnext:not([disabled])") || $("#ocview .ctpos");
  f?.focus({ preventScroll: true });
}
function ctDownload() {
  const v = S.ocv; if (!v?.ct || !ctFresh(v)) { alert("The dataset changed after the changed-traces view was built, so nothing was downloaded. Rebuild it first."); renderOutcomeView(); return false; }
  const rep = changedTracesReport(v.ct.ct, { version: S.cfg?.version ?? null, at: new Date().toISOString(), frozenAt: v.ct.at, file: v.name, datasetRows: v.ct.rowsN }, v.ct.decs);
  download(`changed-traces-comparison-${stamp()}.json`, JSON.stringify(rep, null, 2)); return true;
}
function ocCaseClose(refocus = true) {
  if (!OCC) return; const { d, entry } = OCC; OCC = null; if (d.open) d.close(); d.remove();
  if (!refocus) return;
  const b = $(`#ocview .ocopen[data-e="${entry}"]`) || $(`#ocview li[data-e="${entry}"]`) || $("#ocview .occlose");
  if (b) { if (!b.matches("button")) b.tabIndex = -1; b.scrollIntoView({ block: "center" }); b.focus({ preventScroll: true }); }
}
function openOutcomeCase(entry) {
  if (!S.ocv) return; ocCaseClose(false);
  const oc = outcomeCase(S.rows, S.ocv.parsed, entry);
  if (!oc.ok) { alert(`Entry ${entry} cannot be opened: ${oc.reason}. No other case is opened.`); renderOutcomeView(); const li = $(`#ocview li[data-e="${entry}"]`); if (li) { li.tabIndex = -1; li.focus(); } return; }
  const c = oc.claimed, mn = esc(M[oc.metric]);
  const nowLbl = !oc.label_now.present ? "blank (no label)" : oc.label_state === "ok" ? esc(String(oc.label_now.value)) : `${esc(JSON.stringify(oc.label_now.value))} <span class="err">(not a valid 1–5 label)</span>`;
  const d = document.createElement("dialog"); d.className = "lpass occase"; d.setAttribute("aria-labelledby", "occ-h");
  d.innerHTML = `<h3 id="occ-h">Current case <code>${esc(chkIdTxt(oc.id))}</code> · ${mn} <span class="tag">read-only</span></h3>
    <p class="hint ocscope">This is the case <b>in your current dataset</b> that has this exact ID (row ${oc.idx + 1} of ${S.rows.length}). The outcome file is unsigned, so this is <b>not</b> proof of who the earlier reviewer is; the fingerprint line only compares content. Opening it is not a review: nothing is saved, confirmed, applied or sent.</p>
    <p class="err occstale" role="alert" hidden></p>
    <div class="occols"><section class="occlaim"><h4>Claimed in file (at their export)</h4><p>${esc(OC_TXT[c.outcome])}${c.outcome_label ? ` · label ${lblTxt(c.outcome_label)}` : ""}${c.outcome_at ? ` <span class="hint nw">at ${esc(c.outcome_at)}</span>` : ""}</p><p class="hint">File change: ${lblTxt(oc.before)} → ${lblTxt(oc.after)} · at their export: ${CHK_ST[c.status_at_export]}${c.label_at_export ? `, label ${lblTxt(c.label_at_export)}` : ""}</p></section>
    <section class="occnow"><h4 class="occnowh">Current case now</h4><p>${mn}: <b>${nowLbl}</b> · ${oc.applicable ? "applies to this trace" : `<span class="tag">n/a</span> not scored: ${esc(oc.na_reason)}`}</p><p class="hint">Now ${CHK_ST[oc.status]}</p>${c.outcome_label ? `<p class="occmp"><b class="oc-${sameLabel(c.outcome_label, oc.label_now) ? "same" : "different"}">Claimed label ${lblTxt(c.outcome_label)} ${sameLabel(c.outcome_label, oc.label_now) ? "=" : "≠"} label now ${lblTxt(oc.label_now)}</b></p>` : ""}</section></div>
    <p class="occtrace" aria-live="polite"></p>
    <details open><summary>Current trace (request, conversation, answer, tools, context and every other stored field except labels)</summary><pre class="lptrace" tabindex="0" aria-label="Current trace, read-only">${esc(JSON.stringify(oc.trace, null, 2))}</pre></details>
    <div class="row"><button type="button" class="primary occback">← Back to outcome entry</button></div>`;
  document.body.append(d); OCC = { d, oc, entry, stale: false, proj: traceProjection(oc.row) }; ocCaseTrace();
  $(".occback", d).onclick = () => ocCaseClose(true);
  d.addEventListener("cancel", e => { e.preventDefault(); ocCaseClose(true); });
  d.showModal(); $(".occback", d).focus();
}
function sameLabel(a, b) { return !!a && !!b && a.present === b.present && (!a.present || JSON.stringify(a.value) === JSON.stringify(b.value)); }
$("#ocview").addEventListener("click", e => {
  const o = e.target.closest(".ocopen"); if (o) { openOutcomeCase(+o.dataset.e); return; }
  if (e.target.closest(".ctbuild")) { ctBuild(); return; }
  if (e.target.closest(".ctnext")) { ctStep(1); return; }
  if (e.target.closest(".ctprev")) { ctStep(-1); return; }
  if (e.target.closest(".ctdlb")) { ctDownload(); return; }
  const dd = e.target.closest(".ctdec button[data-d]"); if (dd) { ctDecideUI(dd.dataset.d); return; }
  if (e.target.closest(".ctclr")) { ctClear(); return; }
  if (e.target.closest(".ctnextun")) { ctNextUnreviewed(); return; }
  if (e.target.closest(".ctexit")) { if (!ctDiscardOk()) return; S.ocv.ct = null; renderOutcomeView(); return; }
  if (e.target.closest(".occlose")) { if (!ctDiscardOk()) return; S.ocv = null; renderOutcomeView(); } });
$("#ocfile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (!ctDiscardOk()) return;
  if (f.size > MAX_OUTCOME_BYTES) { alert(`That file is too large to be a checklist outcome (over ${MAX_OUTCOME_BYTES / 1e6} MB). Nothing was changed.`); return; }
  let t; try { t = await f.text(); } catch { alert("Could not read that file. Nothing was changed."); return; }
  const p = parseOutcomeFile(t);
  if (!p.ok) { alert(`This is not a usable checklist-outcome file: ${p.error}. Nothing was changed.`); return; }
  ocCaseClose(false); S.ocv = { name: f.name, parsed: p };
  renderOutcomeView(); $("#ocview").scrollIntoView({ block: "start" });
};
$("#coverage").addEventListener("click", e => {
  const mo = e.target.closest(".covmore"); if (mo) { const m = mo.dataset.m; S.covAll.has(m) ? S.covAll.delete(m) : S.covAll.add(m); renderCoverage(); return; }
  const qs = e.target.closest(".qstart"); if (qs) { qMove(qs.dataset.m, -1); return; }
  if (e.target.closest(".lpdl")) { downloadChanges(); return; }
  if (e.target.closest(".lpundo")) { const at = undoLastSave(); const tr = at >= 0 && revealRow(at); if (tr) tr.classList.add("flash"); return; }
  if (e.target.closest(".lpstart")) { const n = nextCaseNeeding(S.rows, -1); if (n) openLabelPass(n.idx); return; }
  const b = e.target.closest(".covgo"); if (!b) return;
  gotoLabel(+b.dataset.idx, b.dataset.m);
});
$("#dtable tbody").addEventListener("input", e => {
  const tr = e.target.closest("tr"); if (!tr) return; const i = +tr.dataset.i;
  if (e.target.classList.contains("lab")) {
    const raw = e.target.value.trim(), k = "human_" + e.target.dataset.m, prev = S.rows[i][k];
    if (raw !== "" && !/^[1-5]$/.test(raw)) { e.target.setAttribute("aria-invalid", "true"); return; }  // whole 1-5 or blank only
    e.target.removeAttribute("aria-invalid");
    if (raw === "") delete S.rows[i][k]; else S.rows[i][k] = +raw;
    if (S.rows[i][k] !== prev) { noteEdited(null, S.rows[i].id); renderCoverage(); }
  }
});
$("#dtable tbody").addEventListener("click", e => {
  const tr = e.target.closest("tr"); if (!tr) return; const i = +tr.dataset.i;
  if (e.target.classList.contains("rs")) { e.target.checked ? S.selected.add(i) : S.selected.delete(i); tr.classList.toggle("sel", e.target.checked); renderSel(); }
  if (e.target.classList.contains("del")) { S.editedSinceRun.delete(String(S.rows[i].id)); S.rows.splice(i, 1); renderRunNote(); S.selected.clear(); renderData(); }
  if (e.target.classList.contains("edit")) editRow(i);
  if (e.target.classList.contains("fedit")) openCaseForm(i);
  if (e.target.classList.contains("flabel")) openLabelPass(i);
  if (e.target.classList.contains("fvar")) openVariant(i);
});
// While a search is active, select-all ticks/unticks only the rows shown; hidden rows keep their selection state.
$("#selall").onchange = e => {
  const vis = $$("#dtable tbody tr").filter(t => !t.hidden).map(t => +t.dataset.i), all = vis.length === S.rows.length;
  if (all) S.selected = new Set(e.target.checked ? S.rows.map((_, i) => i) : []);
  else for (const i of vis) e.target.checked ? S.selected.add(i) : S.selected.delete(i);
  renderData();
};
function editRow(i, why) {
  const orig = S.rows[i], origJSON = JSON.stringify(orig);
  const d = document.createElement("dialog");
  d.innerHTML = `<h3>Edit row ${esc(orig.id)}</h3>${why ? `<p class="hint"><b>JSON only:</b> ${esc(why)}</p>` : ""}<p class="hint">Foundry agent format: <code>query</code> (messages), <code>response</code> (messages incl. tool_call / tool_result), optional <code>tool_definitions</code>, <code>context</code>, <code>human_*</code> labels.</p>
    <textarea spellcheck="false"></textarea><div class="row"><button class="primary sv">Save</button><button class="cn">Cancel</button><span class="hint er"></span></div>`;
  document.body.append(d); $("textarea", d).value = JSON.stringify(orig, null, 2); d.addEventListener("close", () => d.remove()); d.showModal();
  $(".cn", d).onclick = () => d.remove();
  $(".sv", d).onclick = () => {
    const at = S.rows.indexOf(orig);
    if (at < 0 || JSON.stringify(S.rows[at]) !== origJSON) { $(".er", d).textContent = "This row was changed, removed or the dataset was replaced while the editor was open; nothing was saved."; return; }
    try { const nr = JSON.parse($("textarea", d).value); const ch = JSON.stringify(nr) !== origJSON; S.rows[at] = nr; if (ch) noteEdited(orig?.id, nr?.id); d.remove(); renderData(); renderRunNote(); } catch (e) { $(".er", d).textContent = e.message; }
  };
}
// ---------- one-row all-metric label pass ("Review this case labels"). A dialog over ONE row object of S.rows:
// exact case ID + the original trace (read-only JSON of the stored fields), every metric's current human label or
// blank, n/a with the judge's actual reason. Saves ONLY the labels the user typed, only after re-checking that the
// row is still the same object with the same content. Moves to another case only on an explicit button.
function openLabelPass(i, ck) {
  const orig = S.rows[i]; if (!orig) return;
  if (ck && orig !== ck.row) return;   // checklist item must still be this exact row object
  if (typeof orig !== "object" || Array.isArray(orig)) { editRow(i, "this row is not a JSON object, so labels cannot be set on it; fix it here."); return; }
  const origJSON = JSON.stringify(orig), c = caseLabels(orig);
  const trace = Object.fromEntries(Object.entries(orig).filter(([k]) => !k.startsWith("human_")));   // every stored field except the labels below
  const d = document.createElement("dialog"); d.className = "lpass";
  const cell = m => {
    const x = c[m];
    if (!x.applicable) return `<div class="lpm na" data-m="${m}"><b>${M[m]}</b> <span class="tag">n/a</span><div class="hint">Not scored: ${esc(x.reason)}.${x.state !== "none" ? ` Existing label ${esc(JSON.stringify(x.value))} is kept, not used.` : ""}</div></div>`;
    if (x.state === "invalid") return `<div class="lpm bad" data-m="${m}"><b>${M[m]}</b> <span class="err">invalid label ${esc(JSON.stringify(x.value))}</span><div class="hint">Must be a whole number 1–5.${ck && m !== ck.metric ? " Not part of this checklist entry." : ` <button type="button" class="linkish lpjson" data-m="${m}">Fix in JSON editor</button>`}</div></div>`;
    const ro = ck && m !== ck.metric;
    return `<label class="lpm${ck ? (ro ? " ckro" : " ckon") : ""}" data-m="${m}"><b>${M[m]}</b> <span class="hint">${x.state === "ok" ? `current ${x.value}` : "no label yet"}</span><input type="text" inputmode="numeric" maxlength="1" data-m="${m}" value="${x.state === "ok" ? x.value : ""}" placeholder="–" aria-describedby="lpe-${m} lpkeys"${ro ? ' readonly tabindex="-1" title="Not part of this checklist entry"' : ""}><span class="err" id="lpe-${m}"></span></label>`;
  };
  const need = casesNeedingLabels(S.rows), pos = need.findIndex(e => e.idx === i);
  d.innerHTML = `<h3>Review labels for case <code>${esc(orig.id ?? "(no id) row " + (i + 1))}</code></h3>
    <p class="hint">Row ${i + 1} of ${S.rows.length} · ${need.length} case${need.length === 1 ? " still needs" : "s still need"} at least one applicable label${pos >= 0 ? ` (this is ${pos + 1} of ${need.length})` : " (this case is complete)"}. Type your own 1–5 judgement per metric; blank = unlabelled. Only what you type is saved; nothing is guessed, copied from a model or from a source case, or sent.</p>
    <p class="hint lpkeys" id="lpkeys"><kbd>1</kbd>–<kbd>5</kbd> in a label box sets (replaces) it and moves to the next metric · <kbd>Enter</kbd> in a label box = Save &amp; next · <kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> move · <kbd>Esc</kbd> closes without saving. Nothing is saved until you press Enter or a Save button.</p>
    ${ck?.banner ? ck.banner : ck ? `<p class="ckbanner" role="note"><b>Checklist entry: ${esc(M[ck.metric])}.</b> The file says this label went ${lblTxt(ck.before)} → ${lblTxt(ck.after)} in an earlier session; now it is ${lblTxt(Object.hasOwn(orig, "human_" + ck.metric) ? { present: true, value: orig["human_" + ck.metric] } : { present: false })}. That is shown for comparison only and is not applied. Only this metric can be edited here; Save keeps whatever you type (or leave it as is and Close).</p>` : ""}
    <div class="lpdprog">${progressHTML()}</div>
    <details open><summary>Original case (every stored field except labels, read-only)</summary><pre class="lptrace">${esc(JSON.stringify(trace, null, 2))}</pre></details>
    <form novalidate><div class="lpgrid">${METRICS.map(cell).join("")}</div>
    <div class="row"><button type="submit" class="primary lpsave">Save labels</button><button type="button" class="lpnext"${ck ? " hidden" : ""} title="Save what you typed, then open the next case still needing a label">Save &amp; next case needing labels →</button><button type="button" class="ghost lpskip"${ck ? " hidden" : ""}>Skip to next case →</button><button type="button" class="lpclose">Close</button><span class="err lpmsg" role="alert"></span></div></form>`;
  document.body.append(d);
  const close = () => { d.close(); d.remove(); ck?.onClose?.(); };
  const fresh = () => { const at = S.rows.indexOf(orig); return at >= 0 && JSON.stringify(S.rows[at]) === origJSON ? at : -1; };
  const STALE = "This case was changed, removed or the dataset was replaced while this was open; nothing was saved. Close and reopen it.";
  const save = () => {
    const at = fresh(); if (at < 0) { $(".lpmsg", d).textContent = STALE; return -2; }
    if (ck?.guard) { const g = ck.guard(); if (g) { $(".lpmsg", d).textContent = g; return -2; } }
    const vals = Object.fromEntries($$("input[data-m]", d).filter(x => !x.readOnly).map(x => [x.dataset.m, x.value]));
    const p = planCaseLabels(orig, vals);
    $$(".lpm .err", d).forEach(x => x.textContent = ""); $$("[aria-invalid]", d).forEach(x => x.removeAttribute("aria-invalid"));
    if (!p.ok) { for (const [m, v] of Object.entries(p.errors)) { $("#lpe-" + m, d).textContent = v; $(`input[data-m="${m}"]`, d).setAttribute("aria-invalid", "true"); } $(".lpmsg", d).textContent = "Fix the highlighted labels; nothing was saved."; $(`input[aria-invalid]`, d)?.focus(); return -2; }
    const ch = Object.entries(p.changes), prevLab = ck?.metric && Object.hasOwn(orig, "human_" + ck.metric) ? { present: true, value: orig["human_" + ck.metric] } : { present: false };
    if (ch.length) {
      const rec = captureSave(orig); if (!S.lpBase.has(orig)) S.lpBase.set(orig, labelSig(orig));
      for (const [m, v] of ch) { if (v == null) delete orig["human_" + m]; else orig["human_" + m] = v; }
      const sealed = sealSave(rec); if (sealed) { S.lastSave = sealed; S.undoMsg = ""; }
      noteEdited(null, orig.id); renderData();
    }
    // typed Save = explicit outcome, only when the entry's own metric had an editable box (not n/a / invalid)
    if (ck?.onSaved) ck.onSaved(Object.hasOwn(vals, ck.metric), Object.hasOwn(p.changes, ck.metric), prevLab);
    else if (ck && ck.chk === S.chk) { if (Object.hasOwn(vals, ck.metric)) { chkRecord(ck.chk, ck.k, "saved", orig, ck.metric, Object.hasOwn(p.changes, ck.metric)); renderChecklist(); } else $(".lpmsg", d).textContent = "This checklist entry's metric could not be edited here, so no checklist outcome was recorded."; }
    return at;
  };
  const openNext = from => {
    const n = nextCaseNeeding(S.rows, from);
    if (n && S.rows[n.idx] === orig) { close(); openLabelPass(n.idx); const m = $("dialog.lpass[open] .lpmsg"); if (m) m.textContent = "No other case needs a label; this is the only one left."; return; }
    close(); if (n) openLabelPass(n.idx); else { const el = $("#coverage"); el?.scrollIntoView({ block: "start" }); } };
  $("form", d).addEventListener("input", e => { e.target.removeAttribute("aria-invalid"); const er = e.target.nextElementSibling; if (er) er.textContent = ""; $(".lpmsg", d).textContent = ""; });
  $("form", d).onsubmit = e => { e.preventDefault(); const at = save(); if (at >= 0) { close(); if (ck?.onClose) return; const tr = revealRow(at); if (tr) { tr.classList.add("flash"); tr.scrollIntoView({ block: "center" }); } } };
  let busy = false;   // one Save & next per dialog: repeated Enter / double click cannot submit twice
  $(".lpnext", d).onclick = () => { if (busy) return; busy = true; let at = -2; try { at = save(); if (at >= 0) openNext(at); } finally { if (at < 0) busy = false; } };
  // Keep the focused label box clear of the sticky action bar (small screens), however focus got there.
  $("form", d).addEventListener("focusin", e => { if (!e.target.matches?.("input[data-m]")) return;
    const bar = $("form>.row", d).getBoundingClientRect(), r = e.target.getBoundingClientRect(), top = d.getBoundingClientRect().top;
    if (r.bottom > bar.top - 8) d.scrollTop += r.bottom - bar.top + 16; else if (r.top < top + 8) d.scrollTop -= top - r.top + 16; });
  // Keyboard flow, scoped to this dialog's label inputs only (never the trace, JSON editor or page controls).
  $("form", d).addEventListener("keydown", e => {
    const t = e.target; if (!(t instanceof HTMLInputElement) || !t.matches("input[data-m]")) return;
    const a = labelKeyAction(e); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    if (t.readOnly && a !== "save_next") return;   // checklist: other metrics are view-only
    if (a === "swallow") return;
    if (a === "save_next") { if (ck) $("form", d).requestSubmit(); else $(".lpnext", d).click(); return; }
    t.value = a.set; t.dispatchEvent(new Event("input", { bubbles: true }));
    const all = $$("input[data-m]", d).filter(x => !x.readOnly), nx = all[all.indexOf(t) + 1];
    if (nx) { nx.focus(); nx.select(); } else (ck ? $(".lpsave", d) : $(".lpnext", d)).focus();
  });
  $(".lpskip", d).onclick = () => { const at = S.rows.indexOf(orig); openNext(at >= 0 ? at : i - 1); };
  d.addEventListener("click", e => { if (e.target.closest(".lpdl")) { downloadChanges(); return; } if (!e.target.closest(".lpundo")) return;
    if (ck?.onClose) { $(".lpmsg", d).textContent = "Undo is off inside the handoff label-differences pass (it could revert a label on another case). Close, then use Undo from the Dataset step."; return; }
    if ($$("input[data-m]", d).some(x => x.value !== x.defaultValue) && !confirm("Undo the last save and discard what you typed in this case?")) return;
    const at = undoLastSave(); close();
    if (at >= 0) { openLabelPass(at); const m = $("dialog.lpass[open] .lpmsg"); if (m) m.textContent = S.undoMsg; }
    else if (S.rows.indexOf(orig) >= 0) { openLabelPass(S.rows.indexOf(orig)); const m = $("dialog.lpass[open] .lpmsg"); if (m) m.textContent = S.undoMsg; }
    else $("#coverage")?.scrollIntoView({ block: "start" }); });
  $(".lpclose", d).onclick = close; d.addEventListener("cancel", e => { e.preventDefault(); close(); });
  $$(".lpjson", d).forEach(b => b.onclick = () => { const at = fresh(); if (at < 0) { $(".lpmsg", d).textContent = STALE; return; } close(); editRow(at, `the ${M[b.dataset.m]} label ${JSON.stringify(orig["human_" + b.dataset.m])} is not a whole number 1–5; fix or remove human_${b.dataset.m}.`); });
  d.showModal(); ((ck && $(`input[data-m="${ck.metric}"]:not([readonly])`, d)) || (!ck && $("input[data-m]", d)) || $(".lpclose", d)).focus();
}
// ---------- guided Add / Edit case (same form; no JSON, no network; never touches runs/selection)
// mode "add" appends one row; mode "edit" replaces ONE simple text row in place (rich traces stay JSON-only).
function openCaseForm(editIdx, V) {
  const variant = !!V;
  const editing = editIdx != null && !variant;
  const orig = editing || variant ? S.rows[editIdx] : null;           // object identity = which row this form edits
  const origJSON = editing ? JSON.stringify(orig) : null;   // content at open time (stale-write guard)
  if (editing) { const el = CaseForm.editEligibility(orig); if (!el.ok) { editRow(editIdx, el.reason); return; } }
  const d = document.createElement("dialog"); d.className = "caseform";
  const lab = m => `<label class="clab">${M[m]}<input type="text" inputmode="numeric" maxlength="1" data-m="${m}" placeholder="–" aria-describedby="e-label_${m}"><span class="err" id="e-label_${m}"></span></label>`;
  const hadRun = S.runRows.length > 0;
  d.innerHTML = `<h3>${variant ? `Create variant of <code>${esc(orig.id)}</code>` : editing ? `Edit case <code>${esc(orig.id)}</code>` : "Add a case"}</h3>
    <p class="hint">${variant ? V.intro : editing
      ? `Change the text or labels, then Save. Only this row in this tab's dataset changes; its other fields${orig.source ? ` (incl. provenance <span class="tag">${esc(orig.source)}</span>)` : ""} are kept. Cancel changes nothing.${hadRun ? ` <b>Your last run is not changed:</b> its scores and the trace it judged stay frozen and inspectable. Run again to score the edited text.` : ""}`
      : `Type one real example you want judged. It is added to this tab's dataset only (not uploaded or saved on the server) and marked <span class="tag">user-authored</span>. No tool calls, context or labels are added for you; for traces with tool calls, use Upload or the ✎ JSON editor.`}</p>
    <form novalidate>
    <label for="cf-id"><b>Case ID</b> <span class="hint">a short unique name${editing ? "" : "; you can change the suggestion"}</span></label>
    <input id="cf-id" aria-describedby="e-id" name="id" autocomplete="off" spellcheck="false"><span class="err" id="e-id"></span>
    <label for="cf-req"><b>User request</b> <span class="hint">what the user asked the agent, exactly</span></label>
    <textarea id="cf-req" aria-describedby="e-request" name="request" rows="3"></textarea><span class="err" id="e-request"></span>
    <label for="cf-ans"><b>Assistant answer</b> <span class="hint">the agent's final reply you want judged</span></label>
    <textarea id="cf-ans" aria-describedby="e-answer" name="answer" rows="4"></textarea><span class="err" id="e-answer"></span>
    <label for="cf-ctx"><b>Grounding context</b> <span class="hint">optional · source text the answer should be based on. Leave blank if none; Groundedness is then not scored</span></label>
    <textarea id="cf-ctx" aria-describedby="e-context" name="context" rows="3"></textarea><span class="err" id="e-context"></span>
    <b>Your labels</b> <span class="hint">optional · 1 (poor) to 5 (excellent) per metric. Blank = unlabelled, excluded from agreement. Tool Call Accuracy is not scored for a case without tools.</span>
    <div class="clabs">${Object.keys(M).map(lab).join("")}</div>
    <div class="row"><button type="submit" class="primary" id="cf-add">${variant ? "Add variant" : editing ? "Save changes" : "Add case"}</button><button type="button" id="cf-cancel">Cancel</button>${editing ? `<button type="button" class="ghost" id="cf-json" title="Open the raw JSON editor for this row">Edit JSON instead</button>` : ""}<span class="err" id="cf-msg" role="alert"></span></div>
    </form>`;
  document.body.append(d);
  if (editing || variant) {
    const f = CaseForm.formFromRow(orig);
    $("#cf-id", d).value = variant ? CaseForm.suggestVariantId(orig.id, S.rows.map(r => r.id)) : f.id; $("#cf-req", d).value = f.request; $("#cf-ans", d).value = f.answer; $("#cf-ctx", d).value = f.context;
    $$(".clabs input", d).forEach(i => i.value = variant ? "" : f.labels[i.dataset.m]);   // variant labels start blank
  } else $("#cf-id", d).value = CaseForm.suggestId(S.rows.map(r => r.id));
  const close = () => { d.close(); d.remove(); };
  // editing a field clears its (now stale) error; everything is re-validated on submit
  $("form", d).addEventListener("input", e => { const er = e.target.nextElementSibling; if (er?.classList.contains("err")) er.textContent = ""; e.target.removeAttribute("aria-invalid"); $("#cf-msg", d).textContent = ""; });
  $("#cf-cancel", d).onclick = close; d.addEventListener("cancel", e => { e.preventDefault(); close(); });
  if (editing) $("#cf-json", d).onclick = () => { close(); const j = S.rows.indexOf(orig); if (j >= 0) editRow(j); };
  $("form", d).onsubmit = e => {
    e.preventDefault();
    const nothing = editing ? "nothing was saved" : "nothing was added";
    if (variant && V.fresh() < 0) { $("#cf-msg", d).textContent = V.stale; return; }
    const labels = Object.fromEntries($$(".clabs input", d).map(i => [i.dataset.m, i.value]));
    const form = { id: $("#cf-id", d).value, request: $("#cf-req", d).value, answer: $("#cf-ans", d).value, context: $("#cf-ctx", d).value, labels };
    let r, at = -1;
    if (editing) {
      // stale guard: the row must still be in the CURRENT dataset and unchanged since the form opened
      at = S.rows.indexOf(orig);
      if (at < 0 || JSON.stringify(S.rows[at]) !== origJSON) {
        $("#cf-msg", d).textContent = `This row was changed, removed or the dataset was replaced while the form was open; ${nothing}. Cancel and reopen it.`;
        return;
      }
      r = CaseForm.applyEdit(orig, form, S.rows.filter((_, j) => j !== at).map(x => x.id));
    } else if (variant) r = CaseForm.buildVariant(orig, form, S.rows.map(x => x.id));
    else r = CaseForm.buildCase(form, S.rows.map(x => x.id));
    $$(".err", d).forEach(x => x.textContent = ""); $$("[aria-invalid]", d).forEach(x => x.removeAttribute("aria-invalid"));
    if (!r.ok) {
      for (const [k, v] of Object.entries(r.errors)) { const el = $("#e-" + k, d); if (el) { el.textContent = v; el.previousElementSibling?.setAttribute("aria-invalid", "true"); } }
      $("#cf-msg", d).textContent = r.errors.form ? `${r.errors.form} ${nothing}.` : `Fix the highlighted fields; ${nothing}.`;
      const first = { id: "#cf-id", request: "#cf-req", answer: "#cf-ans", context: "#cf-ctx" }[Object.keys(r.errors)[0]];
      (first ? $(first, d) : $(`.clabs input[data-m="${Object.keys(r.errors)[0].slice(6)}"]`, d))?.focus();
      return;
    }
    if (variant) { if (!V.insert(r.row)) { $("#cf-msg", d).textContent = V.stale; return; } close(); return; }
    if (editing) {
      if (r.changed) { S.rows[at] = r.row; noteEdited(orig.id, r.row.id); }
    } else { S.rows.push(r.row); at = S.rows.length - 1; }
    close(); renderData(); renderRunNote();
    const tr = revealRow(at); if (tr) { tr.classList.add("flash"); tr.scrollIntoView({ block: "center" }); }
  };
  d.showModal(); $(editing || variant ? "#cf-ans" : "#cf-req", d).focus();
}
function addCase() { openCaseForm(null); }
// record that a row changed after the last run started (the frozen run snapshot is taken when a run starts)
function noteEdited(oldId, newId) {
  if (!S.runRows.length) return;
  if (oldId != null && String(oldId) !== String(newId)) S.editedSinceRun.delete(String(oldId));
  if (newId != null && String(newId) !== "") S.editedSinceRun.add(String(newId));
  renderRunNote();
}
// dataset edited after the last run: the run stays frozen; tell the user a rerun is needed to score changes
function renderRunNote() {
  const n = S.editedSinceRun.size, show = n > 0 && S.runRows.length > 0;
  for (const id of ["#staleData", "#staleDash"]) {
    const el = $(id); if (!el) continue; el.hidden = !show;
    if (show) el.innerHTML = `<b>${n} case${n > 1 ? "s" : ""} edited or added after the last run</b> (${[...S.editedSinceRun].map(x => `<code>${esc(x)}</code>`).join(", ")}). The dashboard still shows that run's frozen inputs and scores, unchanged. Run again to score the edited text (a new run replaces this one on screen; export its results first if you want to keep them).`;
  }
}
$("#addCase").onclick = addCase;
// ---------- Create variant: adds ONE new derivative row right after its source; the source row is never changed.
// Simple text sources use the same guided form; rich tool / multi-turn sources use the JSON editor (never flattened).
function openVariant(i) {
  const src = S.rows[i], srcJSON = JSON.stringify(src);
  const ids = () => S.rows.map(r => r.id);
  const labs = CaseForm.sourceLabels(src), labTxt = Object.entries(labs).map(([m, v]) => `${SHORT[m]} ${v}`).join(", ");
  const hadRun = S.runRows.length > 0;
  const intro = `Makes a <b>new</b> case from <code>${esc(src.id)}</code> so you can change the answer and judge both side by side. <code>${esc(src.id)}</code> itself is not changed. The copy is marked <span class="tag">user-authored</span> <span class="tag var">variant of ${esc(src.id)}</span> — it is your edit, not another observed agent run.`
    + ` <b>Labels start blank:</b> ${labTxt ? `the source's labels (${esc(labTxt)}) describe the source answer, not your edited one, so they are not copied.` : "the source has no labels."} Add your own for the new answer if you want agreement stats.`
    + `${hadRun ? " Your last run is not changed; run again to score the variant." : ""} Nothing is scored until you press Run.`;
  // stale guard: source must still be in the CURRENT dataset and unchanged since the dialog opened
  const fresh = () => { const at = S.rows.indexOf(src); return at >= 0 && JSON.stringify(S.rows[at]) === srcJSON ? at : -1; };
  const stale = "The source case was changed, removed or the dataset was replaced while this was open; nothing was added. Cancel and start again.";
  const insert = (row) => {
    const at = fresh(); if (at < 0) return false;
    S.rows.splice(at + 1, 0, row);
    S.selected = new Set([...S.selected].map(j => j > at ? j + 1 : j));
    noteEdited(null, row.id); renderData(); renderRunNote();
    const tr = revealRow(at + 1); if (tr) { tr.classList.add("flash"); tr.scrollIntoView({ block: "center" }); }
    return true;
  };
  const el = CaseForm.editEligibility(src);
  if (!el.ok) {  // rich trace: full JSON draft, deep copy of every turn/tool/unknown field
    const draft = CaseForm.draftVariant(src, ids());
    const d = document.createElement("dialog"); d.className = "variant";
    d.innerHTML = `<h3>Create variant of <code>${esc(src.id)}</code></h3><p class="hint">${intro}</p><p class="hint"><b>JSON only:</b> ${esc(el.reason)} Every turn, tool call and field is copied exactly; edit what you want to contrast (e.g. the final assistant text).</p>
      <textarea spellcheck="false"></textarea><div class="row"><button class="primary sv">Add variant</button><button class="cn">Cancel</button><span class="hint er err" role="alert"></span></div>`;
    document.body.append(d); $("textarea", d).value = JSON.stringify(draft, null, 2);
    const close = () => { d.close(); d.remove(); };
    $(".cn", d).onclick = close; d.addEventListener("cancel", e => { e.preventDefault(); close(); });
    $(".sv", d).onclick = () => {
      if (fresh() < 0) { $(".er", d).textContent = stale; return; }
      let obj; try { obj = JSON.parse($("textarea", d).value); } catch (e) { $(".er", d).textContent = e.message + " Nothing was added."; return; }
      const v = CaseForm.validateVariantJSON(src, obj, ids());
      if (!v.ok) { $(".er", d).textContent = v.error + (/nothing was changed/.test(v.error) ? "" : " Nothing was added."); return; }
      if (insert(v.row)) close(); else $(".er", d).textContent = stale;
    };
    d.showModal(); return;
  }
  openCaseForm(i, { variant: true, src, intro, fresh, stale, insert });
}
$("#loadSample").onclick = () => {
  const s = S.samples.find(x => x.name === $("#sample").value); if (!s) return;
  const have = new Set(S.rows.map(r => r.id));
  S.rows.push(...structuredClone(s.rows).filter(r => !have.has(r.id))); renderData();
};
// read-only preview of the exact selected sample (t_59b45262): no calls, no rows added until Add scenario
function renderSamplePreview() {
  const s = S.samples.find(x => x.name === $("#sample").value), box = $("#sprev");
  if (!s) { box.hidden = true; return; }
  const v = samplePreview(s, S.rows, { applicable, labelState, METRICS, userText, finalText });
  box.hidden = false;
  const add = v.already ? (v.will_add ? `Add scenario inserts ${v.will_add} new; ${v.already} already in your dataset are skipped by id.` : `All ${v.count} are already in your dataset; Add scenario inserts nothing.`) : `Add scenario inserts all ${v.count}; your dataset is unchanged until then.`;
  $("#sprevsum").innerHTML = `What's in <b>${esc(v.name.replace(/_/g, " "))}</b>: ${v.count} cases <span class="tag">synthetic, authored</span><span class="sprevadd">${esc(add)}</span>`;
  const per = METRICS.map(m => { const x = v.metrics[m]; return `<tr><th scope="row">${esc(M[m])}</th><td>${x.applicable} of ${v.count}${x.not_applicable ? ` <span class="hint">(${x.not_applicable} n/a)</span>` : ""}</td><td>${x.applicable ? `${x.labelled} of ${x.applicable}` : '<span class="hint">n/a</span>'}</td></tr>`; }).join("");
  $("#sprevbody").innerHTML = `<p class="hint">Fictional company, written for this demo: not customer traces and not model results. The numbers below describe this scenario only, not your current dataset. Previewing sends nothing to Jev.</p>`
    + (v.rep ? `<p class="sprevh">Example case <b>${esc(v.rep.id)}</b>${v.rep.note ? ` <span class="hint">author's note on this case: ${esc(v.rep.note)}</span>` : ""}</p>
    <dl class="sprevex"><dt>Request</dt><dd>${esc(v.rep.request) || '<span class="hint">none</span>'}</dd><dt>Answer</dt><dd>${esc(v.rep.answer) || '<span class="hint">tool calls only, no text</span>'}</dd></dl>` : "")
    + `<div class="twrap"><table class="sprevm"><thead><tr><th scope="col">Metric</th><th scope="col">Applies to</th><th scope="col">Cases with author's 1–5 label</th></tr></thead><tbody>${per}</tbody></table></div>`;
}
$("#sample").onchange = renderSamplePreview;
$("#clearBtn").onclick = () => { if (confirm("Clear the dataset and results?")) { S.rows = []; S.results = []; S.runRows = []; S.runCfg = null; S.summary = null; S.selected.clear(); S.editedSinceRun = new Set(); S.lpBase = new Map(); S.lastSave = null; S.undoMsg = ""; S.queue = null; S.chk = null; S.ocv = null; S.ho = null; S.hi = null; S.imp = null; S.runPos = null; S.slowPrep = null; S.disPrep = null; S.failPrep = null; S.prepNotice = null; S.rfp = null; S.rfx = null; S.covAll.clear(); renderData(); renderDash(); renderRunNote(); } };

function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...body] = rows.filter(r => r.some(x => x !== ""));
  return body.map(r => Object.fromEntries(h.map((k, i) => [k.trim(), r[i]])));
}
function normalize(o, n) {
  const r = { id: o.id || `row-${Date.now().toString(36)}-${n}`, scenario: o.scenario || "uploaded" };
  const tryJ = v => { if (typeof v !== "string") return v; const t = v.trim(); if (t.startsWith("[") || t.startsWith("{")) { try { return JSON.parse(t); } catch { } } return v; };
  r.query = tryJ(o.query ?? o.input ?? o.question ?? o.messages ?? "");
  r.response = tryJ(o.response ?? o.output ?? o.answer ?? "");
  for (const k of ["tool_definitions", "tool_calls", "context"]) if (o[k] != null && o[k] !== "") r[k] = tryJ(o[k]); else if (o[k] === null) r[k] = null;  // explicit JSON null kept (CSV blanks are "", dropped)
  // form-authored context is free text typed by a person: keep it verbatim even if it looks like JSON
  if (o.source === "user-authored" && typeof o.context === "string" && o.context !== "") r.context = o.context;
  // OpenAI chat trace: {messages:[...]} -> split at last user turn
  if (Array.isArray(r.query) && !o.response && !o.output) {
    const idx = r.query.map(m => m.role).lastIndexOf("user");
    if (idx >= 0 && idx < r.query.length - 1) { r.response = r.query.slice(idx + 1); r.query = r.query.slice(0, idx + 1); }
  }
  if (Array.isArray(r.response)) r.response = r.response.map(m => {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      return { role: "assistant", content: [...(m.content ? [{ type: "text", text: m.content }] : []), ...m.tool_calls.map(t => ({ type: "tool_call", tool_call_id: t.id, name: t.function?.name, arguments: tryJ(t.function?.arguments) }))] };
    }
    if (m.role === "tool" && typeof m.content === "string") return { role: "tool", tool_call_id: m.tool_call_id, content: [{ type: "tool_result", tool_result: tryJ(m.content) }] };
    return m;
  });
  for (const m of Object.keys(M)) { const v = o["human_" + m] ?? o[m + "_label"]; if (v !== undefined && v !== "" && v !== null) r["human_" + m] = +v; else if (o["human_" + m] === null) r["human_" + m] = null; }  // unrecorded label stays null, never 0
  if (o.note) r.note = o.note;
  // keep every other field verbatim (trace metadata, generated flag, custom columns); aliases already mapped above are not duplicated
  const used = new Set(["id", "scenario", "query", "input", "question", "messages", "response", "output", "answer", "tool_definitions", "tool_calls", "context", "note", "source", "derived_from",
    ...Object.keys(M).flatMap(m => ["human_" + m, m + "_label"])]);
  for (const [k, v] of Object.entries(o)) if (!used.has(k) && !(k in r) && v !== "" && v !== undefined) r[k] = k === "generated" && typeof v === "string" ? v.trim().toLowerCase() === "true" : v;  // CSV blank cells are not fields
  if (o.source === "user-authored") r.source = o.source;  // keep provenance of form-authored rows on re-import
  // variant provenance (object in JSONL, JSON text in CSV)
  if (o.source === "user-authored" && o.derived_from != null && o.derived_from !== "") {
    const df = tryJ(o.derived_from);
    r.derived_from = df && typeof df === "object" && !Array.isArray(df) && df.id != null ? df : { id: String(o.derived_from) };
  }
  return r;
}
// Upload -> preview -> explicit Apply/Cancel (t_f136e25a). S.imp = {p (parsed, rows already normalized)} or {err}.
// Only Apply touches S.rows (same push the old one-click upload did); Cancel / a bad file change nothing. No calls.
$("#upload").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  $("#impdone").textContent = "";
  const tok = S.impSeq = (S.impSeq || 0) + 1;  // a slower earlier read must not overwrite a later pick
  let t; try { t = await f.text(); } catch { if (tok === S.impSeq) { S.imp = { err: "the file could not be read", name: f.name }; renderImport(); } return; }
  if (tok !== S.impSeq) return;
  const p = parseImport(f.name, t, { parseCSV, normalize });
  S.imp = p.ok ? { p } : { err: p.error, name: f.name, format: p.format }; renderImport();
  $("#imprev").scrollIntoView({ block: "nearest" }); $("#imprev").focus();
};
function renderImport() {
  const el = $("#imprev"), im = S.imp; if (!el) return;
  if (!im) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  if (im.err) { el.innerHTML = `<p role="alert"><b class="err">Could not import ${esc(im.name)}${im.format ? ` (${esc(im.format)})` : ""}:</b> ${esc(im.err)}.</p><p class="hint">Nothing was added or changed. Your ${S.rows.length} current row${S.rows.length === 1 ? "" : "s"}, unsaved edits and any completed run are as they were.</p><div class="row"><button type="button" class="ghost impx">Dismiss</button></div>`; return; }
  const v = previewImport(im.p, S.rows, { applicable, labelState, METRICS });
  const per = METRICS.map(m => { const x = v.metrics[m]; return `<tr><th scope="row">${esc(M[m])}</th><td>${x.applicable} of ${v.incoming}${x.not_applicable ? ` <span class="hint nw">(${x.not_applicable} n/a)</span>` : ""}</td><td>${x.applicable ? `${x.labelled} of ${x.applicable}` : '<span class="hint">n/a</span>'}${x.invalid ? ` <span class="err nw">(${x.invalid} invalid label${x.invalid === 1 ? "" : "s"})</span>` : ""}</td></tr>`; }).join("");
  const warn = [
    v.no_id ? `${v.no_id} case${v.no_id === 1 ? " has" : "s have"} no usable id (missing, empty, 0 or null) and will get a generated <code>row-…</code> id, as uploads always have (file row${v.no_id === 1 ? "" : "s"} ${esc(im.p.no_id_rows.slice(0, 12).join(", "))}${v.no_id > 12 ? "…" : ""}).` : "",
    v.odd_id ? `${v.odd_id} case id${v.odd_id === 1 ? " is" : "s are"} not text or a number; kept exactly as in the file.` : "",
    v.clash_ids.length ? `${v.clash_ids.length} incoming id${v.clash_ids.length === 1 ? " is" : "s are"} already in your dataset (${esc(v.clash_ids.slice(0, 8).join(", "))}${v.clash_ids.length > 8 ? "…" : ""}); both copies would be kept, and label tools refuse ambiguous ids until you edit or delete one.` : "",
    v.dup_in_file ? `${v.dup_in_file} cases in the file share an id with another case in the file.` : "",
  ].filter(Boolean).map(w => `<li>${w}</li>`).join("");
  el.innerHTML = `<p><b>Import preview: ${esc(v.file)}</b> <span class="tag">${esc(v.format)}</span></p>
    <p><b>${v.incoming} case${v.incoming === 1 ? "" : "s"}</b> in the file. <b>Apply adds</b> them ${v.current ? `after your ${v.current} current row${v.current === 1 ? "" : "s"} (${v.after} total)` : `to your empty dataset (${v.after} total)`}; nothing is replaced or merged. <span class="hint">${v.user_authored ? `${v.user_authored} marked user-authored · ` : ""}${v.generated ? `${v.generated} marked generated · ` : ""}unknown fields are kept as they are. Nothing is sent to Jev until you press Run.</span></p>
    ${warn ? `<ul class="impwarn">${warn}</ul>` : ""}
    <div class="twrap"><table class="sprevm"><thead><tr><th scope="col">Metric</th><th scope="col">Applies to</th><th scope="col">Cases with a 1–5 label</th></tr></thead><tbody>${per}</tbody></table></div>
    ${impInspectHTML(im)}
    <div class="row"><button type="button" class="primary impok">Apply: add ${v.incoming} case${v.incoming === 1 ? "" : "s"}</button> <button type="button" class="ghost impx">Cancel</button></div>`;
}
// Incoming-case inspector (t_8407aab1): one pending row at a time, the SAME object Apply pushes (im.p.rows[pos]).
// Read-only inert text (esc), no edit/normalize/merge/call. Previous/Next only move the view.
const IMP_STATE = { absent: "not in this case", null: "null (explicit)", empty: "empty" };
function impVal(d, label, key, opens) {
  const open = !!opens?.has(key);
  if (d.state in IMP_STATE) return `<dt>${label}</dt><dd><span class="hint">${IMP_STATE[d.state]}${d.text ? ` <code>${esc(d.text)}</code>` : ""}</span></dd>`;
  const kind = d.state === "text" ? "" : d.state === "json_array" ? `JSON list, ${d.items} item${d.items === 1 ? "" : "s"}` : d.state === "json_object" ? "JSON object" : esc(d.state);
  const meta = [kind, d.long ? `${d.chars.toLocaleString()} characters` : ""].filter(Boolean).join(" · ");
  return `<dt>${label}</dt><dd>${meta ? `<span class="hint">${meta}</span>` : ""}<pre class="impval${d.long && !open ? " clip" : ""}" tabindex="0">${esc(d.text)}</pre>${d.long ? `<button type="button" class="ghost impexp" data-k="${key}" aria-label="${open ? "Show less" : "Show all"} of ${label}" aria-expanded="${open ? "true" : "false"}">${open ? "Show less" : "Show all"}</button>` : ""}</dd>`;
}
function impInspectHTML(im) {
  const x = inspectPending(im.p.rows, im.pos || 0); if (!x) return "";
  const pv = x.provenance, gen = im.p.no_id_rows.includes(x.pos + 1);
  const prov = [pv.source ? `<span class="tag">${esc(pv.source)}</span>` : "", pv.generated ? `<span class="tag">generated</span>` : "", pv.derived_from != null ? `<span class="tag var">variant of ${esc(pv.derived_from)}</span>` : ""].join(" ").trim();
  const opens = im.open instanceof Set ? im.open : new Set();
  return `<section class="impins" aria-label="Incoming cases">
    <div class="impnav"><b>Incoming case <span id="imppos" aria-live="polite">${x.pos + 1} of ${x.total}</span></b>${x.total > 1 ? ` <span class="row"><button type="button" class="ghost impprev"${x.pos ? "" : " disabled"}>← Previous</button> <button type="button" class="ghost impnext"${x.pos < x.total - 1 ? "" : " disabled"}>Next →</button></span>` : ""}</div>
    <dl class="impcase">
      <dt>id</dt><dd><code>${esc(x.id)}</code> <span class="hint">${esc(x.id_type)}${gen ? " · generated here (no usable id in file)" : ""}</span></dd>
      <dt>Provenance</dt><dd>${prov || '<span class="hint">not recorded in the file</span>'}<span class="hint"> · scenario ${pv.scenario == null ? "<i>none recorded</i>" : pv.scenario === "" ? "<i>empty</i>" : esc(pv.scenario)}${pv.note ? ` · note: ${esc(pv.note)}` : ""}</span></dd>
      ${impVal(x.request, "Request", "query", opens)}${impVal(x.answer, "Answer", "response", opens)}
      ${x.rich.map(d => impVal(d, d.key === "context" ? "Context" : d.key === "tool_definitions" ? "Tool definitions" : "Tool calls", d.key, opens)).join("")}
      ${x.other_fields.length ? `<dt>Other fields</dt><dd><span class="hint">kept as in the file: ${esc(x.other_fields.join(", "))}</span></dd>` : ""}
    </dl><p class="hint">Read-only: this is exactly what Apply adds for this case. Nothing is edited here.${x.total > 1 ? " Left/Right arrow keys on Previous/Next move between cases." : ""}</p></section>`;
}
function impMove(d) {
  if (!S.imp?.p) return; const n = S.imp.p.rows.length, to = Math.min(n - 1, Math.max(0, (S.imp.pos || 0) + d));
  if (to === (S.imp.pos || 0)) return; S.imp.pos = to; renderImport();
  const b = $(d < 0 ? "#imprev .impprev" : "#imprev .impnext"); (b && !b.disabled ? b : $(d < 0 ? "#imprev .impnext" : "#imprev .impprev"))?.focus();
}
$("#imprev").addEventListener("keydown", e => {
  if (!S.imp?.p || !e.target.closest(".impins") || e.target.closest("pre")) return;
  if (e.key === "ArrowLeft" && e.target.closest(".impnav")) { e.preventDefault(); impMove(-1); } else if (e.key === "ArrowRight" && e.target.closest(".impnav")) { e.preventDefault(); impMove(1); }
});
$("#imprev").onclick = e => {
  if (e.target.closest(".impprev")) return impMove(-1);
  if (e.target.closest(".impnext")) return impMove(1);
  const ex = e.target.closest(".impexp"); if (ex && S.imp?.p) { const k = ex.dataset.k; if (!(S.imp.open instanceof Set)) S.imp.open = new Set(); S.imp.open.has(k) ? S.imp.open.delete(k) : S.imp.open.add(k); renderImport(); $(`#imprev .impexp[data-k="${k}"]`)?.focus(); return; }
  if (e.target.closest(".impx")) { S.imp = null; renderImport(); $("#upload").parentElement.focus(); return; }
  if (e.target.closest(".impok") && S.imp?.p) { const rows = S.imp.p.rows; S.imp = null; S.rows.push(...rows); renderData(); renderImport();
    $("#impdone").textContent = `Added ${rows.length} case${rows.length === 1 ? "" : "s"}; the dataset now has ${S.rows.length}.`; $("#upload").parentElement.focus(); }
};
$("#genBtn").onclick = () => { $("#genmenu").hidden = !$("#genmenu").hidden; };
$("#genGo").onclick = async () => {
  const src = S.selected.size ? [...S.selected].map(i => S.rows[i]) : S.rows.filter(r => !r.generated).slice(0, 5);
  if (!src.length) return alert("Add or select rows first");
  const kinds = $$("#genkinds input:checked").map(x => x.value);
  const r = await api("/api/generate", { body: { rows: src, kinds } });
  const have = new Set(S.rows.map(x => x.id));
  S.rows.push(...r.rows.filter(x => !have.has(x.id))); $("#genmenu").hidden = true; renderData();
};

// ---------- first-journey guidance (navigation only: never runs, never labels, never stores anything)
function renderDataNext() {
  const n = S.rows.length, el = $("#dataNext"); if (!el) return;
  el.hidden = !n;
  $("#dataNextNote").textContent = n ? `${n} row${n === 1 ? "" : "s"} ready. The Run step shows the estimated calls; nothing runs until you press Run there.${S.key ? "" : " Connect your Jev key on step 1 first."}` : "";
}
$("#goRun").onclick = () => go("run");
// File pickers are <label class="btn"> around a hidden <input type=file>; make them reachable and operable by keyboard.
for (const l of $$("label.btn")) { const i = l.querySelector('input[type="file"]'); if (!i) continue;
  l.tabIndex = 0; l.setAttribute("role", "button");
  l.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); i.click(); } }); }
// Advanced review: the four file-review views live outside the <details>, so the disclosure only hides the pickers.
// The indicator is read from the views' real visibility, so it is exactly as true as what the page shows.
const ADV_VIEWS = [["#chklist", "label-changes checklist"], ["#ocview", "checklist outcome"], ["#hoview", "re-label from comparison"], ["#hiview", "handoff outcome"]];
function renderAdvActive() {
  const on = ADV_VIEWS.filter(([id]) => { const e = $(id); return e && !e.hidden; }).map(([, t]) => t), el = $("#advActive"); if (!el) return;
  el.hidden = !on.length; el.textContent = on.length ? `● ${on.length} open above the table: ${on.join(", ")}` : "";
}
{ const mo = new MutationObserver(renderAdvActive); for (const [id] of ADV_VIEWS) { const e = $(id); if (e) mo.observe(e, { attributes: true, attributeFilter: ["hidden"] }); } renderAdvActive(); }

// ---------- run
function renderRun() {
  const rn = $("#runNext"), rc = S.cfg ? curRun() : { n: S.rows.length, mode: "all" }, rw = `${rc.n}${rc.mode === "selected" ? " selected" : ""} row${rc.n === 1 ? "" : "s"}`;
  if (rn) rn.innerHTML = !S.rows.length ? `<b>No rows yet.</b> <button type="button" class="linkish" data-go="data">Go to Dataset</button> and add a scenario, a case or an upload.`
    : !S.key ? `<b>${rw} ready, no Jev key connected.</b> <button type="button" class="linkish" data-go="key">Connect your key</button> first; it stays in this tab's memory only.`
    : S.summary ? `<b>${rw} ready.</b> <span class="hint">A previous run's results are on the <button type="button" class="linkish" data-go="dash">Dashboard</button>. Pressing Run again makes new live Jev calls on your key (see the estimate below) and replaces them.</span>`
    : `<b>Next: press Run on ${rw}.</b> <span class="hint">Nothing has run yet in this tab. Live Jev calls go on your key (estimate below); results open on the Dashboard.</span>`;
  const pn = S.prepNotice;
  if (pn && (pn.rows !== S.rows || pn.sel !== selectionSummary({ rows: S.rows, selected: S.selected }).positions.join(",") || runMode() !== "selected" || S.running)) S.prepNotice = null;
  if (rn && S.prepNotice) { const m = `Prepared ${pn.n} ${pn.kind === "disagreement" ? "disagreement" : pn.kind === "decrease" ? "recorded-decrease" : pn.kind === "increase" ? "recorded-increase" : pn.kind === "failed" ? "failed" : pn.kind === "searched" ? "searched" : pn.kind === "compare-search" ? "found" : "slow"} case${pn.n === 1 ? "" : "s"} from ${pn.kind === "compare-search" ? "a search in Compare with recorded run" : pn.kind === "decrease" || pn.kind === "increase" ? "Compare with recorded run" : pn.kind === "searched" ? "Search this run" : "the Dashboard"}. Review and press Run when ready.`; rn.insertAdjacentHTML("beforeend", ` <span class="ok prepdone" id="prepNotice" role="status" data-msg="${esc(m)}">${esc(m)}</span>`); }
  renderRunScope();
}
$("#runNext")?.addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });
$("#runBtn").onclick = async () => {
  if (!S.key) { go("key"); return; }
  if (!S.rows.length) { go("data"); return; }
  // preflight: refuse a zero-metric run before touching results, snapshot or network
  const sc0 = curScope();
  if (!sc0.ok || !sc0.run.ok) { renderRunScope(); $("#runScope").scrollIntoView({ block: "nearest" }); return; }
  const rr = sc0.run;
  const metrics = S.cfg.metrics.filter(m => selMetrics().includes(m));
  const baseline = sc0.baseline;
  const foundry = S.cfg.foundry?.enabled && $("#useFoundry").checked && rr.n <= S.cfg.foundry.max_rows;
  S.studio_url = null; $("#studioRow").hidden = true; $("#studioLink").hidden = true;
  // frozen snapshot of exactly what is sent; results[i] <-> runRows[i] (position, never id)
  $("#detail").hidden = true;
  S.runRows = structuredClone(rr.rows); S.runPos = rr.positions.slice(); S.slowPrep = null; S.disPrep = null; S.failPrep = null; S.prepNotice = null; S.editedSinceRun = new Set(); renderRunNote(); renderCoverage();
  // configuration actually used for this run (recorded, not re-read later); no key, endpoint or credential
  S.runCfg = { metrics: [...metrics], baseline_requested: baseline, foundry_logging_requested: !!foundry, max_rows_per_request: S.cfg.max_rows_per_request ?? null, jev_usd_per_mtok_input: S.cfg.jev_usd_per_mtok_input ?? null, baseline_usd_per_mtok_in: S.cfg.baseline?.usd_per_mtok_in ?? null, baseline_usd_per_mtok_out: S.cfg.baseline?.usd_per_mtok_out ?? null, threshold_at_start: +$("#threshold").value, cases: rr.mode, dataset_rows_at_start: rr.total };
  const B = S.cfg.max_rows_per_request; const batches = [];
  for (let i = 0; i < S.runRows.length; i += B) batches.push(S.runRows.slice(i, i + B));
  S.running = true; for (const x of $$("#metricOpts input")) x.disabled = true; $("#runBtn").disabled = true; $("#log").textContent = ""; S.results = []; S.summary = null; let done = 0;
  const t0 = performance.now();
  log(`Running ${rr.mode === "selected" ? `${rr.n} selected of ${rr.total}` : S.runRows.length} rows · metrics: ${metrics.map(m => SHORT[m]).join(", ")} · baseline: ${baseline ? "on" : "off"}`);
  try {
    if (foundry) {
      log(`Calling azure.ai.evaluation.evaluate() → Foundry project "${S.cfg.foundry.project}" (one run, all rows)…`);
      let r = null;
      try { r = await api("/api/foundry-run", { key: true, body: { rows: S.runRows, metrics, baseline } }); }
      catch (e) { if (/key/i.test(e.message)) throw e; log(`Foundry logging failed (${e.message}); running directly instead.`); }
      if (r) {
      if (r.baseline_note) log("note: " + r.baseline_note);
      for (const x of r.results) { S.results.push(x); const j = x.jev_meta; log(`${x.id}: ${x.error ? x.error : metrics.map(m => `${SHORT[m]} ${x.jev[m] ?? "n/a"}`).join(" · ")}${j ? ` · ${fmtMs(j.latency_ms)} · ${j.input_tokens} tok` : ""}`); }
      $("#prog").style.width = "100%";
      S.studio_url = r.studio_url;
      if (S.studio_url) { log("Logged to Foundry: " + S.studio_url); for (const id of ["#studioLink", "#studioLink2"]) $(id).href = S.studio_url; $("#studioRow").hidden = false; }
      batches.length = 0;
      }
    }
    for (const b of batches) {
      const r = await api("/api/judge", { key: true, body: { rows: b, metrics, baseline } });
      if (r.baseline_note) log("note: " + r.baseline_note);
      for (const x of r.results) {
        S.results.push(x); done++;
        const j = x.jev_meta; log(`${x.id}: ${x.error ? x.error : metrics.map(m => `${SHORT[m]} ${x.jev[m] ?? "n/a"}`).join(" · ")}${j ? ` · ${fmtMs(j.latency_ms)} · ${j.input_tokens} tok` : ""}`);
      }
      $("#prog").style.width = (100 * done / S.runRows.length) + "%";
    }
    log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s wall clock.`);
    window.jevTrack?.("eval_run", { n: S.results.length, kind: S.studio_url ? "foundry" : "judge" });
    S.summary = await api("/api/summary", { body: { results: S.results, threshold: +$("#threshold").value } });
    S.summary.wall_s = (performance.now() - t0) / 1000; S.summary.version = S.cfg.version; S.summary.at = new Date().toISOString();
    S.summary.scope = rr.mode === "selected"
      ? (metrics.length === S.cfg.metrics.length ? `selected cases (${rr.n} of ${rr.total} rows, all metrics)` : `selected cases (${rr.n} of ${rr.total} rows; metrics: ${metrics.map(m => SHORT[m]).join(", ")})`)
      : metrics.length === S.cfg.metrics.length ? "full run (all rows, all metrics; not filtered)" : `full run (all rows; metrics: ${metrics.map(m => SHORT[m]).join(", ")}; not filtered)`;
    S.summary.baseline_label = baseline ? S.cfg.baseline.label : null;
    $('[data-step="run"]').classList.add("done"); renderDash(); setTimeout(() => go("dash"), 500);
  } catch (e) { log("ERROR: " + e.message); }
  finally { S.running = false; for (const x of $$("#metricOpts input")) x.disabled = false; renderRunScope(); }
};
// Pre-run scope: read from the SAME checked inputs and the FULL S.rows the Run button uses (search filter ignored).
// Pure projection (run_scope.js + the judge's own applicability rule); no call is made to update it.
const selMetrics = () => $$("#metricOpts input:checked").map(x => x.value);
// Run cases (t_7936c995): "all" is the default; "selected" is an explicit opt-in over the SAME S.selected the Dataset
// step uses. One projection (run_subset.js) feeds the preflight, the button label and what Run freezes and sends.
const runMode = () => $("#rsSel")?.checked ? "selected" : "all";
function curRun() { return runRowsFor({ rows: S.rows, selected: S.selected, shown: S.findShown ?? null, mode: runMode() }); }
function curScope() { const rr = curRun(); return { ...runScope(rr.rows, selMetrics(), { all: S.cfg.metrics, applicable, baseline: !$("#useBaseline").disabled && $("#useBaseline").checked }), run: rr }; }
function renderRunScope() {
  const el = $("#runScope"); if (!el || !S.cfg) return;
  renderGuide();
  const sc = curScope(), n = sc.rows;
  const rr = sc.run, noSel = rr.mode === "selected" && rr.reason === "none_selected";
  $("#runN").textContent = rr.n; $("#runWhat").textContent = rr.mode === "selected" ? " selected" : "";
  el.classList.toggle("refuse", sc.reason === "no_metrics" || noSel);
  $("#runBtn").disabled = S.running || sc.reason === "no_metrics" || noSel;
  if (noSel) { el.innerHTML = `<b class="err">No cases selected.</b> You chose Selected cases only, but no case is ticked. Tick cases on the <button type="button" class="linkish" data-go="data">Dataset</button> step, or choose All cases. Nothing was sent, and Run does not fall back to all ${rr.total} cases${S.summary ? "; your previous results stay on the Dashboard" : ""}.`; $("#runEst").textContent = ""; return; }
  if (!n) { el.innerHTML = ""; $("#runEst").textContent = "Add rows first."; return; }
  if (!sc.ok) { el.innerHTML = `<b class="err">No metric selected.</b> Tick at least one metric above to run. Nothing was sent and nothing was changed${S.summary ? "; your previous results stay on the Dashboard" : ""}.`; $("#runEst").textContent = ""; return; }
  const names = sc.all_selected ? `all ${sc.metrics.length} metrics` : `${sc.metrics.length} of ${S.cfg.metrics.length} metrics`;
  if (S.naOpen && !sc.metrics.some(x => x.metric === S.naOpen && x.not_applicable)) S.naOpen = null;
  const li = sc.metrics.map(x => `<li>${esc(M[x.metric])}: <b>${x.applicable}</b> row${x.applicable === 1 ? "" : "s"} scored${x.not_applicable ? ` · <span class="tag">n/a</span> <button type="button" class="linkish natog" data-m="${esc(x.metric)}" aria-expanded="${S.naOpen === x.metric}"${S.naOpen === x.metric ? ' aria-controls="naList"' : ""} title="List the cases ${esc(M[x.metric])} will not score, and why">${x.not_applicable} not applicable</button>` : ""}</li>${S.naOpen === x.metric ? naListHTML(x.metric) : ""}`).join("");
  const bl = $("#useBaseline").disabled ? "not available on this host" : sc.baseline ? `on: ${esc(S.cfg.baseline.label)}, not billed to your key, applicable rows only` : "off";
  // compare like with like: a Selected-cases run against the current selected rows, an All-cases run against S.rows
  const ref = S.runCfg?.cases === "selected" ? runRowsFor({ rows: S.rows, selected: S.selected, mode: "selected" }).rows : S.rows;
  const rerun = S.summary && !S.running && (S.editedSinceRun.size || JSON.stringify(ref) !== JSON.stringify(S.runRows)) ? `<p class="hint narerun" role="note"><b>${S.runCfg?.cases === "selected" ? "Cases or selection changed since the last run." : "Dataset edited since the last run."}</b> These counts are for the current rows; the completed run on the Dashboard is unchanged until you press Run again.</p>` : "";
  const idTxt = v => typeof v === "string" ? esc(v) : esc(JSON.stringify(v ?? null)) + ` <span class="hint">(not text)</span>`;
  const who = rr.mode === "selected"
    ? `<b>${n}</b> selected case${n === 1 ? "" : "s"} of ${rr.total} in dataset${rr.search ? ` · ${rr.shown} shown by search` : ""}`
    : `all <b>${n}</b> dataset row${n === 1 ? "" : "s"}${$("#dfind")?.value.trim() ? " (the Dataset search does not filter the run)" : ""}${S.selected.size ? ` <span class="hint">(${S.selected.size} ticked on the Dataset step are not a filter unless you choose Selected cases only)</span>` : ""}`;
  const extra = rr.mode !== "selected" ? "" : (rr.hidden_selected ? `<span class="selwarn">⚠ ${rr.hidden_selected} selected case${rr.hidden_selected === 1 ? " is" : "s are"} hidden by the search and will be run.</span>` : "") + `<span class="rsids">IDs in run order: ${rr.ids.map(v => `<code>${idTxt(v)}</code>`).join(", ")}</span>`;
  el.innerHTML = rerun + `<b>This run:</b> ${who} · ${names} · LLM judge ${bl}${extra}<ul>${li}</ul>`;
  $("#runEst").textContent = `≈ ${sc.jev_calls} Jev call${sc.jev_calls === 1 ? "" : "s"} (one per row with at least one applicable metric${sc.rows_no_call ? `; ${sc.rows_no_call} row${sc.rows_no_call === 1 ? "" : "s"} need no call` : ""}). Estimated Jev cost ≈ ${fmt$(sc.jev_calls * 1500 * S.cfg.jev_usd_per_mtok_input / 1e6)} on your key (estimate).`;
}
// ---------- n/a drilldown: which current rows a selected metric will NOT score, and why. Same applicability rule
// (label_coverage.applicable) and reason text (caseLabels) as the counts; all rows, search ignored. Read-only: no
// call, no fill; "Open case" opens the EXISTING form / JSON editor for that exact row, re-resolved at click time.
function naListHTML(m) {
  const rr = curRun();
  S.naList = naCases(rr.rows, m, { applicable, reasonOf: (r, mm) => caseLabels(r)[mm].reason, formOk: r => CaseForm.editEligibility(r).ok }).map(e => ({ ...e, idx: rr.positions[e.idx] }));
  const idTxt = e => e.has_id ? (typeof e.id === "string" ? esc(e.id) : esc(JSON.stringify(e.id)) + ` <span class="hint">(not text)</span>`) : `<i>(no id)</i>`;
  const items = S.naList.map((e, k) => `<li><code>${idTxt(e)}</code> <span class="hint">row ${e.idx + 1}</span>${e.dup ? ` <span class="tag warn">duplicate id</span>` : ""} · ${esc(e.reason)} <button type="button" class="ghost naopen" data-k="${k}" aria-label="Open case ${e.has_id ? esc(String(e.id)) : "row " + (e.idx + 1)} in the ${e.open === "form" ? "Edit form" : "JSON editor"}">Open case (${e.open === "form" ? "Edit" : "JSON"})</button></li>`).join("");
  return `<li class="nawrap"><div id="naList" class="nalist" role="region" aria-label="${esc(M[m])} not applicable cases"><p class="hint">${S.naList.length} case${S.naList.length === 1 ? "" : "s"} ${esc(M[m])} will not score (reported n/a, not a low score). ${S.naList.length === 1 ? "It stays" : "They stay"} in the run. Add the missing ${m === "groundedness" ? "context or tool result" : "tool call or tool list"} yourself to have ${S.naList.length === 1 ? "it" : "them"} scored; nothing is filled in for you.</p><ul>${items}</ul><button type="button" class="ghost naclose">Close list</button> <span class="hint namsg" role="status"></span></div></li>`;
}
function naFocusBack(m) { const b = m && $(`#runScope .natog[data-m="${CSS.escape(m)}"]`); if (b) { b.focus(); b.scrollIntoView({ block: "nearest" }); } }
function naWatch(m) {             // when the opened editor dialog goes away, refresh prospective counts and return focus
  const d = [...document.querySelectorAll("dialog[open]")].pop(); if (!d) return;
  const ob = new MutationObserver(() => { if (d.isConnected && d.open) return; ob.disconnect();
    if (document.querySelector("dialog[open]")) { naWatch(m); return; }       // handed on (e.g. form -> JSON)
    go("run"); renderRunScope(); naFocusBack(m); });
  ob.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
}
$("#runScope").addEventListener("click", e => {
  const t = e.target.closest(".natog"); if (t) { S.naOpen = S.naOpen === t.dataset.m ? null : t.dataset.m; renderRunScope(); naFocusBack(t.dataset.m); return; }
  if (e.target.closest(".naclose")) { const m = S.naOpen; S.naOpen = null; renderRunScope(); naFocusBack(m); return; }
  const o = e.target.closest(".naopen"); if (!o) return;
  const en = S.naList?.[+o.dataset.k], m = S.naOpen; if (!en) return;
  if (S.running) { const g = $("#runScope .namsg"); if (g) g.textContent = "Not opened: a run is in progress. Wait for it to finish; nothing was changed."; return; }
  const r = resolveNa(S.rows, en);
  if (!r.ok) { renderRunScope(); const g = $("#runScope .namsg"); if (g) g.textContent = `Not opened: ${r.reason}. The list is refreshed; nothing was changed.`; naFocusBack(m); return; }
  if (en.open === "form") openCaseForm(r.idx); else editRow(r.idx);
  naWatch(m);
});
$("#runScope").addEventListener("keydown", e => { if (e.key === "Escape" && S.naOpen) { e.preventDefault(); const m = S.naOpen; S.naOpen = null; renderRunScope(); naFocusBack(m); } });
// ---------- "What these metrics check": selected metrics only, canonical order, from /api/config (evaluators.SPECS +
// LEVELS_5) and the same applicability rule as the counts. Read-only projection: no call, no mutation. Collapsed.
function renderGuide() {
  const d = $("#mguide"), body = $("#mguideBody"); if (!d || !S.cfg) return;
  const g = metricGuide(selMetrics(), S.cfg, S.rows, applicable);
  d.hidden = !g.length; if (!g.length) { body.innerHTML = ""; return; }
  const keep = new Set([...body.querySelectorAll(".mgadv[open]")].map(e => e.closest(".mgitem")?.dataset.m));
  const tv = $("#threshold").value.trim(), th = tv === "" ? "(not set)" : tv, bl = !$("#useBaseline").disabled && $("#useBaseline").checked;
  const item = x => `<div class="mgitem" data-m="${esc(x.metric)}"><h4>${esc(M[x.metric])}</h4><p>${esc(x.purpose || "")}</p>
    <p><b>Needs:</b> ${esc(x.needs)}.${x.always ? "" : ` Otherwise the row is reported <span class="tag">n/a</span> (“${esc(x.na_reason)}”), not a low score.${x.rows ? ` In your current ${x.rows} row${x.rows === 1 ? "" : "s"}: <b>${x.na_now}</b> n/a.` : ""}`}</p>
    <p><b>Recorded score:</b> 1–5. <b>1</b> = ${esc((x.low || "").replace(/^1 - /, ""))}; <b>5</b> = ${esc((x.high || "").replace(/^5 - /, ""))}. Pass at ≥ ${esc(String(th))} (your threshold).${x.critical.length ? ` If the judge is confident a critical check failed (${x.critical.map(c => `“${esc(c)}”`).join(" or ")}), the score is capped at 2.` : ""}</p>
    ${bl && x.baseline_diff ? `<p class="hint">${esc(x.baseline_diff)}</p>` : ""}
    <details class="mgadv"${keep.has(x.metric) ? " open" : ""}><summary>The ${x.checks.length} Jev checks and full 1–5 scale</summary><ol>${x.checks.map(c => `<li>${esc(c.question)} <span class="hint">${c.type === "score" ? "1–5 score" : "yes/no"}, weight ${esc(String(c.weight))}${c.invert ? ", a yes counts against" : ""}${c.critical ? ", critical" : ""}</span></li>`).join("")}</ol><ul class="mglv">${x.levels.map(l => `<li>${esc(l)}</li>`).join("")}</ul></details></div>`;
  body.innerHTML = `<p class="hint">Taken from the Jev evaluator definitions this app runs. Each score is a weighted mix of these checks, computed in open code. This lists what the judge is asked; it does not guarantee the judge is right. ${bl ? "The Foundry built-in LLM judge uses its own prompts and scale, so its scores are compared with Jev's, not assumed equal." : ""}</p>` + g.map(item).join("");
}
$("#threshold").addEventListener("input", renderGuide);
$("#metricOpts").addEventListener("change", renderRunScope);
$("#useBaseline").addEventListener("change", renderRunScope);
$("#rscope").addEventListener("change", renderRun);
$("#runScope").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });

// ---------- dashboard
function kpi(l, v, c, hl, x) { return `<div class="kpi ${hl ? "hl" : ""} ${x || ""}"><div class="l">${l}</div><div class="v">${v}</div><div class="c">${c || ""}</div></div>`; }
function renderDash() {
  const s = S.summary; if (!s) { $("#kpis").innerHTML = `<div class="empty">Run an evaluation to see the dashboard.</div>`; $("#dashCharts").innerHTML = ""; renderCompare(); if (S.rfindRef || $("#rfind").value) { $("#detail").hidden = true; renderRows(); } return; }
  const j = s.jev, l = s.llm, o = s.overall;
  const hasL = l.evaluations > 0;
  if (S.studio_url) { $("#studioLink").href = S.studio_url; $("#studioLink").hidden = false; }
  $("#dashNote").textContent = `${s.rows} rows · ${j.evaluations} Jev metric scores · ${new Date(s.at).toLocaleString()} · ${s.version}`;
  $("#kpis").innerHTML = [
    kpi("Jev latency p50 (one call = all metrics)", `${fmtMs(j.p50_ms)}`, `p95 ${fmtMs(j.p95_ms)} · ${j.calls} calls${slowCases({ results: S.results, summary: s }).ok ? ` <button type="button" class="linkish" id="slowBtn">Show slow cases (≥ p95)</button>` : ""}`, true),
    kpi("Jev cost per 1k metric evaluations", fmt$(j.usd_per_1k_evals), `total ${fmt$(j.total_usd)} (estimate) · ${j.input_tokens.toLocaleString()} input tokens`, true),
    kpi("Jev ↔ human agreement", pct(o.jev_vs_human.pass_fail_agreement), `pass/fail · MAE ${o.jev_vs_human.mae ?? "—"} · r ${o.jev_vs_human.pearson ?? "—"} · n ${o.jev_vs_human.n}`, true),
    hasL ? kpi("LLM judge latency p50 (per metric)", fmtMs(l.p50_ms_per_metric), `p95 ${fmtMs(l.p95_ms_per_metric)} · ${fmtMs(l.p50_ms_per_row_sequential)} per row`) : "",
    hasL ? kpi("LLM judge cost per 1k evaluations", fmt$(l.usd_per_1k_evals), `total ${fmt$(l.total_usd)} · estimated at list price`) : "",
    hasL ? kpi("LLM judge ↔ human agreement", pct(o.llm_vs_human.pass_fail_agreement), `MAE ${o.llm_vs_human.mae ?? "—"} · Jev↔LLM ${pct(o.jev_vs_llm.pass_fail_agreement)}`) : "",
  ].join("");
  $("#dashCharts").innerHTML = window.JCharts ? JCharts.full(s) : "";
  renderCompare();
  // bars
  $("#metricBars").innerHTML = Object.keys(M).map(m => {
    const r = S.results; const avg = k => { const v = r.map(k).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const jv = avg(x => x.jev?.[m]), lv = avg(x => x.llm?.[m]?.score), hv = avg(x => x.human?.[m]);
    const w = v => v == null ? 0 : (v / 5 * 100);
    return `<div class="mb"><div>${M[m]}</div><div class="track"><i class="j" style="width:${w(jv)}%;height:6px"></i><i class="l" style="width:${w(lv)}%;height:3px"></i><i class="h" style="width:${w(hv)}%;height:3px"></i></div><div class="hint">Jev ${jv != null ? jv.toFixed(2) : "—"} · LLM ${lv != null ? lv.toFixed(2) : "—"} · H ${hv != null ? hv.toFixed(2) : "—"}</div></div>`;
  }).join("") + `<div class="legend"><span style="--c:var(--acc)">Jev mean</span><span style="--c:var(--warn)">LLM judge mean</span><span style="--c:var(--acc2)">Human mean</span></div>`;
  // agreement table
  $("#agree").innerHTML = `<table class="agtab"><thead><tr><th>Metric</th><th>Jev↔Human</th><th>LLM↔Human</th><th>Jev↔LLM</th></tr></thead><tbody>` +
    Object.keys(M).map(m => { const x = s.metrics[m]; const c = a => a.n ? `${pct(a.pass_fail_agreement)} <span class="hint">MAE ${a.mae} · n${a.n}</span>` : "—"; return `<tr><td>${M[m]}</td><td data-l="Jev↔Human">${c(x.jev_vs_human)}</td><td data-l="LLM↔Human">${c(x.llm_vs_human)}</td><td data-l="Jev↔LLM">${c(x.jev_vs_llm)}</td></tr>`; }).join("") +
    `<tr><td><b>All metrics</b></td>${[o.jev_vs_human, o.llm_vs_human, o.jev_vs_llm].map((a, i) => `<td data-l="${["Jev↔Human", "LLM↔Human", "Jev↔LLM"][i]}"><b>${pct(a.pass_fail_agreement)}</b> <span class="hint">MAE ${a.mae ?? "—"} · n${a.n}</span></td>`).join("")}</tr></tbody></table>`;
  renderDist();
  renderRows();
  $('[data-step="dash"]').classList.add("done");
}
// ---------- same-workload cost/latency comparison (pure projection of the frozen results; bench_compare.js)
const fmtX = v => v == null ? "—" : v >= 10 ? Math.round(v) + "×" : v.toFixed(1) + "×";
// compared / excluded case drilldown: rows come from the SAME projection (c.cases) that produced the ratio above
const MSH = m => M[m] || esc(m);
const mset = a => a && a.length ? a.map(MSH).join(", ") : "none";
function cmpCaseLine(k, excluded, openable = true) {
  const idT = k.id == null ? `<i>no id</i>` : `<b>${esc(k.id)}</b>${k.id_unique ? "" : ` <span class="tag">duplicate id</span>`}`;
  const can = k.id != null;
  const insp = !openable ? "" : can ? `<button class="ghost" data-cpos="${k.pos}" data-cid="${esc(k.id)}">Open frozen trace</button>` : `<span class="hint">cannot open: no id recorded</span>`;
  const t = v => fmtMs(v), u = v => v == null ? "unknown" : fmt$(v);
  return `<li class="cmpcase"><div>${idT} <span class="hint">run row ${k.pos + 1}</span> ${insp}</div>` +
    (excluded ? `<div><span class="tag">${esc(k.reason)}</span>${(() => { if (k.llm_calls == null) return ""; const oj = k.jev_metrics.filter(m => !k.llm_metrics.includes(m)), ol = k.llm_metrics.filter(m => !k.jev_metrics.includes(m)); return [oj.length ? ` only Jev scored <b>${mset(oj)}</b>` : "", ol.length ? ` only the LLM judge scored <b>${mset(ol)}</b>` : ""].filter(Boolean).join(";"); })()}</div>` : "") +
    `<div class="hint">Jev scored: ${mset(k.jev_metrics)} · LLM judge scored: ${k.llm_calls == null ? "not run" : mset(k.llm_metrics)}${k.llm_failed_calls ? ` · ${k.llm_failed_calls} LLM call${k.llm_failed_calls > 1 ? "s" : ""} failed` : ""}</div>` +
    `<div class="hint">Recorded cost: Jev ${u(k.jev_usd)} · LLM judge ${k.llm_calls == null ? "not run" : k.llm_calls === 0 ? "no calls (not applicable)" : u(k.llm_usd) + (k.llm_usd != null && k.llm_failed_calls ? " (includes the failed call" + (k.llm_failed_calls > 1 ? "s" : "") + ")" : "")} · Time: Jev ${t(k.jev_ms)} (one call) · LLM judge ${k.llm_calls == null ? "not run" : k.llm_calls === 0 ? "no calls" : k.llm_sum_ms == null ? "unknown" : `${t(k.llm_sum_ms)} (sum of ${k.llm_calls} per-metric call${k.llm_calls === 1 ? "" : "s"})`}</div></li>`;
}
function cmpCasesHTML(c, openable = true) {
  const K = c.cases || [], inc = K.filter(k => k.status === "compared"), exc = K.filter(k => k.status === "excluded");
  const blk = (lab, arr, ex) => `<details class="cmpcases"><summary>${lab} (${arr.length})</summary>${arr.length ? `<ul>${arr.map(k => cmpCaseLine(k, ex, openable)).join("")}</ul>` : `<p class="hint">None.</p>`}</details>`;
  return `<div class="cmpdrill">${blk("Show compared cases", inc, false)}${blk("Show excluded cases", exc, true)}<p class="hint">Listed from this run's frozen results, same rule as the figure above. ${openable ? "Opening a case shows its stored scores and the trace frozen at run start; nothing" : "Nothing"} is re-judged and no call is made. A per-row cost or time is shown only where it was recorded, otherwise <b>unknown</b>.</p></div>`;
}
function openCmpCase(pos, id) {
  const x = S.results[pos], src = S.runRows[pos];
  if (S.cmpRef !== S.results || !x || String(x.id) !== id || !src || String(src.id) !== id) { alert("This case is no longer in the run shown here (the run was replaced or cleared, or the row no longer matches its id), so it was not opened. No other case was opened instead."); return; }
  showDetail(pos);
}
function renderCompare() {
  const card = $("#cmpCard"); if (!S.summary || !S.results.length) { card.hidden = true; $("#cmp").innerHTML = ""; return; }
  const c = buildBenchCompare(S.results, { pricing: runPricing(S.runCfg) });
  S.compare = c; card.hidden = false;
  $("#cmp").innerHTML = cmpBodyHTML(c, S.summary.baseline_label || null, true); // label recorded with the run, not today's config
  S.cmpRef = S.results;
  $$("#cmp [data-cpos]").forEach(bt => bt.onclick = () => openCmpCase(+bt.dataset.cpos, bt.dataset.cid));
}
// Same panel body for the live completed run and for an opened benchmark package (openable=false: no frozen-trace
// buttons bound to the current run; the package view lists its own rows).
function cmpBodyHTML(c, label, openable) {
  const b = { label };
  const J = c.jev, L = c.llm, m = c.matched, P = c.pricing;
  const tot = (t, k) => t == null ? `unknown <span class="hint">(some cost not recorded; ${fmt$(k)} recorded)</span>` : fmt$(t);
  const row = (a, x, y) => `<tr><th scope="row">${a}</th><td data-l="Jev">${x}</td><td data-l="LLM judge">${y}</td></tr>`;
  const lcell = f => L ? f() : `<span class="hint">not run</span>`;
  const jfail = J.failed_rows ? ` · <b>${J.failed_rows} failed</b>` : "", lfail = L?.failed_calls ? ` · <b>${L.failed_calls} failed</b>` : "";
  let head;
  if (c.scope === "no_baseline") head = `<p class="cmpHead">Only Jev ran in this run (LLM judge off or capped), so there is nothing to compare against. Jev's own measured figures are below.</p>`;
  else if (c.scope === "not_comparable") head = `<p class="cmpHead"><b>Not comparable.</b> No row had both judges score exactly the same metrics with cost and time recorded, so no like-for-like figure or ratio is shown. The separate measured totals are below.</p>`;
  else head = `<p class="cmpHead">On the <b>${m.rows}</b> ${c.scope === "same" ? "rows (all rows in this run)" : `of ${J.rows_sent} rows`} where both judges scored the same <b>${m.metric_evals}</b> metric evaluations, Jev cost <b>${fmt$(m.jev_usd)}</b> and the LLM judge <b>${fmt$(m.llm_usd)}</b>${m.cost_ratio != null ? ` (<b>${fmtX(m.cost_ratio)}</b> for the LLM judge)` : ""}. Per row, Jev took <b>${fmtMs(m.jev_p50_ms)}</b> (median, one call for all metrics); the LLM judge's per-metric calls added up to <b>${fmtMs(m.llm_seq_p50_ms)}</b> (median sum of call times; they run in parallel, so actual wait per row is lower and was not measured).</p>` +
    (c.scope === "partial" ? `<p class="hint">${m.unmatched_rows} row${m.unmatched_rows === 1 ? "" : "s"} left out of this like-for-like figure (${Object.entries(m.unmatched).map(([k, n]) => `${esc(k)}: ${n}`).join(" · ")}). They are still in the full totals below.</p>` : "");
  return head + `<div style="overflow-x:auto"><table class="agtab cmptab"><thead><tr><th>Full run, measured</th><th>Jev</th><th>LLM judge${b.label ? ` <span class="hint">${esc(b.label.replace("(, ", "("))}</span>` : ""}</th></tr></thead><tbody>` +
    row("Calls made", `${J.calls} of ${J.rows_sent} rows (one call per row, all metrics)${jfail}`, lcell(() => `${L.calls} (one call per metric)${lfail}`)) +
    row("Metric scores returned", `${J.scored_evals}${J.not_applicable ? ` · ${J.not_applicable} not applicable` : ""}`, lcell(() => `${L.scored_evals}${L.not_applicable ? ` · ${L.not_applicable} not applicable (no call)` : ""}`)) +
    row("Time per call", `median ${fmtMs(J.p50_ms_per_call)} · p95 ${fmtMs(J.p95_ms_per_call)} <span class="hint">covers every metric of the row</span>`, lcell(() => `median ${fmtMs(L.p50_ms_per_call)} · p95 ${fmtMs(L.p95_ms_per_call)} <span class="hint">one metric</span>`)) +
    row("Time per row", `median ${fmtMs(J.p50_ms_per_call)} <span class="hint">same single call</span>`, lcell(() => `median ${fmtMs(L.p50_ms_per_row_sequential)} <span class="hint">sum of its per-metric calls over ${L.rows_sequential_n} rows; the server runs them in parallel, so wall time is lower (not measured)</span>`)) +
    row("Estimated cost, this run", tot(J.total_usd, J.known_usd), lcell(() => tot(L.total_usd, L.known_usd))) +
    row("Projected cost", J.usd_per_1k_rows == null ? "—" : `${fmt$(J.usd_per_1k_rows)} per 1,000 rows <span class="hint">÷ ${J.calls} calls</span>`, lcell(() => L.usd_per_1k_evals == null ? "—" : `${fmt$(L.usd_per_1k_evals)} per 1,000 metric calls <span class="hint">÷ ${L.calls} calls</span>`)) +
    (m.rows ? row(`Like-for-like, ${m.rows} matched rows`, `${fmt$(m.jev_usd_per_1k_rows)} per 1,000 rows`, `${fmt$(m.llm_usd_per_1k_rows)} per 1,000 rows`) : "") +
    `</tbody></table></div><p class="hint">Costs are estimates (recorded tokens × list price), not an invoice. ${P.source === "not_recorded" ? "Prices used for this run were not recorded (older or replayed run), so they are shown as unknown; current app prices are not applied." : `Prices recorded at run start: Jev ${P.jev_usd_per_mtok_input != null ? "$" + P.jev_usd_per_mtok_input : "unknown"} per 1M input tokens (docs.typesafe.ai; output free); LLM judge ${P.llm_usd_per_mtok_in != null ? "$" + P.llm_usd_per_mtok_in : "unknown"} in / ${P.llm_usd_per_mtok_out != null ? "$" + P.llm_usd_per_mtok_out : "unknown"} out per 1M tokens (Azure list price set on this host at that time).`} Human agreement is in the table below with its own n; cost and speed say nothing about accuracy.</p>` + cmpCasesHTML(c, openable);
}
// ---------- Jev score distribution for one metric (score_dist.js; pure projection of the frozen run, no calls)
// exact stored value (shortest round-trip text), so 1.999 never reads as 2.0 inside the 1–2 bin; same pill colours
function distPill(v, th) { const cls = v >= Math.max(4, th) ? "p-good" : v >= th ? "p-mid" : "p-bad"; return `<span class="pill ${cls}" title="exact stored score">${String(v)}</span>`; }
function distMetrics() { return (S.runCfg?.metrics?.length ? S.runCfg.metrics : Object.keys(M)).filter(m => Object.hasOwn(M, m)); }
function renderDist() {
  const card = $("#distCard"), el = $("#dist");
  if (!S.summary || !S.results.length) { card.hidden = true; el.innerHTML = ""; S.distRef = null; return; }
  card.hidden = false;
  const ms = distMetrics(), th = S.summary.threshold;
  $("#distCard h3 .hint").textContent = S.distCmp ? `Jev vs ${COMPARATORS[S.distCmp] || ""}, paired cases only, this run` : "recorded Jev scores only, this run";
  if (S.distRef !== S.results || !ms.includes(S.distMetric)) { S.distMetric = defaultMetric(S.results, ms, th); S.distBin = null; if (S.distRef !== S.results) { S.distCmp = ""; S.distPV = "bins"; S.distPt = null; } S.distRef = S.results; }
  const m = S.distMetric, d = scoreDist(S.results, m, { metrics: S.runCfg?.metrics ?? null, threshold: th });
  if (S.distBin == null && !S.distCmp) { const lo = d.bins.find(b => b.n); S.distBin = lo ? lo.key : null; }
  const mx = Math.max(1, ...d.bins.map(b => b.n));
  const ex = Object.entries(d.excluded);
  const idT = v => typeof v === "string" ? esc(v) : v === undefined ? "<i>no id</i>" : `${esc(JSON.stringify(v))} <span class="hint">(not text)</span>`;
  const sel = d.bins.find(b => b.key === S.distBin) || null;
  const cmpSel = `<label>Compare with <select id="distC"><option value=""${S.distCmp ? "" : " selected"}>Nothing (Jev only)</option>${Object.entries(COMPARATORS).map(([k, t]) => { const av = pairedDist(S.results, m, k, { metrics: S.runCfg?.metrics ?? null }).available; return `<option value="${k}"${S.distCmp === k ? " selected" : ""}>${t}${av ? "" : " (not available here)"}</option>`; }).join("")}</select></label>`;
  if (S.distCmp) { renderDistPaired(el, ms, m, th, cmpSel, idT); return; }
  el.innerHTML = `<div class="rfilter"><label>Metric <select id="distM">${ms.map(k => `<option value="${k}"${k === m ? " selected" : ""}>${M[k]}</option>`).join("")}</select></label>${cmpSel}</div>
    <p class="hint" id="distNote">${d.scored ? `<b>${d.scored}</b> of <b>${d.rows}</b> rows in this run have a recorded Jev ${esc(M[m])} score${d.below_threshold != null ? `; <b>${d.below_threshold}</b> below the pass threshold of ${th}` : ""}. Mean ${d.mean.toFixed(2)} over those ${d.scored} only.` : `No recorded Jev ${esc(M[m])} scores in this run.`} ${d.excluded_n ? `Not counted (never treated as 0): ${ex.map(([k, n]) => `${n} ${esc(k)}`).join(" · ")}.` : "Nothing excluded."} Bins use the exact stored score, no rounding; bar length is relative to the largest bin. Counts describe this run's cases only, not agent quality in general; LLM judge and human scores are not included.</p>
    <div class="distbins" role="group" aria-label="Jev ${esc(M[m])} score bins">${d.bins.map(b => `<button type="button" class="distbin${b.key === S.distBin ? " on" : ""}" data-bin="${b.key}" aria-pressed="${b.key === S.distBin}" aria-label="${b.label}: ${b.n} case${b.n === 1 ? "" : "s"}"><span class="dlab">${b.label}</span><span class="dtrack"><i style="width:${(100 * b.n / mx).toFixed(1)}%"></i></span><span class="dn">${b.n}</span></button>`).join("")}</div>
    ${sel ? `<div id="distList"><p class="hint"><b>${sel.n}</b> case${sel.n === 1 ? "" : "s"} with ${sel.label.replace("score", "Jev " + esc(M[m]) + " score")}, in run order:</p>${sel.n ? "" : `<p class="empty">No cases in this interval. Pick another bin or metric.</p>`}<ul class="distcases">${sel.items.map(it => `<li><b>${idT(it.id)}</b> <span class="hint">run row ${it.pos + 1}</span> ${distPill(it.score, th)} <button class="ghost" data-dpos="${it.pos}" data-did='${esc(JSON.stringify(it.id ?? null))}'>Open case</button></li>`).join("")}</ul></div>` : ""}`;
  bindDist();
}
function bindDist() {
  $("#distM").onchange = e => { S.distMetric = e.target.value; S.distBin = null; renderDist(); $("#distM").focus(); };
  $("#distC").onchange = e => { S.distCmp = e.target.value; S.distBin = null; renderDist(); $("#distC").focus(); };
  $$("#dist .distbin").forEach(b => b.onclick = () => { S.distBin = b.dataset.bin; renderDist(); $(`#dist .distbin[data-bin="${S.distBin}"]`).focus(); });
  $$("#dist [data-dpos]").forEach(b => b.onclick = () => openDistCase(+b.dataset.dpos, JSON.parse(b.dataset.did)));
  $$("#dist [data-pv]").forEach(b => b.onclick = () => { S.distPV = b.dataset.pv; renderDist(); $(`#dist [data-pv="${S.distPV}"]`).focus(); });
  const xb = $("#distExport"); if (xb) xb.onclick = exportDistList;
  $$("#dist [data-pk]").forEach(b => b.onclick = () => { S.distPt = b.dataset.pk; renderDist(); $(`#dist button[data-pk='${CSS.escape(S.distPt)}']`)?.focus(); });
}
// score-pair plot (t_c1201840): same pd.pairs as the bins; one mark per exact coordinate, grouped with honest counts, never jittered
function distPairsHTML(pd, c, cl, th, idT) {
  const P = pairPoints(pd), sh = c === "human" ? "Human" : "Foundry", f = v => String(v);
  if (!P.points.some(g => g.key === S.distPt)) S.distPt = P.points[0]?.key ?? null;
  const sel = P.points.find(g => g.key === S.distPt) || null;
  const X = v => 40 + (v - 0.8) * 50, Y = v => 232 - (v - 0.8) * 50, R = g => Math.min(14, 5 + 2 * Math.sqrt(g.n - 1));
  // marks whose circles touch another mark at this drawing size (exact coordinates kept; the list is the precise view)
  const near = P.points.filter(a => P.points.some(b => b !== a && Math.hypot(X(a.jev) - X(b.jev), Y(a.cmp) - Y(b.cmp)) < R(a) + R(b))).length;
  const grid = [1, 2, 3, 4, 5].map(v => `<line x1="${X(v)}" y1="${Y(0.8)}" x2="${X(v)}" y2="${Y(5.2)}" class="pg"/><line x1="${X(0.8)}" y1="${Y(v)}" x2="${X(5.2)}" y2="${Y(v)}" class="pg"/><text x="${X(v)}" y="${Y(0.8) + 14}" class="pt">${v}</text><text x="${X(0.8) - 9}" y="${Y(v) + 4}" class="pt">${v}</text>`).join("");
  const pts = [...P.points].sort((a, b) => (a.key === S.distPt) - (b.key === S.distPt));
  const marks = pts.map(g => `<g class="pm${g.key === S.distPt ? " on" : ""}${g.diff === 0 ? " eq" : ""}" data-pk='${esc(g.key)}'><circle cx="${X(g.jev).toFixed(2)}" cy="${Y(g.cmp).toFixed(2)}" r="${R(g).toFixed(1)}"/>${g.n > 1 ? `<text x="${X(g.jev).toFixed(2)}" y="${(Y(g.cmp) + 3.5).toFixed(2)}">${g.n}</text>` : ""}</g>`).join("");
  const dt = d => d === 0 ? "equal" : `difference ${d > 0 ? "+" : "−"}${f(Math.abs(+d.toPrecision(12)))}`;
  return `<p class="hint" id="distPairNote">Each mark is one exact stored pair: Jev across, ${esc(cl)} up, both on the same 1–5 scale; the dashed diagonal is where the two scores are equal. Marks are never moved apart: <b>${P.points.length}</b> mark${P.points.length === 1 ? "" : "s"} for <b>${P.paired}</b> paired case${P.paired === 1 ? "" : "s"}, and a number on a mark counts cases with exactly the same two scores.${near ? ` <b>${near}</b> mark${near === 1 ? " overlaps" : "s overlap"} a nearby one at this size; the list shows every pair exactly.` : ""} <b>${P.equal}</b> equal · <b>${P.cmp_higher}</b> with ${esc(cl)} higher · <b>${P.cmp_lower}</b> with ${esc(cl)} lower; <b>${P.other_bin}</b> land in different score bins (1–2, 2–3, 3–4 half-open, 4–5 closed, as in the Bins view). Distance from the diagonal shows how far two different measurements differ, not which one is right.</p>
    <div class="pairplot"><svg viewBox="0 0 270 262" role="img" aria-label="Plot of ${P.paired} paired Jev and ${esc(cl)} scores; the same pairs are listed as buttons next to it">${grid}<line x1="${X(1)}" y1="${Y(1)}" x2="${X(5)}" y2="${Y(5)}" class="pd"/><text x="${X(3)}" y="258" class="pt pa">Jev →</text><text x="10" y="${Y(3)}" class="pt pa" transform="rotate(-90 10 ${Y(3)})">${sh} →</text>${marks}</svg>
    <div class="pairlist" role="group" aria-label="Score pairs, largest difference first"><p class="hint"><b>${P.points.length}</b> pair${P.points.length === 1 ? "" : "s"}, largest difference first (difference = ${esc(cl)} − Jev):</p>${P.points.map(g => `<button type="button" class="ghost pbtn${g.key === S.distPt ? " on" : ""}${g.diff === 0 ? " eq" : ""}" data-pk='${esc(g.key)}' aria-pressed="${g.key === S.distPt}"><span class="nw">Jev <b>${f(g.jev)}</b> · ${esc(sh)} <b>${f(g.cmp)}</b></span> <span class="pdiff">${dt(g.diff)}</span> <span class="hint">· ${g.n} case${g.n === 1 ? "" : "s"}</span></button>`).join("")}</div></div>
    ${sel ? `<div id="distList"><p class="hint"><b>${sel.n}</b> paired case${sel.n === 1 ? "" : "s"} with Jev ${f(sel.jev)} and ${esc(cl)} ${f(sel.cmp)} exactly, in run order:</p>${distExportHTML(sel.items)}<ul class="distcases">${sel.items.map(it => `<li><b>${idT(it.id)}</b> <span class="hint">run row ${it.pos + 1}</span> <span class="nw">Jev ${distPill(it.jev, th)}</span> <span class="nw">${esc(cl)} ${distPill(it.cmp, th)}</span> <button class="ghost" data-dpos="${it.pos}" data-did='${esc(JSON.stringify(it.id ?? null))}'>Open case</button></li>`).join("")}</ul></div>` : ""}`;
}
// paired view (t_10def3c9): Jev vs ONE stored comparator on the same frozen run; only cases where both have a 1–5 score
function renderDistPaired(el, ms, m, th, cmpSel, idT) {
  const c = S.distCmp, pd = pairedDist(S.results, m, c, { metrics: S.runCfg?.metrics ?? null }), cl = COMPARATORS[c];
  const mSel = `<label>Metric <select id="distM">${ms.map(k => `<option value="${k}"${k === m ? " selected" : ""}>${M[k]}</option>`).join("")}</select></label>`;
  if (!pd.available) {
    el.innerHTML = `<div class="rfilter">${mSel}${cmpSel}</div><p class="empty" id="distNote">${esc(cl)} scores are not available for ${esc(M[m])} in this run${pd.jev_scored_all ? "" : `, and Jev has no ${esc(M[m])} scores in this run either`}, so there is nothing to compare. No score is filled in or treated as 0.${c === "llm" ? " The Foundry LLM judge is only scored when it was switched on for the run and could score this metric." : " Add 1–5 human labels on the Dataset step, then run again; this completed run keeps the labels it started with."}</p>`;
    bindDist(); return;
  }
  if (S.distBin == null) { const lo = pd.jev_bins.find((b, i) => b.n || pd.cmp_bins[i].n); S.distBin = lo ? lo.key : null; }
  const mx = Math.max(1, ...pd.jev_bins.map(b => b.n), ...pd.cmp_bins.map(b => b.n));
  const ex = Object.entries(pd.excluded), sel = pd.jev_bins.find(b => b.key === S.distBin) || null, list = sel ? pairedBinCases(pd, sel.key) : [];
  el.innerHTML = `<div class="rfilter">${mSel}${cmpSel}</div>
    <p class="hint" id="distNote"><b>${pd.paired}</b> of <b>${pd.rows}</b> rows in this run have both a Jev and a ${esc(cl)} ${esc(M[m])} score from 1 to 5; only those ${pd.paired} are shown. ${pd.excluded_n ? `Not counted (never treated as 0): ${ex.map(([k, n]) => `${n} ${esc(k)}`).join(" · ")}.` : "Nothing excluded."} ${pd.paired === pd.jev_scored_all ? `Here the paired set happens to match the Jev-only view (${pd.jev_scored_all} Jev scores); it can be smaller, because a row counts only when both judges scored it.` : `The Jev-only view counts ${pd.jev_scored_all} Jev scores; ${pd.jev_scored_all - pd.paired} of them ${pd.jev_scored_all - pd.paired === 1 ? "is" : "are"} left out here because the ${esc(cl)} has no 1–5 score for that row, so the Jev bars below differ from the Jev-only view.`}</p>
    <p class="hint distwarn">Both bars use the same bins, the exact stored scores and one scale (bar length is relative to the largest count). Similar bars do not mean the judges agree on the same cases: open a bin to compare case by case. ${c === "llm" ? "The Foundry LLM judge uses its own built-in prompt and scale mapping, so its score is not the same measurement as Jev's." : "Human labels are whole numbers typed by the dataset author, not a second model."}</p>
    ${S.distPV === "pairs" ? "" : `<div class="legend"><span style="--c:var(--acc)">J = Jev</span><span style="--c:var(--acc2)">${c === "human" ? "H" : "L"} = ${esc(cl)}</span></div>`}
    <div class="pvtog" role="group" aria-label="Paired view">${[["bins", "Bins"], ["pairs", "Score pairs"]].map(([k, t]) => `<button type="button" class="ghost${(S.distPV || "bins") === k ? " on" : ""}" data-pv="${k}" aria-pressed="${(S.distPV || "bins") === k}">${t}</button>`).join("")}</div>
    ${S.distPV === "pairs" ? distPairsHTML(pd, c, cl, th, idT) : `<div class="distbins" role="group" aria-label="Jev and ${esc(cl)} ${esc(M[m])} score bins, paired cases only">${pd.jev_bins.map((b, i) => { const k = pd.cmp_bins[i].n; return `<button type="button" class="distbin dpair${b.key === S.distBin ? " on" : ""}" data-bin="${b.key}" aria-pressed="${b.key === S.distBin}" aria-label="${b.label}: Jev ${b.n}, ${esc(cl)} ${k}"><span class="dlab">${b.label}</span><span class="dbars"><span class="dtrack"><i style="width:${(100 * b.n / mx).toFixed(1)}%"></i></span><span class="dtrack dc"><i style="width:${(100 * k / mx).toFixed(1)}%"></i></span></span><span class="dn"><span class="djn" title="Jev">J ${b.n}</span><br><span class="dcn" title="${esc(cl)}">${c === "human" ? "H" : "L"} ${k}</span></span></button>`; }).join("")}</div>
    ${sel ? `<div id="distList"><p class="hint"><b>${list.length}</b> paired case${list.length === 1 ? "" : "s"} with a Jev or ${esc(cl)} score in ${sel.label}, in run order:</p>${list.length ? distExportHTML(list) : `<p class="empty">No paired cases in this interval. Pick another bin or metric.</p>`}<ul class="distcases">${list.map(it => `<li><b>${idT(it.id)}</b> <span class="hint">run row ${it.pos + 1}</span> <span class="nw">Jev ${distPill(it.jev, th)}${it.jevIn ? "" : ` <span class="hint">(other bin)</span>`}</span> <span class="nw">${esc(cl)} ${distPill(it.cmp, th)}${it.cmpIn ? "" : ` <span class="hint">(other bin)</span>`}</span> <button class="ghost" data-dpos="${it.pos}" data-did='${esc(JSON.stringify(it.id ?? null))}'>Open case</button></li>`).join("")}</ul></div>` : ""}`}`;
  bindDist();
}
// export the opened compared list (t_fb8d75e1): the exact frozen rows of the list shown, in shown order, via the
// evaluated-dataset serializer (case_list_export.js). Re-derived and compared at click; any drift refuses. 0 calls,
// no change to the working dataset, the frozen run or any export.
function distExportHTML(items) {
  S.distShown = { ref: S.results, L: items.map(p => ({ pos: p.pos, id: p.id })) };
  const e = evalExport(), n = items.length, pv = S.distPV === "pairs";
  const scope = `Jev vs ${COMPARATORS[S.distCmp] || ""} · ${M[S.distMetric] || S.distMetric} · ${pv ? (() => { try { const [j, c] = JSON.parse(S.distPt); return `pair Jev ${j} · ${S.distCmp === "human" ? "Human" : "Foundry"} ${c}`; } catch { return "pair"; } })() : `bin ${(SCORE_BINS.find(b => b.key === S.distBin) || {}).label || S.distBin}`}`;
  return `<div class="distexp"><button type="button" class="ghost" id="distExport"${e.ok ? "" : " disabled"}>Download these ${n} case${n === 1 ? "" : "s"} (.jsonl)</button> <span class="hint" id="distExportNote">${e.ok ? `<b>${esc(scope)}</b>: exactly the ${n} listed case${n === 1 ? "" : "s"}, in this order, as frozen when this run started (recorded version ${esc(String(e.version ?? "unknown"))}${e.at ? `, run ${esc(new Date(e.at).toISOString().replace("T", " ").slice(0, 16))} UTC` : ""}). Original traces, human labels as authored and extra fields; no Jev or LLM-judge scores. Upload it on the Dataset step: the preview shows the cases and Apply adds them (nothing is replaced).` : esc(EVAL_WHY[e.reason] || "Not available.")}</span></div>`;
}
const DLX_WHY = { empty: "The list you opened has no cases.", stale: "The list shown no longer matches this run (it was replaced, cleared or changed)." };
function exportDistList() {
  const nav = distNavCtx(), sh = S.distShown;
  const fresh = nav && sh && sh.ref === S.results && S.distRef === S.results && JSON.stringify(nav.L) === JSON.stringify(sh.L);
  const r = fresh ? buildCaseListExport({ runRows: S.runRows, results: S.results, summary: S.summary, key: S.key, list: sh.L }) : { ok: false, reason: sh && sh.L.length ? "stale" : "empty" };
  if (!r.ok) { alert(`${DLX_WHY[r.reason] || EVAL_WHY[r.reason] || "Not available."} Nothing was downloaded.`); renderDist(); return; }
  const tag = `${nav.cmp}-${nav.metric}-${nav.view === "pairs" ? "pair" : "bin"}-${String(nav.key).replace(/[^\w.-]+/g, "_")}`;
  download(`compared-cases-${r.n}-${tag}-${String(r.version || "unknown").replace(/[^\w.-]/g, "_")}-${stamp()}.jsonl`, r.text, "application/x-ndjson");
  const nt = $("#distExportNote"); if (nt) nt.textContent = `Downloaded ${r.n} case${r.n === 1 ? "" : "s"} (${r.ids.map(v => JSON.stringify(v)).join(", ")}) of ${r.total} run rows. Nothing in this run or your dataset changed.`;
}
// nav (t_ad616649): when opened from a PAIRED list, freeze that exact list (distNavList over the same pairedDist
// projection) with the run identity; Previous/Next only re-open stored cases of that list (0 calls, same inspector).
function distNavCtx() {
  if (!S.distCmp) return null;
  const pd = pairedDist(S.results, S.distMetric, S.distCmp, { metrics: S.runCfg?.metrics ?? null });
  const view = S.distPV === "pairs" ? "pairs" : "bins", key = view === "pairs" ? S.distPt : S.distBin;
  const L = distNavList(pd, view, key); if (!L.length) return null;
  const grp = view === "pairs" ? (() => { const [j, c] = JSON.parse(key); return `pair Jev ${j} · ${S.distCmp === "human" ? "Human" : "Foundry"} ${c}`; })() : `bin ${(SCORE_BINS.find(b => b.key === key) || {}).label || key}`;
  return { ref: S.results, metric: S.distMetric, cmp: S.distCmp, view, key, L, grp };
}
function openDistCase(pos, id, nav, focusSel) {
  if (S.distRef !== S.results || !resolveDistCase(S.results, S.runRows, pos, id).ok || (nav && nav.ref !== S.results)) { alert("This case is no longer in the run shown here (the run was replaced or cleared), so it was not opened. No other case was opened instead."); $("#detail").hidden = true; renderDist(); return; }
  if (nav === undefined) nav = distNavCtx();
  showDetail(pos, nav ? nav.metric : S.distMetric);
  const d = $("#detail"), bar = document.createElement("div"), bk = document.createElement("button");
  bar.className = "distnav"; bar.id = "distNav";
  bk.type = "button"; bk.className = "ghost"; bk.id = "distBack"; bk.textContent = "← Back to score distribution";
  bk.onclick = () => { d.hidden = true; const t = $(`#dist [data-dpos="${pos}"]`) || $(`#dist .distbin.on`) || $(`#dist .pbtn.on`); $("#distCard").scrollIntoView({ block: "start" });
    // t_8cf9e0ff: with enlarged text the restored button can sit far below the card top — bring it on screen too
    if (t) { const r = t.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) t.scrollIntoView({ block: "center" }); t.focus({ preventScroll: true }); } };
  bar.append(bk);
  if (nav) {
    const i = nav.L.findIndex(e => e.pos === pos && JSON.stringify(e.id) === JSON.stringify(id));
    const mk = (dir, txt) => { const b = document.createElement("button"); b.type = "button"; b.className = "ghost"; b.id = dir < 0 ? "distPrev" : "distNext"; b.textContent = txt;
      const s = distNavStep(nav.L, pos, id, dir); b.disabled = !s.ok; b.setAttribute("aria-label", `${dir < 0 ? "Previous" : "Next"} compared case${s.ok ? ` (${s.i + 1} of ${s.n})` : dir < 0 ? ", this is the first" : ", this is the last"}`);
      b.onclick = () => { const t = distNavStep(nav.L, pos, id, dir); if (!t.ok) return; openDistCase(t.pos, t.id, nav, dir < 0 ? "#distPrev" : "#distNext"); }; return b; };
    const lab = document.createElement("span"); lab.className = "hint"; lab.id = "distNavPos"; lab.setAttribute("aria-live", "polite");
    lab.innerHTML = `Compared case <b>${i + 1}</b> of <b>${nav.L.length}</b> in the list you opened · Jev vs ${esc(COMPARATORS[nav.cmp])} · ${esc(M[nav.metric])} · <span class="nw">${esc(nav.grp)}</span>`;
    const g = document.createElement("span"); g.className = "navgrp"; g.append(mk(-1, "‹ Previous case"), mk(1, "Next case ›"));
    bar.append(g, lab);
  }
  d.prepend(bar);
  let f = focusSel ? $(focusSel, d) : bk; if (!f || f.disabled) f = focusSel ? ($("#distNext", d)?.disabled === false ? $("#distNext", d) : $("#distPrev", d)?.disabled === false ? $("#distPrev", d) : bk) : bk;
  bar.scrollIntoView({ block: "start", behavior: "instant" }); f.focus({ preventScroll: true });
  { const r = f.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) f.scrollIntoView({ block: "nearest", behavior: "instant" }); }
}
// ---------- disagreement review (pure client-side over the completed run; no new inference)
const VIEW = { jev_vs_human: ["Jev", "Human"], jev_vs_llm: ["Jev", "LLM judge"] };
function filterState() {
  const d = S.summary?.disagreements; if (!d || S.view === "all") return null;
  const c = d[S.view]?.[S.metric]; if (!c) return null;
  const hits = new Map();
  for (const it of c.items) { if (!hits.has(it.idx)) hits.set(it.idx, new Set()); hits.get(it.idx).add(it.metric); }
  return { c, hits };
}
function renderRows() {
  const s = S.summary;
  if (!s) { $("#rfindbar").hidden = true; $("#rfind").value = ""; $("#rfindStatus").textContent = ""; $("#rfindStatus").classList.remove("warn"); $("#rfindNote").hidden = $("#rfindClear").hidden = true; S.rfindRef = null; S.rfProj = null; S.rfx = null; if ($("#rfx")) { $("#rfx").hidden = true; $("#rfx").innerHTML = ""; $("#rfxLive").textContent = ""; } $("#exReview").hidden = $("#exReviewNote").hidden = $("#exPairs").hidden = $("#exPairsNote").hidden = true; $("#rtable thead").innerHTML = ""; $("#rtable tbody").innerHTML = ""; $("#fNote").textContent = ""; S.disPrep = null; renderDisBar(); S.failPrep = null; renderFailBar(); return; }
  const hasL = s.llm.evaluations > 0;
  if (!hasL && S.view === "jev_vs_llm") S.view = "all";
  if (S.view === "pairs") { $("#fMetric").innerHTML = `<option value="all">All metrics</option>` + Object.keys(M).map(m => `<option value="${m}">${M[m]}</option>`).join(""); $("#fMetric").value = S.metric; $("#fView").value = "pairs"; $("#exReview").hidden = $("#exReviewNote").hidden = true; $("#exPairs").hidden = $("#exPairsNote").hidden = false; $("#fOrderWrap").hidden = true; S.disPrep = null; renderDisBar(); renderFailBar(); $("#rfindbar").hidden = true; $("#rfind").value = ""; S.rfProj = null; S.rfx = null; renderRfx(); renderPairs(hasL); return; }
  $("#exPairs").hidden = $("#exPairsNote").hidden = true;
  $("#fMetric").innerHTML = `<option value="all">All metrics</option>` + Object.keys(M).map(m => `<option value="${m}">${M[m]}</option>`).join("");
  $("#fMetric").value = S.metric; $("#fView").value = S.view;
  $$("#fView option").forEach(o => { if (o.value === "jev_vs_llm") o.disabled = !hasL; });
  const rv = S.view !== "all"; $("#exReview").hidden = !rv; $("#exReviewNote").hidden = !rv;
  const cc = rv ? s.disagreements?.[S.view]?.[S.metric] : null; $("#exReview").disabled = !cc || cc.comparable === 0;
  const ms = S.metric === "all" ? Object.keys(M) : [S.metric];
  const f = filterState(), th = s.threshold;
  if (!f) {
    $("#fNote").innerHTML = `Showing all <b>${S.results.length}</b> rows of this run. Pass = score ≥ <b>${th}</b> (this run's threshold).`;
  } else {
    const [A, B] = VIEW[S.view], c = f.c, ex = Object.entries(c.excluded);
    const exT = ex.length ? ` Not counted either way: ${ex.map(([k, n]) => `${n} ${esc(k)}`).join(" · ")}.` : "";
    $("#fNote").innerHTML = c.comparable === 0
      ? `<b>No comparable ${A} / ${B} score pairs</b> for ${S.metric === "all" ? "any metric" : M[S.metric]} in this run, so there is nothing to compare.${exT}`
      : `<b>${c.disagree}</b> of <b>${c.comparable}</b> comparable ${A} / ${B} metric pairs disagree on pass/fail (pass = score ≥ ${th}), in <b>${c.rows_disagree}</b> of ${c.rows_comparable} rows.${c.disagree === 0 ? " <b>No disagreements.</b>" : ""}${exT}`;
  }
  $("#rtable thead").innerHTML = `<tr><th>ID</th>${ms.map(m => `<th>${SHORT[m]} Jev</th>${hasL ? `<th>${SHORT[m]} LLM</th>` : ""}<th>${SHORT[m]} Human</th>`).join("")}<th title="Recorded time of the one Jev call that scored every metric of this row. Not the LLM judge's per-metric time, not overall app time.">Jev call latency <span class="hint">(all metrics)</span></th><th>Tokens</th></tr>`;
  if (S.slow && (S.slow.ref !== S.results || S.slow.summary !== s || S.view !== "all" || S.metric !== "all")) { S.slow = null; S.slowPrep = null; }   // changed run/view invalidates
  const SC = S.slow ? slowCases({ results: S.results, summary: s }) : null; renderSlowBar(SC); renderDisBar(); renderFailBar();
  if (SC?.ok) $("#fNote").innerHTML = `Showing <b>${SC.members.length}</b> slow case${SC.members.length === 1 ? "" : "s"} of <b>${S.results.length}</b> rows in this run. Pass = score ≥ <b>${th}</b>.`;
  const idxs0 = SC?.ok ? SC.members.map(e => e.pos) : f ? [...f.hits.keys()] : S.results.map((_, i) => i);
  const RF = runFind(), rfOn = new Set(RF.shown), idxsF = RF.active ? idxs0.filter(i => rfOn.has(i)) : idxs0;
  const LV = latencyView(S.results, idxsF, SC?.ok ? "slowest" : S.order), idxs = LV.rows.map(e => e.pos); S.rtRef = S.results;
  renderRunFind(RF, idxsF.length, idxs0.length);
  S.rfProj = RF.active ? { ref: S.results, query: RF.query, scope: rfScopeTxt(SC, f, LV.mode), L: runMatchList(S.results, idxs, (pos, id) => resolveRow(S.results, S.runRows, pos, id)) } : null;
  renderRfx();
  $("#fOrder").value = LV.mode; $("#fOrderWrap").hidden = !!SC?.ok;
  if (!SC?.ok) $("#fNote").insertAdjacentHTML("beforeend", ` <span class="nw lvnote">Jev call latency (one call scores all metrics of a row) recorded for <b>${LV.valid}</b> of ${LV.rows.length} rows shown${LV.unavailable ? ` · <b>${LV.unavailable}</b> unavailable (no recorded duration; never counted as 0)` : ""}.${LV.mode === "slowest" ? " Ordered slowest first; equal times keep run order; unavailable rows last. Scores and exports are unchanged." : ""}</span>`);
  const other = S.view === "jev_vs_human" ? "human" : "llm";
  const flag = (i, m, who) => f && f.hits.get(i)?.has(m) && (who === "jev" || who === other) ? ` class="dis" data-m="${m}" title="disagreement: click to inspect"` : "";
  $("#rtable tbody").innerHTML = idxs.length ? idxs.map(i => {
    const x = S.results[i];
    return `<tr data-i="${i}" data-id="${x.id === undefined ? "" : esc(JSON.stringify(x.id))}"><td><button type="button" class="linkish rowopen" aria-label="Open case ${esc(typeof x.id === "string" ? x.id : JSON.stringify(x.id))} (run row ${i + 1})"><b>${esc(x.id)}</b></button>${LV.mode === "slowest" ? ` <span class="hint lvms">${jevLatency(x) === null ? "Jev time unavailable" : fmtMs(jevLatency(x))}</span>` : ""}${x.error ? ` <span class="tag">error</span>` : ""}</td>${ms.map(m => `<td${flag(i, m, "jev")}>${pill(x.jev?.[m])}</td>${hasL ? `<td${flag(i, m, "llm")}>${pill(x.llm?.[m]?.score)}</td>` : ""}<td${flag(i, m, "human")}>${pill(x.human?.[m])}</td>`).join("")}<td>${fmtMs(x.jev_meta?.latency_ms)}</td><td>${x.jev_meta?.input_tokens ?? "—"}</td></tr>`;
  }).join("") : `<tr><td colspan="99" class="empty">${RF.active ? `No run row matches “${esc(RF.query)}” in this view. <button type="button" class="ghost" id="rfindClear2">Clear search</button>` : "No rows match this filter."}</td></tr>`;
  const c2 = $("#rfindClear2"); if (c2) c2.onclick = clearRunFind;
}
// ---------- search this run (t_d45415fb): VIEW-ONLY over the frozen S.results/S.runRows. Keyed on the results ref,
// so a replaced run resets it. Never touches summary, failed/slow/disagreement scopes, exports, prepare or selection.
function runFind() {
  const inp = $("#rfind");
  if (S.rfindRef !== S.results) { S.rfindRef = S.results; if (inp) inp.value = ""; }
  return findRunCases(S.results, S.runRows, inp ? inp.value : "", r => ({ req: userText(r?.query), ans: finalText(r?.response) }));
}
function renderRunFind(RF, n, inView) {
  $("#rfindbar").hidden = !S.results.length;
  $("#rfindClear").hidden = !RF.active; $("#rfindNote").hidden = !RF.active;
  const st = $("#rfindStatus"), narrowed = inView !== S.results.length;
  const ub = unboundRunRows(S.results, S.runRows).length;
  const ubT = ub ? ` · ${ub} of ${S.results.length} row${S.results.length === 1 ? "" : "s"} ${ub === 1 ? "has" : "have"} no frozen trace bound to its result, so only the case ID is searchable there (request/answer text not searched)` : "";
  st.textContent = !RF.active ? "" : `${n} shown of ${S.results.length} run rows${narrowed ? ` (${inView} in the current view)` : ""}${n ? "" : RF.shown.length ? ` · ${RF.shown.length} match${RF.shown.length === 1 ? "" : "es"} hidden by the current view filter` : ` · no match for “${RF.query}”${ub ? " in the searchable text" : ""}`}${ubT}`;
  st.classList.toggle("warn", RF.active && !n);
}
// t_aaeefd58: "Download these N shown cases (.jsonl)" = run_find_export.js over the SAME S.rfProj list (visible ordered
// search+view positions + typed ids). Two steps: the button opens a preview of the exact rows (pending, keyed on run +
// query + scope + list); any change to search/view/order/run closes it. Confirm re-derives and refuses on drift. 0 calls.
const rfxKey = P => P ? JSON.stringify([P.query, P.scope, runMatchKey(P.L)]) : null;
const rfxSame = x => !!x && x.ref === S.results && x.rr === S.runRows && x.sum === S.summary;
function rfxEval() { const c = S.rfxEv; if (c && c.ref === S.results && c.rr === S.runRows && c.sum === S.summary && c.key === S.key) return c.e;
  const e = evalExport(); S.rfxEv = { ref: S.results, rr: S.runRows, sum: S.summary, key: S.key, e: { ok: e.ok, reason: e.reason, version: e.version, at: e.at } }; return S.rfxEv.e; }
const rfxIdT = id => id === undefined ? "(no id)" : typeof id === "string" ? id : JSON.stringify(id);
const rfxTag = id => `<span class="tag">${id === undefined ? "no id" : id === null ? "null id" : typeof id === "number" ? "number" : "text"}</span>`;
const RFX_WHY = { empty: "No cases are shown by this search.", none_bound: "None of the shown matches has a frozen trace bound to its result, so there is nothing exact to download.", stale: "The cases shown changed (search, view, order or run), so nothing was downloaded." };
function renderRfx() {
  const box = $("#rfx"); if (!box) return; const P = S.rfProj;
  if (S.rfxLiveRef && S.rfxLiveRef !== rfxKey(P)) { $("#rfxLive").textContent = ""; S.rfxLiveRef = null; }
  const hadFocus = box.contains(document.activeElement), hadRfp = !!document.activeElement?.closest?.("#rfpPrev, #rfpOpen");
  if (S.rfx && (!P || !rfxSame(S.rfx) || S.rfx.key !== rfxKey(P))) { S.rfx = null; if (P) $("#rfxLive").textContent = "The search, view, order or run changed, so the download preview was closed. Nothing was downloaded."; }
  if (S.rfp && (!P || !rfxSame(S.rfp) || S.rfp.key !== rfxKey(P))) { S.rfp = null; if (P) $("#rfxLive").textContent = "The search, view, order or run changed, so the prepare preview was closed. Your selection was not changed."; }
  if (!P || !P.L.length) { box.hidden = true; box.innerHTML = ""; S.rfx = null; S.rfp = null; return; }
  const e = rfxEval(), plan = planRunFindExport({ runRows: S.runRows, results: S.results, list: P.L });
  const n = plan.include.length, x = plan.excluded.length, dis = !e.ok || !n;
  const exT = plan.excluded.map(m => `${rfxIdT(m.id)} (run row ${Number.isInteger(m.pos) ? m.pos + 1 : "?"})`).join(", ");
  const why = !e.ok ? (EVAL_WHY[e.reason] || "Not available.") : !n ? `${RFX_WHY.none_bound} Shown but not bound: ${exT}.` : "";
  const qT = P.query.length > 40 ? P.query.slice(0, 39) + "…" : P.query;
  let h = `<div class="distexp"><button type="button" class="ghost" id="rfxOpen"${dis ? " disabled" : ""} aria-expanded="${S.rfx && !dis ? "true" : "false"}" aria-controls="rfxPrev">Download ${n === 1 ? "this shown case" : `these ${n} shown cases`} (.jsonl)</button> <span class="hint" id="rfxNote">${dis ? esc(why) : `Search “${esc(qT)}” · ${esc(P.scope)} · ${n} of ${S.results.length} run rows${x ? ` · <span class="warn">${x} shown match${x === 1 ? "" : "es"} excluded (no frozen trace bound to the result)</span>` : ""}. Opens a preview; nothing downloads until you confirm.`}</span></div>`;
  if (S.rfx && !dis) {
    h += `<div id="rfxPrev" class="slowprep" role="region" aria-label="Download preview"><p><b>Download ${n} shown case${n === 1 ? "" : "s"} of ${S.results.length} run rows?</b> Exactly these, in this order, as frozen when this run started (recorded version ${esc(String(e.version ?? "unknown"))}${e.at ? `, run ${esc(new Date(e.at).toISOString().replace("T", " ").slice(0, 16))} UTC` : ""}):</p>
      <ol>${plan.include.map(m => `<li><b>${esc(rfxIdT(m.id))}</b> ${rfxTag(m.id)} · run row ${m.pos + 1}</li>`).join("")}</ol>
      ${x ? `<p class="warn">Not in the file: ${esc(exT)}: shown by search, but the frozen trace is not bound to its result, so it cannot be exported exactly. No other row is used instead.</p>` : ""}
      <p class="hint">The file is saved only to this device and contains each case's request, answer, context and tool data plus human labels as authored, which may be private. No Jev or LLM-judge scores, errors or keys; later dataset edits are not in it. Your dataset, selection, summary and other exports do not change and no calls are made. Upload it on the Dataset step (preview, then Apply adds the cases).</p>
      <div class="row"><button type="button" id="rfxGo">Download ${n} case${n === 1 ? "" : "s"} (.jsonl)</button> <button type="button" class="ghost" id="rfxCancel">Cancel</button></div></div>`;
  } else if (S.rfx) S.rfx = null;
  h += rfpHtml(P, plan, e);
  box.innerHTML = h; box.hidden = false;
  if (hadFocus && !box.contains(document.activeElement)) ((hadRfp && $("#rfpOpen:not(:disabled)")) || $("#rfxOpen:not(:disabled)") || $("#rfind"))?.focus({ preventScroll: true });
}
// t_d1c0abe0: "Prepare these N shown cases for another run…" = run_find_export.js prepareRunFind over the SAME S.rfProj
// list and plan as the download (bound matches only, shown order) through the SAME prepareRerun binding. Preview first;
// Cancel changes nothing; Confirm only sets the existing Dataset selection + Selected-cases scope and opens Run. Never runs.
function rfpCompute(P) { return prepareRunFind({ runRows: S.runRows, results: S.results, summary: S.summary, list: P ? P.L : [], runPos: S.runPos, rows: S.rows, selected: S.selected }); }
const RFP_WHY = { empty: "No cases are shown by this search.", partial: "This run is not complete, so its cases cannot be prepared.", none_bound: "None of the shown matches has a frozen trace bound to its result.", no_dataset: "The dataset these cases came from is no longer loaded in this tab." };
function rfpHtml(P, plan, e) {
  const n = plan.include.length, x = plan.excluded.length, T = S.results.length;
  if (S.rfp && S.rfp.sig !== prepSig()) S.rfp = { ...S.rfp, r: rfpCompute(P), sig: prepSig(), changed: true };
  const open = !!S.rfp && !!n, chg = open && S.rfp.changed; if (chg) S.rfp = { ...S.rfp, changed: false };
  const dis = !n;
  let h = `<div class="distexp rfpbar"><button type="button" class="ghost" id="rfpOpen"${dis ? " disabled" : ""} aria-expanded="${open}"${open ? ' aria-controls="rfpPrev"' : ""}>Prepare ${n === 1 ? "this shown case" : `these ${n} shown cases`} for another run…</button> <span class="hint" id="rfpNote">${dis ? esc(RFP_WHY.none_bound) : "Sets your Dataset selection to exactly these cases after a preview; nothing runs until you press Run."}</span></div>`;
  if (!open) { if (S.rfp && !n) S.rfp = null; return h; }
  const r = S.rfp.r, qT = P.query.length > 40 ? P.query.slice(0, 39) + "…" : P.query;
  const scope = `Search “${esc(qT)}” · ${esc(P.scope)} · ${n} of ${T} run rows${x ? ` · ${x} shown match${x === 1 ? "" : "es"} excluded` : ""}`;
  const exT = x ? `<p class="warn">Not prepared: ${esc(plan.excluded.map(m => `${rfxIdT(m.id)} (run row ${Number.isInteger(m.pos) ? m.pos + 1 : "?"})`).join(", "))}: shown by search, but the frozen trace is not bound to its result, so it cannot be matched exactly. No other row is used instead.</p>` : "";
  const shownL = `<ol>${plan.include.map(m => `<li><b>${esc(rfxIdT(m.id))}</b> ${rfxTag(m.id)} · run row ${m.pos + 1}</li>`).join("")}</ol>`;
  h += `<div id="rfpPrev" class="slowprep" role="region" aria-label="Prepare preview">${chg ? `<p class="err" role="alert">The dataset or selection changed while this was open; the preview below is updated.</p>` : ""}`;
  if (!r.ok) {
    const why = RFP_WHY[r.reason] || `${r.problems.length} of the shown cases cannot be matched to exactly one unchanged dataset row:`;
    h += `<p role="alert"><b class="err">Not prepared. Your current selection is unchanged${r.before.n ? ` (${r.before.n} ticked)` : ""}.</b> ${scope}. ${esc(why)}</p>${r.problems.length ? `<ul class="prepwhy">${r.problems.map(q => `<li><code>${esc(q.label)}</code>: ${esc(q.why)}.</li>`).join("")}</ul>` : ""}${exT}
      <p class="hint">A repeat run must use the exact rows shown, so nothing is guessed. You can still use Download these shown cases (.jsonl) above and upload that file on the Dataset step.</p>
      <div class="row"><button type="button" class="ghost" id="rfpCancel">Close</button></div></div>`;
    return h;
  }
  const b = r.before, a = r.after;
  h += `<p role="status"><b>Prepare ${a.n} shown case${a.n === 1 ? "" : "s"} for another run?</b> ${scope}. Shown order:</p>${shownL}${exT}
    <ul class="prepwhat">
      <li>Dataset selection: ${b.n ? `${b.n} ticked now (${prepIds(b.ids)})` : "nothing ticked now"} → ${a.n === 1 ? "only this case" : `exactly these ${a.n}`} (${prepIds(a.ids)}, dataset order)${r.same ? " (no change)" : ` (${r.added} added, ${r.removed} unticked, ${r.unchanged} kept)`}. Each is the unchanged dataset row that was scored in this run (same input, trace, labels and typed ID).</li>
      <li>Run step: Cases to run switches to Selected cases only, so the estimate covers ${a.n} of ${r.total} rows. Other run rows are not included.</li>
      <li>Nothing runs and nothing is spent until you press Run. The completed run, its scores, the Dashboard and exports stay as they are until then; a new run replaces the Dashboard.</li>
    </ul>
    <p class="hint">A different score on a repeat run is a new measurement, not an accuracy gain.</p>
    <div class="row"><button type="button" id="rfpOk">${a.n === 1 ? "Select this case" : `Select these ${a.n} cases`} and open Run</button> <button type="button" class="ghost" id="rfpCancel">Cancel</button></div></div>`;
  return h;
}
function rfpConfirm() {
  const pend = S.rfp; renderRows();   // re-derive the projection from the current search/view/order/run
  const P = S.rfProj, now = prepSig();
  if (S.running || !pend || !pend.r?.ok || !P || !rfxSame(pend) || pend.key !== rfxKey(P) || pend.sig !== now) {
    S.rfp = pend && P && rfxSame(pend) && pend.key === rfxKey(P) ? { ...pend, r: rfpCompute(P), sig: now } : null; renderRfx();
    ($("#rfpPrev") || $("#rfx"))?.insertAdjacentHTML("afterbegin", `<p class="err" role="alert">The search, view, order, run, dataset or selection changed after this was shown, so nothing was changed. Review the updated preview.</p>`);
    ($("#rfpOk") || $("#rfpCancel") || $("#rfpOpen:not(:disabled)") || $("#rfind"))?.focus(); return; }
  const rsSel = $("#rsSel"), rsAll = $("#rsAll"); if (!rsSel || !rsAll) return;   // never half-apply
  S.selected = new Set(pend.r.after.positions); S.rfp = null; S.rfx = null; S.slowPrep = null; S.disPrep = null; S.failPrep = null;
  rsSel.checked = true; rsAll.checked = false; rsSel.dispatchEvent(new Event("change", { bubbles: true }));
  S.prepNotice = { n: pend.r.after.n, kind: "searched", sel: selectionSummary({ rows: S.rows, selected: S.selected }).positions.join(","), rows: S.rows };
  renderData(); renderRows(); go("run"); rsSel.focus({ preventScroll: true });
  setTimeout(() => { const el = $("#prepNotice"); if (el) el.textContent = el.dataset.msg; }, 50);
}
function rfxDownload() {
  const pend = S.rfx; renderRows();   // re-derive the projection from the current search/view/order/run
  const P = S.rfProj;
  if (!pend || !P || !rfxSame(pend) || pend.key !== rfxKey(P)) { S.rfx = null; alert(`${RFX_WHY.stale} Nothing was changed.`); renderRfx(); ($("#rfxOpen:not(:disabled)") || $("#rfind"))?.focus(); return; }
  const r = buildRunFindExport({ runRows: S.runRows, results: S.results, summary: S.summary, key: S.key, list: P.L });
  if (!r.ok) { S.rfx = null; alert(`${RFX_WHY[r.reason] || EVAL_WHY[r.reason] || "Not available."} Nothing was downloaded. Nothing was changed.`); renderRfx(); ($("#rfxOpen:not(:disabled)") || $("#rfind"))?.focus(); return; }
  download(`searched-cases-${r.n}-of-${r.total}-${String(r.version || "unknown").replace(/[^\w.-]/g, "_")}-${stamp()}.jsonl`, r.text, "application/x-ndjson");
  S.rfx = null; S.rfxLiveRef = rfxKey(P); renderRfx();
  $("#rfxLive").textContent = `Downloaded ${r.n} shown case${r.n === 1 ? "" : "s"} (${r.ids.map(v => v === undefined ? "no id" : JSON.stringify(v)).join(", ")}) of ${r.total} run rows${r.excluded.length ? `; ${r.excluded.length} shown match${r.excluded.length === 1 ? "" : "es"} excluded (not bound)` : ""}. No calls were made; nothing in this run or your dataset changed.`;
  $("#rfxOpen")?.focus();
}
$("#rfx").addEventListener("keydown", e => { if (e.key === "Escape" && S.rfp && e.target.closest("#rfpPrev, #rfpOpen")) { e.preventDefault(); e.stopPropagation(); S.rfp = null; renderRfx(); $("#rfpOpen")?.focus(); } });
$("#rfx").addEventListener("click", e => {
  if (e.target.closest("#rfpOpen")) { const P = S.rfProj; if (!P) return; S.rfx = null; S.rfp = S.rfp ? null : { ref: S.results, rr: S.runRows, sum: S.summary, key: rfxKey(P), sig: prepSig(), r: rfpCompute(P) }; $("#rfxLive").textContent = ""; renderRfx(); (S.rfp ? ($("#rfpOk") || $("#rfpCancel")) : $("#rfpOpen"))?.focus(); return; }
  if (e.target.closest("#rfpCancel")) { S.rfp = null; renderRfx(); $("#rfpOpen")?.focus(); return; }
  if (e.target.closest("#rfpOk")) { rfpConfirm(); return; }
  if (e.target.closest("#rfxOpen")) { const P = S.rfProj; if (!P) return; S.rfp = null; S.rfx = S.rfx ? null : { ref: S.results, rr: S.runRows, sum: S.summary, key: rfxKey(P) }; $("#rfxLive").textContent = ""; renderRfx(); (S.rfx ? $("#rfxGo") : $("#rfxOpen"))?.focus(); return; }
  if (e.target.closest("#rfxCancel")) { S.rfx = null; renderRfx(); $("#rfxOpen")?.focus(); return; }
  if (e.target.closest("#rfxGo")) rfxDownload();
});
// t_eae08a5f: Previous/Next matching case in the existing frozen inspector. The list is EXACTLY the visible ordered
// search+view projection (S.rfProj: positions + typed ids), re-derived before every step; any change refuses. 0 calls.
function rfScopeTxt(SC, f, mode) {
  const v = SC?.ok ? "slow cases (≥ p95)" : f ? `${(VIEW[S.view] || []).join(" vs ")} disagreements · ${S.metric === "all" ? "all metrics" : M[S.metric]}` : "all rows";
  return `${v} · ${mode === "slowest" ? "slowest Jev call first" : "run order"}`;
}
const rfNavFresh = nav => !!nav && !!S.rfProj && nav.ref === S.results && S.rfProj.ref === S.results && S.rfProj.query === nav.query && S.rfProj.scope === nav.scope && runMatchKey(S.rfProj.L) === nav.key;
function rfNavCtx() { const P = S.rfProj; return P && P.L.length ? { ref: P.ref, query: P.query, scope: P.scope, L: P.L, key: runMatchKey(P.L) } : null; }
const rfLive = t => { const lv = $("#failNavLive"); if (lv) lv.textContent = t; };
function rfNavBar(pos, id, nav) {
  const st = runMatchStep(nav.L, pos, id, 0); if (st.i < 0) return null;
  const g = document.createElement("span"); g.className = "navgrp";
  const mk = (dir, txt) => { const b = document.createElement("button"); b.type = "button"; b.className = "ghost"; b.id = dir < 0 ? "rfPrev" : "rfNext"; b.textContent = txt;
    const s = runMatchStep(nav.L, pos, id, dir); b.disabled = !s.ok; b.setAttribute("aria-label", `${dir < 0 ? "Previous" : "Next"} matching case${s.ok ? ` (${s.i + 1} of ${s.n}${s.skipped ? `, skipping ${s.skipped} that cannot be opened` : ""})` : dir < 0 ? `, none before this${s.skipped ? " that can be opened" : ""}` : `, none after this${s.skipped ? " that can be opened" : ""}`}`);
    b.onclick = () => { const t = runMatchStep(nav.L, pos, id, dir); if (!t.ok) return;
      renderRows();   // re-derive the projection from the current search/view/order/run before stepping
      if (!rfNavFresh(nav) || !resolveRow(S.results, S.runRows, t.pos, t.id)) { alert("The search results shown changed (search text, view, order or run), so no other case was opened. Nothing was changed."); $("#detail").hidden = true; renderRows(); ($("#rfindbar").hidden ? $("#fOrder") : $("#rfind")).focus(); return; }
      openRow(t.pos, t.id, S.metric !== "all" ? S.metric : null, nav, dir < 0 ? "#rfPrev" : "#rfNext"); }; return b; };
  g.append(mk(-1, "‹ Previous match"), mk(1, "Next match ›"));
  const lab = document.createElement("span"); lab.className = "hint"; lab.id = "rfNavPos";
  const idT = id === undefined ? "(no id)" : typeof id === "string" ? id : JSON.stringify(id), qT = nav.query.length > 40 ? nav.query.slice(0, 39) + "…" : nav.query;
  const no = nav.L.filter(e => e.open === false).length;
  lab.innerHTML = `Match <b>${st.i + 1}</b> of <b>${nav.L.length}</b> shown · <b>${esc(idT)}</b> <span class="tag">${id === undefined ? "no id" : typeof id === "number" ? "number" : "text"}</span> · run row ${pos + 1} of ${S.results.length} · <span class="nw" title="${esc(nav.query)}">search “${esc(qT)}” · ${esc(nav.scope)}</span>${no ? ` · <span class="warn">${no} of these ${no === 1 ? "match" : "matches"} cannot be opened (no frozen trace bound to the result, matched on ID only) and ${no === 1 ? "is" : "are"} skipped</span>` : ""}`;
  rfLive(`Match ${st.i + 1} of ${nav.L.length} shown for search “${nav.query}”, ${idT}, run row ${pos + 1}.${no ? ` ${no} cannot be opened and are skipped.` : ""}`);
  return [g, lab];
}
function clearRunFind() { rfLive(""); $("#rfind").value = ""; $("#detail").hidden = true; renderRows(); $("#rfind").focus(); }
$("#rfind").oninput = () => { $("#detail").hidden = true; renderRows(); };
$("#rfind").onkeydown = e => {
  if (e.key === "Escape" && e.target.value) { e.preventDefault(); clearRunFind(); }
  else if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); $("#rtable tbody tr[data-i] .rowopen")?.click(); }
};
$("#rfindClear").onclick = clearRunFind;
$("#fView").onchange = e => { S.view = e.target.value; $("#detail").hidden = true; renderRows(); };
$("#exReview").onclick = () => {
  const r = buildReviewPacket({ summary: S.summary, results: S.results, runRows: S.runRows, view: S.view, metric: S.metric });
  if (!r.ok) { alert(r.reason); return; }
  download(`disagreement-review-${S.view}-${S.metric}-${stamp()}.json`, JSON.stringify(r.packet, null, 2));
};
$("#exPairs").onclick = () => {
  const r = buildPairPacket({ summary: S.summary, results: S.results, runRows: S.runRows });
  if (!r.ok) { alert(r.reason); return; }
  download(`pair-comparison-${stamp()}.json`, JSON.stringify(r.packet, null, 2));
};
$("#fMetric").onchange = e => { S.metric = e.target.value; $("#detail").hidden = true; renderRows(); };
const snapText = v => v == null || v === "" ? "—" : typeof v === "string" ? v : JSON.stringify(v, null, 2);
function showDetail(i, focus) {
  const d = $("#detail"); d.hidden = false; d.innerHTML = detailHTML(i, focus, true);
  const b = $("#dAll", d); if (b) b.onclick = () => showDetail(i);
  d.scrollIntoView({ behavior: "smooth" });
}
function detailHTML(i, focus, allBtn) {
  const x = S.results[i], src = S.runRows[i];
  const bound = !!src && src.id === x.id, th = S.summary.threshold;
  const pf = v => typeof v === "number" && isFinite(v) ? (v >= th ? "pass" : "fail") : "not comparable";
  const pair = m => `<div class="pairbox">${[["Jev", x.jev?.[m]], ["LLM judge", x.llm?.[m]?.score], ["Human label", x.human?.[m]]].map(([k, v]) => `<div class="pb"><b>${k}</b>${pill(v)} <span class="hint">${pf(v)}</span></div>`).join("")}</div>`;
  const ms = focus ? [focus] : Object.keys(M).filter(m => (x.jev_detail || {})[m] || x.llm?.[m]);
  return `<h3>${esc(x.id)} · row ${i + 1} of ${S.results.length} in this run${focus ? ` · ${M[focus]}` : ""} ${focus && allBtn ? `<button class="ghost" id="dAll">all metrics</button>` : ""}</h3>
    <p class="hint">Stored scores from the run at ${esc(new Date(S.summary.at).toLocaleString())} (${esc(S.summary.version)}); pass = score ≥ ${th}. Nothing is re-judged here.</p>
    ${x.error ? `<p class="err">${esc(x.error)}</p>` : ""}
    <div class="checks">` + ms.map(m => {
      const v = (x.jev_detail || {})[m] || {};
      return `<div class="m"><b>${M[m]}</b> <span class="tag">${esc(v.result ?? "no Jev result")}</span> <span class="hint" style="white-space:nowrap">conf ${v.confidence ?? "—"}</span>${pair(m)}
    <ul>${(v.checks || []).map(c => `<li>${c.type === "score" ? `Score: ${esc(c.check)} → <b>${c.value}</b>/5 (conf ${c.confidence})` : `${c.good ? "✓" : "✗"} ${c.good && c.invert ? "no " : ""}${esc(c.check)} <span class="hint">p(yes)=${c.p_yes}</span>`}</li>`).join("")}</ul>
    ${v.reason ? `<div class="hint">${esc(v.reason)}</div>` : ""}
    ${x.llm?.[m] ? `<div class="hint">LLM judge: ${x.llm[m].score ?? "n/a"}${x.llm[m].error ? " (" + esc(x.llm[m].error) + ")" : ""} · ${fmtMs(x.llm[m].latency_ms)} · ${fmt$(x.llm[m].usd)}</div>` : ""}</div>`;
    }).join("") + `</div>
    <h3 style="margin-top:14px">Trace sent to the judges <span class="hint">${bound ? "snapshot frozen when this run started; later dataset edits don't change it" : "snapshot unavailable for this row"}</span></h3>
    ${bound ? `<div class="grid2"><div><b class="hint">query</b><pre class="snap">${esc(snapText(src.query))}</pre></div><div><b class="hint">response</b><pre class="snap">${esc(snapText(src.response))}</pre></div></div>
    ${src.context != null ? `<b class="hint">context</b><pre class="snap">${esc(snapText(src.context))}</pre>` : ""}
    ${src.tool_definitions != null ? `<b class="hint">tool_definitions</b><pre class="snap">${esc(snapText(src.tool_definitions))}</pre>` : ""}
    <p class="hint">source: scenario ${esc(src.scenario || "custom")}${src.generated ? " · generated" : ""}${src.source ? " · " + esc(src.source) : ""}${src.derived_from?.id != null ? ` · <span class="tag var">variant of ${esc(src.derived_from.id)}</span>` : ""}${src.note ? " · " + esc(src.note) : ""}</p>` : ""}`;
}
// ---------- original vs variant (view-only over the frozen run; pairs only from derived_from provenance)
const sgn = v => v == null ? "unknown" : (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(2);
function pairCell(c) {
  const ex = v => v == null ? "missing" : String(v);
  return `<td class="pc" title="exact: original ${ex(c.original)} → variant ${ex(c.variant)}; change ${c.delta == null ? "unknown" : c.delta}">${pill(c.original)}<span class="hint">→</span>${pill(c.variant)} <span class="dl ${c.delta == null ? "unk" : ""}" title="variant minus original">${sgn(c.delta)}</span></td>`;
}
function renderPairs(hasL) {
  const P = buildPairs({ results: S.results, runRows: S.runRows });
  const ms = S.metric === "all" ? Object.keys(M) : [S.metric];
  const js = ["jev", ...(hasL ? ["llm"] : []), "human"], JN = { jev: "Jev", llm: "LLM", human: "Human" };
  const exT = P.excluded.length ? ` <b>Not paired (${P.excluded.length}):</b> ${P.excluded.map(e => `<code>${esc(e.variant_id)}</code> (variant of <code>${esc(e.source_id)}</code>): ${esc(e.reason)}`).join("; ")}.` : "";
  const tot = P.ok && P.pairs.length ? ` Comparable (both scores present): ${ms.map(m => `${SHORT[m]} ${js.map(j => `${JN[j]} ${P.totals[m][j].n}/${P.totals[m][j].of}`).join(" · ")}`).join("; ")}.` : "";
  $("#fNote").innerHTML = !P.ok ? esc(P.reason)
    : `<b>${P.pairs.length}</b> original / variant pair${P.pairs.length === 1 ? "" : "s"} in this frozen run, matched only by the variant's recorded source ID (exactly one row with that ID in the same run). Cells show original → variant and the signed change (variant − original) on each judge's own 1–5 scale; a missing score is <b>unknown</b>, not 0. Variants are cases <b>you authored</b> as contrasts, not observed agent behaviour, so no better/worse verdict or accuracy claim is made here. ${(() => { const n = S.results.length - new Set(P.pairs.flatMap(q => [q.original_idx, q.variant_idx])).size; return n > 0 ? `${n} other row${n === 1 ? "" : "s"} of the run ${n === 1 ? "is" : "are"} not in a pair and not shown in this view.` : ""; })()}${tot}${exT}`;
  $("#rtable thead").innerHTML = `<tr><th>Original → variant</th>${ms.map(m => js.map(j => `<th>${SHORT[m]} ${JN[j]}</th>`).join("")).join("")}</tr>`;
  $("#rtable tbody").innerHTML = P.ok && P.pairs.length ? P.pairs.map((p, k) => `<tr data-pair="${k}" title="click to compare traces"><td><b>${esc(p.original_id)}</b><span class="hint"> → </span><b>${esc(p.variant_id)}</b>${p.nested ? ` <span class="tag">variant of a variant${p.root_id != null ? ` · root ${esc(p.root_id)}` : ""}</span>` : ""}</td>${ms.map(m => js.map(j => pairCell(p.metrics[m][j])).join("")).join("")}</tr>`).join("")
    : `<tr><td colspan="99" class="empty">${P.ok ? "No original / variant pairs in this run. Create a variant on the Dataset step, then run again." : "—"}</td></tr>`;
  S._pairs = P; $("#exPairs").disabled = !P.ok;
}
function showPair(k) {
  const p = S._pairs?.pairs[k]; if (!p) return; const d = $("#detail"); d.hidden = false;
  const hasL = S.summary.llm.evaluations > 0, js = ["jev", ...(hasL ? ["llm"] : []), "human"], JN = { jev: "Jev", llm: "LLM judge", human: "Human label" };
  d.innerHTML = `<h3>Original <code>${esc(p.original_id)}</code> vs variant <code>${esc(p.variant_id)}</code></h3>
    <p class="hint">Stored scores from the frozen run at ${esc(new Date(S.summary.at).toLocaleString())} (${esc(S.summary.version)}). Change = variant − original on the same judge's 1–5 scale; unknown when either score is missing. The variant is a user-authored contrast case, not another observed agent run. Nothing is re-judged.</p>
    <div class="tablewrap"><table class="agtab"><thead><tr><th>Metric</th>${js.map(j => `<th>${JN[j]}: original → variant (change)</th>`).join("")}</tr></thead><tbody>${Object.keys(M).map(m => `<tr><td>${M[m]}</td>${js.map(j => pairCell(p.metrics[m][j])).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="grid2 pairdet"><div class="card">${detailHTML(p.original_idx)}</div><div class="card">${detailHTML(p.variant_idx)}</div></div>`;
  d.scrollIntoView({ behavior: "smooth" });
}
$("#rtable tbody").addEventListener("click", e => {
  const pr = e.target.closest("tr[data-pair]"); if (pr) { showPair(+pr.dataset.pair); return; }
  const tr = e.target.closest("tr[data-i]"); if (!tr) return; const td = e.target.closest("td.dis");
  const pos = +tr.dataset.i; let id; try { id = JSON.parse(tr.dataset.id); } catch { id = undefined; }
  if (S.rtRef !== S.results || tr.dataset.id === "" || !resolveRow(S.results, S.runRows, pos, id)) { alert("This case is no longer in the run shown here (or has no recorded ID), so it was not opened. No other case was opened instead."); renderRows(); return; }
  openRow(pos, id, td ? td.dataset.m : (S.metric !== "all" ? S.metric : null));
});
// opens the existing inspector for (run position, typed id) and keeps "Back to results" across its re-renders
function openRow(pos, id, focus, nav, focusSel) {
  if (nav === undefined) { nav = rfNavCtx(); if (nav) nav.origin = { pos, id }; }
  if (nav && runMatchStep(nav.L, pos, id, 0).i < 0) nav = null;
  const og = nav?.origin || { pos, id };
  showDetail(pos, focus);
  const d = $("#detail"), bar = document.createElement("div"), bk = document.createElement("button");
  bar.className = "distnav"; bk.type = "button"; bk.className = "ghost"; bk.id = "rowBack"; bk.textContent = "← Back to results";
  bk.onclick = () => { d.hidden = true; if (nav) rfLive(""); const t = [...$$("#rtable tbody tr[data-i]")].find(r => +r.dataset.i === og.pos && r.dataset.id === JSON.stringify(og.id))?.querySelector(".rowopen") || (S.slow ? ($("#slowExport:not(:disabled)") || $("#slowClear")) : !$("#rfindbar").hidden && $("#rfind").value.trim() ? $("#rfind") : $("#fOrder"));
    t.scrollIntoView({ block: "center" }); t.focus({ preventScroll: true }); };
  bar.append(bk); const nb = nav ? rfNavBar(pos, id, nav) : null; if (nb) bar.append(...nb); d.prepend(bar);
  let fe = focusSel ? $(focusSel, d) : bk; if (!fe || fe.disabled) fe = focusSel ? [$("#rfNext", d), $("#rfPrev", d)].find(b => b && !b.disabled) || bk : bk;
  if (focusSel) bar.scrollIntoView({ block: "start", behavior: "instant" }); fe.focus({ preventScroll: true });
  const all = $("#dAll", d); if (all) all.onclick = () => openRow(pos, id, null, nb && rfNavFresh(nav) ? nav : null);
}
// ---------- prepare the shown disagreement cases for another run (t_0e0d57f4): same binding as slow cases
// (prepareRerun over the exact frozen run rows the filter shows); proposes Dataset selection + Selected-cases scope only.
const disKey = () => JSON.stringify([S.view, S.metric]);
function disMembers() {
  const f = filterState(); if (!f || !f.c.disagree) return null;
  return [...f.hits.keys()].filter(pos => pos < S.results.length).sort((a, b) => a - b).map(pos => ({ pos, id: S.results[pos]?.id }));
}
function disPrepCompute() { return prepareRerun({ members: disMembers(), runRows: S.runRows, runPos: S.runPos, rows: S.rows, selected: S.selected }); }
function disScope() {
  const [A, B] = VIEW[S.view] || ["?", "?"], c = filterState()?.c;
  return { A, B, m: S.metric === "all" ? "all metrics" : M[S.metric], th: S.summary?.threshold, n: c?.rows_disagree ?? 0, pairs: c?.disagree ?? 0 };
}
function renderDisBar() {
  const b = $("#disBar"); if (!b) return;
  const live = S.view === "jev_vs_human" || S.view === "jev_vs_llm";
  if (S.disPrep && (S.disPrep.ref !== S.results || S.disPrep.summary !== S.summary || S.disPrep.key !== disKey() || !live)) S.disPrep = null;   // changed run/filter invalidates
  const mem = live && !S.slow ? disMembers() : null;
  if (!mem) { b.hidden = true; b.innerHTML = ""; return; }
  if (S.disPrep && S.disPrep.sig !== prepSig()) S.disPrep = { ...S.disPrep, r: disPrepCompute(), changed: true, sig: prepSig() };
  const n = mem.length, open = !!S.disPrep;
  b.hidden = false;
  b.innerHTML = `<div class="row"><button type="button" id="disPrepBtn" aria-expanded="${open}" aria-controls="disPrep">Prepare these ${n === 1 ? "case" : `${n} cases`} for another run…</button></div>
    <div id="disPrep" class="slowprep"${open ? "" : " hidden"}>${open && S.disPrep.changed ? `<p class="err" role="alert">The dataset or selection changed while this was open; the preview below is updated.</p>` : ""}${open ? disPrepHtml(S.disPrep.r) : ""}</div>`;
}
function disPrepHtml(r) {
  const s = disScope(), scope = `${s.A} vs ${s.B} pass/fail disagreements · ${esc(s.m)} · pass = score ≥ ${s.th} · ${s.pairs} disagreeing metric pair${s.pairs === 1 ? "" : "s"} in ${s.n} row${s.n === 1 ? "" : "s"}`;
  if (!r.ok) {
    const why = r.reason === "no_dataset" ? "The dataset these cases came from is no longer loaded in this tab."
      : r.reason === "empty" ? "There are no disagreement cases to prepare." : `${r.problems.length} of the shown cases cannot be matched to exactly one unchanged dataset row:`;
    return `<p class="hint">${scope}</p><p role="alert"><b class="err">Not prepared. Your current selection is unchanged${r.before.n ? ` (${r.before.n} ticked)` : ""}.</b> ${why}</p>${r.problems.length ? `<ul class="prepwhy">${r.problems.map(p => `<li><code>${esc(p.label)}</code>: ${esc(p.why)}.</li>`).join("")}</ul>` : ""}
      <p class="hint">A repeat run must use the exact rows that were compared, so nothing is guessed. You can still use Download disagreement review (.json) above, or the evaluated dataset (.jsonl) on the Export step; the completed run and its scores stay on the Dashboard.</p>
      <div class="row"><button type="button" class="ghost" id="disPrepCancel">Close</button></div>`;
  }
  const b = r.before, a = r.after;
  return `<p role="status"><b>Prepare ${a.n} case${a.n === 1 ? "" : "s"} for another run?</b> IDs in dataset order: ${prepIds(a.ids)}.</p>
    <p class="hint">From: ${scope}.</p>
    <ul class="prepwhat">
      <li>Dataset selection: ${b.n ? `${b.n} ticked now (${prepIds(b.ids)})` : "nothing ticked now"} → ${a.n === 1 ? "only this case" : `exactly these ${a.n}`}${r.same ? " (no change)" : ` (${r.added} added, ${r.removed} unticked, ${r.unchanged} kept)`}. Each is the unchanged dataset row that was scored in this run (same input, trace, labels and typed ID).</li>
      <li>Run step: Cases to run switches to Selected cases only, so the estimate covers ${a.n} of ${r.total} rows.</li>
      <li>Nothing runs and nothing is spent until you press Run. Labels, the completed run, its scores and the Dashboard stay as they are until then.</li>
    </ul>
    <p class="hint">Jev, human labels and the LLM judge are different measurements. A different score or pass/fail on a repeat run is not an accuracy gain and does not settle who was right.</p>
    <div class="row"><button type="button" id="disPrepOk">${a.n === 1 ? "Select this case" : `Select these ${a.n} cases`} and open Run</button> <button type="button" class="ghost" id="disPrepCancel">Cancel</button></div>`;
}
$("#disBar")?.addEventListener("click", e => {
  if (e.target.closest("#disPrepBtn")) {
    if (S.disPrep) { S.disPrep = null; renderRows(); $("#disPrepBtn")?.focus(); return; }
    S.disPrep = { r: disPrepCompute(), sig: prepSig(), key: disKey(), ref: S.results, summary: S.summary }; renderRows();
    ($("#disPrepOk") || $("#disPrepCancel"))?.focus(); return; }
  if (e.target.closest("#disPrepCancel")) { S.disPrep = null; renderRows(); $("#disPrepBtn")?.focus(); return; }
  if (e.target.closest("#disPrepOk")) {
    const P = S.disPrep, now = prepSig();
    if (!P?.r?.ok || P.ref !== S.results || P.summary !== S.summary || P.key !== disKey() || P.sig !== now) {
      S.disPrep = P && P.ref === S.results && P.key === disKey() ? { r: disPrepCompute(), sig: now, key: disKey(), ref: S.results, summary: S.summary } : null; renderRows();
      ($("#disPrep") || $("#fNote"))?.insertAdjacentHTML("afterbegin", `<p class="err" role="alert">The dataset, selection, filter or run changed after this was shown, so nothing was changed. Review the updated preview.</p>`); ($("#disPrepOk") || $("#disPrepCancel") || $("#disPrepBtn") || $("#fView"))?.focus(); return; }
    S.selected = new Set(P.r.after.positions); S.disPrep = null;
    $("#rsSel").checked = true; $("#rsAll").checked = false; $("#rsSel").dispatchEvent(new Event("change", { bubbles: true }));
    S.prepNotice = { n: P.r.after.n, kind: "disagreement", sel: selectionSummary({ rows: S.rows, selected: S.selected }).positions.join(","), rows: S.rows };
    renderData(); renderRows(); go("run");
    setTimeout(() => { const el = $("#prepNotice"); if (el) el.textContent = el.dataset.msg; }, 50);
  }
});
// ---------- failed cases of this run (t_cfc8f5a5): which rows had a failed judge call, by judge + reason; prepare only
// those rows for a deliberate repeat run through the SAME prepareRerun binding. View + prepare make 0 calls; never runs.
const failAll = () => failedCases({ results: S.results, runCfg: S.runCfg });
// t_c1326574: ONE visible scope. S.failFilt {ref, judge, metric} narrows the SAME members (failFocus); the list, stepping,
// download and prepare all read failNow(), so no action silently uses a different set. A replaced run resets it.
function failFilt() { if (!S.failFilt || S.failFilt.ref !== S.results) S.failFilt = { ref: S.results, judge: "", metric: "" }; return S.failFilt; }
const failNow = () => { const A = failAll(), f = failFilt(); return failFocus(A, f); };
const FJ = { jev: "Jev", llm: "LLM judge" };
const failMetricTxt = k => k === FAIL_ROW ? "all metrics (row-level Jev call)" : (M[k] || k);
function failScopeTxt(F) { const f = F?.focus; if (!f || f.all) return "all failed calls"; return [f.judge ? FJ[f.judge] : "any judge", f.metric ? failMetricTxt(f.metric) : "any metric"].join(" · "); }
const failMembers = F => F?.ok ? F.members.map(m => ({ pos: m.pos, id: m.id })) : null;
function failPrepCompute(F) { return prepareRerun({ members: failMembers(F), runRows: S.runRows, runPos: S.runPos, rows: S.rows, selected: S.selected }); }
const failWhyTxt = o => Object.entries(o).map(([k, n]) => `${n} × ${esc(k)}`).join(" · ");
function renderFailBar() {
  const b = $("#failBar"); if (!b) return;
  const lv = $("#failExportLive"); if (lv && S.failDoneRef !== S.results) lv.textContent = "";   // confirmation lives outside the re-rendered bar
  if (!S.summary || !S.results.length) { b.hidden = true; b.innerHTML = ""; S.failPrep = null; return; }
  const F = failNow();
  if (!F.ok) { b.hidden = true; b.innerHTML = ""; S.failPrep = null; return; }
  if (S.failPrep && (S.failPrep.ref !== S.results || S.failPrep.list !== JSON.stringify(failMembers(F)))) S.failPrep = null;   // changed run invalidates
  if (S.failPrep && S.failPrep.sig !== prepSig()) S.failPrep = { ...S.failPrep, r: failPrepCompute(F), sig: prepSig(), changed: true };
  const n = F.members.length, T = F.failed_total ?? n, foc = F.focus && !F.focus.all, ex = Object.keys(F.excluded).length ? ` Not failures, not counted (per metric result): ${failWhyTxt(F.excluded)} (unavailable, never 0).` : "";
  b.hidden = false;
  if (!T) { b.innerHTML = `<p class="hint" id="failNote" tabindex="-1"><b>No failed judge calls</b> in this run's ${F.rows} row${F.rows === 1 ? "" : "s"}. A low score is a result, not a failure.${ex}</p>`; return; }
  const open = !!S.failPrep, chg = open && S.failPrep.changed; if (chg) S.failPrep = { ...S.failPrep, changed: false };
  const O = failFocusOptions(failAll(), F.focus?.judge), fj = F.focus?.judge || "", fm = F.focus?.metric || "";
  const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(t)}</option>`;
  const filt = `<div class="failfilt" role="group" aria-label="Focus failed cases"><label>Failed judge <select id="failJudge">${opt("", "Any judge", fj)}${O.judges.map(j => opt(j, FJ[j] || j, fj)).join("")}</select></label> <label>Failed metric <select id="failMetric">${opt("", "Any metric", fm)}${O.metrics.map(k => opt(k, failMetricTxt(k), fm)).join("")}</select></label>${foc ? ` <button type="button" class="ghost" id="failFiltAll">Show all failed calls</button>` : ""}</div>
    <p class="hint" id="failCount"><b>${n}</b> shown of <b>${T}</b> failed row${T === 1 ? "" : "s"} of ${F.rows} run rows · scope: <b>${esc(failScopeTxt(F))}</b>. Each row is counted once even when several of its calls failed. Options list only judges and metrics with a recorded failure in this run; filtering makes no calls and changes no result.</p>`;
  const list = F.members.map(m => `<li><button type="button" class="linkish failopen" data-p="${m.pos}" data-id="${esc(JSON.stringify(m.id ?? null))}" aria-label="Open case ${esc(typeof m.id === "string" ? m.id : JSON.stringify(m.id))} (run row ${m.pos + 1})"><b>${esc(m.id === undefined ? "(no id)" : m.id)}</b></button> <span class="tag">${typeof m.id === "number" ? "number" : "text"}</span> <span class="hint">run row ${m.pos + 1}: ${esc(m.reasons.map(r => (r.metric ? `${SHORT[r.metric]}: ` : "all metrics: ") + r.why).join("; "))}</span></li>`).join("");
  b.innerHTML = `<p id="failNote" tabindex="-1"><b>${T}</b> of <b>${F.rows}</b> rows had a failed judge call; ${F.ok_rows} returned results.${F.jev_rows ? ` Jev: ${F.jev_rows} row${F.jev_rows === 1 ? "" : "s"} (${failWhyTxt(F.jev_reasons)}).` : " Jev: none failed."}${F.llm_requested ? (F.llm_rows ? ` LLM judge: ${F.llm_rows} row${F.llm_rows === 1 ? "" : "s"} (${failWhyTxt(F.llm_reasons)}).` : F.llm_errors_unrecorded ? " LLM judge: failures cannot be told apart from missing scores on the Foundry run path." : " LLM judge: none failed.") : " LLM judge: not requested in this run."}${ex}</p>
    <p class="hint">A failure is a requested judge call that returned no result. Low scores are results, not failures; missing scores are never shown as 0. Recorded results stay as they are.</p>
    ${filt}
    ${n ? `<ul class="faillist">${list}</ul>
    ${failExportHTML(F)}
    <div class="row"><button type="button" id="failPrepBtn" aria-expanded="${open}" aria-controls="failPrep">Prepare ${n === 1 ? `this ${foc ? "shown " : ""}failed case` : `these ${n} ${foc ? "shown " : ""}failed cases`} for another run…</button>${foc ? ` <span class="hint">scope: ${esc(failScopeTxt(F))}</span>` : ""}</div>` : `<p class="hint" id="failEmpty">No failed row matches this focus. ${(S.failShown = null, "")}<button type="button" class="linkish" id="failFiltAll2">Show all failed calls</button></p>`}
    <div id="failPrep" class="slowprep"${open ? "" : " hidden"}>${chg ? `<p class="err" role="alert">The dataset or selection changed while this was open; the preview below is updated.</p>` : ""}${open ? failPrepHtml(S.failPrep.r, F) : ""}</div>`;
}
// t_5a0f5b6a: open a failed case in the existing frozen-run inspector and step the SAME failedCases list (run order,
// position + typed id) with Previous/Next failed case. Shows only the member's RECORDED failure reasons next to its frozen
// trace. Re-derived before every step; a changed/replaced run or list refuses and opens nothing else. 0 calls, no mutation.
function failNavCtx() { const F = failNow(), L = failNavList(F); return L.length ? { ref: S.results, L, key: failNavKey(L), scope: F.focus && !F.focus.all ? failScopeTxt(F) : "" } : null; }
const failNavFresh = nav => !!nav && nav.ref === S.results && !!S.summary && failNavKey(failNavList(failNow())) === nav.key;
const failIdTxt = id => id === undefined ? "(no id)" : typeof id === "string" ? id : JSON.stringify(id);
function failNavRefuse(msg) { alert(`The failed cases shown no longer match this run (it was replaced, cleared or changed), so ${msg}. No other case was opened instead. Nothing was changed.`); $("#detail").hidden = true; renderRows(); failFocusHome(); }
function failFocusHome() { const t = $("#failNote") || $("#fNote"); if (t) { if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1"); t.scrollIntoView({ block: "center" }); t.focus({ preventScroll: true }); } }
function openFailCase(pos, id, nav, focusSel) {
  if (nav === undefined) { nav = failNavCtx(); if (nav) nav.y = scrollY; }
  if (!nav || !failNavFresh(nav) || !resolveRow(S.results, S.runRows, pos, id)) return failNavRefuse("this case was not opened");
  const i = nav.L.findIndex(e => e.pos === pos && JSON.stringify(e.id) === JSON.stringify(id) && typeof e.id === typeof id);
  if (i < 0) return failNavRefuse("this case was not opened");
  showDetail(pos);
  const d = $("#detail"), bar = document.createElement("div"), bk = document.createElement("button");
  bar.className = "distnav"; bar.id = "failNav";
  bk.type = "button"; bk.className = "ghost"; bk.id = "failBack"; bk.textContent = "\u2190 Back to failed cases";
  bk.onclick = () => { d.hidden = true; renderRows(); const fr = failNavFresh(nav);
    const t = fr ? [...$$("#failBar .failopen")].find(b => +b.dataset.p === pos && b.dataset.id === JSON.stringify(id ?? null)) : null;
    if (!t) return failFocusHome();
    if (typeof nav.y === "number") scrollTo({ top: nav.y, behavior: "instant" });
    { const r = t.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) t.scrollIntoView({ block: "center" }); } t.focus({ preventScroll: true }); };
  const mk = (dir, txt) => { const b = document.createElement("button"); b.type = "button"; b.className = "ghost"; b.id = dir < 0 ? "failPrev" : "failNext"; b.textContent = txt;
    const s = distNavStep(nav.L, pos, id, dir); b.disabled = !s.ok; b.setAttribute("aria-label", `${dir < 0 ? "Previous" : "Next"} failed case${s.ok ? ` (${s.i + 1} of ${s.n})` : dir < 0 ? ", this is the first" : ", this is the last"}`);
    b.onclick = () => { const t = distNavStep(nav.L, pos, id, dir); if (!t.ok) return; if (!failNavFresh(nav)) return failNavRefuse("no other case was opened");
      openFailCase(t.pos, t.id, nav, dir < 0 ? "#failPrev" : "#failNext"); }; return b; };
  const lab = document.createElement("span"); lab.className = "hint"; lab.id = "failNavPos";
  lab.innerHTML = `Failed case <b>${i + 1}</b> of <b>${nav.L.length}</b>${nav.scope ? ` shown (${esc(nav.scope)})` : ""} \u00b7 <b>${esc(failIdTxt(id))}</b> <span class="tag">${typeof id === "number" ? "number" : "text"}</span> \u00b7 run row ${pos + 1} of ${S.results.length} \u00b7 <span class="nw">${nav.scope ? `shown failed cases (${esc(nav.scope)}), in run order` : "failed judge calls of this run, in run order"}</span>`;
  const g = document.createElement("span"); g.className = "navgrp"; g.append(mk(-1, "\u2039 Previous failed case"), mk(1, "Next failed case \u203a"));
  const R = nav.L[i].reasons, why = document.createElement("div"); why.className = "failwhy"; why.id = "failWhy";
  why.innerHTML = `<b>Recorded failure${R.length === 1 ? "" : "s"} for this case</b> <span class="hint">(as stored in this run; not re-checked, no explanation added)</span><ul>${R.map(r => `<li>${r.judge === "llm" ? "LLM judge" : "Jev"} \u00b7 ${r.metric ? esc(M[r.metric] || r.metric) : "all metrics (one Jev call scores every metric of the row)"}: ${esc(r.why)}</li>`).join("")}</ul>`;
  bar.append(bk, g, lab); d.prepend(bar, why);
  const lv = $("#failNavLive"); if (lv) lv.textContent = `Failed case ${i + 1} of ${nav.L.length}${nav.scope ? " shown, " + nav.scope : ""}, ${failIdTxt(id)} (${typeof id === "number" ? "number" : "text"}), run row ${pos + 1}.`;
  const all = $("#dAll", d); if (all) all.onclick = () => openFailCase(pos, id, nav);
  let f = focusSel ? $(focusSel, d) : bk; if (!f || f.disabled) f = focusSel ? ($("#failNext", d)?.disabled === false ? $("#failNext", d) : $("#failPrev", d)?.disabled === false ? $("#failPrev", d) : bk) : bk;
  bar.scrollIntoView({ block: "start", behavior: "instant" }); f.focus({ preventScroll: true });
  { const r = f.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) f.scrollIntoView({ block: "nearest", behavior: "instant" }); }
}
// t_0e89d114: the failed rows as a .jsonl evaluation dataset = case_list_export.js over the SAME failedCases members
// (run position + typed id) and the evaluated-dataset serializer: exact frozen input rows in run order, no scores, no
// keys. Re-derived and compared at click; a changed/replaced run refuses. 0 calls, nothing mutated.
function failExportHTML(F) {
  const L = failMembers(F) || [], n = L.length; S.failShown = { ref: S.results, L: JSON.stringify(L) };
  const e = evalExport();
  return `<div class="distexp failx"><button type="button" class="ghost" id="failExport"${e.ok ? "" : " disabled"}>Download ${n === 1 ? `this ${F.focus && !F.focus.all ? "shown " : ""}failed case` : `these ${n} ${F.focus && !F.focus.all ? "shown " : ""}failed cases`} (.jsonl)</button> <span class="hint" id="failExportNote">${e.ok ? `<b>Failed cases of this run · ${esc(failScopeTxt(F))}</b>: exactly the ${n} of ${F.rows} run rows listed above${F.focus && !F.focus.all ? ` (${n} shown of ${F.failed_total} failed rows; the others are not in the file)` : ""}, in run order, as frozen when the run started (recorded version ${esc(String(e.version ?? "unknown"))}${e.at ? `, run ${esc(new Date(e.at).toISOString().replace("T", " ").slice(0, 16))} UTC` : ""}). It includes the input trace and human labels as authored, which may contain private content; no Jev or LLM-judge scores or error text, no keys, and later dataset edits are not in it. Downloading repeats no calls. Upload it on the Dataset step (preview, then Apply adds the cases) or in another tool.` : esc(EVAL_WHY[e.reason] || "Not available.")}</span></div>`;
}
function failExport() {
  const F = failNow(), L = failMembers(F), sh = S.failShown;
  const fresh = L && L.length && sh && sh.ref === S.results && sh.L === JSON.stringify(L);
  const r = fresh ? buildCaseListExport({ runRows: S.runRows, results: S.results, summary: S.summary, key: S.key, list: L }) : { ok: false, reason: L && L.length ? "stale" : "empty" };
  if (!r.ok) { alert(`${r.reason === "stale" ? "The failed cases shown no longer match this run (it was replaced, cleared or changed)." : r.reason === "empty" ? "This run has no failed cases." : EVAL_WHY[r.reason] || "Not available."} Nothing was downloaded. Nothing was changed.`); renderRows(); ($("#failExport") || $("#failNote"))?.focus(); return; }
  download(`failed-cases-${F.focus && !F.focus.all ? `shown-${[F.focus.judge || "anyjudge", F.focus.metric ? (F.focus.metric === FAIL_ROW ? "rowlevel" : F.focus.metric) : "anymetric"].join("-")}-` : ""}${r.n}-of-${r.total}-${String(r.version || "unknown").replace(/[^\w.-]/g, "_")}-${stamp()}.jsonl`, r.text, "application/x-ndjson");
  S.failDoneRef = S.results; const nt = $("#failExportLive"); if (nt) nt.textContent = `Downloaded ${r.n} failed case${r.n === 1 ? "" : "s"}${F.focus && !F.focus.all ? ` shown for scope “${failScopeTxt(F)}”` : " (all failed calls)"} (${r.ids.map(v => JSON.stringify(v)).join(", ")}) of ${r.total} run rows. No calls were made; nothing in this run or your dataset changed.`;
}
function failPrepHtml(r, F) {
  if (!r.ok) {
    const why = r.reason === "no_dataset" ? "The dataset these cases came from is no longer loaded in this tab."
      : r.reason === "empty" ? "There are no failed cases to prepare." : `${r.problems.length} of the failed cases cannot be matched to exactly one unchanged dataset row:`;
    return `<p role="alert"><b class="err">Not prepared. Your current selection is unchanged${r.before.n ? ` (${r.before.n} ticked)` : ""}.</b> Scope: ${esc(failScopeTxt(F))}${F.focus && !F.focus.all ? ` (${F.members.length} shown of ${F.failed_total} failed rows)` : ""}. ${why}</p>${r.problems.length ? `<ul class="prepwhy">${r.problems.map(p => `<li><code>${esc(p.label)}</code>: ${esc(p.why)}.</li>`).join("")}</ul>` : ""}
      <p class="hint">A retry must use the exact rows that failed, so nothing is guessed. You can still download the evaluated dataset on the Export step; the completed run and its results stay on the Dashboard.</p>
      <div class="row"><button type="button" class="ghost" id="failPrepCancel">Close</button></div>`;
  }
  const b = r.before, a = r.after, ms = selMetrics(), bl = !$("#useBaseline").disabled && $("#useBaseline").checked;
  return `<p role="status"><b>Prepare ${a.n} failed case${a.n === 1 ? "" : "s"} for another run?</b> Scope: ${esc(failScopeTxt(F))}${F.focus && !F.focus.all ? ` (${F.members.length} shown of ${F.failed_total} failed rows)` : ""}. IDs in dataset order: ${prepIds(a.ids)}.</p>
    <ul class="prepwhat">
      <li>Dataset selection: ${b.n ? `${b.n} ticked now (${prepIds(b.ids)})` : "nothing ticked now"} → ${a.n === 1 ? "only this case" : `exactly these ${a.n}`}${r.same ? " (no change)" : ` (${r.added} added, ${r.removed} unticked, ${r.unchanged} kept)`}. Each is the unchanged dataset row that failed in this run (same input, trace, labels and typed ID). The ${F.ok_rows} row${F.ok_rows === 1 ? "" : "s"} that returned results ${F.ok_rows === 1 ? "is" : "are"} not included${F.focus && !F.focus.all ? `, nor the ${F.failed_total - F.members.length} failed row${F.failed_total - F.members.length === 1 ? "" : "s"} outside this focus` : ""}.</li>
      <li>What will run: the metrics ticked on the Run step now (${ms.length ? esc(ms.map(m => M[m]).join(", ")) : "none ticked; Run stays disabled"}), LLM judge ${bl ? "on" : "off"}. This run mode repeats <b>every</b> ticked metric and judge for each selected row, not only the call that failed (one Jev call scores all metrics of a row).</li>
      <li>Run step: Cases to run switches to Selected cases only, so the estimate covers ${a.n} of ${r.total} rows.</li>
      <li>Nothing runs, is retried or is spent until you press Run. The completed run, its results and exports stay as they are until then; a new run replaces the Dashboard.</li>
    </ul>
    <p class="hint">The same call may fail again. A result on a repeat run is a new measurement, not a fix of the old run.</p>
    <div class="row"><button type="button" id="failPrepOk">${a.n === 1 ? "Select this case" : `Select these ${a.n} cases`} and open Run</button> <button type="button" class="ghost" id="failPrepCancel">Cancel</button></div>`;
}
$("#failBar")?.addEventListener("change", e => {
  const j = e.target.closest("#failJudge"), m = e.target.closest("#failMetric"); if (!j && !m) return;
  const f = failFilt(); let reset = false;
  if (j) { f.judge = j.value; if (f.metric && !failFocusOptions(failAll(), f.judge).metrics.includes(f.metric)) { f.metric = ""; reset = true; } }
  else f.metric = m.value;
  setFailFilt(f.judge, f.metric, j ? "#failJudge" : "#failMetric", reset);
});
function setFailFilt(judge, metric, focusSel, reset) {
  const f = failFilt(); f.judge = judge; f.metric = metric;
  S.failPrep = null; S.failDoneRef = null; $("#detail").hidden = true; renderRows(); $(focusSel)?.focus();
  const F = failNow(), lv = $("#failNavLive");
  if (lv && F?.ok) lv.textContent = `${F.members.length} shown of ${F.failed_total} failed rows, scope ${failScopeTxt(F)}.${reset ? " Failed metric reset to Any metric." : ""}`;
}
$("#failBar")?.addEventListener("click", e => {
  if (e.target.closest("#failFiltAll, #failFiltAll2")) { setFailFilt("", "", "#failJudge"); return; }
  if (e.target.closest("#failExport")) { failExport(); return; }
  const o = e.target.closest(".failopen"); if (o) { const p = +o.dataset.p; if (S.results[p]) openFailCase(p, S.results[p].id); return; }
  if (e.target.closest("#failPrepBtn")) {
    if (S.failPrep) { S.failPrep = null; renderRows(); $("#failPrepBtn")?.focus(); return; }
    const F = failNow(); S.failPrep = { r: failPrepCompute(F), sig: prepSig(), ref: S.results, list: JSON.stringify(failMembers(F)) }; renderRows();
    ($("#failPrepOk") || $("#failPrepCancel"))?.focus(); return; }
  if (e.target.closest("#failPrepCancel")) { S.failPrep = null; renderRows(); $("#failPrepBtn")?.focus(); return; }
  if (e.target.closest("#failPrepOk")) {
    const P = S.failPrep, F = failNow(), now = prepSig();
    if (!P?.r?.ok || P.ref !== S.results || P.list !== JSON.stringify(failMembers(F)) || P.sig !== now) {
      S.failPrep = P && P.ref === S.results ? { r: failPrepCompute(F), sig: now, ref: S.results, list: JSON.stringify(failMembers(F)) } : null; renderRows();
      ($("#failPrep:not([hidden])") || $("#failNote"))?.insertAdjacentHTML("afterbegin", `<p class="err" role="alert">The dataset, selection or run changed after this was shown, so nothing was changed. Review the updated preview.</p>`); ($("#failPrepOk") || $("#failPrepCancel") || $("#failPrepBtn"))?.focus(); return; }
    const rsSel = $("#rsSel"), rsAll = $("#rsAll"); if (!rsSel || !rsAll) return;   // never half-apply
    S.selected = new Set(P.r.after.positions); S.failPrep = null; S.slowPrep = null; S.disPrep = null;
    rsSel.checked = true; rsAll.checked = false; rsSel.dispatchEvent(new Event("change", { bubbles: true }));
    S.prepNotice = { n: P.r.after.n, kind: "failed", sel: selectionSummary({ rows: S.rows, selected: S.selected }).positions.join(","), rows: S.rows };
    renderData(); renderRows(); go("run"); rsSel.focus({ preventScroll: true });
    setTimeout(() => { const el = $("#prepNotice"); if (el) el.textContent = el.dataset.msg; }, 50);
  }
});
// ---------- slow cases behind the p95 headline (t_1b23e244): view-only, 0 calls, threshold = the run's own p95
function renderSlowBar(sc) {
  if (S.slowPrep && sc?.ok && S.slowPrep.sig !== prepSig()) S.slowPrep = { r: slowPrepCompute(), sig: prepSig(), changed: true };   // t_d0deefc7: recompute + announce once
  const slowChg = !!S.slowPrep?.changed; if (slowChg) S.slowPrep = { ...S.slowPrep, changed: false };
  const b = $("#slowBar"); if (!sc) { b.hidden = true; b.innerHTML = ""; return; }
  if (!sc.ok) { b.hidden = false; b.innerHTML = `<p>No measured Jev p95 for this run, so there are no slow cases to show.</p><button type="button" class="ghost" id="slowClear">Show all results</button>`; return; }
  const ex = Object.entries(sc.excluded), n = sc.members.length;
  b.hidden = false;
  b.innerHTML = `<p><b>${n}</b> slow case${n === 1 ? "" : "s"}: recorded Jev call time ≥ this run's measured p95 of <b>${fmtMs(sc.p95)}</b>, out of <b>${sc.denominator}</b> rows with a recorded Jev call time (of ${sc.rows} in the run).${sc.ties ? ` ${sc.ties} at exactly p95, included.` : ""}${ex.length ? ` Not counted: ${ex.map(([k, c]) => `${c} ${esc(k)}`).join(" · ")} (unavailable, never 0).` : ""}</p>
    <p class="hint">One Jev call scores every metric of a row, so this is call-level time for all metrics together; it is not the LLM judge's per-metric time or end-to-end app time. p95 uses the same method as the headline (linear interpolation over recorded times).${sc.small_n ? ` <b>Small sample:</b> with ${sc.denominator} timed rows, p95 sits near the slowest case and is a rough guide, not a stable tail estimate.` : ""}${sc.no_call_zero ? ` ${sc.no_call_zero} row(s) had no applicable metric and recorded 0 ms with no call.` : ""} Shown slowest first; equal times keep run order. Scores, the dashboard and exports are unchanged.</p>
    <div class="row"><button type="button" id="slowPrepBtn"${n ? "" : " disabled"} aria-expanded="${S.slowPrep ? "true" : "false"}" aria-controls="slowPrep">Prepare these cases for another run…</button> <button type="button" id="slowExport"${n ? "" : " disabled"}>Download slow cases as evaluated dataset (.jsonl)</button> <button type="button" class="ghost" id="slowClear">Show all results</button></div>
    <p class="hint">The file holds the exact rows sent to the judges for ${n === 1 ? "this case" : `these ${n} cases, in the order shown`}, with IDs, labels and provenance as they were at run start. Human labels in it are the ones you entered; no Jev or LLM scores are written into it. Saved to your device only; re-import with Upload on the Dataset step.</p>
    <div id="slowPrep" class="slowprep"${S.slowPrep ? "" : " hidden"}>${slowChg ? `<p class="err" role="alert">The dataset or selection changed while this was open; the preview below is updated.</p>` : ""}${S.slowPrep ? slowPrepHtml(S.slowPrep.r) : ""}</div>`;
}
// ---------- prepare slow cases for another run (t_7d8754cd): proposes a new Dataset selection + Selected-cases Run
// scope; shows exactly what changes first; Cancel changes nothing; never runs, never touches results/scores.
const prepIds = ids => ids.map(v => `<code>${esc(v === undefined ? "(no id)" : JSON.stringify(v))}</code>`).join(", ");
function slowPrepHtml(r) {
  if (!r.ok) {
    const why = r.reason === "no_dataset" ? "The dataset these cases came from is no longer loaded in this tab."
      : r.reason === "empty" ? "There are no slow cases to prepare." : `${r.problems.length} of the slow cases cannot be matched to exactly one unchanged dataset row:`;
    return `<p role="alert"><b class="err">Not prepared. Your current selection is unchanged${r.before.n ? ` (${r.before.n} ticked)` : ""}.</b> ${why}</p>${r.problems.length ? `<ul class="prepwhy">${r.problems.map(p => `<li><code>${esc(p.label)}</code>: ${esc(p.why)}.</li>`).join("")}</ul>` : ""}
      <p class="hint">A repeat run must use the exact rows that were timed, so nothing is guessed. You can still use Download slow cases as evaluated dataset (.jsonl) and upload it as new rows; the completed run and its scores stay on the Dashboard.</p>
      <div class="row"><button type="button" class="ghost" id="slowPrepCancel">Close</button></div>`;
  }
  const b = r.before, a = r.after;
  return `<p role="status"><b>Prepare ${a.n} case${a.n === 1 ? "" : "s"} for another run?</b> IDs in dataset order: ${prepIds(a.ids)}.</p>
    <ul class="prepwhat">
      <li>Dataset selection: ${b.n ? `${b.n} ticked now (${prepIds(b.ids)})` : "nothing ticked now"} → ${a.n === 1 ? "only this case" : `exactly these ${a.n}`}${r.same ? " (no change)" : ` (${r.added} added, ${r.removed} unticked, ${r.unchanged} kept)`}. Each is the unchanged dataset row that was timed in this run (same input, trace, labels and typed ID).</li>
      <li>Run step: Cases to run switches to Selected cases only, so the estimate covers ${a.n} of ${r.total} rows.</li>
      <li>Nothing runs and nothing is spent until you press Run. The dataset rows, the completed run, its scores and the Dashboard stay as they are until then.</li>
    </ul>
    <p class="hint">A repeat run measures latency again; a different time or score next run is normal variation, not a speed or accuracy gain.</p>
    <div class="row"><button type="button" id="slowPrepOk">${a.n === 1 ? "Select this case" : `Select these ${a.n} cases`} and open Run</button> <button type="button" class="ghost" id="slowPrepCancel">Cancel</button></div>`;
}
function slowPrepCompute() {
  const sc = slowCases({ results: S.results, summary: S.summary });
  return prepareSlowRerun({ sc, runRows: S.runRows, runPos: S.runPos, rows: S.rows, selected: S.selected });
}
const prepSig = () => JSON.stringify([S.rows, selectionSummary({ rows: S.rows, selected: S.selected }).positions]);
$("#kpis").addEventListener("click", e => { if (!e.target.closest("#slowBtn")) return;
  S.slow = { ref: S.results, summary: S.summary }; S.view = "all"; S.metric = "all"; $("#detail").hidden = true; renderRows();
  const b = $("#slowBar"); b.scrollIntoView({ block: "start" }); ($("#slowExport", b) || $("#slowClear", b))?.focus({ preventScroll: true }); });
$("#slowBar").addEventListener("click", e => {
  if (e.target.closest("#slowPrepBtn")) {
    if (!S.slow || S.slow.ref !== S.results || S.slow.summary !== S.summary) { S.slow = null; S.slowPrep = null; renderRows(); return; }
    if (S.slowPrep) { S.slowPrep = null; renderRows(); $("#slowPrepBtn")?.focus(); return; }
    S.slowPrep = { r: slowPrepCompute(), sig: prepSig() }; renderRows();
    ($("#slowPrepOk") || $("#slowPrepCancel"))?.focus(); return; }
  if (e.target.closest("#slowPrepCancel")) { S.slowPrep = null; renderRows(); $("#slowPrepBtn")?.focus(); return; }
  if (e.target.closest("#slowPrepOk")) {
    const P = S.slowPrep, now = prepSig();
    if (!P?.r?.ok || !S.slow || S.slow.ref !== S.results || S.slow.summary !== S.summary || P.sig !== now) {
      S.slowPrep = S.slow && S.slow.ref === S.results ? { r: slowPrepCompute(), sig: now } : null; renderRows();
      $("#slowPrep")?.insertAdjacentHTML("afterbegin", `<p class="err" role="alert">The dataset, selection or run changed after this was shown, so nothing was changed. Review the updated preview.</p>`); ($("#slowPrepOk") || $("#slowPrepCancel") || $("#slowPrepBtn"))?.focus(); return; }
    S.selected = new Set(P.r.after.positions); S.slowPrep = null;
    $("#rsSel").checked = true; $("#rsAll").checked = false; $("#rsSel").dispatchEvent(new Event("change", { bubbles: true }));
    S.prepNotice = { n: P.r.after.n, sel: selectionSummary({ rows: S.rows, selected: S.selected }).positions.join(","), rows: S.rows };
    renderData(); renderRows(); go("run");
    setTimeout(() => { const el = $("#prepNotice"); if (el) el.textContent = el.dataset.msg; }, 50);   // live-region announce after focus move
    return; }
  if (e.target.closest("#slowClear")) { S.slow = null; S.slowPrep = null; renderRows(); ($("#slowBtn") || $("#fView")).focus(); return; }
  if (!e.target.closest("#slowExport")) return;
  if (!S.slow || S.slow.ref !== S.results || S.slow.summary !== S.summary) { alert("The run changed since these slow cases were shown, so nothing was downloaded."); S.slow = null; renderRows(); return; }
  const sc = slowCases({ results: S.results, summary: S.summary });
  const r = slowExport({ sc, runRows: S.runRows, results: S.results, summary: S.summary, key: S.key, build: buildEvaluatedDataset });
  if (!r.ok) { alert((EVAL_WHY[r.reason] || "Not available.") + " Nothing was downloaded."); return; }
  download(`slow-cases-p95-${(r.version || "unknown").replace(/[^\w.-]/g, "_")}-${stamp()}.jsonl`, r.text, "application/x-ndjson");
});
$("#fOrder").onchange = e => { S.order = e.target.value === "slowest" ? "slowest" : "run"; $("#detail").hidden = true; renderRows(); };

// ---------- export
const toJSONL = a => a.map(x => JSON.stringify(x)).join("\n") + "\n";
function toCSV(rows) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = v => { const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [keys.join(","), ...rows.map(r => keys.map(k => cell(r[k])).join(","))].join("\n");
}
function flatResults() {
  return S.results.map(x => {
    const o = { id: x.id, jev_latency_ms: x.jev_meta?.latency_ms, jev_input_tokens: x.jev_meta?.input_tokens, jev_usd: x.jev_meta?.usd, jev_model: x.jev_meta?.model };
    for (const m of Object.keys(M)) { o[`jev_${m}`] = x.jev?.[m]; o[`jev_${m}_confidence`] = x.jev_detail?.[m]?.confidence; o[`jev_${m}_reason`] = x.jev_detail?.[m]?.reason; o[`llm_${m}`] = x.llm?.[m]?.score; o[`llm_${m}_latency_ms`] = x.llm?.[m]?.latency_ms; o[`llm_${m}_usd`] = x.llm?.[m]?.usd; o[`human_${m}`] = x.human?.[m]; }
    return o;
  });
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
$("#exDataJ").onclick = () => download(`dataset-${stamp()}.jsonl`, toJSONL(S.rows));
$("#exDataC").onclick = () => download(`dataset-${stamp()}.csv`, toCSV(S.rows.map(r => Object.fromEntries(Object.entries(r)))), "text/csv");
// starter template (t_ed766f3f): fixed synthetic row from dataset_template.js; local download only, touches no state
$("#tplJ").onclick = () => download("dataset-template.jsonl", templateJSONL(), "application/x-ndjson");
$("#tplC").onclick = () => download("dataset-template.csv", templateCSV(), "text/csv");
$("#exResJ").onclick = () => download(`results-${stamp()}.jsonl`, toJSONL(flatResults()));
$("#exResC").onclick = () => download(`results-${stamp()}.csv`, toCSV(flatResults()), "text/csv");
$("#exSum").onclick = () => download(`benchmark-${stamp()}.json`, JSON.stringify(S.summary, null, 2));
// Benchmark brief: formats the SAME buildBenchCompare projection + the run's frozen summary. Built fresh from
// S.results/S.summary on every preview/download, so preview and file are the same text and a new/cleared run never
// exports a stale view (a run in progress has S.summary = null -> nothing to export).
function briefText(generatedAt) {
  if (!S.summary || !S.results.length) return null;
  const c = buildBenchCompare(S.results, { pricing: runPricing(S.runCfg) });
  return buildBenchBrief({ compare: c, summary: S.summary, meta: { app_version: S.cfg?.version ?? null, generated_at: generatedAt || S.briefAt || new Date().toISOString() } });
}
function renderBrief() {
  S.briefAt = new Date().toISOString(); const t = briefText();
  $("#exBrief").disabled = !t; $("#briefPrev").hidden = !t;
  $("#briefNote").textContent = t ? "" : "Run an evaluation first; the brief describes a completed run.";
  $("#briefText").textContent = t || "";
}
$("#exBrief").onclick = () => { const t = briefText(); if (!t) { alert("There is no completed run to describe (a run may be in progress or was cleared), so nothing was downloaded."); renderBrief(); return; } $("#briefText").textContent = t; download(`benchmark-brief-${stamp()}.md`, t, "text/markdown"); };
// Evaluated dataset: ONLY the frozen S.runRows of a completed run (never S.rows); refused before a run, after Clear,
// during/after a partial run. Never rewrites the working dataset or recomputes scores.
const EVAL_WHY = { no_run: "Run an evaluation first; this is the dataset a completed run evaluated.", running_or_none: "A run is in progress or did not finish, so there is no completed evaluated dataset yet.", partial: "The last run did not complete for every row, so no evaluated dataset is offered.", misaligned: "The run's results do not line up with its rows, so no evaluated dataset is offered.", key_in_rows: "A row contains your key text, so the download was refused." };
function evalExport() { return buildEvaluatedDataset({ runRows: S.runRows, results: S.results, summary: S.summary, key: S.key }); }
function renderEvalExport() {
  const e = evalExport(); $("#exEvalJ").disabled = !e.ok;
  const changed = e.ok && toJSONL(S.rows) !== e.text;
  $("#evalNote").textContent = e.ok ? `${e.rows} rows · run ${e.at ? new Date(e.at).toLocaleString() : "time unknown"} · recorded version ${e.version ?? "unknown"}${changed ? " · the working dataset has changed since this run; those changes are not in this file" : " · the working dataset still matches this run"}` : EVAL_WHY[e.reason] || "Not available.";
}
$("#exEvalJ").onclick = () => { const e = evalExport(); if (!e.ok) { alert((EVAL_WHY[e.reason] || "Not available.") + " Nothing was downloaded."); renderEvalExport(); return; } download(`evaluated-dataset-${(e.version || "unknown").replace(/[^\w.-]/g, "_")}-${stamp()}.jsonl`, e.text, "application/x-ndjson"); };
// Benchmark package: one versioned JSON bundle of the last completed run = the SAME texts as the evaluated-dataset,
// Results JSONL, Benchmark summary and Brief exports + a manifest. Same refusal rules as the evaluated dataset.
// Nothing is re-scored; only the frozen S.runRows / S.results / S.summary / S.runCfg are read.
function pkgExport() {
  const exportedAt = new Date().toISOString();
  const done = !!S.summary && S.results.length > 0;
  return buildBenchPackage({ runRows: S.runRows, results: S.results, summary: S.summary, key: S.key, build: buildEvaluatedDataset,
    resultsText: done ? toJSONL(flatResults()) : null, summaryText: done ? JSON.stringify(S.summary, null, 2) : null, briefText: done ? briefText(exportedAt) : null,
    runConfig: S.runCfg ?? null, appVersion: S.cfg?.version ?? null, exportedAt });
}
function renderPkgExport() {
  const e = pkgExport(); $("#exPkg").disabled = !e.ok;
  $("#pkgNote").textContent = e.ok ? `${e.rows} rows · run ${e.at ? new Date(e.at).toLocaleString() : "time unknown"} · recorded version ${e.version ?? "unknown"}${e.manifest.run.recorded_config ? "" : " · run configuration was not recorded for this run (shown as unknown)"}` : EVAL_WHY[e.reason] || "Not available.";
}
$("#exPkg").onclick = () => { const e = pkgExport(); if (!e.ok) { alert((EVAL_WHY[e.reason] || "Not available.") + " Nothing was downloaded."); renderPkgExport(); return; } download(`benchmark-package-${(e.version || "unknown").replace(/[^\w.-]/g, "_")}-${stamp()}.json`, e.text); };
function renderSnippet() {
  $("#snippet").textContent = `# pip install azure-ai-evaluation  &&  pip install git+https://github.com/nguyennhianhtri/jev-foundry-judge
import os
from azure.ai.evaluation import evaluate, TaskAdherenceEvaluator
from jev_foundry_judge import (JevIntentResolutionEvaluator, JevTaskAdherenceEvaluator,
                               JevToolCallAccuracyEvaluator, JevGroundednessEvaluator)

key = os.environ["JEV_API_KEY"]
result = evaluate(
    data="dataset.jsonl",            # exported from this app
    evaluators={
        "jev_intent":    JevIntentResolutionEvaluator(key),
        "jev_adherence": JevTaskAdherenceEvaluator(key),
        "jev_tools":     JevToolCallAccuracyEvaluator(key),
        "jev_grounded":  JevGroundednessEvaluator(key),
        # built-in LLM judge alongside, for comparison:
        # "task_adherence": TaskAdherenceEvaluator(model_config, credential=cred, is_reasoning_model=True),
    },
    evaluator_config={"default": {"column_mapping": {
        "query": "\${data.query}", "response": "\${data.response}",
        "tool_definitions": "\${data.tool_definitions}", "context": "\${data.context}"}}},
    # log the run to your Foundry project (optional):
    # azure_ai_project="https://<resource>.services.ai.azure.com/api/projects/<project>",
    output_path="jev_eval_results.json",
)
print(result["metrics"])`;
}
$("#copySnip").onclick = () => navigator.clipboard.writeText($("#snippet").textContent);
// ---------- open a benchmark package (read-only offline review; bench_package_open.js)
// Lives only in S.pv. Never touches S.rows / S.runRows / S.results / S.summary / S.runCfg / S.key, makes no request,
// stores nothing, applies no label or trace. Rendered with esc()/textContent only.
const MLAB = M;
function pvKV(k, v) { return `<tr><th scope="row">${k}</th><td>${v}</td></tr>`; }
const pvV = v => v == null || v === "" ? `<i>unknown</i>` : esc(typeof v === "object" ? JSON.stringify(v) : v);
function renderPkgView() {
  const box = $("#pkgView"), v = S.pv;
  if (!v) { box.hidden = true; box.innerHTML = ""; return; }
  const o = v.o, M = o.manifest, R = M.run, E = M.export, rc = R.recorded_config, P = o.pricing, s = o.summary;
  const price = x => x == null ? "<i>unknown</i>" : "$" + esc(x);
  const cfg = rc ? pvKV("Metrics requested", esc((rc.metrics || []).map(m => MLAB[m] || m).join(", ") || "unknown")) + pvKV("LLM judge requested", pvV(rc.baseline_requested)) + pvKV("Foundry logging requested", pvV(rc.foundry_logging_requested)) + pvKV("Rows per request", pvV(rc.max_rows_per_request)) + pvKV("Threshold at start", pvV(rc.threshold_at_start))
    : pvKV("Run configuration", "<i>not recorded in this file</i> (older or replayed run); nothing is filled in from this app");
  const prices = P.source === "not_recorded" ? `<i>not recorded</i>: unit prices are unknown; this app's current prices are not applied`
    : `Jev ${price(P.jev_usd_per_mtok_input)} per 1M input tokens · LLM judge ${price(P.llm_usd_per_mtok_in)} in / ${price(P.llm_usd_per_mtok_out)} out per 1M tokens <span class="hint">(recorded at run start)</span>`;
  const ag = a => a && a.n ? `${pct(a.pass_fail_agreement)} <span class="hint">MAE ${esc(a.mae ?? "—")} · n ${esc(a.n)}</span>` : `<span class="hint">n = 0</span>`;
  const agree = `<table class="agtab"><thead><tr><th>Metric</th><th>Jev↔labels</th><th>LLM↔labels</th><th>Jev↔LLM</th></tr></thead><tbody>` +
    Object.keys(MLAB).map(m => { const x = s.metrics?.[m] || {}; return `<tr><td>${MLAB[m]}</td><td>${ag(x.jev_vs_human)}</td><td>${ag(x.llm_vs_human)}</td><td>${ag(x.jev_vs_llm)}</td></tr>`; }).join("") +
    `<tr><td><b>All metrics</b></td><td>${ag(s.overall.jev_vs_human)}</td><td>${ag(s.overall.llm_vs_human)}</td><td>${ag(s.overall.jev_vs_llm)}</td></tr></tbody></table>`;
  const wl = o.rows.map((r, i) => { const f = o.flat[i]; const sc = Object.keys(MLAB).map(m => `${SHORT[m]} ${f["jev_" + m] == null ? "—" : esc(f["jev_" + m])}/${f["llm_" + m] == null ? "—" : esc(f["llm_" + m])}`).join(" · ");
    return `<li><details><summary><b>${esc(r.id ?? "no id")}</b> <span class="hint">row ${i + 1} · Jev/LLM ${sc}</span></summary><div class="grid2"><div><b class="hint">query</b><pre class="snap">${esc(snapText(r.query))}</pre></div><div><b class="hint">response</b><pre class="snap">${esc(snapText(r.response))}</pre></div></div>${r.context != null ? `<b class="hint">context</b><pre class="snap">${esc(snapText(r.context))}</pre>` : ""}${r.tool_definitions != null ? `<b class="hint">tool_definitions</b><pre class="snap">${esc(snapText(r.tool_definitions))}</pre>` : ""}</details></li>`; }).join("");
  box.hidden = false;
  box.innerHTML = `<div class="bar"><h3 style="margin:0">Opened benchmark package <span class="hint">${esc(v.name)} · ${(o.bytes / 1e3).toFixed(1)} kB</span></h3><button type="button" class="pvclose">Close package</button></div>
    <div class="stale" role="note"><b>⚠ Unverified file evidence.</b> This is what the file says about a past run.<ul class="pvwarn"><li>Not re-run here and not a live result.</li><li>Not signed, so it is not proof.</li><li>Checked only for internal consistency: kind, version, sizes, row counts, IDs in order, each result belonging to its row.</li><li>Nothing was sent, stored or applied; your current dataset, run and key are unchanged.</li></ul></div>
    <div class="grid2"><div><h4>Recorded with the run</h4><table class="agtab pvkv"><tbody>${pvKV("App version", pvV(R.recorded_app_version))}${pvKV("Completed", pvV(R.completed_at))}${pvKV("Scope", pvV(R.scope))}${pvKV("Pass threshold", pvV(R.threshold))}${pvKV("LLM judge", pvV(R.baseline_label))}${pvKV("Wall time", typeof R.wall_s !== "number" ? "<i>unknown</i>" : esc(R.wall_s.toFixed(1) + " s"))}${cfg}${pvKV("Unit prices", prices)}</tbody></table></div>
    <div><h4>File and this app</h4><table class="agtab pvkv"><tbody>${pvKV("Exported by app version", pvV(E.app_version))}${pvKV("Exported at", pvV(E.exported_at))}${pvKV("Format", `${esc(M.format)} v${esc(M.format_version)}`)}${pvKV("This app now", `${esc(S.cfg?.version ?? "unknown")} <span class="hint">(current app; not the version that ran)</span>`)}${pvKV("Rows / results", `${o.counts.rows} / ${o.counts.results}${o.counts.rows_with_error ? ` · ${o.counts.rows_with_error} failed` : ""}`)}${pvKV("Brief check", o.brief == null ? "<i>no brief in the file</i>, so the rebuilt panel below cannot be checked against it (a failed LLM call may read as not applicable)" : o.briefReproduced ? `<span class="ok">reproduced</span> <span class="hint">the panel below re-derives the stored brief byte-for-byte</span>` : `<span class="err">differs in ${o.briefDiffLines} line(s)</span> <span class="hint">trust the stored brief text; the panel is rebuilt from the flat results and may lose detail</span>`)}</tbody></table></div></div>
    <h4>Measured results (same-workload comparison, from the file's results)</h4>${cmpBodyHTML(o.compare, R.baseline_label, false)}
    <h4>Agreement with labels (from the file's summary)</h4><div style="overflow-x:auto">${agree}</div>
    <h4>Evaluated workload (${o.rows.length} rows, exactly as in the file)</h4><ul class="pvrows">${wl}</ul>
    <details><summary>Stored brief (exact text from the file)</summary><pre class="code" id="pvBrief"></pre></details>
    <div id="rcBox" class="rcbox"></div>`;
  renderRunCompare();
  $("#pvBrief").textContent = o.brief ?? "(no brief in this file)";
  $(".pvclose", box).onclick = () => { S.pv = null; renderPkgView(); $("#pkgOpenBtn").focus(); };
}
// ---------- compare the current completed run with the opened recorded run (run_compare.js, t_80f908ea)
// Pure projection over the SAME parsed package (S.pv.o) and the frozen current run; rebuilt on every render so a
// replaced/cleared run is never compared against a stale view. 0 calls, nothing stored, applied or re-scored.
function rcCurrent() {
  const done = !!S.summary && S.results.length > 0 && S.results.length === S.runRows.length;
  return { rows: S.runRows, results: S.results, complete: done, version: S.summary?.version ?? null, at: S.summary?.at ?? null, scope: S.summary?.scope ?? null,
    threshold: S.summary?.threshold ?? null, llmLabel: S.summary?.baseline_label ?? null, config: S.runCfg ?? null };
}
function rcBaseline(o) { const R = o.manifest.run; return { rows: o.rows, results: o.results, version: R.recorded_app_version, at: R.completed_at, scope: R.scope, threshold: R.threshold, llmLabel: R.baseline_label, config: R.recorded_config }; }
const RC_WHY = { no_current: "There is no completed run in this tab to compare with. Run an evaluation first (or wait for it to finish); the opened file stays read-only.", misaligned: "This tab's run results do not line up with its rows, so no comparison is shown.", no_baseline: "The opened file has no usable recorded run." };
const RC_ST = { no_result: "no result", row_error: "row failed", not_recorded: "not recorded", not_applicable: "n/a", no_score: "no score", error: "judge error" };
const JLAB = { jev: "Jev", llm: "LLM judge" };
const rcId = v => typeof v === "number" ? `${v} (number)` : `"${v}" (text)`;
const rcScore = x => x.state === "score" ? esc(x.v) : `<i>${RC_ST[x.state] || esc(x.state)}</i>`;
const rcTr = () => (["all", "same", "changed"].includes(S.pv?.rc?.trace) ? S.pv.rc.trace : "all");   // t_b3ac81fe: one sanitizer for render + nav
const rcOrd = () => (S.pv?.rc?.order === "dec" || S.pv?.rc?.order === "inc" ? S.pv.rc.order : "dataset");   // t_5c9dac5a
// t_3d3710ee: comparison search = view-only narrowing of the shown list via runCompareFind (both frozen traces)
const rcQ = () => (typeof S.pv?.rc?.q === "string" ? S.pv.rc.q.trim() : "");
const rcFind = L => runCompareFind(L, S.pv.o.rows, S.runRows, rcQ(), row => ({ req: userText(row?.query), ans: finalText(row?.response) }));
const rcHitT = h => h.map(x => x === "id" ? "ID" : x === "baseline" ? "recorded trace" : "current trace").join(" + ");
const rcDelta = d => d === null ? `<i>not compared</i>` : d === 0 ? "0" : `<b class="rcd">${d > 0 ? "+" : "−"}${esc(Math.abs(d))}</b>`;
function renderRunCompare() {
  const box = $("#rcBox"); if (!box || !S.pv) return;
  if (!S.pv.rc) { box.innerHTML = `<h4>Compare with the current run</h4><p class="hint">Use this file as the <b>baseline</b> and see which cases changed score between this recorded run (baseline) and the completed run in this tab (current), case by case. Cases are matched only by exact ID; nothing is re-run or changed.</p><div class="row"><button type="button" class="rcgo">Compare with current run</button></div>`; $(".rcgo", box).onclick = () => { S.pv.rc = { open: true }; renderRunCompare(); $(".rcclose", box)?.focus(); }; return; }
  const r = buildRunCompare(rcBaseline(S.pv.o), rcCurrent());
  const close = `<button type="button" class="ghost rcclose">Hide comparison</button>`;
  if (!r.ok) { S.pv.rc.shown = null; S.pv.rc.prep = null; S.pv.rc.sprep = null; S.pv.rc.sdl = null; box.innerHTML = `<div class="bar"><h4 style="margin:0">Compare with the current run</h4>${close}</div><p class="empty">${esc(RC_WHY[r.reason] || "Not available.")}</p>`; $(".rcclose", box).onclick = rcHide; return; }
  const cv = v => v == null ? "<i>not recorded</i>" : esc(Array.isArray(v) ? v.map(m => MLAB[m] || m).join(", ") || "none" : v);
  const cfg = r.config.map(x => `<tr><th scope="row">${esc(x.label)}</th><td>${cv(x.baseline)}</td><td>${cv(x.current)}</td><td>${x.same ? "same" : x.unknown ? `<span class="hint">not recorded on either side</span>` : `<b class="err">differs</b>`}</td></tr>`).join("");
  const C = r.counts, pl = p => `${JLAB[p.judge]}: ${MLAB[p.metric]}`;
  const tally = (ts, n) => !n ? "" : ts.map(t => `<li><b>${pl(t)}</b>: <span class="nw">${t.up} higher</span> · <span class="nw">${t.down} lower</span> · <span class="nw">${t.equal} equal</span>${t.missing ? ` · <span class="nw">${t.missing} not compared (a score is missing)</span>` : ""}</li>`).join("");
  const ord = r.pairs.length ? rcOrd() : "dataset";
  const decKey = !r.pairs.length ? null : S.pv.rc.dec && r.pairs.some(p => `${p.judge}:${p.metric}` === S.pv.rc.dec) ? S.pv.rc.dec : `${r.pairs[0].judge}:${r.pairs[0].metric}`;
  const D = ord !== "dataset" ? runCompareChanges(r, ...decKey.split(":"), ord) : null;
  if (S.pv.rc.prep && (!D?.ok || !rcPrepValid(S.pv.rc.prep, decKey, D))) S.pv.rc.prep = null;   // t_d258f7ec: any view change drops it
  // t_3d9f9b07: the brief formats THIS r and THIS D (the exact projection rendered below); frozen generation time per view
  S.pv.rc.briefAt = S.pv.rc.briefAt || new Date().toISOString();
  const briefT = rcBriefText(r, ord, decKey, D);
  S.pv.rc.shown = { text: briefT, results: S.results, runRows: S.runRows, o: S.pv.o, ord, decList: D?.ok ? rcDecList(D) : [] };
  const sel = rcTr();
  // t_b3ac81fe: ONE matched-case projection for the table rows AND the inspector Previous/Next (current dataset order)
  const ML0 = runCompareMatchedList(r, sel), FD = ord === "dataset" ? rcFind(ML0) : null, ML = FD ? FD.shown : ML0, flt = ML.map(e => r.matched.find(m => m.current_pos === e.pos && m.baseline_pos === e.b));
  const FX = D?.ok ? rcFind(D.shown.map(x => ({ pos: x.current_pos, id: x.id, b: x.baseline_pos }))) : null;   // dec/inc: narrows the shown list only
  const FF = FD || FX;
  if (S.pv.rc.sdl && !rcSDValid(S.pv.rc.sdl)) S.pv.rc.sdl = null;   // t_f1cb925e: same binding as the scoped Prepare
  if (S.pv.rc.sprep && !rcSPValid(S.pv.rc.sprep)) S.pv.rc.sprep = null;   // t_512b4b31: any query/group/order/file/run/list change drops it
  const hitOf = new Map((FF?.active ? FF.shown : []).map(e => [`${e.b}:${e.pos}`, e.hit]));
  const hitH = (b, c) => { const h = hitOf.get(`${b}:${c}`); return h ? ` <span class="hint rchit">matched in ${rcHitT(h)}</span>` : ""; };
  const TRL = { same: `<span class="tr-same">same input</span>`, changed: `<b class="tr-changed">⚠ input changed</b>`, cannot_compare: "input not comparable" };
  const rows = flt.map(m => `<tr${m.trace === "changed" ? ' class="rcchg"' : ""}><th scope="row"><button type="button" class="ghost rcopen" data-b="${m.baseline_pos}" data-c="${m.current_pos}" aria-label="Open case ${esc(rcId(m.id))}">${esc(m.id)}</button> <span class="tag">${typeof m.id === "number" ? "number" : "text"}</span><br><span class="hint">${TRL[m.trace]} · run row ${m.baseline_pos + 1} → ${m.current_pos + 1}</span>${hitH(m.baseline_pos, m.current_pos)}</th>${m.cells.map(c => `<td data-l="${esc(pl(c))}">${rcScore(c.baseline)} → ${rcScore(c.current)}<br>${rcDelta(c.delta)}</td>`).join("")}</tr>`).join("");
  const other = [...r.ambiguous.map(a => `<li><b>${esc(a.id)}</b> <span class="hint">ambiguous: appears in baseline rows [${a.baseline_rows.join(", ")}] and current rows [${a.current_rows.join(", ")}]; not matched</span></li>`),
    ...r.baselineOnly.map(a => `<li><b>${esc(a.id)}</b> <span class="hint">only in the recorded run (row ${a.baseline_row})</span></li>`),
    ...r.currentOnly.map(a => `<li><b>${esc(a.id)}</b> <span class="hint">only in the current run (row ${a.current_row})</span></li>`),
    ...(r.noId.baseline.length ? [`<li><span class="hint">recorded run rows without an ID: ${r.noId.baseline.join(", ")}</span></li>`] : []),
    ...(r.noId.current.length ? [`<li><span class="hint">current run rows without an ID: ${r.noId.current.join(", ")}</span></li>`] : [])].join("");
  box.innerHTML = `<div class="bar"><h4 style="margin:0">Recorded run (baseline) vs current run</h4>${close}</div>
    <div class="stale distwarn" role="note"><b>Descriptive, not an accuracy gain.</b> A higher score means the judge scored that case higher this time, not that the agent or judge is better. Changes on cases whose input changed, or between runs with different versions, configuration or prices, describe different measurements. No overall winner and no cost ratio are given, because the two workloads can differ.${r.config.every(x => x.same || x.unknown) ? "" : ` <b>The two runs differ in: ${esc(r.config.filter(x => !x.same && !x.unknown).map(x => x.label).join(", "))}</b> (details below).`}</div>
    <p><b>${C.matched}</b> cases matched by exact ID <span class="hint">(an ID must appear once on each side; the number 7 and the text "7" are different IDs)</span>: <span class="nw"><b>${C.same_trace}</b> same input</span> · <span class="nw"><b>${C.changed_trace}</b> input changed</span>${C.cannot_compare ? ` · <span class="nw">${C.cannot_compare} not comparable</span>` : ""} · <span class="nw"><b>${C.ambiguous}</b> ambiguous</span> · <span class="nw"><b>${C.baseline_only}</b> only in recorded</span> · <span class="nw"><b>${C.current_only}</b> only in current</span></p>
    <details${r.config.every(x => x.same || x.unknown) ? "" : " open"}><summary>Recorded vs current: versions, configuration, prices, scope</summary><div class="tablewrap"><table class="agtab pvkv"><thead><tr><th>Setting</th><th>Recorded (baseline)</th><th>Current</th><th></th></tr></thead><tbody>${pvKV("Completed", `${pvV(r.baseline.completed_at)}</td><td>${pvV(r.current.completed_at)}</td><td><span class="hint">info</span>`)}${pvKV("Rows in run", `${r.baseline.rows}</td><td>${r.current.rows}</td><td>${r.baseline.rows === r.current.rows ? "same" : `<b class="err">differs</b>`}`)}${cfg}</tbody></table></div><p class="hint">Delta = current − recorded stored score, exact (no rounding), only when both scores exist. Missing is never counted as 0 and no pass/fail threshold is applied.</p></details>
    ${r.pairs.length ? `<p class="hint">Compared: ${r.pairs.map(pl).join("; ")}.${r.notCommon.length ? ` Recorded on one side only, not compared: ${r.notCommon.map(x => `${pl(x)} (${x.only === "baseline" ? "recorded" : "current"} only)`).join(" · ")}.` : ""}</p>
    ${C.same_trace ? `<p><b>Same input (${C.same_trace})</b></p><ul class="rctally">${tally(r.tallySame, C.same_trace)}</ul>` : ""}${C.changed_trace ? `<p><b>Input changed (${C.changed_trace})</b> <span class="hint">scores on different inputs are not a like-for-like change</span></p><ul class="rctally">${tally(r.tallyChanged, C.changed_trace)}</ul>` : ""}
    <p class="hint" id="rcOrdLab" style="margin-bottom:0">Order the matched cases by</p><div class="pvtog" role="group" aria-labelledby="rcOrdLab">${[["dataset", "Current dataset order"], ["dec", "Recorded score decreases"], ["inc", "Recorded score increases"]].map(([k, t]) => `<button type="button" class="ghost rcord${ord === k ? " on" : ""}" data-k="${k}" aria-pressed="${ord === k}">${t}</button>`).join("")}</div>
    ${ord === "dataset" ? rcTrHTML(C, sel) : ""}${rcFindHTML(FF, ord === "dataset" ? `${RC_GRP[sel].toLowerCase()} group, current dataset order` : `${ord === "inc" ? "recorded score increases" : "recorded score decreases"} list`)}${FF?.active && FF.shown.length ? rcSPHTML(r, FF) + rcSDHTML(r, FF) : ""}
    ${ord !== "dataset" ? rcDecHTML(r, pl, decKey, D, FX) : `${flt.length ? `<div class="tablewrap"><table class="rctab"><thead><tr><th>Case ID</th>${r.pairs.map(p => `<th>${pl(p)}<br><span class="hint">baseline → current, Δ</span></th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : FD?.active && ML0.length ? rcNoMatch(FD) : `<p class="empty">No matched cases in this group.</p>`}`}`
    : `<p class="empty">No judge and metric was recorded in both runs, so no scores are compared.</p>`}
    ${other ? `<details${C.matched ? "" : " open"}><summary>Not matched (${C.ambiguous + C.baseline_only + C.current_only + r.noId.baseline.length + r.noId.current.length})</summary><ul class="pvrows">${other}</ul></details>` : ""}
    ${briefT ? `<div class="rcbrief"><div class="row"><button type="button" class="rcdl">Download comparison brief (.md)</button> <span class="hint" id="rcBriefNote">${FF?.active ? `<b>Search not applied:</b> the brief covers the whole ${ord === "dataset" ? "group" : "list"} (${FF.total} case${FF.total === 1 ? "" : "s"}), not the ${FF.shown.length} found by the search. ` : ""}Exactly the view above: order, judge and metric, filter, denominators and the cases ${FF?.active ? "in that list" : "shown"}. Typed IDs and stored scores only; no trace text, labels, notes or keys. Saved to this device only.</span></div><details class="rcbprev"><summary>Preview the comparison brief</summary><pre class="code" id="rcBriefText" tabindex="0" aria-label="Comparison brief text"></pre></details></div>` : ""}
    <div id="rcCase"></div>`;
  if (briefT) { $("#rcBriefText", box).textContent = briefT; $(".rcdl", box).onclick = rcDownloadBrief; }
  $(".rcclose", box).onclick = rcHide;
  for (const b of $$(".rcord", box)) b.onclick = () => { S.pv.rc.order = b.dataset.k; renderRunCompare(); $(`.rcord[data-k="${b.dataset.k}"]`, box).focus(); };
  const dx = $("#rcDecExport", box); if (dx) dx.onclick = rcDecExport;
  rcPrepWire(box);
  const ds = $("#rcDecSel", box); if (ds) ds.onchange = () => { S.pv.rc.dec = ds.value; renderRunCompare(); $("#rcDecSel", box).focus(); };
  for (const b of $$(".rctr", box)) b.onclick = () => { S.pv.rc.trace = b.dataset.k; renderRunCompare(); $(`.rctr[data-k="${b.dataset.k}"]`, box).focus(); };
  // t_ee65b10f: opened from the decreases list -> freeze THAT shown list (same D) for Previous/Next in the same inspector
  const q = rcQ();   // t_3d3710ee: nav walks exactly the narrowed (shown) list and is bound to the query
  const nav = FX && FX.shown.length ? { o: S.pv.o, results: S.results, runRows: S.runRows, key: decKey, dir: ord, q, total: FX.total, L: FX.shown.map(({ pos, id, b }) => ({ pos, id, b })), eligible: D.eligible }
    : ord === "dataset" && ML.length ? { o: S.pv.o, results: S.results, runRows: S.runRows, dir: "dataset", trace: sel, q, total: ML0.length, L: ML.map(({ pos, id, b }) => ({ pos, id, b })), matched: C.matched } : null;   // t_b3ac81fe
  rcFindWire(box, FF); rcSPWire(box); rcSDWire(box);
  for (const b of $$(".rcopen", box)) b.onclick = () => rcOpenCase(r, +b.dataset.b, +b.dataset.c, b, nav);
}
function rcTrHTML(C, sel) { return `<div class="pvtog" role="group" aria-label="Show cases">${[["all", `All matched (${C.matched})`], ["same", `Same input (${C.same_trace})`], ["changed", `Input changed (${C.changed_trace})`]].map(([k, t]) => `<button type="button" class="ghost rctr${sel === k ? " on" : ""}" data-k="${k}" aria-pressed="${sel === k}">${t}</button>`).join("")}</div>`; }
function rcNoMatch(F) { return `<p class="empty">No case in this list matches “${esc(F.query)}” (searched: case ID and the request/answer text of both frozen traces). <button type="button" class="ghost rcfclear2">Clear search</button></p>`; }
// t_3d3710ee: search bar. Value lives in S.pv.rc.q (view state only); rendered status = shown / total of THIS list.
function rcFindHTML(F, listName) {
  if (!F || (!F.total && !F.active)) return "";   // an active query always stays visible + clearable
  const q = S.pv.rc.q || "";
  const st = !F.active ? "" : `${F.shown.length} shown of ${F.total} in the ${listName}${F.shown.length ? "" : ` · no match for “${F.query}”`}`;
  return `<div class="dfindbar rfindbar rcfindbar" role="search"><label for="rcFind" class="hint dfindlab">Find a case in this comparison</label>
    <input type="search" id="rcFind" placeholder="Case ID, request or answer text" autocomplete="off" spellcheck="false" aria-describedby="rcFindStatus rcFindNote" value="${esc(q)}">
    <button type="button" class="ghost" id="rcFindClear"${F.active ? "" : " hidden"}>Clear search</button>
    <span class="hint${F.active && !F.shown.length ? " warn" : ""}" id="rcFindStatus" role="status" aria-live="polite">${esc(st)}</span>
    <p class="hint dfindnote" id="rcFindNote"${F.active ? "" : " hidden"}>View only: narrows the list shown below by case ID (number and text IDs stay separate: 7 and "7" are two cases) or by request/answer text in either frozen trace. Nothing is re-run, re-scored, selected or changed. ‹ Previous / Next › in the case view step through exactly the cases shown. Enter opens the first; Esc clears.</p></div>`;
}
function rcSetQ(v, keepFocus) {
  const box = $("#rcBox"), inp = $("#rcFind", box), caret = inp ? inp.selectionStart : null;
  if ((S.pv.rc.q || "") === v) return;
  S.pv.rc.q = v; S.pv.rc.prep = null; S.pv.rc.sprep = null; S.pv.rc.sdl = null;   // a query change invalidates any pending Prepare preview and the open inspector
  renderRunCompare();
  if (keepFocus) { const n = $("#rcFind"); if (n) { n.focus({ preventScroll: true }); if (caret !== null) try { n.setSelectionRange(Math.min(caret, n.value.length), Math.min(caret, n.value.length)); } catch {} } }
}
function rcFindWire(box, F) {
  const inp = $("#rcFind", box); if (!inp) return;
  inp.oninput = e => { if (!e.isComposing) rcSetQ(inp.value, true); };   // IME: wait for compositionend
  inp.oncompositionend = () => rcSetQ(inp.value, true);
  inp.onkeydown = e => {
    if (e.key === "Escape" && inp.value) { e.preventDefault(); rcSetQ("", true); }
    else if (e.key === "Enter") { e.preventDefault(); const b = $(".rcopen", box); if (b && F?.active) b.click(); }
  };
  const clr = () => rcSetQ("", true);
  const c = $("#rcFindClear", box); if (c) c.onclick = clr;
  const c2 = $(".rcfclear2", box); if (c2) c2.onclick = clr;
}
// t_ee65b10f: re-derive the decreases list now; the nav is valid only if the file, run and exact list are unchanged
function rcNavFresh(nav) {
  if (!nav || !S.pv?.rc || nav.o !== S.pv.o || nav.results !== S.results || nav.runRows !== S.runRows || (nav.q ?? "") !== rcQ()) return false;
  const now = buildRunCompare(rcBaseline(S.pv.o), rcCurrent());
  if (nav.dir === "dataset") {   // t_b3ac81fe: same guard, dataset-order group re-derived through the same projection
    if (!now.ok || (now.pairs.length ? rcOrd() : "dataset") !== "dataset" || rcTr() !== nav.trace) return false;   // effective order, as rendered
    return JSON.stringify(rcFind(runCompareMatchedList(now, nav.trace)).shown.map(({ pos, id, b }) => ({ pos, id, b }))) === JSON.stringify(nav.L) ? now : false;
  }
  if (rcOrd() !== nav.dir || !now.ok || !now.pairs.length) return false;
  const eff = S.pv.rc.dec && now.pairs.some(p => `${p.judge}:${p.metric}` === S.pv.rc.dec) ? S.pv.rc.dec : `${now.pairs[0].judge}:${now.pairs[0].metric}`; // same fallback as renderRunCompare
  if (eff !== nav.key) return false;
  const D = runCompareChanges(now, ...nav.key.split(":"), nav.dir);
  return D.ok && JSON.stringify(rcFind(D.shown.map(x => ({ pos: x.current_pos, id: x.id, b: x.baseline_pos }))).shown.map(({ pos, id, b }) => ({ pos, id, b }))) === JSON.stringify(nav.L) ? now : false;
}
// recorded score decreases focus (t_444de45e): same buildRunCompare result, runCompareDecreases projection
function rcDecHTML(r, pl, key, d, fx) {
  // t_5c9dac5a: one renderer for both signs of the same runCompareChanges projection
  // t_3e9f0c98: Prepare now serves the shown projection of EITHER sign through the same rcPrep* / prepareRerun path
  // t_332de501: Download serves the shown projection of EITHER sign via the same rcDecExport/buildCaseListExport path
  const [j, m] = key.split(":"), E = d.excluded, inc = d.direction === "inc", hl = inc ? "higher" : "lower", w = inc ? "increase" : "decrease";
  const selH = `<label>Judge and metric <select id="rcDecSel">${r.pairs.map(p => `<option value="${esc(`${p.judge}:${p.metric}`)}"${`${p.judge}:${p.metric}` === key ? " selected" : ""}>${esc(pl(p))}</option>`).join("")}</select></label>`;
  const why = [E.changed ? `${E.changed} input changed` : "", E.cannot_compare ? `${E.cannot_compare} input not comparable` : "", E.missing ? `${E.missing} a score missing` : "", d.not_matched ? `${d.not_matched} not matched by ID` : ""].filter(Boolean);
  const head = `<p id="rcDecNote"><b>${d.shown.length}</b> of <b>${d.eligible}</b> eligible cases have a ${hl} recorded ${esc(pl({ judge: j, metric: m }))} score <span class="hint">(eligible = matched by exact ID, same input, both stored scores present; ${d.eligible - d.shown.length} not ${hl}: ${d.unchanged} unchanged · ${d.opposite} ${inc ? "lower" : "higher"}${why.length ? `; left out: ${why.join(" · ")}` : ""})</span>. Largest ${w} first; ties keep current row order. ${inc ? "These are recorded score increases, not verified improvements or a statistical finding." : "These are recorded score decreases, not verified regressions."}</p>`;
  const body = !d.eligible ? `<p class="empty">No same-input case has both stored ${esc(pl({ judge: j, metric: m }))} scores, so nothing can be ordered. Changed inputs and missing scores are never ranked.</p>`
    : !d.shown.length ? `<p class="empty">None of the ${d.eligible} eligible cases has a ${hl} recorded ${esc(pl({ judge: j, metric: m }))} score than the baseline.</p>`
    : fx?.active && !fx.shown.length ? rcNoMatch(fx)
    : `<div class="tablewrap rccells"><table class="agtab rctab"><thead><tr><th>Case ID</th><th>Baseline (recorded)</th><th>Current</th><th>Δ</th></tr></thead><tbody>${(fx?.active ? fx.shown.map(e => d.shown.find(x => x.current_pos === e.pos && x.baseline_pos === e.b)) : d.shown).map(x => `<tr><th scope="row"><button type="button" class="ghost rcopen" data-b="${x.baseline_pos}" data-c="${x.current_pos}" aria-label="Open case ${esc(rcId(x.id))}">${esc(x.id)}</button> <span class="tag">${typeof x.id === "number" ? "number" : "text"}</span><br><span class="hint">run row: baseline ${x.baseline_pos + 1} → current ${x.current_pos + 1}</span>${fx?.active ? ` <span class="hint rchit">matched in ${rcHitT(fx.shown.find(e => e.pos === x.current_pos && e.b === x.baseline_pos).hit)}</span>` : ""}</th><td data-l="Baseline">${esc(x.baseline)}</td><td data-l="Current">${esc(x.current)}</td><td data-l="Δ">${rcDelta(x.delta)}</td></tr>`).join("")}</tbody></table></div>`;
  const keep = fx?.active && d.shown.length ? `<p class="hint rcscope" id="rcScopeNote" role="note"><b>Search does not narrow Download or Prepare below:</b> they still cover all ${d.shown.length} ${inc ? "increased" : "decreased"} case${d.shown.length === 1 ? "" : "s"} in this list, as their labels say. To reuse only the ${fx.shown.length} found, use “Download ${fx.shown.length === 1 ? "this shown case" : `these ${fx.shown.length} shown cases`} (.jsonl)” or “Prepare ${fx.shown.length === 1 ? "this shown case" : `these ${fx.shown.length} shown cases`}” under the search. Clear the search to see them all.</p>` : "";
  return `<div class="rfilter">${selH}</div>${head}${keep}${d.shown.length ? rcDecExportHTML(r, pl({ judge: j, metric: m }), d) + rcPrepHTML(r, pl({ judge: j, metric: m }), key, d) : ""}${body}`;
}
// t_d258f7ec: prepare the shown decreases (CURRENT run frozen rows) for a deliberate repeat run. Same prepareRerun binding
// as slow/disagreement cases (run-start position or unique canonical identical row; shown id must equal the frozen row id;
// 7 !== "7"); proposes only the existing Dataset selection + Selected-cases Run scope. Never runs; 0 calls.
const rcPrepMembers = d => d.shown.map(x => ({ pos: x.current_pos, id: x.id }));
const rcPrepCompute = d => prepareRerun({ members: rcPrepMembers(d), runRows: S.runRows, runPos: S.runPos, rows: S.rows, selected: S.selected });
// t_3e9f0c98: bound to the direction it was opened in (P.dir === d.direction === shown order); a switch drops/refuses it
function rcPrepValid(P, key, d) { return P && P.o === S.pv?.o && P.results === S.results && P.runRows === S.runRows && P.runPos === S.runPos && P.key === key && (P.dir || "dec") === d.direction && S.pv.rc?.order === d.direction && JSON.stringify(rcPrepMembers(d)) === P.list; }
function rcPrepHTML(r, lab, key, d) {
  const rc = S.pv.rc, n = d.shown.length;
  if (rc.prep && !rcPrepValid(rc.prep, key, d)) rc.prep = null;       // changed file/run/judge-metric/list invalidates
  if (rc.prep && rc.prep.sig !== prepSig()) rc.prep = { ...rc.prep, r: rcPrepCompute(d), sig: prepSig(), changed: true };
  const P = rc.prep, open = !!P, chg = open && P.changed; if (chg) rc.prep = { ...P, changed: false };   // announce once
  return `<div class="disbar rcprep"><div class="row"><button type="button" id="rcPrepBtn" aria-expanded="${open}" aria-controls="rcPrep">Prepare ${n === 1 ? "this current case" : `these ${n} current cases`} for another run…</button></div>
    <div id="rcPrep" class="slowprep"${open ? "" : " hidden"}>${chg ? `<p class="err" role="alert">The dataset or selection changed while this was open; the preview below is updated.</p>` : ""}${open ? rcPrepBody(P.r, r, lab, d) : ""}</div></div>`;
}
function rcPrepBody(x, r, lab, d) {
  const E = d.excluded, left = [E.changed ? `${E.changed} input changed` : "", E.cannot_compare ? `${E.cannot_compare} input not comparable` : "", E.missing ? `${E.missing} a score missing` : "", d.not_matched ? `${d.not_matched} not matched by ID` : ""].filter(Boolean);
  const inc = d.direction === "inc";
  const scope = `${inc ? "Recorded score increases" : "Recorded score decreases"} · ${esc(lab)} · ${d.shown.length} shown of ${d.eligible} eligible (same input, both stored scores present)${left.length ? `; left out: ${esc(left.join(" · "))}` : ""} · recorded versions: baseline ${esc(String(r.baseline.app_version ?? "unknown"))}, current ${esc(String(r.current.app_version ?? "unknown"))}`;
  if (!x.ok) {
    const why = x.reason === "no_dataset" ? "The dataset the current run came from is no longer loaded in this tab."
      : x.reason === "empty" ? `There are no ${inc ? "increased" : "decreased"} cases to prepare.` : `${x.problems.length} of the shown cases cannot be matched to exactly one unchanged dataset row:`;
    return `<p class="hint">${scope}</p><p role="alert"><b class="err">Not prepared. Your current selection is unchanged${x.before.n ? ` (${x.before.n} ticked)` : ""}.</b> ${why}</p>${x.problems.length ? `<ul class="prepwhy">${x.problems.map(p => `<li><code>${esc(p.label)}</code>: ${esc(p.why)}.</li>`).join("")}</ul>` : ""}
      <p class="hint">A repeat run must use the exact current-run rows that were compared, so nothing is guessed. You can still use Download these current cases (.jsonl) above; both runs and their scores stay as they are.</p>
      <div class="row"><button type="button" class="ghost" id="rcPrepCancel">Close</button></div>`;
  }
  const b = x.before, a = x.after;
  return `<p role="status"><b>Prepare ${a.n} case${a.n === 1 ? "" : "s"} for another run?</b> IDs in dataset order: ${prepIds(a.ids)}.</p>
    <p class="hint">From: ${scope}.</p>
    <ul class="prepwhat">
      <li>Dataset selection: ${b.n ? `${b.n} ticked now (${prepIds(b.ids)})` : "nothing ticked now"} → ${a.n === 1 ? "only this case" : `exactly these ${a.n}`}${x.same ? " (no change)" : ` (${x.added} added, ${x.removed} unticked, ${x.unchanged} kept)`}. Each is the unchanged dataset row scored in the <b>current</b> run (not the baseline file): same input, trace, labels and typed ID.</li>
      <li>Run step: Cases to run switches to Selected cases only, so the estimate covers ${a.n} of ${x.total} rows.</li>
      <li>Nothing runs and nothing is spent until you press Run. Both runs, their scores, labels and exports stay as they are until then.</li>
    </ul>
    <p class="hint">${inc ? "An increase is recorded run-to-run variation, not a verified improvement." : "A decrease is recorded run-to-run variation, not a confirmed regression."} A different score on a repeat run is not an accuracy gain.</p>
    <div class="row"><button type="button" id="rcPrepOk">${a.n === 1 ? "Select this case" : `Select these ${a.n} cases`} and open Run</button> <button type="button" class="ghost" id="rcPrepCancel">Cancel</button></div>`;
}
function rcPrepNowD() {
  const ord = rcOrd(), now = buildRunCompare(rcBaseline(S.pv.o), rcCurrent()); if (!now.ok || !now.pairs.length || ord === "dataset") return null;
  const key = S.pv.rc.dec && now.pairs.some(p => `${p.judge}:${p.metric}` === S.pv.rc.dec) ? S.pv.rc.dec : `${now.pairs[0].judge}:${now.pairs[0].metric}`;
  const D = runCompareChanges(now, ...key.split(":"), ord); return D.ok ? { key, D } : null;   // t_3e9f0c98: shown sign
}
function rcPrepWire(box) {
  const btn = $("#rcPrepBtn", box); if (!btn) return;
  btn.onclick = () => {
    const rc = S.pv.rc; if (rc.prep) { rc.prep = null; renderRunCompare(); $("#rcPrepBtn")?.focus(); return; }
    const v = rcPrepNowD(); if (!v) { renderRunCompare(); return; }
    rc.sprep = null; rc.sdl = null;   // t_512b4b31: one Prepare preview at a time
    rc.prep = { r: rcPrepCompute(v.D), sig: prepSig(), key: v.key, dir: v.D.direction, o: S.pv.o, results: S.results, runRows: S.runRows, runPos: S.runPos, list: JSON.stringify(rcPrepMembers(v.D)) };
    renderRunCompare(); ($("#rcPrepOk") || $("#rcPrepCancel"))?.focus();
  };
  const c = $("#rcPrepCancel", box); if (c) c.onclick = () => { S.pv.rc.prep = null; renderRunCompare(); $("#rcPrepBtn")?.focus(); };
  const ok = $("#rcPrepOk", box); if (ok) ok.onclick = () => {
    const P = S.pv.rc.prep, v = rcPrepNowD();
    if (!P?.r?.ok || !v || !rcPrepValid(P, v.key, v.D) || P.sig !== prepSig()) {
      S.pv.rc.prep = P && v && rcPrepValid(P, v.key, v.D) ? { ...P, r: rcPrepCompute(v.D), sig: prepSig(), changed: false } : null; renderRunCompare();
      ($("#rcPrep:not([hidden])") || $("#rcDecNote"))?.insertAdjacentHTML("afterbegin", `<p class="err" role="alert">The dataset, selection, opened file, judge and metric or current run changed after this was shown, so nothing was changed. Review the updated preview.</p>`);
      ($("#rcPrepOk") || $("#rcPrepCancel") || $("#rcPrepBtn") || $(".rcclose"))?.focus(); return; }
    const rsSel = $("#rsSel"), rsAll = $("#rsAll"); if (!rsSel || !rsAll) return;   // never half-apply
    S.selected = new Set(P.r.after.positions); S.pv.rc.prep = null;
    rsSel.checked = true; rsAll.checked = false; rsSel.dispatchEvent(new Event("change", { bubbles: true }));
    S.prepNotice = { n: P.r.after.n, kind: P.dir === "inc" ? "increase" : "decrease", sel: selectionSummary({ rows: S.rows, selected: S.selected }).positions.join(","), rows: S.rows };
    renderData(); renderRunCompare(); go("run"); rsSel.focus({ preventScroll: true });
    setTimeout(() => { const el = $("#prepNotice"); if (el) el.textContent = el.dataset.msg; }, 50);
  };
}
// t_512b4b31: prepare ONLY the cases a comparison search shows. Same list the table + Previous/Next use (rcFind over the
// current group or dec/inc list, same order, typed ids, bound by current run position) -> the SAME prepareRerun binding.
// Searching never prepares; the button only previews; Apply is the one explicit step (selection + Selected scope + open
// Run). Bound to query + order + group/judge-metric + file + run + exact list; any change drops it or refuses Apply.
function rcSPNow() {
  if (!S.pv?.rc || !rcQ()) return null;
  const now = buildRunCompare(rcBaseline(S.pv.o), rcCurrent()); if (!now.ok) return null;
  const ord = now.pairs.length ? rcOrd() : "dataset";
  if (ord === "dataset") { const trace = rcTr(), F = rcFind(runCompareMatchedList(now, trace)); return F.active && F.shown.length ? { r: now, ord, trace, key: null, F } : null; }
  const key = S.pv.rc.dec && now.pairs.some(p => `${p.judge}:${p.metric}` === S.pv.rc.dec) ? S.pv.rc.dec : `${now.pairs[0].judge}:${now.pairs[0].metric}`;
  const D = runCompareChanges(now, ...key.split(":"), ord); if (!D.ok) return null;
  const F = rcFind(D.shown.map(x => ({ pos: x.current_pos, id: x.id, b: x.baseline_pos })));
  return F.active && F.shown.length ? { r: now, ord, trace: null, key, D, F } : null;
}
const rcSPMembers = F => F.shown.map(e => ({ pos: e.pos, id: e.id }));
const rcSPList = F => JSON.stringify(F.shown.map(({ pos, id, b }) => ({ pos, id, b })));
const rcSPCompute = F => prepareRerun({ members: rcSPMembers(F), runRows: S.runRows, runPos: S.runPos, rows: S.rows, selected: S.selected });
function rcSPValid(P) {
  if (!P || P.o !== S.pv?.o || P.results !== S.results || P.runRows !== S.runRows || P.runPos !== S.runPos || P.q !== rcQ()) return false;
  const v = rcSPNow(); return !!v && v.ord === P.ord && v.trace === P.trace && v.key === P.key && rcSPList(v.F) === P.list;
}
function rcSPListName(v) { if (v.ord === "dataset") return `${RC_GRP[v.trace].toLowerCase()} group (current dataset order)`; const [j, m] = v.key.split(":"); return `recorded score ${v.ord === "inc" ? "increases" : "decreases"} list (${esc(`${JLAB[j]}: ${MLAB[m]}`)})`; }
function rcSPHTML(r, F) {
  const rc = S.pv.rc, n = F.shown.length;
  if (rc.sprep && rc.sprep.sig !== prepSig()) rc.sprep = { ...rc.sprep, r: rcSPCompute(F), sig: prepSig(), changed: true };
  const P = rc.sprep, open = !!P, chg = open && P.changed; if (chg) rc.sprep = { ...P, changed: false };
  return `<div class="disbar rcprep rcsprep"><div class="row"><button type="button" id="rcSPBtn" aria-expanded="${open}" aria-controls="rcSP" aria-describedby="rcSPScope">Prepare ${n === 1 ? "this shown case" : `these ${n} shown cases`} for another run…</button> <span class="hint" id="rcSPScope">Only the ${n} found by “${esc(F.query)}”, not the whole list.</span></div>
    <div id="rcSP" class="slowprep"${open ? "" : " hidden"}>${chg ? `<p class="err" role="alert">The dataset or selection changed while this was open; the preview below is updated.</p>` : ""}${open ? rcSPBody(P, r) : ""}</div></div>`;
}
function rcSPBody(P, r) {
  const x = P.r, hid = P.total - P.n;
  const scope = `Search “${esc(P.q)}” in the ${rcSPListName(P)} · ${P.n} shown of ${P.total} in that list${hid ? ` · ${hid} not found by the search, left out` : ""}${P.chg ? ` · ${P.chg} of the shown have a changed input` : ""} · recorded versions: baseline ${esc(String(r.baseline.app_version ?? "unknown"))}, current ${esc(String(r.current.app_version ?? "unknown"))}`;
  if (!x.ok) {
    const why = x.reason === "no_dataset" ? "The dataset the current run came from is no longer loaded in this tab." : x.reason === "empty" ? "The search shows no case to prepare." : `${x.problems.length} of the shown cases cannot be matched to exactly one unchanged dataset row:`;
    return `<p class="hint">${scope}</p><p role="alert"><b class="err">Not prepared. Your current selection is unchanged${x.before.n ? ` (${x.before.n} ticked)` : ""}.</b> ${why}</p>${x.problems.length ? `<ul class="prepwhy">${x.problems.map(p => `<li><code>${esc(p.label)}</code>: ${esc(p.why)}.</li>`).join("")}</ul>` : ""}
      <p class="hint">A repeat run must use the exact current-run rows that were found, so nothing is guessed and no other case is added.</p>
      <div class="row"><button type="button" class="ghost" id="rcSPCancel">Close</button></div>`;
  }
  const b = x.before, a = x.after;
  return `<p role="status"><b>Prepare ${a.n} shown case${a.n === 1 ? "" : "s"} for another run?</b> IDs as shown: ${prepIds(P.shownIds)}; in dataset (run) order: ${prepIds(a.ids)}.</p>
    <p class="hint">From: ${scope}.</p>
    <ul class="prepwhat">
      <li>Dataset selection: ${b.n ? `${b.n} ticked now (${prepIds(b.ids)})` : "nothing ticked now"} → ${a.n === 1 ? "only this case" : `exactly these ${a.n}`}${x.same ? " (no change)" : ` (${x.added} added, ${x.removed} unticked, ${x.unchanged} kept)`}. Each is the unchanged dataset row scored in the <b>current</b> run (not the baseline file): same input, trace, labels and typed ID.</li>
      <li>Run step: Cases to run switches to Selected cases only, so the estimate covers ${a.n} of ${x.total} rows.</li>
      <li>Nothing runs and nothing is spent until you press Run. Both runs, their scores, labels and exports stay as they are until then.</li>
    </ul>
    <p class="hint">A search match is not a finding. A different score on a repeat run is run-to-run variation, not a verified improvement or an accuracy gain.</p>
    <div class="row"><button type="button" id="rcSPOk">${a.n === 1 ? "Select this case" : `Select these ${a.n} cases`} and open Run</button> <button type="button" class="ghost" id="rcSPCancel">Cancel</button></div>`;
}
function rcSPWire(box) {
  const btn = $("#rcSPBtn", box); if (!btn) return;
  btn.onclick = () => {
    const rc = S.pv.rc; if (rc.sprep) { rc.sprep = null; renderRunCompare(); $("#rcSPBtn")?.focus(); return; }
    const v = rcSPNow(); if (!v) { renderRunCompare(); return; }
    rc.prep = null; rc.sdl = null;   // one preview at a time (full-list, search-scoped, download)
    const chg = v.ord === "dataset" ? v.F.shown.filter(e => e.trace === "changed").length : 0;
    rc.sprep = { r: rcSPCompute(v.F), sig: prepSig(), q: rcQ(), ord: v.ord, trace: v.trace, key: v.key, n: v.F.shown.length, total: v.F.total, chg, shownIds: v.F.shown.map(e => e.id), o: S.pv.o, results: S.results, runRows: S.runRows, runPos: S.runPos, list: rcSPList(v.F) };
    renderRunCompare(); ($("#rcSPOk") || $("#rcSPCancel"))?.focus();
  };
  const c = $("#rcSPCancel", box); if (c) c.onclick = () => { S.pv.rc.sprep = null; renderRunCompare(); ($("#rcSPBtn") || $("#rcFind"))?.focus(); };
  const ok = $("#rcSPOk", box); if (ok) ok.onclick = () => {
    const P = S.pv.rc.sprep, v = rcSPNow();
    if (!P?.r?.ok || !v || !rcSPValid(P) || P.sig !== prepSig()) {
      S.pv.rc.sprep = P && v && rcSPValid(P) ? { ...P, r: rcSPCompute(v.F), sig: prepSig(), changed: false } : null; renderRunCompare();
      ($("#rcSP:not([hidden])") || $("#rcFindStatus"))?.insertAdjacentHTML("afterbegin", `<p class="err" role="alert">The search, dataset, selection, opened file, list or current run changed after this was shown, so nothing was changed. Review the updated preview.</p>`);
      ($("#rcSPOk") || $("#rcSPCancel") || $("#rcSPBtn") || $("#rcFind"))?.focus(); return; }
    const rsSel = $("#rsSel"), rsAll = $("#rsAll"); if (!rsSel || !rsAll) return;   // never half-apply
    S.selected = new Set(P.r.after.positions); S.pv.rc.sprep = null;
    rsSel.checked = true; rsAll.checked = false; rsSel.dispatchEvent(new Event("change", { bubbles: true }));
    S.prepNotice = { n: P.r.after.n, kind: "compare-search", sel: selectionSummary({ rows: S.rows, selected: S.selected }).positions.join(","), rows: S.rows };
    renderData(); renderRunCompare(); go("run"); rsSel.focus({ preventScroll: true });
    setTimeout(() => { const el = $("#prepNotice"); if (el) el.textContent = el.dataset.msg; }, 50);
  };
}
// t_f1cb925e: DOWNLOAD only the cases a comparison search shows. Members = the SAME rcSPNow/rcFind ordered list the table,
// Previous/Next and the scoped Prepare use ({pos, id} of the CURRENT run, shown order, typed ids) -> the SAME
// case_list_export.js buildCaseListExport over the evaluated-dataset serializer: byte-identical frozen current-run rows,
// labels as authored, unknown fields/nulls kept, no scores, no baseline rows, key refusal. Button only previews; the
// preview's Download is the one explicit step. Bound to query/order/group/judge-metric/file/run/list; drift refuses.
// 0 calls; selection, dataset and runs are never touched.
function rcSDValid(P) {
  if (!P || P.o !== S.pv?.o || P.results !== S.results || P.runRows !== S.runRows || P.summary !== S.summary || P.q !== rcQ()) return false;
  const v = rcSPNow(); return !!v && v.ord === P.ord && v.trace === P.trace && v.key === P.key && rcSPList(v.F) === P.list;
}
const rcSDBuild = F => buildCaseListExport({ runRows: S.runRows, results: S.results, summary: S.summary, list: rcSPMembers(F), build: evalExport });
function rcSDHTML(r, F) {
  const rc = S.pv.rc, n = F.shown.length, e = evalExport(), P = rc.sdl, open = !!P && e.ok;
  if (P && !e.ok) rc.sdl = null;
  const lbl = `Download ${n === 1 ? "this shown case" : `these ${n} shown cases`} (.jsonl)`;
  return `<div class="distexp rcsdx"><button type="button" class="ghost" id="rcSDBtn"${e.ok ? "" : " disabled"} aria-expanded="${open}" aria-controls="rcSD" aria-describedby="rcSDNote">${lbl}</button> <span class="hint" id="rcSDNote" role="status">${e.ok ? `Only the ${n} found by “${esc(F.query)}”, current run traces, in the order shown. Opens a preview; nothing downloads until you confirm.` : esc(EVAL_WHY[e.reason] || "Not available.")}</span>
    <div id="rcSD" class="slowprep" role="region" aria-label="Download preview"${open ? "" : " hidden"}>${open ? rcSDBody(P, r) : ""}</div></div>`;
}
function rcSDBody(P, r) {
  const hid = P.total - P.n;
  const scope = `Search “${esc(P.q)}” in the ${rcSPListName(P)} · ${P.n} shown of ${P.total} in that list${hid ? ` · ${hid} not found by the search, left out` : ""}${P.chg ? ` · ${P.chg} of the shown have a changed input (the current run's input is exported)` : ""} · recorded versions: baseline ${esc(String(r.baseline.app_version ?? "unknown"))}, current ${esc(String(r.current.app_version ?? "unknown"))}`;
  const x = P.x;
  if (!x.ok) return `<p class="hint">${scope}</p><p role="alert"><b class="err">Not available. Nothing was downloaded.</b> ${esc(x.reason === "stale" ? DLX_WHY.stale : DLX_WHY[x.reason] || EVAL_WHY[x.reason] || "Not available.")}</p><div class="row"><button type="button" class="ghost" id="rcSDCancel">Close</button></div>`;
  return `<p role="status"><b>Download ${x.n} shown case${x.n === 1 ? "" : "s"} of ${x.total} current run rows?</b> Exactly these, in the order shown, as frozen when the current run started (recorded version ${esc(String(x.version ?? "unknown"))}):</p>
    <ol class="rcsdids">${P.list0.map(m => `<li><b>${esc(rfxIdT(m.id))}</b> ${rfxTag(m.id)} · current run row ${m.pos + 1}</li>`).join("")}</ol>
    <p class="hint">From: ${scope}.</p>
    <p class="hint">Current run traces only, never the baseline file's rows or scores. Each line is that case's frozen row with its request, answer, context, tool data, other fields and human labels as authored, which may be private; no Jev or LLM-judge scores, errors or keys, and later dataset edits are not in it. Saved to this device only. Your dataset, selection and both runs do not change and no calls are made. Upload it on the Dataset step (preview, then Apply adds the cases). A search match is not a finding.</p>
    <div class="row"><button type="button" id="rcSDGo">Download ${x.n} case${x.n === 1 ? "" : "s"} (.jsonl)</button> <button type="button" class="ghost" id="rcSDCancel">Cancel</button></div>`;
}
function rcSDWire(box) {
  const btn = $("#rcSDBtn", box); if (!btn) return;
  btn.onclick = () => {
    const rc = S.pv.rc; if (rc.sdl) { rc.sdl = null; renderRunCompare(); $("#rcSDBtn")?.focus(); return; }
    const v = rcSPNow(); if (!v) { renderRunCompare(); return; }
    rc.prep = null; rc.sprep = null;   // one preview at a time
    const chg = v.ord === "dataset" ? v.F.shown.filter(e => e.trace === "changed").length : 0;
    rc.sdl = { x: rcSDBuild(v.F), q: rcQ(), ord: v.ord, trace: v.trace, key: v.key, n: v.F.shown.length, total: v.F.total, chg, list0: rcSPMembers(v.F), o: S.pv.o, results: S.results, runRows: S.runRows, summary: S.summary, list: rcSPList(v.F) };
    renderRunCompare(); ($("#rcSDGo") || $("#rcSDCancel"))?.focus();
  };
  const c = $("#rcSDCancel", box); if (c) c.onclick = () => { S.pv.rc.sdl = null; renderRunCompare(); ($("#rcSDBtn") || $("#rcFind"))?.focus(); };
  const go1 = $("#rcSDGo", box); if (go1) go1.onclick = () => {
    const P = S.pv.rc.sdl, v = rcSPNow();
    const x = P && v && rcSDValid(P) ? rcSDBuild(v.F) : null;
    if (!x || !x.ok || x.text !== P.x.text) {
      S.pv.rc.sdl = null; renderRunCompare();
      $("#rcSDNote")?.insertAdjacentHTML("afterbegin", `<b class="err" role="alert">The search, opened file, list or current run changed after the preview was shown, so nothing was downloaded. Nothing was changed. </b>`);
      ($("#rcSDBtn:not(:disabled)") || $("#rcFind"))?.focus(); return; }
    const tag = P.ord === "dataset" ? P.trace : `${P.ord}-${P.key.replace(/[^\w.-]+/g, "_")}`;
    download(`compare-search-cases-${x.n}-${tag}-${String(x.version || "unknown").replace(/[^\w.-]/g, "_")}-${stamp()}.jsonl`, x.text, "application/x-ndjson");
    S.pv.rc.sdl = null; renderRunCompare();
    const nt = $("#rcSDNote"); if (nt) nt.textContent = `Downloaded ${x.n} shown case${x.n === 1 ? "" : "s"} (${x.ids.map(i => JSON.stringify(i)).join(", ")}) of ${x.total} current run rows, in the order shown. Nothing in either run, your dataset or selection changed.`;
    $("#rcSDBtn")?.focus();
  };
}
// t_ba9f4888: the shown decreases as a .jsonl evaluation dataset = case_list_export.js over the CURRENT frozen run rows,
// bound by current run position AND typed id, in the shown order. Same serializer as Export > evaluated dataset; no
// scores, the rows' human labels exactly as authored. Re-derived at click; any drift refuses. 0 calls, nothing mutated.
const rcDecList = d => d.shown.map(x => ({ pos: x.current_pos, id: x.id }));
function rcDecExportHTML(r, lab, d) {
  const e = evalExport(), n = d.shown.length, E = d.excluded;
  const why = [E.changed ? `${E.changed} input changed` : "", E.cannot_compare ? `${E.cannot_compare} input not comparable` : "", E.missing ? `${E.missing} a score missing` : "", d.not_matched ? `${d.not_matched} not matched by ID (ambiguous, one side only or no ID)` : ""].filter(Boolean);
  return `<div class="distexp rcdx"><button type="button" class="ghost" id="rcDecExport"${e.ok ? "" : " disabled"}>${d.direction === "inc" && n === 1 ? "Download this 1 current case" : `Download these ${n} current case${n === 1 ? "" : "s"}`} (.jsonl)</button> <span class="hint" id="rcDecExportNote" role="status">${e.ok ? `<b>Current run traces</b> (not the baseline's): the ${n} shown of ${d.eligible} eligible, ${esc(lab)}, ${d.direction === "inc" ? "recorded score increases (not verified improvements)" : "recorded score decreases (not confirmed regressions)"}, in this order, as frozen when the current run started. Recorded versions: baseline ${esc(String(r.baseline.app_version ?? "unknown"))}, current ${esc(String(r.current.app_version ?? "unknown"))}.${why.length ? ` Left out: ${esc(why.join(" · "))}.` : ""} Human labels as authored; no scores. ${d.direction === "inc" ? "Saved to this device only; the file contains the cases' request, answer and tool text, so treat it as private. Upload it on the Dataset step to reuse just these cases as an evaluation dataset." : "Upload it on the Dataset step to test a fix on just these cases."}` : esc(EVAL_WHY[e.reason] || "Not available.")}</span></div>`;
}
function rcDecExport() {
  const v = S.pv?.rc?.shown, nowR = v && v.o === S.pv.o && v.results === S.results && v.runRows === S.runRows ? buildRunCompare(rcBaseline(S.pv.o), rcCurrent()) : null;
  const key = nowR?.ok && nowR.pairs.length ? (S.pv.rc.dec && nowR.pairs.some(p => `${p.judge}:${p.metric}` === S.pv.rc.dec) ? S.pv.rc.dec : `${nowR.pairs[0].judge}:${nowR.pairs[0].metric}`) : null, ord = rcOrd(), D = nowR?.ok && ord !== "dataset" && ord === v.ord && key && nowR.pairs.some(p => `${p.judge}:${p.metric}` === key) ? runCompareChanges(nowR, ...key.split(":"), ord) : null;
  const L = D?.ok ? rcDecList(D) : [], same = v && JSON.stringify(L) === JSON.stringify(v.decList);
  const x = same && L.length ? buildCaseListExport({ runRows: S.runRows, results: S.results, summary: S.summary, list: L, build: evalExport }) : { ok: false, reason: v?.decList?.length ? "stale" : "empty" };
  if (!x.ok) { alert(`${x.reason === "stale" ? "The current run or the opened file changed since this comparison was shown." : DLX_WHY[x.reason] || EVAL_WHY[x.reason] || "Not available."} Nothing was downloaded. Nothing was changed.`); renderRunCompare(); return; }
  download(`${v.ord === "inc" ? "increased" : "decreased"}-cases-${x.n}-${key.replace(/[^\w.-]+/g, "_")}-${String(x.version || "unknown").replace(/[^\w.-]/g, "_")}-${stamp()}.jsonl`, x.text, "application/x-ndjson");
  const nt = $("#rcDecExportNote"); if (nt) nt.textContent = `Downloaded ${x.n} current case${x.n === 1 ? "" : "s"} (${x.ids.map(i => JSON.stringify(i)).join(", ")}) of ${x.total} current run rows.${v.ord === "inc" ? " Recorded score increases, not verified improvements." : ""} Nothing in either run or your dataset changed.`;
}
// t_3d9f9b07: comparison brief = run_compare_brief.js over the SAME buildRunCompare result + runCompareDecreases view
function rcBriefText(r, ord, decKey, D) {
  return buildRunCompareBrief({ compare: r, view: { order: ord, dec: decKey, trace: S.pv.rc.trace }, decreases: D,
    meta: { file_name: S.pv.name, app_version: S.cfg?.version ?? null, generated_at: S.pv.rc.briefAt } });
}
function rcDownloadBrief() {
  const v = S.pv?.rc?.shown;
  // refuse when the run or opened file was replaced/cleared since the view was shown, or the view no longer re-derives
  const now = v && v.o === S.pv.o && v.results === S.results && v.runRows === S.runRows ? buildRunCompare(rcBaseline(S.pv.o), rcCurrent()) : null;
  const ord = now?.ok && now.pairs.length ? rcOrd() : "dataset";
  const key = now?.ok && now.pairs.length ? (S.pv.rc.dec && now.pairs.some(p => `${p.judge}:${p.metric}` === S.pv.rc.dec) ? S.pv.rc.dec : `${now.pairs[0].judge}:${now.pairs[0].metric}`) : null;
  const t = now?.ok ? rcBriefText(now, ord, key, ord !== "dataset" ? runCompareChanges(now, ...key.split(":"), ord) : null) : null;
  if (!t || t !== v.text) { alert("The current run or the opened file changed since this comparison was shown, so nothing was downloaded. Nothing was changed."); renderRunCompare(); return; }
  download(`comparison-brief-${stamp()}.md`, t, "text/markdown");
}
function rcHide() { S.pv.rc = null; renderRunCompare(); $(".rcgo")?.focus(); }
const RC_GRP = { all: "All matched", same: "Same input", changed: "Input changed" };
const rcListName = nav => (nav.dir === "dataset" ? `${RC_GRP[nav.trace].toLowerCase()} group` : nav.dir === "inc" ? "increases list" : "decreases list") + (nav.q ? " or search" : "");
function rcOpenCase(r, bp, cp, opener, nav, focusSel) {
  const m = r.matched.find(x => x.baseline_pos === bp && x.current_pos === cp), el = $("#rcCase");
  const now = buildRunCompare(rcBaseline(S.pv.o), rcCurrent());
  const still = now.ok && now.matched.some(x => x.baseline_pos === bp && x.current_pos === cp && x.id === m?.id);
  if (!m || !still || (nav && !rcNavFresh(nav))) { alert(`The current run${nav ? `, the opened file or the ${rcListName(nav)}` : ""} changed since this comparison was shown, so this case was not opened. No other case was opened instead. Nothing was changed.`); renderRunCompare(); return; }
  const b = S.pv.o.rows[bp], c = S.runRows[cp], pl = p => `${JLAB[p.judge]}: ${MLAB[p.metric]}`;
  const tr = (x, lab) => `<div><h5 class="rch">${lab}</h5>${["query", "response", "context", "tool_definitions"].filter(k => k === "query" || k === "response" || x[k] != null).map(k => `<b class="hint">${k}</b><pre class="snap">${esc(snapText(x[k]))}</pre>`).join("")}</div>`;
  const diffK = [...new Set([...Object.keys(b), ...Object.keys(c)])].filter(k => !k.startsWith("human_") && JSON.stringify(b[k]) !== JSON.stringify(c[k]));
  el.innerHTML = `<div class="card rccase" tabindex="-1"><div class="bar"><h4 style="margin:0">${esc(rcId(m.id))} <span class="hint">baseline row ${bp + 1} · current row ${cp + 1}</span></h4><button type="button" class="ghost rcback">← Back to comparison</button></div>
    <p>${m.trace === "same" ? `<b class="tr-same">Same input</b> <span class="hint">(every stored field except labels is identical; key order ignored)</span>` : m.trace === "changed" ? `<b class="tr-changed">Input changed</b> <span class="hint">fields that differ: ${diffK.map(k => esc(k)).join(", ") || "key order or nested values"}. These scores are for different inputs.</span>` : "Input not comparable."}</p>
    <div class="tablewrap rccells"><table class="agtab rctab"><thead><tr><th>Judge: metric</th><th>Baseline (recorded)</th><th>Current</th><th>Δ</th></tr></thead><tbody>${m.cells.map(x => `<tr><th scope="row">${pl(x)}</th><td data-l="Baseline">${rcScore(x.baseline)}</td><td data-l="Current">${rcScore(x.current)}</td><td data-l="Δ">${rcDelta(x.delta)}</td></tr>`).join("")}</tbody></table></div>
    <div class="grid2">${tr(b, "Recorded run (from the file)")}${tr(c, "Current run (frozen at run start)")}</div>
    <p class="hint">Stored values only; nothing is re-judged. Recorded: ${esc(r.baseline.app_version ?? "unknown version")} at ${esc(r.baseline.completed_at ?? "unknown time")}. Current: ${esc(r.current.app_version ?? "unknown version")} at ${esc(r.current.completed_at ?? "unknown time")}.</p></div>`;
  const back = $(".rcback", el);
  back.onclick = () => { el.innerHTML = ""; if (opener.isConnected) { opener.scrollIntoView({ block: "center" }); opener.focus({ preventScroll: true }); } else $(".rcclose")?.focus(); };
  if (nav) {
    const [j, mt] = (nav.key || ":").split(":"), i = nav.L.findIndex(e => e.pos === cp && e.b === bp && JSON.stringify(e.id) === JSON.stringify(m.id));
    const bar = document.createElement("div"); bar.className = "distnav"; bar.id = "rcNav";
    const mk = (dir, txt) => { const b = document.createElement("button"); b.type = "button"; b.className = "ghost"; b.id = dir < 0 ? "rcPrev" : "rcNext"; b.textContent = txt;
      const st = distNavStep(nav.L, cp, m.id, dir); b.disabled = !st.ok; b.setAttribute("aria-label", `${dir < 0 ? "Previous" : "Next"} case, ${nav.dir === "dataset" ? `${RC_GRP[nav.trace].toLowerCase()} case` : nav.dir === "inc" ? "increased case" : "decreased case"}${st.ok ? ` (${st.i + 1} of ${st.n})` : dir < 0 ? ", this is the first" : ", this is the last"}`);
      b.onclick = () => { const t = distNavStep(nav.L, cp, m.id, dir); if (!t.ok) return; const fr = rcNavFresh(nav); if (!fr) { alert(`The current run, the opened file or the ${rcListName(nav)} changed since this comparison was shown, so no other case was opened. Nothing was changed.`); el.innerHTML = ""; renderRunCompare(); return; }
        rcOpenCase(fr, nav.L[t.i].b, t.pos, opener, nav, dir < 0 ? "#rcPrev" : "#rcNext"); }; return b; };
    const lab = document.createElement("span"); lab.className = "hint"; lab.id = "rcNavPos"; lab.setAttribute("aria-live", "polite");
    const inc = nav.dir === "inc";
    const qT = nav.q ? ` · <span class="nw">search “${esc(nav.q)}” (${nav.L.length} of ${nav.total})</span>` : "";
    if (nav.dir === "dataset") lab.innerHTML = `Case <b>${i + 1}</b> of <b>${nav.L.length}</b> shown${qT} · <span class="nw">${RC_GRP[nav.trace]}${nav.trace === "all" ? ` (${nav.matched})` : ""}</span> · <span class="nw">current dataset order</span> · <span class="nw">ID ${esc(rcId(m.id))}</span> · <span class="nw">baseline row ${bp + 1} → current row ${cp + 1}</span>${m.trace === "changed" ? ` · <b class="tr-changed">input changed</b>` : ""}`;
    else lab.innerHTML = `${inc ? "Increased" : "Decreased"} case <b>${i + 1}</b> of <b>${nav.L.length}</b> shown${qT} · ${esc(`${JLAB[j]}: ${MLAB[mt]}`)} · <span class="nw">recorded score ${inc ? "increases" : "decreases"}, same input only (${nav.eligible} eligible)</span> · ${inc ? "not verified improvements" : "not verified regressions"}`;
    const g = document.createElement("span"); g.className = "navgrp"; g.append(mk(-1, "‹ Previous case"), mk(1, "Next case ›"));
    bar.append(g, lab); $(".rccase", el).prepend(bar);
  }
  let f = focusSel ? $(focusSel, el) : null; if (f && f.disabled) f = $("#rcNext", el)?.disabled === false ? $("#rcNext", el) : $("#rcPrev", el)?.disabled === false ? $("#rcPrev", el) : back;
  $(".rccase", el).scrollIntoView({ block: "start" }); (f || $(".rccase", el)).focus({ preventScroll: true });
}
$("#pkgfile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (f.size > BENCH_PACKAGE_OPEN_MAX_BYTES) { alert(`That file is over ${BENCH_PACKAGE_OPEN_MAX_BYTES / 1e6} MB, so it was not opened. Nothing was changed.`); return; }
  let t; try { t = await f.text(); } catch { alert("Could not read that file. Nothing was changed."); return; }
  const o = openBenchPackage(t, { buildBenchCompare, runPricing, buildBenchBrief });
  if (!o.ok) { alert(`This benchmark package cannot be opened: ${o.error}. Nothing was changed.`); return; }
  S.pv = { name: f.name, o };
  try { renderPkgView(); } catch { S.pv = null; renderPkgView(); alert("This benchmark package cannot be opened: part of it could not be displayed. Nothing was changed."); return; } $("#pkgView").scrollIntoView({ block: "start" }); $(".pvclose").focus();
};

// ---------- boot
(async () => {
  S.cfg = await api("/api/config");
  $("#ver").textContent = S.cfg.version;
  $("#metricOpts").innerHTML = S.cfg.metrics.map(m => `<label class="chk"><input type="checkbox" value="${m}" checked> ${M[m]} <span class="hint">${S.cfg.atoms[m].length} atomic checks</span></label>`).join("");
  if (S.cfg.foundry?.enabled) { $("#fndwrap").hidden = false; $("#fndlabel").textContent = `(${S.cfg.foundry.project}, via evaluate(); up to ${S.cfg.foundry.max_rows} rows)`; }
  if (S.cfg.baseline.enabled) { $("#bllabel").textContent = S.cfg.baseline.label; }
  else { $("#useBaseline").disabled = true; $("#bllabel").textContent = "Foundry built-in LLM judge (not configured on this host)"; }
  $("#genkinds").innerHTML = S.cfg.mutations.map(k => `<label><input type="checkbox" value="${k}" checked> ${k.replace(/_/g, " ")}</label>`).join("");
  S.samples = await api("/api/samples");
  $("#sample").innerHTML = S.samples.map(s => `<option value="${esc(s.name)}">${esc(s.name.replace(/_/g, " "))} (${s.rows.length})</option>`).join("");
  renderSamplePreview();
  renderData(); renderDash();
})();

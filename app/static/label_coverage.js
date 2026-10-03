// Per-metric human-label coverage: a pure function over a dataset (the current draft S.rows, or the
// frozen S.runRows snapshot of the last run). It answers "can this dataset measure Jev <-> human agreement
// for metric X, and on how many rows?" BEFORE anything is run. No scores, no model calls, no labels invented.
// Applicability mirrors the Python judge exactly (evaluators.build_state + SPECS[m].requires):
//   intent_resolution, task_adherence: always
//   tool_call_accuracy: the trace has a tool call (response / tool_calls) OR tool_definitions
//   groundedness: context OR a tool result in the response
// Loaded by the browser (window.buildCoverage) and by node tests (module.exports).
"use strict";
(function (root) {
  const METRICS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"];
  // Python truthiness (None, "", 0, [], {} and false are falsy)
  const truthy = v => v != null && v !== false && v !== "" && v !== 0 && !(typeof v === "number" && isNaN(v))
    && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  function toolCalls(response, tool_calls) {           // evaluators._extract_tool_calls
    let src = truthy(tool_calls) ? tool_calls : response, n = 0;
    if (isObj(src)) src = [src];
    if (!Array.isArray(src)) return 0;
    for (const m of src) {
      if (!isObj(m)) continue;
      if (["tool_call", "function_call"].includes(m.type) || ("name" in m && "arguments" in m)) n++;
      if (Array.isArray(m.content)) for (const c of m.content) if (isObj(c) && ["tool_call", "function_call"].includes(c.type)) n++;
      if (truthy(m.tool_calls) && Array.isArray(m.tool_calls)) n += m.tool_calls.length;
    }
    return n;
  }
  function toolResults(response) {                      // evaluators._extract_tool_results
    let n = 0;
    if (Array.isArray(response)) for (const m of response) {
      if (!isObj(m) || m.role !== "tool") continue;
      n += Array.isArray(m.content) ? m.content.filter(isObj).length : 1;
    }
    return n;
  }
  function applicable(row, m) {
    if (!isObj(row)) return false;
    if (m === "tool_call_accuracy") return toolCalls(row.response, row.tool_calls) > 0 || truthy(row.tool_definitions);
    if (m === "groundedness") return truthy(row.context) || toolResults(row.response) > 0;
    return true;
  }
  // label state: "none" (missing/blank), "ok" (whole number 1-5, the only value the UI/form accepts), "invalid" (anything else)
  function labelState(v) {
    if (v === undefined || v === null || v === "") return "none";
    return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? "ok" : "invalid";
  }
  // provenance as already stored on the row; anything else is honestly "not recorded"
  const provenance = r => r?.generated ? "generated" : r?.source === "user-authored" ? "user-authored" : "not recorded";

  function buildCoverage(rows) {
    rows = Array.isArray(rows) ? rows : [];
    const out = { rows: rows.length, metrics: {} };
    for (const m of METRICS) {
      const x = { applicable: 0, comparable: 0, not_applicable: 0, missing: [], invalid: [], label_on_not_applicable: [],
        by_provenance: { "user-authored": 0, generated: 0, "not recorded": 0 } };
      rows.forEach((r, idx) => {
        const id = isObj(r) ? r.id : undefined, ap = applicable(r, m), st = labelState(isObj(r) ? r["human_" + m] : undefined);
        const ref = { idx, id: id == null ? null : String(id) };
        if (!ap) { x.not_applicable++; if (st !== "none") x.label_on_not_applicable.push({ ...ref, value: r["human_" + m] }); return; }
        x.applicable++;
        if (st === "ok") { x.comparable++; x.by_provenance[provenance(r)]++; }
        else if (st === "invalid") x.invalid.push({ ...ref, value: r["human_" + m] });
        else x.missing.push(ref);
      });
      out.metrics[m] = x;
    }
    return out;
  }
  // Label queue for ONE metric: every applicable row whose label is missing or invalid, in dataset order.
  // Same projection as buildCoverage (no second rule). Entries point at rows by index; nothing is copied.
  function labelQueue(rows, m) {
    const x = buildCoverage(rows).metrics[m]; if (!x) return [];
    return [...x.invalid.map(r => ({ ...r, kind: "invalid" })), ...x.missing.map(r => ({ ...r, kind: "missing" }))].sort((a, b) => a.idx - b.idx);
  }
  // Next entry strictly after row index `from` (wrapping to the start); null when nothing needs a label.
  // from = -1 starts at the top. May return the entry AT `from` only if it is the sole remaining one.
  function nextInQueue(rows, m, from) {
    const q = labelQueue(rows, m); if (!q.length) return null;
    return q.find(e => e.idx > from) || q[0];
  }
  // ---- one-row all-metric label pass (same applicability + labelState rules; nothing copied or generated)
  const NA_REASON = { tool_call_accuracy: "no tool call or tool list in this trace", groundedness: "no context or tool result in this trace" };
  // per-metric view of ONE row: applicable?, n/a reason, current label state/value (read-only projection)
  function caseLabels(row) {
    const out = {};
    for (const m of METRICS) {
      const ap = applicable(row, m), v = isObj(row) ? row["human_" + m] : undefined;
      out[m] = { applicable: ap, reason: ap ? null : (NA_REASON[m] || "not applicable"), state: labelState(v), value: v === undefined ? null : v };
    }
    return out;
  }
  // rows with at least one APPLICABLE metric whose label is missing or invalid (n/a metrics never count), dataset order
  function casesNeedingLabels(rows) {
    rows = Array.isArray(rows) ? rows : [];
    const out = [];
    rows.forEach((r, idx) => {
      const c = caseLabels(r), need = METRICS.filter(m => c[m].applicable && c[m].state !== "ok");
      if (need.length) out.push({ idx, id: isObj(r) && r.id != null ? String(r.id) : null, need, invalid: need.filter(m => c[m].state === "invalid") });
    });
    return out;
  }
  function nextCaseNeeding(rows, from) {
    const q = casesNeedingLabels(rows); if (!q.length) return null;
    return q.find(e => e.idx > from) || q[0];
  }
  // Validate the typed values for one row's pass. vals: {metric: string}. Only applicable metrics with a currently
  // missing/ok label are editable here; invalid stored values route to the JSON editor; n/a labels are never touched.
  // Returns {ok, errors, changes:{metric: number|null}} where null = delete (user explicitly blanked it).
  function planCaseLabels(row, vals) {
    const c = caseLabels(row), errors = {}, changes = {};
    for (const m of METRICS) {
      if (!(m in (vals || {}))) continue;
      if (!c[m].applicable || c[m].state === "invalid") continue;
      const raw = String(vals[m] ?? "").trim();
      if (raw !== "" && !/^[1-5]$/.test(raw)) { errors[m] = "Use a whole number 1–5, or leave blank."; continue; }
      const nv = raw === "" ? null : +raw, cur = c[m].state === "ok" ? c[m].value : null;
      if (nv !== cur) changes[m] = nv;
    }
    return { ok: !Object.keys(errors).length, errors, changes };
  }
  // Keyboard map for the label pass, scoped by the caller to its own label inputs only. Returns what a keydown means:
  // {set:"1".."5"} = put that digit in the focused metric and move focus on; "save_next" = invoke Save & next;
  // "swallow" = held-down Enter repeat (ignored, never a second submit); null = browser default (Tab/Shift+Tab/Escape/
  // Backspace/other keys/any modifier/IME composition/auto-repeat digits).
  function labelKeyAction(e) {
    if (!e || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return null;
    if (/^[1-5]$/.test(e.key) && !e.repeat) return { set: e.key };
    if (e.key === "Enter" && !e.shiftKey) return e.repeat ? "swallow" : "save_next";
    return null;
  }
  // ---- label-pass session progress + Undo last save (local dataset editing only; no scores)
  // labelSig: canonical signature of ONE row's four human_* labels, absent keys recorded as absent (not null).
  function labelSig(row) {
    const o = {}; if (isObj(row)) for (const m of METRICS) if (Object.prototype.hasOwnProperty.call(row, "human_" + m)) o[m] = row["human_" + m];
    return JSON.stringify(o);
  }
  // Capture what an Undo needs BEFORE a save mutates the row: exact prior label values (absent keys stay absent) and
  // the row's key order, so a restore puts the object back byte-for-byte (JSON) without touching any other field.
  function captureSave(row) {
    const prior = {}; for (const m of METRICS) { const k = "human_" + m; prior[m] = Object.prototype.hasOwnProperty.call(row, k) ? { present: true, value: row[k] } : { present: false }; }
    return { row, prior, keys: Object.keys(row), beforeJSON: JSON.stringify(row) };
  }
  // After the save: seal the record with the row content it produced. Returns null for a no-op save (nothing to undo).
  function sealSave(rec) { const a = JSON.stringify(rec.row); return a === rec.beforeJSON ? null : { ...rec, afterJSON: a }; }
  // Undo exactly that save on exactly that row object. Refuses (touching nothing) if the row object is gone from
  // `rows` (deleted / import / JSON or form edit replaced it) or its content changed in any way since the save.
  // On success mutates only that row object in place: labels restored (absent keys deleted), original key order kept.
  function undoSave(rows, rec) {
    if (!rec || !Array.isArray(rows)) return { ok: false, reason: "nothing to undo" };
    const at = rows.indexOf(rec.row);
    if (at < 0) return { ok: false, reason: "that case was removed or replaced (deleted, re-imported or edited as a new object) since the save" };
    if (JSON.stringify(rec.row) !== rec.afterJSON) return { ok: false, reason: "that case was changed after the save" };
    const r = rec.row, cur = { ...r }, lab = k => k.startsWith("human_") && METRICS.includes(k.slice(6));
    for (const k of Object.keys(r)) delete r[k];
    for (const k of rec.keys) {
      if (lab(k)) { const p = rec.prior[k.slice(6)]; if (p.present) r[k] = p.value; }
      else if (Object.hasOwn(cur, k)) r[k] = cur[k];
    }
    for (const k of Object.keys(cur)) if (!(k in r) && !lab(k)) r[k] = cur[k];   // defensive: never drop a field
    if (JSON.stringify(r) !== rec.beforeJSON) {                                    // cannot happen; restore and refuse
      for (const k of Object.keys(r)) delete r[k]; Object.assign(r, cur); return { ok: false, reason: "restore check failed; nothing changed" };
    }
    return { ok: true, idx: at };
  }
  // Honest session progress: `base` is a Map(rowObject -> labelSig at first label-pass save this session). Changed =
  // rows still in the dataset whose labels now differ from that baseline (no-op saves and undone saves count 0).
  function sessionProgress(rows, base) {
    rows = Array.isArray(rows) ? rows : [];
    const live = new Set(rows); let changed = 0; if (base) for (const [r, sig] of base) if (live.has(r) && labelSig(r) !== sig) changed++;
    return { changed, needing: casesNeedingLabels(rows).length, total: rows.length };
  }
  // Session label-change export: for each row object still in `rows` whose labels differ from the baseline captured at
  // its first label-pass save this session, list every metric whose label differs, before -> after. Absent labels are
  // {present:false}, never null/0; raw values kept as stored (no coercion, no inference). Rows removed or replaced
  // (import / JSON or form edit / clear) are not in `rows` by identity, so they can never be misattributed.
  function sessionChanges(rows, base) {
    rows = Array.isArray(rows) ? rows : []; const out = [];
    if (!base) return out;
    const at = new Map(rows.map((r, i) => [r, i]));
    for (const [r, sig] of base) {
      if (!at.has(r) || labelSig(r) === sig) continue;
      const b = JSON.parse(sig), a = JSON.parse(labelSig(r)), metrics = [];
      for (const m of METRICS) {
        const bp = Object.hasOwn(b, m), ap = Object.hasOwn(a, m);
        if (bp === ap && (!bp || JSON.stringify(b[m]) === JSON.stringify(a[m]))) continue;
        metrics.push({ metric: m, before: bp ? { present: true, value: b[m] } : { present: false }, after: ap ? { present: true, value: a[m] } : { present: false } });
      }
      out.push({ row_index: at.get(r), id: r.id ?? null, changes: metrics });
    }
    return out.sort((x, y) => x.row_index - y.row_index);
  }
  function changesPacket(rows, base, meta = {}) {
    const cases = sessionChanges(rows, base);
    return { kind: "jev-foundry-judge/label-session-changes", version: 1, app_version: meta.version ?? null, generated_at: meta.at ?? null,
      scope: "Human label differences in THIS browser session only, for cases saved at least once with the label pass: current labels compared with that case's labels just before its first label-pass save this session (later inline edits to such a case are included). Not a durable audit history; saves that changed nothing and undone saves are excluded; cases removed, re-imported or replaced by the JSON/form editor since are excluded. No traces, keys, model scores or agreement are included.",
      dataset_rows: rows.length, cases_changed: cases.length, label_changes: cases.reduce((n, c) => n + c.changes.length, 0),
      value_format: "before/after = {present:true,value:<stored label>} or {present:false} (no label); row_index = 0-based position in the current dataset (disambiguates duplicate ids)", cases };
  }
  // ---- import a label-changes .json as a LOCAL review checklist (read-only; never applies file labels)
  // parseChangesFile: validate kind/version/shape. Whole-file failures (not JSON, wrong kind/version, no cases, no
  // entries) return {ok:false,error}. Per-entry problems become "invalid" items with a reason, never guessed/repaired.
  // Only id/metric/before/after are kept; row_index is ignored (positions do not survive reordering/deletes).
  const KIND = "jev-foundry-judge/label-session-changes";
  const lblOk = x => isObj(x) && (x.present === false ? Object.keys(x).length === 1 : x.present === true && Object.hasOwn(x, "value") && Object.keys(x).length === 2);
  const idOk = v => (typeof v === "string" && v !== "") || (typeof v === "number" && Number.isFinite(v));
  function parseChangesFile(text) {
    let p; try { p = JSON.parse(text); } catch { return { ok: false, error: "not a JSON file" }; }
    if (!isObj(p)) return { ok: false, error: "not a label-changes object" };
    if (p.kind !== KIND) return { ok: false, error: `wrong kind (expected "${KIND}")` };
    if (p.version !== 1) return { ok: false, error: `unsupported version ${JSON.stringify(p.version)} (expected 1)` };
    if (!Array.isArray(p.cases)) return { ok: false, error: "cases is not a list" };
    if (!p.cases.length) return { ok: false, error: "the file lists no changed cases" };
    const items = [], seen = new Map();
    p.cases.forEach((c, ci) => {
      if (!isObj(c)) { items.push({ id: null, metric: null, status: "invalid", reason: `case ${ci + 1} is not an object` }); return; }
      if (!idOk(c.id)) { items.push({ id: null, metric: null, status: "invalid", reason: `case ${ci + 1} has no usable id (${JSON.stringify(c.id ?? null)}); cannot be matched` }); return; }
      if (!Array.isArray(c.changes) || !c.changes.length) { items.push({ id: c.id, metric: null, status: "invalid", reason: "no metric changes listed" }); return; }
      for (const x of c.changes) {
        const m = isObj(x) ? x.metric : undefined;
        if (!METRICS.includes(m)) { items.push({ id: c.id, metric: typeof m === "string" ? m : null, status: "invalid", reason: `unknown metric ${JSON.stringify(m ?? null)}` }); continue; }
        if (!lblOk(x.before) || !lblOk(x.after)) { items.push({ id: c.id, metric: m, status: "invalid", reason: "before/after must be {present:true,value} or {present:false}" }); continue; }
        const k = JSON.stringify([c.id, m]), it = { id: c.id, metric: m, before: x.before, after: x.after };
        if (seen.has(k)) { const f = seen.get(k); f.status = "invalid"; f.reason = it.reason = "the file lists this case + metric more than once"; it.status = "invalid"; items.push(it); continue; }
        seen.set(k, it); items.push(it);
      }
    });
    return { ok: true, meta: { app_version: p.app_version ?? null, generated_at: p.generated_at ?? null, dataset_rows: p.dataset_rows ?? null }, items };
  }
  // Resolve ONE checklist item against the CURRENT rows by exact id (same type + value). Never by row_index.
  // status: invalid | missing (no row with this id) | ambiguous (2+ rows) | matched (current label == file after,
  // absent vs numeric kept distinct) | drifted (current differs from file after). `row` is the object for the dialog.
  function resolveItem(rows, it) {
    if (it.status === "invalid") return { ...it };
    rows = Array.isArray(rows) ? rows : [];
    const hits = []; rows.forEach((r, idx) => { if (isObj(r) && JSON.stringify(r.id) === JSON.stringify(it.id)) hits.push(idx); });
    if (!hits.length) return { ...it, status: "missing", reason: "no case with this exact id in the current dataset (deleted, renamed or a different dataset)" };
    if (hits.length > 1) return { ...it, status: "ambiguous", reason: `${hits.length} cases share this id, so the file cannot say which one it meant` };
    const r = rows[hits[0]], k = "human_" + it.metric, cur = Object.hasOwn(r, k) ? { present: true, value: r[k] } : { present: false };
    const same = cur.present === it.after.present && (!cur.present || JSON.stringify(cur.value) === JSON.stringify(it.after.value));
    return { ...it, status: same ? "matched" : "drifted", idx: hits[0], row: r, current: cur, applicable: applicable(r, it.metric) };
  }
  function buildChecklist(rows, items) {
    const out = (items || []).map(it => resolveItem(rows, it)), counts = { matched: 0, drifted: 0, missing: 0, ambiguous: 0, invalid: 0 };
    for (const x of out) counts[x.status]++;
    return { items: out, counts, reviewable: out.filter(x => x.status === "matched" || x.status === "drifted").length };
  }
  // ---- TRACE FINGERPRINT (scheme jfj-trace-v1). An unsigned content comparison of the judge-relevant part of ONE case,
  // taken at ACTION time (typed Save / Confirm). Projection = every stored top-level field EXCEPT human_* labels
  // (id, request/query/conversation, response/answer incl. tool calls + results, tool_definitions, tool_calls, context,
  // scenario/provenance and any other stored field). Object keys are sorted recursively (key order carries no meaning
  // in JSON objects); array order is kept (message/tool-call order is meaningful). SHA-256 over the UTF-8 canonical
  // JSON via the standard Web Crypto API, locally. Not reviewer identity, not correctness, not proof of history, and
  // a hash cannot reconstruct the old trace (no field-level diff is possible from it).
  const FP_SCHEME = "jfj-trace-v1", FP_ALG = "SHA-256";
  const canon = v => Array.isArray(v) ? "[" + v.map(x => x === undefined ? "null" : canon(x)).join(",") + "]"
    : isObj(v) ? "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
    : JSON.stringify(v ?? null);
  function traceProjection(row) {
    if (!isObj(row)) return null;
    return canon(Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("human_"))));
  }
  async function sha256Hex(str) {
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    if (typeof str !== "string" || !c?.subtle || typeof TextEncoder === "undefined") return null;
    try { const b = new Uint8Array(await c.subtle.digest(FP_ALG, new TextEncoder().encode(str))); return Array.from(b, x => x.toString(16).padStart(2, "0")).join(""); }
    catch { return null; }
  }
  // parse a fingerprint claimed in a file: absent | present | unsupported | malformed (never repaired/guessed)
  function parseFp(fp, acted) {
    if (fp === undefined || fp === null) return { state: "absent" };
    if (!acted) return { state: "malformed", reason: "a fingerprint on an entry with no Save/Confirm action" };
    if (!isObj(fp)) return { state: "malformed", reason: "trace_fingerprint is not an object" };
    if (fp.scheme !== FP_SCHEME || fp.alg !== FP_ALG) return { state: "unsupported", reason: `scheme ${JSON.stringify(fp.scheme ?? null)} / alg ${JSON.stringify(fp.alg ?? null)} (this app checks ${FP_SCHEME} / ${FP_ALG})` };
    if (typeof fp.digest !== "string" || !/^[0-9a-f]{64}$/.test(fp.digest)) return { state: "malformed", reason: "digest is not 64 lowercase hex characters" };
    return { state: "present", digest: fp.digest };
  }
  // ---- OPT-IN REVIEWED TRACE (reviewed_trace). Only when the reviewer explicitly ticks "Include reviewed trace" does the
  // export carry the jfj-trace-v1 projection captured AT the Save/Confirm action (the same string that was hashed).
  // Inspect treats it as untrusted: it is used for a field-level comparison ONLY after canon(trace) hashes to the entry's
  // own fingerprint. absent | unverifiable (no valid fingerprint) | unsupported | malformed | present (still to verify).
  function parseSnap(s, fpS, acted) {
    if (s === undefined || s === null) return { state: "absent" };
    if (!acted) return { state: "malformed", reason: "a reviewed trace on an entry with no Save/Confirm action" };
    if (!isObj(s) || !Object.hasOwn(s, "trace")) return { state: "malformed", reason: "reviewed_trace is not {scheme, trace}" };
    if (s.scheme !== FP_SCHEME) return { state: "unsupported", reason: `reviewed_trace scheme ${JSON.stringify(s.scheme ?? null)} (this app reads ${FP_SCHEME})` };
    if (!isObj(s.trace)) return { state: "malformed", reason: "reviewed_trace.trace is not an object" };
    if (!fpS || fpS.state !== "present") return { state: "unverifiable", reason: "no valid trace fingerprint to check it against" };
    let c; try { c = canon(s.trace); } catch { return { state: "malformed", reason: "reviewed_trace.trace cannot be read as JSON" }; }
    return { state: "present", canon: c, trace: JSON.parse(c) };   // diff exactly what was hashed (canon is lossy for NaN/Infinity)
  }
  // Field-level comparison of two JSON traces. Objects by key (key ORDER is not a change), arrays position by position
  // (order kept), leaves by exact JSON type+value (null != absent, 9 != "9"). Returns [{path, kind, before?, after?}].
  const jtype = v => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  const seg = k => /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
  const DIFF_MAX = 400;
  // content-addressed diff cache (both keys are canonical strings, so a hit can never belong to another pair)
  const DIFF_CACHE = new Map();
  function cachedDiff(ca, cb) { const k = ca + "\u0000" + cb; if (!DIFF_CACHE.has(k)) { if (DIFF_CACHE.size > 2000) DIFF_CACHE.clear(); DIFF_CACHE.set(k, traceDiff(JSON.parse(ca), JSON.parse(cb))); } return DIFF_CACHE.get(k); }
  function traceDiff(a, b, path = "", out = []) {
    if (out.length >= DIFF_MAX) return out;
    const ta = jtype(a), tb = jtype(b);
    if (ta === "object" && tb === "object") {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        const p = !path ? seg(k) : /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
        const ia = Object.hasOwn(a, k) && a[k] !== undefined, ib = Object.hasOwn(b, k) && b[k] !== undefined;
        if (ia && !ib) out.push({ path: p, kind: "removed", before: a[k] });
        else if (!ia && ib) out.push({ path: p, kind: "added", after: b[k] });
        else if (ia && ib) traceDiff(a[k], b[k], p, out);
        if (out.length >= DIFF_MAX) break;
      }
      return out;
    }
    if (ta === "array" && tb === "array") {
      for (let i = 0; i < Math.max(a.length, b.length) && out.length < DIFF_MAX; i++) {
        const p = `${path}[${i}]`;
        if (i >= b.length) out.push({ path: p, kind: "removed", before: a[i] });
        else if (i >= a.length) out.push({ path: p, kind: "added", after: b[i] });
        else traceDiff(a[i], b[i], p, out);
      }
      return out;
    }
    if (ta !== tb || JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path || "(whole trace)", kind: "changed", before: a, after: b });
    return out;
  }
  // ---- checklist OUTCOME export (local-only). Outcomes come ONLY from explicit actions recorded by the UI:
  // "saved" (typed Save in the checklist-scoped label dialog) or "confirmed" (explicit "Confirm current label" button).
  // Opening, Next, Skip, or the current label happening to match the file are NEVER confirmation. Skip is its own
  // outcome. Each action stores the exact row object + its full JSON at action time; if that row was since changed,
  // removed/replaced, or the id became ambiguous, the evidence is reported "stale" (never certifies the latest rows).
  // acts: Map(entryIndex -> {action, at, row, sig, value:{present,value?}}); skipped: Set(entryIndex).
  function checklistOutcome(rows, chk, meta = {}) {
    rows = Array.isArray(rows) ? rows : [];
    const cl = buildChecklist(rows, chk.items), acts = chk.acts || new Map(), sk = chk.skipped || new Set();
    const oc = { saved: 0, confirmed: 0, skipped: 0, not_reviewed: 0 }, ev = { current: 0, stale: 0 };
    const entries = cl.items.map((x, i) => {
      const a = acts.get(i), e = { entry: i + 1, id: x.id ?? null, metric: x.metric ?? null,
        file_before: x.before ?? null, file_after: x.after ?? null, current_status: x.status,
        current_label: x.current ?? null, current_reason: x.reason ?? null };
      if (a) {
        e.outcome = a.action; e.label_changed_by_save = a.action === "saved" ? !!a.changed : null; e.outcome_label = a.value; e.outcome_at = a.at ?? null; e.skipped_before = sk.has(i);
        e.trace_fingerprint = typeof a.fp === "string" ? { scheme: FP_SCHEME, alg: FP_ALG, digest: a.fp, taken: "at_action" } : null;
        e.trace_fingerprint_note = e.trace_fingerprint ? null : "could not be computed at action time (Web Crypto unavailable or a non-JSON value in the case)";
        if (meta.includeTrace && e.trace_fingerprint && typeof a.snap === "string") e.reviewed_trace = { scheme: FP_SCHEME, taken: "at_action", trace: JSON.parse(a.snap) };
        let why = null;
        if (!rows.includes(a.row)) why = "the case was removed or replaced after this action";
        else if (JSON.stringify(a.row) !== a.sig) why = "the case was changed after this action";
        else if (x.status !== "matched" && x.status !== "drifted") why = `the entry is now ${x.status}`;
        else if (x.row !== a.row) why = "the entry now resolves to a different case";
        e.evidence = why ? "stale" : "current"; e.evidence_note = why; ev[e.evidence]++;
      } else { e.outcome = sk.has(i) ? "skipped" : "not_reviewed"; e.label_changed_by_save = null; e.outcome_label = null; e.evidence = null; e.evidence_note = null; e.trace_fingerprint = null; e.trace_fingerprint_note = null; }
      oc[e.outcome]++; return e;
    });
    return { kind: "jev-foundry-judge/label-checklist-outcome", version: 1, app_version: meta.version ?? null, generated_at: meta.at ?? null,
      checklist_file: { name: chk.name ?? null, app_version: chk.meta?.app_version ?? null, generated_at: chk.meta?.generated_at ?? null, dataset_rows: chk.meta?.dataset_rows ?? null },
      scope: `Outcome of reviewing ONE imported label-changes file in THIS browser tab. outcome = saved (typed Save in the checklist label dialog; label_changed_by_save says whether that Save changed the label) | confirmed (explicit Confirm current label) | skipped | not_reviewed. Opening an entry, Next, Skip, or the current label matching the file are not confirmation. current_status/current_label are recomputed from the current dataset at download time and are separate from the outcome. evidence = current (the case is byte-identical to when the action was taken) | stale (changed, removed/replaced or no longer resolvable since). trace_fingerprint (saved/confirmed only) = ${FP_SCHEME} ${FP_ALG} of the case's judge-relevant fields (every stored field except human_* labels; object keys sorted, array order kept) taken at the moment of that action, so a later reviewer can tell whether the trace changed since; it is an unsigned content comparison, not reviewer identity, correctness or proof of history, and cannot reconstruct the trace. Unsaved typing is not included. ${meta.includeTrace ? "reviewed_trace (included because the reviewer chose Include reviewed trace) = the case's judge-relevant fields exactly as projected and hashed at that Save/Confirm, so a later reviewer can see which fields changed; it contains the case text and tool data. No keys, model scores or agreement" : "No traces, keys, model scores or agreement"}; nothing was applied or uploaded.`,
      reviewed_trace_included: !!meta.includeTrace,
      value_format: "labels = {present:true,value:<stored label>} or {present:false} (no label); current_label = null when the entry is missing/ambiguous/invalid",
      dataset_rows: rows.length, entries_total: entries.length, status_counts: cl.counts, outcome_counts: oc, evidence_counts: ev, entries };
  }
  // ---- READ-ONLY inspection of a downloaded checklist OUTCOME file (a second reviewer's view).
  // The file is untrusted CLAIMED evidence: no authenticated reviewer identity and no trace fingerprint, so a
  // current label that equals the claimed one never proves the original case evidence still holds.
  // parseOutcomeFile validates kind/version/shape and that the declared counts equal the counts of the entries;
  // any whole-file problem returns {ok:false,error} (caller keeps prior state). Per-entry shape problems become
  // "invalid" entries with a reason. inspectOutcome re-resolves each entry against the CURRENT rows by exact id
  // (resolveItem; ambiguous ids refused), never mutates rows, and keeps "claimed in file" separate from "checked now".
  const OKIND = "jev-foundry-judge/label-checklist-outcome", OUTCOMES = ["saved", "confirmed", "skipped", "not_reviewed"];
  const STATUSES = ["matched", "drifted", "missing", "ambiguous", "invalid"], MAX_OUTCOME_BYTES = 8000000, MAX_OUTCOME_ENTRIES = 5000;
  const countOk = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every(k => Number.isInteger(o[k]) && o[k] >= 0);
  function parseOutcomeFile(text) {
    if (typeof text !== "string") return { ok: false, error: "not a text file" };
    if (text.length > MAX_OUTCOME_BYTES) return { ok: false, error: `file is too large (over ${MAX_OUTCOME_BYTES / 1e6} MB)` };
    let p; try { p = JSON.parse(text); } catch { return { ok: false, error: "not a JSON file" }; }
    if (!isObj(p)) return { ok: false, error: "not a checklist-outcome object" };
    if (p.kind !== OKIND) return { ok: false, error: `wrong kind (expected "${OKIND}")` };
    if (p.version !== 1) return { ok: false, error: `unsupported version ${JSON.stringify(p.version)} (expected 1)` };
    if (!Array.isArray(p.entries) || !p.entries.length) return { ok: false, error: "entries is missing or empty" };
    if (p.entries.length > MAX_OUTCOME_ENTRIES) return { ok: false, error: `too many entries (over ${MAX_OUTCOME_ENTRIES})` };
    if (p.entries_total !== p.entries.length) return { ok: false, error: `entries_total ${JSON.stringify(p.entries_total)} does not equal the ${p.entries.length} entries listed` };
    if (!countOk(p.outcome_counts, OUTCOMES) || !countOk(p.status_counts, STATUSES)) return { ok: false, error: "outcome_counts/status_counts are missing or malformed" };
    const oc = Object.fromEntries(OUTCOMES.map(k => [k, 0])), sc = Object.fromEntries(STATUSES.map(k => [k, 0])), ec = { current: 0, stale: 0 };
    for (const [i, e] of p.entries.entries()) {
      if (!isObj(e)) return { ok: false, error: `entry ${i + 1} is not an object` };
      if (!OUTCOMES.includes(e.outcome)) return { ok: false, error: `entry ${i + 1} has unknown outcome ${JSON.stringify(e.outcome ?? null)}` };
      if (!STATUSES.includes(e.current_status)) return { ok: false, error: `entry ${i + 1} has unknown current_status ${JSON.stringify(e.current_status ?? null)}` };
      oc[e.outcome]++; sc[e.current_status]++;
      if (e.evidence === "current" || e.evidence === "stale") ec[e.evidence]++;
    }
    for (const k of OUTCOMES) if (oc[k] !== p.outcome_counts[k]) return { ok: false, error: `outcome_counts.${k} says ${p.outcome_counts[k]} but ${oc[k]} entries have it` };
    for (const k of STATUSES) if (sc[k] !== p.status_counts[k]) return { ok: false, error: `status_counts.${k} says ${p.status_counts[k]} but ${sc[k]} entries have it` };
    if (p.evidence_counts !== undefined && (!countOk(p.evidence_counts, ["current", "stale"]) || p.evidence_counts.current !== ec.current || p.evidence_counts.stale !== ec.stale))
      return { ok: false, error: "evidence_counts do not match the entries" };
    const entries = p.entries.map((e, i) => {
      const acted = e.outcome === "saved" || e.outcome === "confirmed";
      const x = { entry: i + 1, id: e.id ?? null, metric: e.metric ?? null, before: e.file_before ?? null, after: e.file_after ?? null,
        claimed: { outcome: e.outcome, outcome_label: e.outcome_label ?? null, outcome_at: typeof e.outcome_at === "string" ? e.outcome_at : null,
          label_changed_by_save: typeof e.label_changed_by_save === "boolean" ? e.label_changed_by_save : null,
          status_at_export: e.current_status, label_at_export: lblOk(e.current_label) ? e.current_label : null,
          evidence_at_export: e.evidence === "current" || e.evidence === "stale" ? e.evidence : null,
          evidence_note: typeof e.evidence_note === "string" ? e.evidence_note : null, trace_fp: parseFp(e.trace_fingerprint, acted) } };
      x.claimed.trace_snap = parseSnap(e.reviewed_trace, x.claimed.trace_fp, acted);
      let bad = null;
      if (!idOk(e.id)) bad = `no usable id (${JSON.stringify(e.id ?? null)}); cannot be matched`;
      else if (!METRICS.includes(e.metric)) bad = `unknown metric ${JSON.stringify(e.metric ?? null)}`;
      else if (!lblOk(e.file_before) || !lblOk(e.file_after)) bad = "file_before/file_after must be {present:true,value} or {present:false}";
      else if (acted && !lblOk(e.outcome_label)) bad = `a ${e.outcome} entry needs outcome_label {present:true,value} or {present:false}`;
      else if (!acted && e.outcome_label != null) bad = `a ${e.outcome} entry cannot carry an outcome_label`;
      else if (e.current_label != null && !lblOk(e.current_label)) bad = "current_label must be null or {present:true,value} or {present:false}";
      if (bad) { x.status = "invalid"; x.reason = bad; x.claimed.outcome_label = acted && lblOk(e.outcome_label) ? e.outcome_label : null; }
      return x;
    });
    return { ok: true, meta: { app_version: p.app_version ?? null, generated_at: p.generated_at ?? null, dataset_rows: p.dataset_rows ?? null,
      checklist_file: isObj(p.checklist_file) ? { name: p.checklist_file.name ?? null, app_version: p.checklist_file.app_version ?? null, generated_at: p.checklist_file.generated_at ?? null } : null },
      claimed_counts: { outcome: oc, status_at_export: sc, evidence_at_export: ec }, entries };
  }
  const sameLbl = (a, b) => lblOk(a) && lblOk(b) && a.present === b.present && (!a.present || JSON.stringify(a.value) === JSON.stringify(b.value));
  const TRACE_CMP = ["same", "changed", "unavailable", "unsupported", "malformed", "not_checkable", "pending", "cannot_compute"];
  // digestOf(canonicalString) -> hex | null (cannot compute) | undefined (not computed yet; listed in .pending)
  function inspectOutcome(rows, parsed, digestOf) {
    const tv = Object.fromEntries(TRACE_CMP.map(k => [k, 0])), sv = {}, pending = new Set();
    const now = { matched: 0, drifted: 0, missing: 0, ambiguous: 0, invalid: 0 }, cmp = { same: 0, different: 0, not_checkable: 0, no_claim: 0 };
    const entries = parsed.entries.map(x => {
      const r = resolveItem(rows, x.status === "invalid" ? x : { id: x.id, metric: x.metric, before: x.before, after: x.after });
      const res = { entry: x.entry, id: x.id, metric: x.metric, before: x.before, after: x.after, claimed: x.claimed,
        now: { status: r.status, label: r.current ?? null, reason: r.reason ?? null, row: r.idx ?? null } };
      now[r.status]++;
      const cl = x.claimed.outcome_label;
      res.claimed_vs_now = cl == null ? "no_claim" : res.now.label == null ? "not_checkable" : sameLbl(cl, res.now.label) ? "same" : "different";
      cmp[res.claimed_vs_now]++;
      // trace: file fingerprint vs an INDEPENDENT recompute over the uniquely matched current row (never another row)
      const fp = x.claimed.trace_fp || { state: "absent" };
      if (fp.state === "absent") res.trace_vs_now = "unavailable";
      else if (fp.state !== "present") res.trace_vs_now = fp.state;
      else if (r.status !== "matched" && r.status !== "drifted") res.trace_vs_now = "not_checkable";
      else { const c = traceProjection(r.row), h = digestOf ? digestOf(c) : undefined;
        res.trace_vs_now = h === undefined ? "pending" : h === null ? "cannot_compute" : h === fp.digest ? "same" : "changed";
        if (typeof h === "string") res.fp_now = h;
        if (h === undefined) pending.add(c); }
      tv[res.trace_vs_now]++;
      // reviewed trace (opt-in): usable ONLY if it hashes to the entry's own fingerprint; then diff vs the matched row
      const sn = x.claimed.trace_snap || { state: "absent" };
      if (sn.state !== "present") res.snap = sn.state;
      else { const h = digestOf ? digestOf(sn.canon) : undefined;
        res.snap = h === undefined ? "pending" : h === null ? "cannot_compute" : h === fp.digest ? "verified" : "mismatch";
        if (h === undefined) pending.add(sn.canon);
        if (res.snap === "verified" && (res.trace_vs_now === "same" || res.trace_vs_now === "changed")) res.diff = cachedDiff(sn.canon, traceProjection(r.row)); }
      sv[res.snap] = (sv[res.snap] || 0) + 1;
      return res;
    });
    return { entries_total: entries.length, now_counts: now, claimed_label_vs_now: cmp, trace_vs_now: tv, snapshot: sv, pending: [...pending], entries };
  }
  // READ-ONLY "open current case" for one outcome entry (1-based entry number). Re-resolves the entry against the
  // CURRENT rows at call time with the same exact typed id + metric rule (resolveItem): only a unique match opens.
  // Returns the row object (identity, for later staleness checks), its JSON signature, every stored field except
  // human_* labels (the trace), the current label/applicability for the entry's metric, and the file's claim kept
  // separate. Never mutates rows or parsed.
  function outcomeCase(rows, parsed, entryNo) {
    const x = parsed && Array.isArray(parsed.entries) ? parsed.entries.find(e => e.entry === entryNo) : null;
    if (!x) return { ok: false, reason: "this entry is not in the opened file" };
    const r = resolveItem(rows, x.status === "invalid" ? x : { id: x.id, metric: x.metric, before: x.before, after: x.after });
    if (r.status !== "matched" && r.status !== "drifted") return { ok: false, status: r.status, reason: r.reason || "cannot be matched to one current case" };
    const row = r.row, m = x.metric, v = row["human_" + m], ap = applicable(row, m);
    return { ok: true, entry: x.entry, id: x.id, metric: m, idx: r.idx, row, sig: JSON.stringify(row), status: r.status,
      trace: Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("human_"))),
      label_now: r.current, label_state: labelState(v), applicable: ap, na_reason: ap ? null : (NA_REASON[m] || "not applicable"),
      claimed: x.claimed, before: x.before, after: x.after };
  }
  // true only if the opened case is still the same row object, with identical content, uniquely holding that id
  function outcomeCaseFresh(rows, oc) {
    if (!oc || !oc.ok || !Array.isArray(rows)) return false;
    const at = rows.indexOf(oc.row); if (at < 0 || JSON.stringify(rows[at]) !== oc.sig) return false;
    return rows.filter(r => isObj(r) && JSON.stringify(r.id) === JSON.stringify(oc.id)).length === 1;
  }
  // ---- CHANGED-TRACES review projection (read-only, over one inspectOutcome result). Every entry lands in exactly one
  // bucket: field_comparable (fingerprint says CHANGED and the included reviewed trace verifies against that same
  // fingerprint, so field diffs are real) | hash_only (CHANGED, but no verified earlier content: which field changed
  // cannot be shown) | unchanged (fingerprint same) | unavailable (not checked, with reason). queue = every changed
  // entry (comparable + hash-only) in file order. ready=false while any digest is still pending (never half a scope).
  const CT_UNAV = { unavailable: "no fingerprint in file", unsupported: "unsupported fingerprint", malformed: "malformed fingerprint", not_checkable: "no single current case with that exact ID", cannot_compute: "cannot compute here", pending: "still computing" };
  const CT_SNAP = { absent: "the file does not include their reviewed trace", mismatch: "the included trace does not match its own fingerprint", unverifiable: "the included trace has no valid fingerprint", unsupported: "the included trace is unsupported", malformed: "the included trace is malformed", cannot_compute: "cannot check the included trace here", pending: "still checking the included trace" };
  function changedTraces(insp) {
    const counts = { entries_total: insp.entries.length, changed: 0, field_comparable: 0, hash_only: 0, unchanged: 0, unavailable: 0 }, unav = {};
    const entries = [], queue = [];
    let pending = insp.pending.length > 0;
    for (const x of insp.entries) {
      const t = x.trace_vs_now, b = { entry: x.entry, id: x.id, metric: x.metric, row: x.now.row, claimed: x.claimed, label_now: x.now.label,
        fp_then: x.claimed.trace_fp?.state === "present" ? x.claimed.trace_fp.digest : null, fp_now: x.fp_now ?? null };
      if (t === "pending" || x.snap === "pending") pending = true;
      if (t === "changed") {
        counts.changed++;
        if (x.snap === "verified" && Array.isArray(x.diff) && x.diff.length) { counts.field_comparable++; b.bucket = "field_comparable"; b.diff = x.diff; b.diff_capped = x.diff.length >= DIFF_MAX; }
        else { counts.hash_only++; b.bucket = "hash_only"; b.reason = x.snap === "verified" ? "the verified earlier trace shows no field difference" : CT_SNAP[x.snap] || String(x.snap); }
        queue.push(x.entry);
      } else if (t === "same") { counts.unchanged++; b.bucket = "unchanged"; }
      else { counts.unavailable++; b.bucket = "unavailable"; b.reason = CT_UNAV[t] || String(t); unav[b.reason] = (unav[b.reason] || 0) + 1; }
      entries.push(b);
    }
    return { ready: !pending, counts, unavailable_by_reason: unav, queue, entries };
  }
  // the downloadable report = exactly the frozen projection (all changed entries with every diff item; others summarised)
  // ---- REVIEWER DECISIONS on changed traces (user-authored, local). Keyed by the exact file entry number + typed id +
  // metric + the fingerprint in the file + the fingerprint recomputed now, never by dataset row position. Each file
  // entry is its own scope (a case repeated in the file gets one decision per entry). A key that no longer matches a
  // changed entry's bytes is never carried over. Default = unreviewed; only an explicit decide() records anything.
  const CT_DEC = ["accept_change", "needs_relabel"], CT_NOTE_MAX = 280;
  const ctDecisionKey = e => JSON.stringify([e.entry, e.id, e.metric, e.fp_then, e.fp_now]);
  function ctDecide(decs, e, decision, note, at) {
    if (!CT_DEC.includes(decision)) return { ok: false, reason: "decision must be accept_change or needs_relabel" };
    if (!(e && (e.bucket === "field_comparable" || e.bucket === "hash_only") && e.fp_then && e.fp_now)) return { ok: false, reason: "only a changed trace with both fingerprints can be decided" };
    const n = typeof note === "string" ? note.trim() : "";
    if (n.length > CT_NOTE_MAX) return { ok: false, reason: `note is longer than ${CT_NOTE_MAX} characters` };
    const k = ctDecisionKey(e), prev = decs.get(k) || null;
    decs.set(k, { decision, note: n || null, decided_at: at ?? null, revised: !!prev }); return { ok: true, key: k, prev };
  }
  function ctReviewState(ct, decs) {
    const keys = new Set(), c = { changed: ct.queue.length, accept_change: 0, needs_relabel: 0, unreviewed: 0 };
    const per = ct.entries.filter(e => e.bucket === "field_comparable" || e.bucket === "hash_only").map(e => {
      const k = ctDecisionKey(e); keys.add(k); const d = decs && decs.get(k);
      if (d) c[d.decision]++; else c.unreviewed++;
      return { entry: e.entry, key: k, decision: d || null };
    });
    const orphan = decs ? [...decs.keys()].filter(k => !keys.has(k)).length : 0;
    return { counts: c, remaining: c.unreviewed, orphan, per };
  }
  // carry decisions across a rebuild ONLY where the exact key (same entry, id, metric and both fingerprints) is still a changed entry
  function ctCarry(decs, ct) {
    const keys = new Set(ct.entries.filter(e => e.bucket === "field_comparable" || e.bucket === "hash_only").map(ctDecisionKey)), out = new Map();
    let dropped = 0; for (const [k, v] of decs || []) { if (keys.has(k)) out.set(k, v); else dropped++; }
    return { decs: out, kept: out.size, dropped };
  }
  function changedTracesReport(ct, meta = {}, decs = null) {
    const lab = v => v == null ? null : v;
    const chg = ct.entries.filter(e => e.bucket === "field_comparable" || e.bucket === "hash_only").map(e => {
      const o = { entry: e.entry, id: e.id, metric: e.metric, current_row: e.row == null ? null : e.row + 1, comparison: e.bucket === "field_comparable" ? "fields" : "hash_only",
        claimed_outcome: e.claimed.outcome, claimed_label: lab(e.claimed.outcome_label), claimed_at: e.claimed.outcome_at ?? null, label_now: lab(e.label_now) };
      if (e.bucket === "field_comparable") { o.fields_changed = e.diff.length; o.diff_capped = e.diff_capped;
        o.diff = e.diff.map(d => { const r = { path: d.path, kind: d.kind }; if (Object.hasOwn(d, "before")) r.before = d.before; if (Object.hasOwn(d, "after")) r.after = d.after; return r; }); }
      else o.reason = e.reason;
      o.fingerprint_at_their_action = e.fp_then ?? null; o.fingerprint_now = e.fp_now ?? null;
      const d = decs ? decs.get(ctDecisionKey(e)) : null;
      o.reviewer_decision = d ? { status: d.decision, note: d.note, decided_at: d.decided_at, revised: d.revised } : { status: "unreviewed", note: null, decided_at: null, revised: false };
      return o;
    });
    const rs = ctReviewState(ct, decs || new Map());
    return { kind: "jev-foundry-judge/changed-traces-comparison", version: 2, app_version: meta.version ?? null, generated_at: meta.at ?? null,
      frozen_at: meta.frozenAt ?? null, outcome_file: meta.file ?? null, dataset_rows: meta.datasetRows ?? null,
      contains: "CASE TEXT AND TOOL DATA: earlier (from the reviewer's included trace) and current field values for every changed trace listed. Created locally in this browser on explicit download; nothing uploaded; no keys, model scores or agreement.",
      scope: `Every entry of ONE opened checklist-outcome file, checked against THIS browser's dataset when the changed-traces view was built (frozen_at). changed = the ${FP_SCHEME} SHA-256 fingerprint in the file differs from the one recomputed from the unique current case with that exact typed ID. comparison "fields" = the file's included reviewed trace hashes to that same fingerprint, so diff shows each field (path, kind added/removed/changed, before = at their Save/Confirm, after = now; a missing before/after key means the field was absent; null is a value; JSON types kept; object key order ignored, array order kept; labels excluded). "hash_only" = changed, but no verified earlier content, so which field changed cannot be shown. A fingerprint is unsigned content evidence, not reviewer identity or proof any label is right. diff_capped=true means the per-entry comparison stopped at ${DIFF_MAX} fields.`,
      reviewer_decisions: { counts: rs.counts, remaining_unreviewed: rs.remaining,
        meaning: "Decisions typed by the person using this browser for each changed entry: accept_change = they accept the trace change as-is; needs_relabel = the case needs a new human label. unreviewed = no decision recorded (opening, Next or Skip never decide). Not a model verdict, not verified identity, not approval to deploy, and no label was changed. Each decision is bound to that file entry, typed id, metric and both fingerprints listed on the entry; if the trace bytes change the decision does not apply." },
      counts: ct.counts, unavailable_by_reason: ct.unavailable_by_reason, changed_entries: chg,
      other_entries: ct.entries.filter(e => e.bucket === "unchanged" || e.bucket === "unavailable").map(e => ({ entry: e.entry, id: e.id, metric: e.metric, trace: e.bucket, reason: e.reason ?? null })) };
  }
  // ---- RE-LABEL HANDOFF: open a downloaded changed-traces-comparison v2 (with reviewer decisions) READ-ONLY in another
  // browser, re-check every entry against THIS dataset, and derive label-pass targets for the valid "needs_relabel"
  // entries only. The file is untrusted claimed evidence: its decision/note are shown as claims, never applied, and
  // never select a case except by a unique exact typed id + metric re-match whose trace still hashes to the reviewed
  // current fingerprint. Accept/unreviewed entries never become targets; nothing here writes labels or scores.
  const CKIND = "jev-foundry-judge/changed-traces-comparison", HO_DEC = ["accept_change", "needs_relabel", "unreviewed"];
  const HEX64 = v => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
  function parseComparisonFile(text) {
    if (typeof text !== "string") return { ok: false, error: "not a text file" };
    if (text.length > MAX_OUTCOME_BYTES) return { ok: false, error: `file is too large (over ${MAX_OUTCOME_BYTES / 1e6} MB)` };
    let p; try { p = JSON.parse(text); } catch { return { ok: false, error: "not a JSON file" }; }
    if (!isObj(p)) return { ok: false, error: "not a changed-traces comparison object" };
    if (p.kind !== CKIND) return { ok: false, error: `wrong kind (expected "${CKIND}")` };
    if (p.version === 1) return { ok: false, error: "this is a version 1 comparison, made before reviewer decisions existed, so it has no needs-re-label decisions to act on (re-download it as comparison + decisions)" };
    if (p.version !== 2) return { ok: false, error: `unsupported version ${JSON.stringify(p.version)} (expected 2)` };
    if (!Array.isArray(p.changed_entries)) return { ok: false, error: "changed_entries is not a list" };
    if (!p.changed_entries.length) return { ok: false, error: "the file lists no changed entries" };
    if (p.changed_entries.length > MAX_OUTCOME_ENTRIES) return { ok: false, error: `too many entries (over ${MAX_OUTCOME_ENTRIES})` };
    const c = p.counts, rd = p.reviewer_decisions;
    if (!isObj(c) || !["changed", "field_comparable", "hash_only"].every(k => Number.isInteger(c[k]) && c[k] >= 0)) return { ok: false, error: "counts are missing or malformed" };
    if (!isObj(rd) || !countOk(rd.counts, ["changed", ...HO_DEC])) return { ok: false, error: "reviewer_decisions.counts are missing or malformed" };
    if (c.changed !== p.changed_entries.length) return { ok: false, error: `counts.changed says ${c.changed} but ${p.changed_entries.length} changed entries are listed` };
    if (rd.counts.changed !== p.changed_entries.length) return { ok: false, error: `reviewer_decisions.counts.changed says ${rd.counts.changed} but ${p.changed_entries.length} changed entries are listed` };
    const dc = Object.fromEntries(HO_DEC.map(k => [k, 0])), cc = { fields: 0, hash_only: 0 };
    for (const [i, e] of p.changed_entries.entries()) {
      if (!isObj(e)) return { ok: false, error: `changed entry ${i + 1} is not an object` };
      const s = isObj(e.reviewer_decision) ? e.reviewer_decision.status : undefined;
      if (!HO_DEC.includes(s)) return { ok: false, error: `changed entry ${i + 1} has unknown reviewer_decision.status ${JSON.stringify(s ?? null)}` };
      if (e.comparison !== "fields" && e.comparison !== "hash_only") return { ok: false, error: `changed entry ${i + 1} has unknown comparison ${JSON.stringify(e.comparison ?? null)}` };
      dc[s]++; cc[e.comparison]++;
    }
    for (const k of HO_DEC) if (dc[k] !== rd.counts[k]) return { ok: false, error: `reviewer_decisions.counts.${k} says ${rd.counts[k]} but ${dc[k]} entries have it` };
    if (cc.fields !== c.field_comparable || cc.hash_only !== c.hash_only) return { ok: false, error: "counts.field_comparable/hash_only do not match the entries" };
    const seenEntry = new Map();
    const entries = p.changed_entries.map((e, i) => {
      const d = e.reviewer_decision, x = { pos: i + 1, entry: e.entry ?? null, id: e.id ?? null, metric: e.metric ?? null, comparison: e.comparison,
        fp_then: e.fingerprint_at_their_action ?? null, fp_now: e.fingerprint_now ?? null,
        claimed: { decision: d.status, note: typeof d.note === "string" ? d.note : null, decided_at: typeof d.decided_at === "string" ? d.decided_at : null, revised: d.revised === true },
        diff: Array.isArray(e.diff) ? e.diff : null, diff_capped: e.diff_capped === true };
      let bad = null;
      if (!Number.isInteger(e.entry) || e.entry < 1) bad = `no usable entry number (${JSON.stringify(e.entry ?? null)})`;
      else if (!idOk(e.id)) bad = `no usable id (${JSON.stringify(e.id ?? null)}); cannot be matched`;
      else if (!METRICS.includes(e.metric)) bad = `unknown metric ${JSON.stringify(e.metric ?? null)}`;
      else if (!HEX64(x.fp_then) || !HEX64(x.fp_now)) bad = "fingerprint_at_their_action / fingerprint_now must be 64 lowercase hex characters";
      else if (x.fp_then === x.fp_now) bad = "both fingerprints are equal, so this is not a changed trace";
      else if (d.note != null && (typeof d.note !== "string" || d.note.length > CT_NOTE_MAX)) bad = `note must be text of at most ${CT_NOTE_MAX} characters`;
      else if (d.status === "unreviewed" && d.note != null) bad = "an unreviewed entry cannot carry a note";
      else if (e.comparison === "fields" && (!x.diff || !x.diff.length || !x.diff.every(q => isObj(q) && typeof q.path === "string" && ["added", "removed", "changed"].includes(q.kind)))) bad = "a fields comparison needs a non-empty diff of {path, kind}";
      if (!bad && seenEntry.has(e.entry)) { const f = seenEntry.get(e.entry); if (f.status !== "invalid") { f.status = "invalid"; f.reason = "the file lists this entry number more than once"; } bad = "the file lists this entry number more than once"; }
      if (!bad) seenEntry.set(e.entry, x);
      if (bad) { x.status = "invalid"; x.reason = bad; }
      return x;
    });
    return { ok: true, meta: { app_version: p.app_version ?? null, generated_at: p.generated_at ?? null, frozen_at: p.frozen_at ?? null, outcome_file: typeof p.outcome_file === "string" ? p.outcome_file : null, dataset_rows: Number.isInteger(p.dataset_rows) ? p.dataset_rows : null },
      claimed_counts: dc, entries };
  }
  // Parse a diff path produced by traceDiff ("a.b[0][\"x y\"]") back into segments. null if it cannot be read exactly.
  function parsePath(s) {
    if (s === "(whole trace)") return [];
    const out = []; let i = 0;
    const id = /^[A-Za-z_$][\w$]*/;
    const m0 = s.match(id), m0q = s[0] === '"';
    if (m0) { out.push(m0[0]); i = m0[0].length; }
    else if (m0q) { let j = 1; while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1; try { out.push(JSON.parse(s.slice(0, j + 1))); } catch { return null; } i = j + 1; }
    else if (s[0] !== "[") return null;
    while (i < s.length) {
      if (s[i] === ".") { const m = s.slice(i + 1).match(id); if (!m) return null; out.push(m[0]); i += 1 + m[0].length; continue; }
      if (s[i] !== "[") return null;
      if (s[i + 1] === '"') { let j = i + 2; while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1; if (s[j + 1] !== "]") return null; try { out.push(JSON.parse(s.slice(i + 1, j + 1))); } catch { return null; } i = j + 2; continue; }
      const m = s.slice(i).match(/^\[(\d+)\]/); if (!m) return null; out.push(+m[1]); i += m[0].length;
    }
    return out;
  }
  // Rebuild the EARLIER trace by undoing a diff on the current trace (only possible for an uncapped fields diff).
  // Returns a canonical string, or null with no guess if any path cannot be applied exactly.
  function undoDiff(curCanon, diff) {
    let t; try { t = JSON.parse(curCanon); } catch { return null; }   // JSON.parse makes "__proto__" an own key
    const ops = diff.map(d => ({ d, p: parsePath(d.path) }));
    if (ops.some(o => o.p === null)) return null;
    // array element removals/additions shift indices: apply deepest/highest index first
    // (added: pop highest index first; removed: push lowest index first; deeper paths before shallower)
    const rk = o => o.d.kind === "added" ? 0 : o.d.kind === "changed" ? 1 : 2;
    ops.sort((a, b) => { const la = a.p.length, lb = b.p.length; if (la !== lb) return lb - la; if (rk(a) !== rk(b)) return rk(a) - rk(b);
      const x = a.p[la - 1], y = b.p[lb - 1]; if (typeof x !== "number" || typeof y !== "number") return 0; return a.d.kind === "added" ? y - x : x - y; });
    for (const { d, p } of ops) {
      if (!p.length) { if (d.kind !== "changed" || !Object.hasOwn(d, "before")) return null; t = d.before; continue; }
      let o = t; for (const k of p.slice(0, -1)) { if (o == null || typeof o !== "object" || !Object.hasOwn(o, k)) return null; o = o[k]; }
      const k = p[p.length - 1]; if (o == null || typeof o !== "object") return null;
      const put = (obj, key, v) => Object.defineProperty(obj, key, { value: v, enumerable: true, writable: true, configurable: true });   // own key even for "__proto__"
      if (d.kind === "changed") { if (!Object.hasOwn(d, "before") || !Object.hasOwn(o, k)) return null; put(o, k, d.before); }
      else if (d.kind === "added") { if (!Object.hasOwn(o, k)) return null; if (Array.isArray(o)) { if (k !== o.length - 1) return null; o.pop(); } else delete o[k]; }
      else if (d.kind === "removed") { if (!Object.hasOwn(d, "before")) return null; if (Array.isArray(o)) { if (k !== o.length) return null; o.push(d.before); } else { if (Object.hasOwn(o, k)) return null; put(o, k, d.before); } }
      else return null;
    }
    try { return canon(t); } catch { return null; }
  }
  // Check every parsed entry against the CURRENT rows. digestOf(canonical) -> hex | null | undefined (pending).
  // status: invalid | missing | ambiguous | changed_since (current trace != the reviewed current fingerprint) |
  //   current (unique exact match whose trace hashes to fingerprint_now) | pending
  // earlier: verified (undoing the file's diff on the current trace reproduces fingerprint_at_their_action) |
  //   mismatch (it does not: file internally inconsistent, not eligible) | not_verifiable (hash-only / capped / not
  //   reconstructible; the earlier trace is NOT independently verified) | not_checked (entry not current)
  // eligible = claimed needs_relabel AND current AND earlier != mismatch AND the metric applies to that case.
  function checkHandoff(rows, parsed, digestOf) {
    rows = Array.isArray(rows) ? rows : [];
    const st = { current: 0, changed_since: 0, missing: 0, ambiguous: 0, invalid: 0, pending: 0 }, ea = { verified: 0, mismatch: 0, not_verifiable: 0, not_checked: 0 };
    let pending = false;
    const entries = parsed.entries.map(x => {
      const r = { pos: x.pos, entry: x.entry, id: x.id, metric: x.metric, comparison: x.comparison, claimed: x.claimed, fp_then: x.fp_then, fp_now_file: x.fp_now, eligible: false };
      if (x.status === "invalid") { r.status = "invalid"; r.reason = x.reason; r.earlier = "not_checked"; }
      else {
        const res = resolveItem(rows, { id: x.id, metric: x.metric, before: { present: false }, after: { present: false } });
        if (res.status === "missing" || res.status === "ambiguous") { r.status = res.status; r.reason = res.reason; r.earlier = "not_checked"; }
        else {
          r.idx = res.idx; r.row = res.row; r.label_now = res.current; r.applicable = applicable(res.row, x.metric);
          let pc = null; try { pc = traceProjection(res.row); } catch { }
          const h = pc == null ? null : digestOf ? digestOf(pc) : undefined;
          if (h === undefined) { r.status = "pending"; pending = true; r.earlier = "not_checked"; }
          else if (h === null) { r.status = "changed_since"; r.reason = "the current trace cannot be fingerprinted here"; r.earlier = "not_checked"; }
          else { r.fp_current = h;
            if (h !== x.fp_now) { r.status = "changed_since"; r.reason = "this case's trace changed after the comparison was made (it no longer hashes to the reviewed current fingerprint)"; r.earlier = "not_checked"; }
            else { r.status = "current";
              if (x.comparison !== "fields") { r.earlier = "not_verifiable"; r.earlier_reason = "hash-only in the file: no earlier content to check"; }
              else if (x.diff_capped) { r.earlier = "not_verifiable"; r.earlier_reason = `the file's diff was capped at ${DIFF_MAX} fields`; }
              else { const e0 = undoDiff(pc, x.diff);
                if (e0 == null) { r.earlier = "mismatch"; r.earlier_reason = "the file's diff does not apply to the current trace"; }
                else { const he = digestOf ? digestOf(e0) : undefined;
                  if (he === undefined) { r.earlier = "not_checked"; r.status = "pending"; pending = true; }
                  else if (he === null) { r.earlier = "not_verifiable"; r.earlier_reason = "cannot fingerprint here"; }
                  else if (he === x.fp_then) r.earlier = "verified";
                  else { r.earlier = "mismatch"; r.earlier_reason = "undoing the file's diff does not reproduce its earlier fingerprint"; } } } } } }
      }
      st[r.status]++; ea[r.earlier]++;
      if (r.status === "current" && r.claimed.decision === "needs_relabel") {
        if (r.earlier === "mismatch") r.why_not = "the file is internally inconsistent for this entry (" + r.earlier_reason + ")";
        else if (!r.applicable) r.why_not = `${x.metric} does not apply to this case (${NA_REASON[x.metric] || "not applicable"})`;
        else r.eligible = true;
      } else if (r.claimed.decision === "needs_relabel") r.why_not = r.status === "pending" ? "still checking" : `entry is ${r.status}${r.reason ? ": " + r.reason : ""}`;
      return r;
    });
    // targets: dedupe eligible entries by exact typed id + metric (a case repeated in the file is labelled once)
    const tmap = new Map();
    for (const r of entries) if (r.eligible) {
      const k = JSON.stringify([r.id, r.metric]);
      if (!tmap.has(k)) tmap.set(k, { key: k, id: r.id, metric: r.metric, idx: r.idx, row: r.row, proj: traceProjection(r.row), fp: r.fp_current, entries: [], notes: [] });
      const t = tmap.get(k); t.entries.push(r.entry); if (r.claimed.note) t.notes.push({ entry: r.entry, note: r.claimed.note });
    }
    const targets = [...tmap.values()];
    return { ready: !pending, status_counts: st, earlier_counts: ea, entries,
      eligible_entries: entries.filter(r => r.eligible).length, targets, target_cases: new Set(targets.map(t => JSON.stringify(t.id))).size };
  }
  // a label-pass target is only saveable while it is still the same row object, uniquely holding its id, with the
  // same trace (labels may change). Never re-targets another row.
  function handoffTargetFresh(rows, t) {
    if (!t || !Array.isArray(rows)) return false;
    const at = rows.indexOf(t.row); if (at < 0) return false;
    let pc = null; try { pc = traceProjection(t.row); } catch { return false; }
    if (pc !== t.proj) return false;
    return rows.filter(r => isObj(r) && JSON.stringify(r.id) === JSON.stringify(t.id)).length === 1;
  }
  // ---- RE-LABEL HANDOFF OUTCOME export (local-only). One record per deduped target (exact typed id + metric).
  // action comes ONLY from explicit UI actions: "saved" (typed Save in the handoff-scoped label dialog; label_changed
  // says whether it changed the label, an unchanged Save is still recorded honestly) | "skipped" | "not_reached".
  // Opening, Next/Previous, import, Re-check or the current label already matching are never an action.
  // acts: Map(targetKey -> {before, after, changed, saves, at, row}).
  // evidence (saved only) = current (same row object, unique id, trace = reviewed fingerprint, label = saved value)
  // | stale (with the reason). checked_now is recomputed at download and kept separate from the historical action.
  const HO_OKIND = "jev-foundry-judge/relabel-handoff-outcome";
  function handoffOutcome(rows, ho, meta = {}) {
    rows = Array.isArray(rows) ? rows : [];
    const c = ho.chk, acts = ho.acts || new Map(), sk = ho.skipped || new Set();
    const lab = (r, m) => Object.hasOwn(r, "human_" + m) ? { present: true, value: r["human_" + m] } : { present: false };
    const same = (a, b) => a.present === b.present && (!a.present || JSON.stringify(a.value) === JSON.stringify(b.value));
    const oc = { saved_changed: 0, saved_unchanged: 0, skipped: 0, not_reached: 0 }, ev = { current: 0, stale: 0 }, cn = { current: 0, trace_changed: 0, missing: 0, ambiguous: 0 };
    const targets = c.targets.map((t, i) => {
      const hits = rows.filter(r => isObj(r) && JSON.stringify(r.id) === JSON.stringify(t.id));
      const inRows = rows.includes(t.row);
      let pc = null; if (inRows) { try { pc = traceProjection(t.row); } catch { } }
      const now = !inRows ? (hits.length > 1 ? "ambiguous" : "missing") : hits.length !== 1 ? "ambiguous" : pc !== t.proj ? "trace_changed" : "current";
      cn[now]++;
      const a = acts.get(t.key), o = { target: i + 1, id: t.id, metric: t.metric, source_entries: [...t.entries], reviewed_fingerprint: { scheme: FP_SCHEME, alg: FP_ALG, digest: t.fp } };
      if (a) {
        o.action = "saved"; o.label_changed = !!a.changed; o.label_before = a.before; o.label_after = a.after; o.saves = a.saves; o.action_at = a.at; o.skipped_before = !!a.skippedBefore;
        o.trace_at_action = "matched reviewed_fingerprint (Save is refused otherwise)";
        const why = now === "missing" ? "the case was removed or replaced after this Save" : now === "ambiguous" ? "the case id is no longer unique" : now === "trace_changed" ? "the case's trace changed after this Save"
          : !same(lab(t.row, t.metric), a.after) ? "the label changed after this Save (a later edit or Undo)" : null;   // other metrics' labels on the same case may change
        o.evidence = why ? "stale" : "current"; o.evidence_note = why; ev[o.evidence]++; oc[a.changed ? "saved_changed" : "saved_unchanged"]++;
      } else {
        o.action = sk.has(t.key) ? "skipped" : "not_reached"; o.label_changed = null; o.label_before = null; o.label_after = null; o.saves = 0; o.action_at = null; o.skipped_before = false;
        o.trace_at_action = null; o.evidence = null; o.evidence_note = null; oc[o.action]++;
      }
      o.checked_now = now; o.label_now = now === "missing" ? null : inRows ? lab(t.row, t.metric) : null;
      return o;
    });
    const notElig = c.entries.filter(r => !r.eligible).map(r => ({ entry: r.entry, id: r.status === "invalid" ? null : r.id, metric: r.status === "invalid" ? null : r.metric, claimed_decision: r.claimed.decision, status_at_check: r.status, why_not_target: r.status === "invalid" ? "invalid entry in the file (details shown in the app, not exported)" : r.why_not || (r.claimed.decision === "needs_relabel" ? "not eligible" : `claimed ${r.claimed.decision}`) }));
    const m = ho.meta || {};
    return { kind: HO_OKIND, version: 1, app_version: meta.version ?? null, generated_at: meta.at ?? null,
      comparison_file: { name: ho.name ?? null, app_version: m.app_version ?? null, generated_at: m.generated_at ?? null, outcome_file: m.outcome_file ?? null, dataset_rows: m.dataset_rows ?? null },
      checked_at: ho.at ?? null, dataset_changed_since_check: !!meta.datasetChanged,
      scope: "Outcome of ONE re-label handoff pass in THIS browser tab, for the first reviewer. One target per exact typed case id + metric (repeated needs-re-label entries merged; source_entries lists them). action = saved (typed Save in the handoff label dialog; label_changed=false means an explicit Save that kept the label) | skipped (explicit Skip) | not_reached (no Save/Skip). Opening, Next/Previous, import, Re-check and a label that already matched are never an action. label_before/label_after are the label right before and after this pass's Saves. evidence (saved only) = current | stale with a reason; checked_now/label_now are recomputed at download and separate from the recorded action. reviewed_fingerprint = the jfj-trace-v1 fingerprint the other reviewer looked at; Save was only allowed while the case still hashed to it. Unsigned, no reviewer identity. No traces, notes, keys, model scores or agreement; nothing was applied or uploaded.",
      value_format: "labels = {present:true,value:<stored label>} or {present:false} (no label); null = not recorded / not resolvable",
      dataset_rows: rows.length,
      counts: { entries_in_file: c.entries.length, eligible_entries: c.eligible_entries, not_eligible_entries: notElig.length, targets: targets.length, target_cases: c.target_cases, duplicate_entries_merged: c.eligible_entries - targets.length, outcomes_dropped_at_recheck: ho.dropped || 0 },
      outcome_counts: oc, evidence_counts: ev, checked_now_counts: cn, targets, not_eligible_entries: notElig };
  }
  // Re-check: carry an action only onto a new target with the SAME key, row object and trace; everything else is dropped.
  function handoffCarry(oldChk, acts, skipped, newChk) {
    const na = new Map(), ns = new Set(); let dropped = 0;
    const byKey = new Map((newChk?.targets || []).map(t => [t.key, t]));
    const old = new Map((oldChk?.targets || []).map(t => [t.key, t]));
    for (const k of new Set([...(acts?.keys() || []), ...(skipped || [])])) {
      const o = old.get(k), n = byKey.get(k), ok = o && n && o.row === n.row && o.proj === n.proj && o.fp === n.fp;
      if (!ok) { dropped++; continue; }
      if (acts.has(k)) na.set(k, acts.get(k)); else ns.add(k);
    }
    return { acts: na, skipped: ns, dropped };
  }
  // ---- READ-ONLY inspection of a downloaded re-label HANDOFF OUTCOME file (the first reviewer's view).
  // Untrusted, unsigned claims. parseHandoffOutcomeFile validates kind/version/shape and that every declared count
  // equals the targets/entries actually listed (whole-file problem -> {ok:false}; caller keeps prior state). A target
  // with a bad shape, or a typed id+metric listed twice, becomes "invalid" with a reason (never matched).
  const clip = (v, n = 500) => typeof v !== "string" ? null : v.length > n ? v.slice(0, n) + "… (cut)" : v;
  const HO_ACT = ["saved", "skipped", "not_reached"], HO_CN = ["current", "trace_changed", "missing", "ambiguous"];
  function parseHandoffOutcomeFile(text) {
    if (typeof text !== "string") return { ok: false, error: "not a text file" };
    if (text.length > MAX_OUTCOME_BYTES) return { ok: false, error: `file is too large (over ${MAX_OUTCOME_BYTES / 1e6} MB)` };
    let p; try { p = JSON.parse(text); } catch { return { ok: false, error: "not a JSON file" }; }
    if (!isObj(p)) return { ok: false, error: "not a handoff-outcome object" };
    if (p.kind !== HO_OKIND) return { ok: false, error: `wrong kind (expected "${HO_OKIND}")` };
    if (p.version !== 1) return { ok: false, error: `unsupported version ${JSON.stringify(p.version)} (expected 1)` };
    if (!Array.isArray(p.targets) || !p.targets.length) return { ok: false, error: "targets is missing or empty" };
    if (p.targets.length > MAX_OUTCOME_ENTRIES) return { ok: false, error: `too many targets (over ${MAX_OUTCOME_ENTRIES})` };
    if (!Array.isArray(p.not_eligible_entries)) return { ok: false, error: "not_eligible_entries is not a list" };
    const c = p.counts, CK = ["entries_in_file", "eligible_entries", "not_eligible_entries", "targets", "target_cases", "duplicate_entries_merged", "outcomes_dropped_at_recheck"];
    if (!countOk(c, CK)) return { ok: false, error: "counts are missing or malformed" };
    if (!countOk(p.outcome_counts, ["saved_changed", "saved_unchanged", "skipped", "not_reached"]) || !countOk(p.evidence_counts, ["current", "stale"]) || !countOk(p.checked_now_counts, HO_CN))
      return { ok: false, error: "outcome_counts/evidence_counts/checked_now_counts are missing or malformed" };
    if (c.targets !== p.targets.length) return { ok: false, error: `counts.targets says ${c.targets} but ${p.targets.length} targets are listed` };
    if (c.not_eligible_entries !== p.not_eligible_entries.length) return { ok: false, error: `counts.not_eligible_entries says ${c.not_eligible_entries} but ${p.not_eligible_entries.length} are listed` };
    if (c.entries_in_file !== c.eligible_entries + c.not_eligible_entries) return { ok: false, error: "counts.entries_in_file is not eligible + not eligible" };
    if (c.duplicate_entries_merged !== c.eligible_entries - c.targets) return { ok: false, error: "counts.duplicate_entries_merged is not eligible entries − targets" };
    const oc = { saved_changed: 0, saved_unchanged: 0, skipped: 0, not_reached: 0 }, ev = { current: 0, stale: 0 }, cn = Object.fromEntries(HO_CN.map(k => [k, 0]));
    let srcN = 0; const srcSeen = new Set();
    for (const [i, t] of p.targets.entries()) {
      if (!isObj(t)) return { ok: false, error: `target ${i + 1} is not an object` };
      if (!HO_ACT.includes(t.action)) return { ok: false, error: `target ${i + 1} has unknown action ${JSON.stringify(t.action ?? null)}` };
      if (!HO_CN.includes(t.checked_now)) return { ok: false, error: `target ${i + 1} has unknown checked_now ${JSON.stringify(t.checked_now ?? null)}` };
      if (t.action === "saved") { if (typeof t.label_changed !== "boolean") return { ok: false, error: `saved target ${i + 1} has no boolean label_changed` };
        oc[t.label_changed ? "saved_changed" : "saved_unchanged"]++;
        if (t.evidence !== "current" && t.evidence !== "stale") return { ok: false, error: `saved target ${i + 1} has unknown evidence ${JSON.stringify(t.evidence ?? null)}` };
        ev[t.evidence]++; }
      else oc[t.action]++;
      cn[t.checked_now]++;
      if (Array.isArray(t.source_entries)) for (const n of t.source_entries) {
        srcN++; if (!Number.isInteger(n) || n < 1 || n > c.entries_in_file) return { ok: false, error: `target ${i + 1} lists source entry ${JSON.stringify(n)} outside 1…${c.entries_in_file}` };
        if (srcSeen.has(n)) return { ok: false, error: `source entry ${n} is listed more than once across the targets` }; srcSeen.add(n); }
    }
    for (const [k, v] of Object.entries(oc)) if (v !== p.outcome_counts[k]) return { ok: false, error: `outcome_counts.${k} says ${p.outcome_counts[k]} but ${v} targets have it` };
    for (const [k, v] of Object.entries(ev)) if (v !== p.evidence_counts[k]) return { ok: false, error: `evidence_counts.${k} says ${p.evidence_counts[k]} but ${v} saved targets have it` };
    for (const [k, v] of Object.entries(cn)) if (v !== p.checked_now_counts[k]) return { ok: false, error: `checked_now_counts.${k} says ${p.checked_now_counts[k]} but ${v} targets have it` };
    if (srcN !== c.eligible_entries) return { ok: false, error: `the targets list ${srcN} source entries but counts.eligible_entries says ${c.eligible_entries}` };
    const seen = new Map();
    const targets = p.targets.map((t, i) => {
      const sv = t.action === "saved";
      const x = { pos: i + 1, target: t.target ?? null, id: t.id ?? null, metric: t.metric ?? null, source_entries: Array.isArray(t.source_entries) ? t.source_entries.filter(n => Number.isInteger(n)) : [],
        fp: isObj(t.reviewed_fingerprint) ? t.reviewed_fingerprint.digest ?? null : null,
        claimed: { action: t.action, label_changed: sv ? t.label_changed : null, label_before: sv && lblOk(t.label_before) ? t.label_before : null, label_after: sv && lblOk(t.label_after) ? t.label_after : null,
          saves: Number.isInteger(t.saves) ? t.saves : null, action_at: clip(t.action_at, 64), skipped_before: t.skipped_before === true,
          evidence: sv ? t.evidence : null, evidence_note: clip(t.evidence_note),
          checked_now_at_export: t.checked_now, label_now_at_export: lblOk(t.label_now) ? t.label_now : null } };
      let bad = null;
      if (!idOk(t.id)) bad = `no usable id (${JSON.stringify(t.id ?? null)}); cannot be matched`;
      else if (!METRICS.includes(t.metric)) bad = `unknown metric ${JSON.stringify(t.metric ?? null)}`;
      else if (!isObj(t.reviewed_fingerprint) || t.reviewed_fingerprint.scheme !== FP_SCHEME || t.reviewed_fingerprint.alg !== FP_ALG) bad = `reviewed_fingerprint is not ${FP_SCHEME} / ${FP_ALG}`;
      else if (!HEX64(x.fp)) bad = "reviewed_fingerprint.digest is not 64 lowercase hex characters";
      else if (!Array.isArray(t.source_entries) || !t.source_entries.length || x.source_entries.length !== t.source_entries.length) bad = "source_entries must be a non-empty list of entry numbers";
      else if (sv && (!lblOk(t.label_before) || !lblOk(t.label_after))) bad = "a saved target needs label_before/label_after {present:true,value} or {present:false}";
      else if (sv && t.label_changed !== !sameLbl(t.label_before, t.label_after)) bad = `label_changed=${t.label_changed} contradicts label_before → label_after`;
      else if (!sv && (t.label_before != null || t.label_after != null || t.evidence != null)) bad = `a ${t.action} target cannot carry labels or evidence`;
      else if (t.label_now != null && !lblOk(t.label_now)) bad = "label_now must be null or {present:true,value} or {present:false}";
      if (!bad) { const k = JSON.stringify([t.id, t.metric]);
        if (seen.has(k)) { const f = seen.get(k); if (f.status !== "invalid") { f.status = "invalid"; f.reason = "the file lists this case·metric target more than once"; } bad = "the file lists this case·metric target more than once"; }
        else seen.set(k, x); }
      if (bad) { x.status = "invalid"; x.reason = bad; }
      return x;
    });
    const cases = new Set(p.targets.filter(t => idOk(t.id)).map(t => JSON.stringify(t.id))).size;
    if (cases !== c.target_cases) return { ok: false, error: `counts.target_cases says ${c.target_cases} but the targets name ${cases} cases` };
    const cf = isObj(p.comparison_file) ? p.comparison_file : {};
    return { ok: true, meta: { app_version: p.app_version ?? null, generated_at: p.generated_at ?? null, checked_at: p.checked_at ?? null, dataset_rows: Number.isInteger(p.dataset_rows) ? p.dataset_rows : null,
      dataset_changed_since_check: p.dataset_changed_since_check === true, comparison_file: clip(cf.name, 200) },
      counts: { ...c }, claimed_counts: { outcome: oc, evidence: ev, checked_now: cn }, not_eligible: p.not_eligible_entries.length, targets };
  }
  // Check every parsed target against the CURRENT rows: exact typed id (resolveItem; ambiguous/missing refused, never
  // another row), label now for that metric, and the current trace re-fingerprinted vs the file's reviewed_fingerprint.
  // digestOf(canonical) -> hex | null | undefined (pending). Never mutates rows. "landed" is only a consistency reading:
  // saved + label now == the file's label_after + trace same; it is NOT proof a Save happened (unsigned file).
  function inspectHandoffOutcome(rows, parsed, digestOf) {
    rows = Array.isArray(rows) ? rows : [];
    const now = { matched: 0, missing: 0, ambiguous: 0, invalid: 0 }, tr = { same: 0, changed: 0, not_checkable: 0, pending: 0, cannot_compute: 0 };
    const lv = { same: 0, different: 0, not_checkable: 0, no_claim: 0 }, rd = { consistent: 0, consistent_stale: 0, label_differs: 0, trace_changed: 0, not_checkable: 0, pending: 0 };
    let pending = false;
    const targets = parsed.targets.map(x => {
      const r = { pos: x.pos, id: x.id, metric: x.metric, source_entries: x.source_entries, fp: x.fp, claimed: x.claimed, status: x.status, reason: x.reason ?? null };
      if (x.status !== "invalid") {
        const res = resolveItem(rows, { id: x.id, metric: x.metric, before: { present: false }, after: { present: false } });
        if (res.status === "missing" || res.status === "ambiguous") { r.status = res.status; r.reason = res.reason; }
        else { r.status = "matched"; r.idx = res.idx; r.row = res.row; r.label_now = res.current; r.applicable = applicable(res.row, x.metric); }
      }
      now[r.status]++;
      if (r.status !== "matched") r.trace = "not_checkable";
      else { let pc = null; try { pc = traceProjection(r.row); } catch { }
        const h = pc == null ? null : digestOf ? digestOf(pc) : undefined;
        r.trace = h === undefined ? "pending" : h === null ? "cannot_compute" : h === x.fp ? "same" : "changed";
        if (typeof h === "string") r.fp_now = h;
        if (h === undefined) pending = true; }
      tr[r.trace]++;
      const cl = x.claimed.action === "saved" ? x.claimed.label_after : null;
      r.label_vs_claim = cl == null ? "no_claim" : r.label_now == null ? "not_checkable" : sameLbl(cl, r.label_now) ? "same" : "different";
      lv[r.label_vs_claim]++;
      if (x.claimed.action === "saved") {
        r.reading = r.status !== "matched" ? "not_checkable" : r.trace === "pending" ? "pending" : r.trace !== "same" ? (r.trace === "changed" ? "trace_changed" : "not_checkable") : r.label_vs_claim === "same" ? (x.claimed.evidence === "stale" ? "consistent_stale" : "consistent") : "label_differs";
        rd[r.reading]++;
      } else r.reading = null;
      return r;
    });
    const saved = parsed.targets.filter(x => x.claimed.action === "saved").length;
    return { ready: !pending, targets_total: targets.length, saved_claims: saved, now_counts: now, trace_counts: tr, label_vs_claim: lv, saved_reading: rd, targets };
  }
  // read-only "open current case" for one handoff-outcome target (1-based pos), re-resolved at call time.
  function handoffOutcomeCase(rows, parsed, pos) {
    const x = parsed && Array.isArray(parsed.targets) ? parsed.targets.find(t => t.pos === pos) : null;
    if (!x) return { ok: false, reason: "this target is not in the opened file" };
    if (x.status === "invalid") return { ok: false, status: "invalid", reason: x.reason };
    const r = resolveItem(rows, { id: x.id, metric: x.metric, before: { present: false }, after: { present: false } });
    if (r.status !== "matched" && r.status !== "drifted") return { ok: false, status: r.status, reason: r.reason };
    const row = r.row, m = x.metric, ap = applicable(row, m);
    return { ok: true, pos, id: x.id, metric: m, idx: r.idx, row, sig: JSON.stringify(row), fp: x.fp, claimed: x.claimed, source_entries: x.source_entries,
      trace: Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("human_"))), label_now: r.current, label_state: labelState(row["human_" + m]),
      applicable: ap, na_reason: ap ? null : (NA_REASON[m] || "not applicable") };
  }
  // t_8a886e42: the exact "label differs now" targets of an inspectHandoffOutcome() result, in file target order, plus
  // the rest counted by their EXISTING reading (no new matching or interpretation). Only a ready result has a list.
  function handoffDiffTargets(ins) {
    if (!ins || !ins.ready) return { ready: false, list: [], excluded: {} };
    const ex = { consistent: 0, consistent_stale: 0, trace_changed: 0, not_checkable: 0, no_save_claim: 0 }, list = [];
    for (const x of ins.targets) {
      if (x.reading === "label_differs" && x.status === "matched") list.push({ pos: x.pos, id: x.id, metric: x.metric, idx: x.idx, row: x.row, claimed_after: x.claimed.label_after, label_now: x.label_now, applicable: x.applicable });
      else if (x.reading == null) ex.no_save_claim++; else ex[x.reading === "pending" ? "not_checkable" : x.reading]++;
    }
    return { ready: true, list, excluded: ex };
  }
  const api = { handoffDiffTargets, parseHandoffOutcomeFile, inspectHandoffOutcome, handoffOutcomeCase, handoffOutcome, handoffCarry, HO_OKIND, parseComparisonFile, checkHandoff, handoffTargetFresh, parsePath, undoDiff, ctDecisionKey, ctDecide, ctReviewState, ctCarry, CT_NOTE_MAX, changedTraces, changedTracesReport, cachedDiff, parseSnap, traceDiff, DIFF_MAX, traceProjection, sha256Hex, parseFp, FP_SCHEME, outcomeCase, outcomeCaseFresh, parseOutcomeFile, inspectOutcome, MAX_OUTCOME_BYTES, checklistOutcome, parseChangesFile, resolveItem, buildChecklist, sessionChanges, changesPacket, labelSig, captureSave, sealSave, undoSave, sessionProgress, labelKeyAction, buildCoverage, applicable, labelState, labelQueue, nextInQueue, caseLabels, casesNeedingLabels, nextCaseNeeding, planCaseLabels, METRICS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

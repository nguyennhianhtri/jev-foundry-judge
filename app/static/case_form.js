// Guided "Add case": turns a plain-language form into ONE dataset row in the canonical Foundry agent
// message format the app already runs/exports (query/response messages, optional context, human_* labels).
// Pure: no network, no inference, no key. Nothing is synthesized — no tool calls, tool definitions,
// context or labels the author did not type. Loaded by the browser (window.CaseForm) and node tests.
"use strict";
(function (root) {
  const METRICS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"];
  const MAX_TEXT = 20000, MAX_ID = 120;
  const SOURCE = "user-authored";

  // next free "my-case-N" (stable for a given dataset; the author may edit it)
  function suggestId(existingIds) {
    const have = new Set((existingIds || []).map(String));
    let n = 1; while (have.has(`my-case-${n}`)) n++;
    return `my-case-${n}`;
  }

  // f: {id, request, answer, context, labels:{metric: string}} (raw form strings)
  // returns {ok:true, row} | {ok:false, errors:{field: message}}
  function buildCase(f, existingIds) {
    const errors = {};
    const s = v => (v == null ? "" : String(v));
    const id = s(f.id).trim(), request = s(f.request), answer = s(f.answer), context = s(f.context);
    if (!id) errors.id = "Give the case an ID.";
    else if (id.length > MAX_ID) errors.id = `Keep the ID under ${MAX_ID} characters.`;
    else if ((existingIds || []).map(x => String(x ?? "").trim()).includes(id)) errors.id = `A row with ID "${id}" already exists. Choose a different ID; the existing row was not changed.`;
    if (!request.trim()) errors.request = "Type what the user asked.";
    else if (request.length > MAX_TEXT) errors.request = `Keep this under ${MAX_TEXT.toLocaleString()} characters.`;
    if (!answer.trim()) errors.answer = "Type the assistant's answer to judge.";
    else if (answer.length > MAX_TEXT) errors.answer = `Keep this under ${MAX_TEXT.toLocaleString()} characters.`;
    if (context.length > MAX_TEXT) errors.context = `Keep this under ${MAX_TEXT.toLocaleString()} characters.`;
    const labels = {};
    for (const m of METRICS) {
      const raw = s(f.labels?.[m]).trim();
      if (raw === "") continue;                       // blank = unlabelled, never a default score
      if (!/^[1-5]$/.test(raw)) { errors["label_" + m] = "Use a whole number from 1 to 5, or leave blank."; continue; }
      labels["human_" + m] = +raw;
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    // text is kept exactly as typed (no trimming/escaping); only the emptiness checks trim
    const row = {
      id, scenario: "user_authored",
      query: [{ role: "user", content: request }],
      response: [{ role: "assistant", content: [{ type: "text", text: answer }] }],
    };
    if (context.trim()) row.context = context;
    Object.assign(row, labels);
    row.note = "user-authored in the browser (not an observed agent trace; no tool calls)";
    row.source = SOURCE;  // last, matching the import normalizer's key order so re-imports are byte-identical
    return { ok: true, row };
  }

  // ---------- guided Edit (same form) for SIMPLE text rows only
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  const onlyKeys = (o, ks) => Object.keys(o).every(k => ks.includes(k));
  // query: string | [{role:"user", content:string}]
  function readQuery(q) {
    if (typeof q === "string") return { text: q, shape: "string" };
    if (Array.isArray(q) && q.length === 1 && isObj(q[0]) && onlyKeys(q[0], ["role", "content"]) && q[0].role === "user" && typeof q[0].content === "string")
      return { text: q[0].content, shape: "msg" };
    return null;
  }
  // response: string | [{role:"assistant", content: string | [{type:"text", text:string}]}]
  function readResponse(r) {
    if (typeof r === "string") return { text: r, shape: "string" };
    if (!(Array.isArray(r) && r.length === 1 && isObj(r[0]) && onlyKeys(r[0], ["role", "content"]) && r[0].role === "assistant")) return null;
    const c = r[0].content;
    if (typeof c === "string") return { text: c, shape: "msg-string" };
    if (Array.isArray(c) && c.length === 1 && isObj(c[0]) && onlyKeys(c[0], ["type", "text"]) && c[0].type === "text" && typeof c[0].text === "string")
      return { text: c[0].text, shape: "msg-parts" };
    return null;
  }
  // {ok:true} | {ok:false, reason} — rows that cannot be shown in the form WITHOUT loss stay JSON-only
  function editEligibility(row) {
    if (!isObj(row)) return { ok: false, reason: "This row is not a JSON object." };
    if (typeof row.id !== "string" || !row.id.trim()) return { ok: false, reason: "This row's ID is not plain text; use the JSON editor." };
    if (!readQuery(row.query)) return { ok: false, reason: "The request is a multi-message or structured conversation; use the JSON editor so no turns are lost." };
    if (!readQuery(row.query).text.trim()) return { ok: false, reason: "The request is empty; use the JSON editor." };
    if (!readResponse(row.response)) return { ok: false, reason: "The answer contains tool calls, tool results or several messages; use the JSON editor so the trace is not flattened." };
    if (!readResponse(row.response).text.trim()) return { ok: false, reason: "The answer is empty; use the JSON editor." };
    for (const k of ["tool_definitions", "tool_calls"]) if (row[k] != null && row[k] !== "" && !(Array.isArray(row[k]) && !row[k].length)) return { ok: false, reason: `This row has ${k}; use the JSON editor.` };
    if (row.context != null && typeof row.context !== "string") return { ok: false, reason: "The grounding context is structured data, not plain text; use the JSON editor." };
    for (const m of METRICS) { const v = row["human_" + m]; if (v != null && !(Number.isInteger(v) && v >= 1 && v <= 5)) return { ok: false, reason: `The ${m.replace(/_/g, " ")} label (${JSON.stringify(v)}) is not a whole number 1-5; use the JSON editor.` }; }
    return { ok: true };
  }
  function formFromRow(row) {
    const labels = {}; for (const m of METRICS) labels[m] = row["human_" + m] == null ? "" : String(row["human_" + m]);
    return { id: row.id, request: readQuery(row.query).text, answer: readResponse(row.response).text, context: typeof row.context === "string" ? row.context : "", labels };
  }
  // Returns a NEW row: same key order and every other field (source, note, scenario, generated, unknown keys)
  // untouched; only id/query/response/context/human_* change. Never mutates `row`.
  function applyEdit(row, f, otherIds) {
    const el = editEligibility(row); if (!el.ok) return { ok: false, errors: { form: el.reason } };
    const s = v => (v == null ? "" : String(v));
    const rawId = s(f.id), id = rawId === row.id ? row.id : rawId.trim();   // unchanged id kept byte-exact
    const b = buildCase({ ...f, id: id === row.id ? "__keep__" : id }, id === row.id ? [] : otherIds);
    if (!b.ok) return b;
    const src = structuredClone(row);
    const q = readQuery(row.query), r = readResponse(row.response), req = s(f.request), ans = s(f.answer), ctx = s(f.context);
    const set = {};  // edited values; undefined = remove the key
    set.id = id;
    set.query = q.shape === "string" ? req : [{ ...src.query[0], content: req }];
    set.response = r.shape === "string" ? ans : r.shape === "msg-string" ? [{ ...src.response[0], content: ans }] : [{ ...src.response[0], content: [{ ...src.response[0].content[0], text: ans }] }];
    // untouched context is kept byte-exact (even whitespace-only); a blank edit removes it
    set.context = ctx === (row.context ?? "") ? row.context : (ctx.trim() ? ctx : undefined);
    for (const m of METRICS) set["human_" + m] = b.row["human_" + m];
    // rebuild in the original key order; new keys go in canonical position (after response / context / labels)
    const CANON = ["id", "scenario", "query", "response", "context", ...METRICS.map(m => "human_" + m)];
    const out = {};
    const put = k => { if (k in set) { if (set[k] !== undefined) out[k] = set[k]; } else out[k] = src[k]; };
    const keys = Object.keys(src);
    for (const k of keys) {
      put(k);
      // after writing k, insert any edited-but-new canonical keys that belong right after it
      const ci = CANON.indexOf(k);
      if (ci >= 0) for (const nk of CANON.slice(ci + 1)) { if (keys.includes(nk)) break; if (set[nk] !== undefined && !(nk in out)) out[nk] = set[nk]; }
    }
    for (const k of Object.keys(set)) if (set[k] !== undefined && !(k in out)) out[k] = set[k];
    const changed = JSON.stringify(out) !== JSON.stringify(row);
    return { ok: true, row: out, changed };
  }

  // ---------- Create variant: ONE new user-authored derivative of an existing case (the source is never touched)
  const VARIANT_NOTE = "user-authored variant (edited copy of another case; not an observed agent run)";
  // next free "<source>-variant", "<source>-variant-2", ... (kept under MAX_ID)
  function suggestVariantId(srcId, existingIds) {
    const have = new Set((existingIds || []).map(x => String(x ?? "").trim()));
    const stem = String(srcId ?? "case").trim() || "case";
    const make = sfx => stem.slice(0, MAX_ID - sfx.length) + sfx;       // always <= MAX_ID
    let n = 1, id = make("-variant"); while (have.has(id)) id = make(`-variant-${++n}`);
    return id;
  }
  // content the judges see; a variant must differ from its source in at least one of these
  const CONTENT = ["query", "response", "context", "tool_definitions", "tool_calls"];
  const sameContent = (a, b) => CONTENT.every(k => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
  const sourceLabels = src => Object.fromEntries(METRICS.filter(m => src["human_" + m] != null).map(m => [m, src["human_" + m]]));
  // deep copy of the source with: labels cleared, "generated" dropped, provenance (note/source/derived_from) last.
  // Every other field (rich traces, tool definitions, unknown keys) is copied exactly.
  function withProvenance(row, src) {
    const out = structuredClone(row);
    delete out.generated; delete out.note; delete out.source; delete out.derived_from;
    out.note = VARIANT_NOTE;
    out.source = SOURCE;
    const root = src.derived_from && typeof src.derived_from === "object" ? (src.derived_from.root ?? src.derived_from.id) : undefined;
    out.derived_from = { id: src.id, ...(src.scenario != null ? { scenario: src.scenario } : {}), ...(src.source != null ? { source: src.source } : {}), ...(root != null ? { root } : {}) };
    return out;
  }
  function draftVariant(src, existingIds) {
    const d = structuredClone(src);
    for (const m of METRICS) delete d["human_" + m];
    d.id = suggestVariantId(src.id, existingIds);
    return withProvenance(d, src);
  }
  // guided path (simple text sources only): form -> new row. existingIds = ALL ids in the dataset (incl. the source).
  function buildVariant(src, f, existingIds) {
    const el = editEligibility(src); if (!el.ok) return { ok: false, errors: { form: el.reason } };
    const ids = (existingIds || []).map(x => String(x ?? "").trim());
    const id = (f.id == null ? "" : String(f.id)).trim();
    const errors = {};
    if (!id) errors.id = "Give the variant an ID.";
    else if (id.length > MAX_ID) errors.id = `Keep the ID under ${MAX_ID} characters.`;
    else if (ids.includes(id)) errors.id = `A row with ID "${id}" already exists. Choose a different ID; nothing was changed.`;
    const base = structuredClone(src); for (const m of METRICS) delete base["human_" + m]; delete base.generated;
    base.id = "\u0000source";                                   // never a real id; forces applyEdit to use (and check) the new one
    const r = applyEdit(base, { ...f, id }, ids);
    if (!r.ok || Object.keys(errors).length) return { ok: false, errors: { ...(r.ok ? {} : r.errors), ...errors } };
    const row = withProvenance(r.row, src);
    if (sameContent(row, src)) return { ok: false, errors: { answer: "The variant is identical to the source case. Change the answer (or the request or context) to make a contrast case." } };
    return { ok: true, row };
  }
  // JSON path (rich tool / multi-turn sources): the user edits the full draft; validated, never flattened
  function validateVariantJSON(src, obj, existingIds) {
    if (!isObj(obj)) return { ok: false, error: "The variant must be one JSON object (a single row)." };
    const ids = (existingIds || []).map(x => String(x ?? "").trim());
    if (typeof obj.id !== "string" || !obj.id.trim()) return { ok: false, error: "Give the variant a text \"id\"." };
    if (obj.id !== obj.id.trim()) return { ok: false, error: "Remove leading/trailing spaces from the \"id\"." };
    if (obj.id.length > MAX_ID) return { ok: false, error: `Keep the ID under ${MAX_ID} characters.` };
    if (ids.includes(obj.id)) return { ok: false, error: `A row with ID "${obj.id}" already exists. Choose a different ID; nothing was changed.` };
    const msgs = v => (typeof v === "string" && v.trim() !== "") || (Array.isArray(v) && v.length > 0 && v.every(m => isObj(m) && typeof m.role === "string"));
    if (!msgs(obj.query)) return { ok: false, error: "\"query\" must be text or a non-empty list of messages with a \"role\"." };
    if (!msgs(obj.response)) return { ok: false, error: "\"response\" must be text or a non-empty list of messages with a \"role\"." };
    for (const k of ["tool_definitions", "tool_calls"]) if (obj[k] != null && !Array.isArray(obj[k])) return { ok: false, error: `"${k}" must be a list when present.` };
    if (obj.context != null && typeof obj.context !== "string" && !isObj(obj.context) && !Array.isArray(obj.context)) return { ok: false, error: "\"context\" must be text or structured JSON." };
    for (const m of METRICS) { const v = obj["human_" + m]; if (v != null && !(Number.isInteger(v) && v >= 1 && v <= 5)) return { ok: false, error: `human_${m} must be a whole number 1-5 or left out.` }; }
    if (sameContent(obj, src)) return { ok: false, error: "The variant is identical to the source case. Change the response (or query/context/tools) to make a contrast case." };
    // provenance is not user-editable: always re-stamped from the real source (cannot be dropped or forged)
    return { ok: true, row: withProvenance(obj, src) };
  }

  const api = { buildCase, suggestId, editEligibility, formFromRow, applyEdit, suggestVariantId, draftVariant, buildVariant, validateVariantJSON, sourceLabels, VARIANT_NOTE, METRICS, SOURCE, MAX_TEXT, MAX_ID };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CaseForm = api;
})(typeof window !== "undefined" ? window : globalThis);

// Preview an uploaded JSONL / JSON-array / CSV dataset BEFORE it touches the current cases (t_f136e25a).
// Uses the app's EXISTING parseCSV + normalize (passed in as deps), so the rows applied are byte-for-byte the
// rows the old one-click upload produced; this module only adds an honest parse report and a read-only summary.
// Apply semantics are unchanged: incoming rows are ADDED after the current rows; nothing is replaced or merged by id.
// Loaded by the browser (window.parseImport / previewImport) and by node tests (module.exports).
"use strict";
(function (root) {
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  const typeOfId = v => v === undefined ? "absent" : v === null ? "null" : typeof v;
  // deps: { parseCSV, normalize }. Never throws; returns {ok:false, error} with a line/row number when it can.
  function parseImport(name, text, deps) {
    name = String(name || "");
    if (typeof text === "string") text = text.replace(/^\uFEFF/, "");  // byte-order mark from Excel/Notepad
    const lower = name.toLowerCase();
    const format = lower.endsWith(".csv") ? "CSV" : String(text).trim().startsWith("[") ? "JSON array" : "JSONL";
    const fail = error => ({ ok: false, format, error });
    if (typeof text !== "string" || !text.trim()) return fail("the file is empty");
    let objs = [];
    if (format === "CSV") {
      try { objs = deps.parseCSV(text); } catch (e) { return fail(`CSV could not be read (${e.message})`); }
      if (!Array.isArray(objs) || !objs.length) return fail("the CSV has a header row but no data rows");
    } else if (format === "JSON array") {
      try { objs = JSON.parse(text); } catch (e) { return fail(`not valid JSON (${e.message})`); }
      if (!Array.isArray(objs)) return fail("the JSON is not an array of cases");
      if (!objs.length) return fail("the JSON array has no cases");
      const bad = objs.findIndex(o => !isObj(o));
      if (bad >= 0) return fail(`item ${bad + 1} of the array is not a JSON object`);
    } else {
      const lines = text.split(/\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        let o; try { o = JSON.parse(lines[i]); } catch (e) { return fail(`line ${i + 1} is not valid JSON (${e.message})`); }
        if (!isObj(o)) return fail(`line ${i + 1} is not a JSON object`);
        objs.push(o);
      }
    }
    // report ids exactly as they are in the file, before normalize assigns anything
    const noId = [], oddId = [];
    objs.forEach((o, i) => { const t = typeOfId(o.id); if (!o.id) noId.push(i + 1); /* same test normalize uses (o.id || generated): 0, "", null reported */ else if (t !== "string" && t !== "number") oddId.push(i + 1); });
    let rows;
    try { rows = objs.map(deps.normalize); } catch (e) { return fail(`a case could not be read (${e.message})`); }
    return { ok: true, format, name, rows, no_id_rows: noId, odd_id_rows: oddId };
  }
  // Read-only summary of the parsed file vs the current dataset. deps: { applicable, labelState, METRICS }
  function previewImport(p, current, deps) {
    const rows = p.rows, cur = Array.isArray(current) ? current : [];
    const key = id => typeOfId(id) + ":" + String(id);
    const have = new Set(cur.map(r => key(r && r.id)));
    const seen = new Map();
    for (const r of rows) seen.set(key(r.id), (seen.get(key(r.id)) || 0) + 1);
    const dupInFile = [...seen.values()].filter(n => n > 1).reduce((a, n) => a + n, 0);
    const clash = rows.filter(r => have.has(key(r.id))).map(r => r.id);
    const metrics = {};
    for (const m of deps.METRICS) {
      let ap = 0, lab = 0, inv = 0;
      for (const r of rows) {
        const s = deps.labelState(r["human_" + m]);
        if (s === "invalid") inv++;
        if (deps.applicable(r, m)) { ap++; if (s === "ok") lab++; }
      }
      metrics[m] = { applicable: ap, not_applicable: rows.length - ap, labelled: lab, invalid: inv };
    }
    return {
      file: p.name, format: p.format, incoming: rows.length, current: cur.length, after: cur.length + rows.length,
      mode: "add", no_id: p.no_id_rows.length, odd_id: p.odd_id_rows.length,
      clash_ids: clash.map(String), dup_in_file: dupInFile,
      generated: rows.filter(r => r.generated).length, user_authored: rows.filter(r => r.source === "user-authored").length,
      metrics,
    };
  }
  // Read-only view of ONE pending row (t_8407aab1): the exact object Apply will push, never a re-parse or copy
  // that could drift. Values are described, not normalized: strings verbatim, objects/arrays as JSON text,
  // absent / null / "" / [] kept distinct. `long` flags text over LONG chars so the UI can collapse it.
  const LONG = 600;
  const RICH = ["context", "tool_definitions", "tool_calls"];
  const KNOWN = new Set(["id", "scenario", "query", "response", "note", "source", "generated", "derived_from", ...RICH]);
  function describe(r, k) {
    if (!Object.prototype.hasOwnProperty.call(r, k)) return { state: "absent", text: "" };
    const v = r[k];
    if (v === null) return { state: "null", text: "" };
    if (typeof v === "string") return v === "" ? { state: "empty", text: "" } : { state: "text", text: v, long: v.length > LONG, chars: v.length };
    if (Array.isArray(v) && !v.length) return { state: "empty", text: "[]" };
    let t; try { t = JSON.stringify(v, null, 2); } catch { t = String(v); }
    if (t === undefined) t = String(v);
    return { state: typeof v === "object" ? (Array.isArray(v) ? "json_array" : "json_object") : typeof v, text: t, long: t.length > LONG, chars: t.length, items: Array.isArray(v) ? v.length : undefined };
  }
  function inspectPending(rows, pos) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const i = Math.min(Math.max(0, pos | 0), rows.length - 1), r = rows[i];
    const df = r.derived_from && r.derived_from.id != null ? r.derived_from.id : null;
    return {
      pos: i, total: rows.length, id: r.id, id_type: typeOfId(r.id),
      provenance: { source: r.source ?? null, generated: !!r.generated, derived_from: df, scenario: r.scenario ?? null, note: r.note ?? null },
      request: describe(r, "query"), answer: describe(r, "response"),
      rich: RICH.map(k => ({ key: k, ...describe(r, k) })),
      other_fields: Object.keys(r).filter(k => !KNOWN.has(k)),
    };
  }
  const api = { parseImport, previewImport, inspectPending, INSPECT_LONG: LONG };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

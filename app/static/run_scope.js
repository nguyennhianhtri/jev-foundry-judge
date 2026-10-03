// Pre-run evaluation scope (what pressing Run will send). Pure: no DOM, no network, never mutates its input.
// rows: the FULL dataset in order (never the search-filtered view). selected: the checked metric values.
// opts.all: canonical metric order; opts.applicable(row, m): the shared rule from label_coverage.js
// (mirrors evaluators.build_state + SPECS[m].requires). A row where no selected metric applies costs no Jev call
// (JevAgentJudge returns n/a without calling), so jev_calls counts only rows with >= 1 applicable selected metric.
(function (root) {
  function runScope(rows, selected, opts = {}) {
    const all = Array.isArray(opts.all) ? opts.all : [], ap = opts.applicable;
    const list = Array.isArray(rows) ? rows : [], sel = new Set(Array.isArray(selected) ? selected : []);
    const metrics = all.filter(m => sel.has(m));
    const base = { rows: list.length, baseline: !!opts.baseline, all_selected: metrics.length === all.length && all.length > 0 };
    if (!list.length) return { ...base, ok: false, reason: "no_rows", metrics: [], jev_calls: 0, rows_no_call: 0 };
    if (!metrics.length) return { ...base, ok: false, reason: "no_metrics", metrics: [], jev_calls: 0, rows_no_call: 0 };
    const per = metrics.map(m => ({ metric: m, applicable: 0, not_applicable: 0 }));
    let calls = 0;
    for (const r of list) {
      let any = false;
      per.forEach(x => { if (ap(r, x.metric)) { x.applicable++; any = true; } else x.not_applicable++; });
      if (any) calls++;
    }
    return { ...base, ok: true, reason: null, metrics: per, jev_calls: calls, rows_no_call: list.length - calls };
  }
  // Drilldown for ONE selected metric's n/a count: every current row where the SAME applicability rule says the
  // judge will not score it, in dataset order, with the plain reason (opts.reasonOf(row, m), label_coverage's
  // caseLabels projection) and where to fix it. opts.formOk(row): the plain-text form can edit this row.
  // Groundedness n/a on a form-editable row -> "form" (its Grounding context field); everything else -> "json"
  // (tool calls / tool lists / structured traces are only editable there). Duplicate IDs are flagged, never merged.
  function naCases(rows, m, opts = {}) {
    const list = Array.isArray(rows) ? rows : [], ap = opts.applicable, why = opts.reasonOf || (() => "not applicable");
    const key = r => (r && typeof r === "object" && !Array.isArray(r) && "id" in r) ? JSON.stringify(r.id) : null;
    const seen = new Map(); list.forEach(r => { const k = key(r); if (k != null) seen.set(k, (seen.get(k) || 0) + 1); });
    const out = [];
    list.forEach((r, idx) => {
      if (ap(r, m)) return;
      const k = key(r), isO = r && typeof r === "object" && !Array.isArray(r);
      out.push({ idx, id: isO ? r.id : undefined, has_id: k != null, dup: k != null && seen.get(k) > 1,
        reason: why(r, m), open: m === "groundedness" && isO && opts.formOk && opts.formOk(r) ? "form" : "json", sig: JSON.stringify(r) });
    });
    return out;
  }
  // Re-resolve a drilldown entry against the CURRENT rows: same position + byte-identical content, else the unique
  // byte-identical row elsewhere (reorder). Anything else (edited, deleted, ambiguous) is refused, never another case.
  function resolveNa(rows, e) {
    const list = Array.isArray(rows) ? rows : [];
    if (list[e.idx] !== undefined && JSON.stringify(list[e.idx]) === e.sig) return { ok: true, idx: e.idx };
    const hits = []; list.forEach((r, i) => { if (JSON.stringify(r) === e.sig) hits.push(i); });
    if (hits.length === 1) return { ok: true, idx: hits[0], moved: true };
    return { ok: false, reason: hits.length ? "several identical rows match this case, so it is ambiguous" : "this case was changed or removed since the list was shown" };
  }
  const api = { runScope, naCases, resolveNa };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

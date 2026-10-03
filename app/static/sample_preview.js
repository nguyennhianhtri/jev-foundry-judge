// Read-only preview of ONE shipped sample scenario before it is added (t_59b45262). A pure projection over the
// exact selected sample's rows and the current dataset: case count, how many Add would insert (Add skips ids that
// are already in the dataset), one representative request/answer, and per-metric applicability + human-label counts
// via the existing label_coverage rules. No calls, no mutation, nothing invented.
// Loaded by the browser (window.samplePreview) and by node tests (module.exports).
"use strict";
(function (root) {
  const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
  // deps: { applicable, labelState, METRICS, userText, finalText }
  function samplePreview(sample, rows, deps) {
    const src = sample && Array.isArray(sample.rows) ? sample.rows : [];
    const have = new Set((Array.isArray(rows) ? rows : []).map(r => r && r.id));
    const willAdd = src.filter(r => !have.has(r && r.id)).length;
    const rep = src[0] || null;
    const metrics = {};
    for (const m of deps.METRICS) {
      let ap = 0, lab = 0;
      for (const r of src) if (deps.applicable(r, m)) { ap++; if (deps.labelState(r["human_" + m]) === "ok") lab++; }
      metrics[m] = { applicable: ap, labelled: lab, not_applicable: src.length - ap };
    }
    return {
      name: sample ? sample.name : null, count: src.length, will_add: willAdd, already: src.length - willAdd,
      generated: src.filter(r => r && r.generated).length,
      rep: rep ? { id: rep.id == null ? null : String(rep.id), note: clip(rep.note, 90),
        request: clip(deps.userText(rep.query), 140), answer: clip(deps.finalText(rep.response), 160) } : null,
      metrics,
    };
  }
  const api = { samplePreview };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

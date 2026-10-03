// Original vs variant pairing: a pure function over the COMPLETED run (results + the runRows snapshot
// frozen at run start). Pairs come ONLY from user-authored derived_from.id provenance matched to exactly
// one source id in the same run. Nothing is inferred, re-judged, or fetched. No verdicts.
// Loaded by the browser (window.buildPairs) and by node tests (module.exports).
"use strict";
(function (root) {
  const METRICS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"];
  const JUDGES = ["jev", "llm", "human"];
  const SCALE = { jev: "Jev 1–5 (continuous)", llm: "LLM judge 1–5 (integer)", human: "your label 1–5 (integer)" };
  const fin = v => typeof v === "number" && isFinite(v);
  const score = (x, who, m) => who === "llm" ? x?.llm?.[m]?.score : x?.[who]?.[m];
  const r2 = v => Math.round(v * 100) / 100;

  // returns {ok, reason?, pairs:[...], excluded:[{variant_id, idx, reason}], totals:{metric:{judge:{n, of}}}}
  function buildPairs({ results, runRows }) {
    if (!Array.isArray(results) || !results.length) return { ok: false, reason: "No completed run.", pairs: [], excluded: [] };
    if (!Array.isArray(runRows) || runRows.length !== results.length)
      return { ok: false, reason: "The frozen trace snapshot for this run is missing, so pairs cannot be bound; nothing is shown.", pairs: [], excluded: [] };
    const idCount = new Map();
    runRows.forEach(r => { const k = String(r?.id); idCount.set(k, (idCount.get(k) || 0) + 1); });
    const at = new Map(); runRows.forEach((r, i) => at.set(String(r?.id), i));
    const pairs = [], excluded = [];
    runRows.forEach((v, vi) => {
      const df = v?.derived_from;
      if (!df || df.id == null || v.source !== "user-authored") return;       // only authored-variant provenance
      const vid = String(v.id), sid = String(df.id);
      const ex = reason => excluded.push({ variant_id: vid, source_id: sid, idx: vi, reason });
      if (results[vi]?.id !== v.id) return ex("result row is not bound to this snapshot row");
      if (idCount.get(vid) > 1) return ex(`variant id appears ${idCount.get(vid)} times in this run`);
      const n = idCount.get(sid) || 0;
      if (n === 0) return ex("source case was not in this run");
      if (n > 1) return ex(`source id appears ${n} times in this run (ambiguous)`);
      const oi = at.get(sid);
      if (oi === vi) return ex("variant names itself as its source");
      if (results[oi]?.id !== runRows[oi]?.id) return ex("source result row is not bound to its snapshot row");
      const o = results[oi], x = results[vi], metrics = {};
      for (const m of METRICS) {
        metrics[m] = {};
        for (const j of JUDGES) {
          const a = score(o, j, m), b = score(x, j, m);
          metrics[m][j] = { original: fin(a) ? a : null, variant: fin(b) ? b : null, delta: fin(a) && fin(b) ? r2(b - a) : null };
        }
      }
      const nested = runRows[oi]?.derived_from?.id != null;
      pairs.push({ original_id: sid, variant_id: vid, original_idx: oi, variant_idx: vi, nested,
        root_id: df.root != null ? String(df.root) : null, metrics });
    });
    const totals = {};
    for (const m of METRICS) {
      totals[m] = {};
      for (const j of JUDGES) totals[m][j] = { n: pairs.filter(p => p.metrics[m][j].delta != null).length, of: pairs.length };
    }
    return { ok: true, pairs, excluded, totals, scale: SCALE };
  }
  const api = { buildPairs, SCALE };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

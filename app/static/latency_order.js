// Results-by-row view order (t_bef3dda6). Pure: no DOM, no network, never mutates results or the index list.
// "Slowest Jev first" orders the rows being shown by the exact recorded jev_meta.latency_ms (one Jev call that scored
// every metric of that row). Only finite numbers count; missing/null/NaN/Infinity/non-number = unavailable, never 0,
// and sit after every valid row in run order. Ties keep run order (stable). S.results / runRows are never reordered.
(function (root) {
  const jevLatency = x => { const v = x?.jev_meta?.latency_ms; return typeof v === "number" && Number.isFinite(v) ? v : null; };
  // idxs: run positions currently shown (already filtered). Returns a NEW array of { pos, id, ms } in view order.
  function latencyView(results, idxs, mode) {
    const L = idxs.map(pos => ({ pos, id: results[pos]?.id, ms: jevLatency(results[pos]) }));
    const valid = L.filter(e => e.ms !== null).length, unavailable = L.length - valid;
    if (mode === "slowest") L.sort((a, b) => (a.ms === null) - (b.ms === null) || (a.ms === null ? 0 : b.ms - a.ms) || a.pos - b.pos);
    return { mode: mode === "slowest" ? "slowest" : "run", rows: L, valid, unavailable };
  }
  // A displayed row is bound to (run position, typed id); open only if both still match the frozen run.
  const sameId = (a, b) => typeof a === typeof b && JSON.stringify(a) === JSON.stringify(b);
  function resolveRow(results, runRows, pos, id) {
    const x = results[pos], src = runRows[pos];
    return !!x && sameId(x.id, id) && !!src && sameId(src.id, id);
  }
  const api = { jevLatency, latencyView, resolveRow };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

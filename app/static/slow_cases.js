// Slow-case drilldown behind the Dashboard "Jev latency p95" headline (t_1b23e244). Pure: no DOM, no network,
// never mutates results/runRows/summary. The threshold is NOT recomputed here: it is the run's own measured
// summary.jev.p95_ms from stats.pct (the server's single percentile method). Denominator mirrors that method:
// rows whose jev_meta.latency_ms is a finite number (the one Jev call that scored all metrics of the row).
// Missing/null/non-finite latency = unavailable (never 0), excluded with a reason. Members = finite latency >= p95
// (ties included), shown slowest first, equal times in run order.
(function (root) {
  const fin = v => typeof v === "number" && Number.isFinite(v);
  function slowCases({ results, summary } = {}) {
    const res = Array.isArray(results) ? results : [];
    if (!summary || !res.length) return { ok: false, reason: "no_run" };
    const p95 = summary.jev?.p95_ms;
    if (!fin(p95) || p95 <= 0) return { ok: false, reason: "no_p95" };   // 0 = only no-call rows timed
    const valid = [], excluded = {}, noCall = [];
    res.forEach((x, pos) => {
      const v = x?.jev_meta?.latency_ms;
      if (fin(v)) { valid.push({ pos, id: x.id, ms: v }); if (x.jev_meta.calls === 0) noCall.push(pos); return; }
      const why = x?.error ? "Jev call failed (error)" : !x?.jev_meta ? "no Jev call recorded" : "latency not recorded";
      excluded[why] = (excluded[why] || 0) + 1;
    });
    const members = valid.filter(e => e.ms >= p95).sort((a, b) => b.ms - a.ms || a.pos - b.pos);
    const ties = members.filter(e => e.ms === p95).length;
    return { ok: true, p95, denominator: valid.length, rows: res.length, members, ties, excluded,
      excluded_n: res.length - valid.length, no_call_zero: noCall.length, small_n: valid.length < 20,
      at: summary.at ?? null, version: summary.version ?? null };
  }
  // Export: the existing evaluated-dataset serializer over exactly the member rows, in shown order.
  function slowExport({ sc, runRows, results, summary, key, build }) {
    if (!sc?.ok || !sc.members.length) return { ok: false, reason: "empty" };
    const rr = sc.members.map(e => runRows[e.pos]), rs = sc.members.map(e => results[e.pos]);
    return build({ runRows: rr, results: rs, summary, key });
  }
  const api = { slowCases, slowExport };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

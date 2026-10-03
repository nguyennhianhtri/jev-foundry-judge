// Same-workload cost/latency comparison: a pure projection over the COMPLETED run's raw results.
// Jev answers ALL requested metrics of a row in ONE call, so its cost/latency are per row and cannot be split per
// metric. The LLM judge makes one call PER metric. The only like-for-like unit is therefore a ROW where both judges
// returned a score for exactly the same set of metrics ("matched row"). Everything else is shown as separate measured
// totals with its own denominator, never as a ratio. Missing/non-finite cost or latency is "unknown", never 0.
// Loaded by the browser (window.buildBenchCompare) and by node tests (module.exports). No globals, no network.
"use strict";
(function (root) {
  const METRICS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"];
  const num = v => typeof v === "number" && Number.isFinite(v);
  const sum = a => a.reduce((x, y) => x + y, 0);
  function pct(xs, p) {
    const s = xs.filter(num).sort((a, b) => a - b); if (!s.length) return null;
    const k = (s.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k);
    return Math.round((s[lo] + (s[hi] - s[lo]) * (k - lo)) * 10) / 10;
  }
  const per1k = (tot, n) => (num(tot) && n > 0) ? tot / n * 1000 : null;

  function buildBenchCompare(results, opt = {}) {
    const R = Array.isArray(results) ? results : [];
    const J = { rows_sent: R.length, calls: 0, failed_rows: 0, scored: 0, not_applicable: 0, missing_cost_rows: 0, missing_latency_rows: 0, lat: [], usd: [] };
    const L = { ran: false, calls: 0, scored: 0, not_applicable: 0, failed: 0, missing_cost: 0, missing_latency: 0, lat: [], usd: [], row_seq: [], rows_with_calls: 0 };
    const matched = [], unmatched = {}, cases = []; let pos = 0;
    const bump = (k) => { unmatched[k] = (unmatched[k] || 0) + 1; };
    for (const r of R) {
      const meta = r.jev_meta;
      const jSet = new Set(METRICS.filter(m => num(r.jev?.[m])));
      if (r.error || !meta) { J.failed_rows++; J.missing_cost_rows++; }
      else {
        J.calls++;
        if (num(meta.latency_ms)) J.lat.push(meta.latency_ms); else J.missing_latency_rows++;
        if (num(meta.usd)) J.usd.push(meta.usd); else J.missing_cost_rows++;
      }
      J.scored += jSet.size;
      for (const m of METRICS) if (r.jev_detail?.[m]?.result === "not_applicable") J.not_applicable++;
      const llm = r.llm && typeof r.llm === "object" ? r.llm : null;
      const lSet = new Set(); let rowLat = 0, rowUsd = 0, rowLatOk = true, rowUsdOk = true, rowCalls = 0;
      if (llm) {
        L.ran = true;
        for (const [m, v] of Object.entries(llm)) {
          if (!v) continue;
          if (v.result === "not_applicable" && !num(v.score)) { L.not_applicable++; continue; }
          rowCalls++; L.calls++;
          if (num(v.score)) { L.scored++; lSet.add(m); } else L.failed++;
          if (num(v.latency_ms)) { L.lat.push(v.latency_ms); rowLat += v.latency_ms; } else { L.missing_latency++; rowLatOk = false; }
          if (num(v.usd)) { L.usd.push(v.usd); rowUsd += v.usd; } else { L.missing_cost++; rowUsdOk = false; }
        }
        if (rowCalls) { L.rows_with_calls++; if (rowLatOk) L.row_seq.push(rowLat); }
      }
      // matched-row test (one reason per row, first failing condition wins; order unchanged from v1)
      let reason = null;
      if (!llm) reason = "no LLM judge result for this row";
      else if (r.error || !meta) reason = "Jev call failed";
      else if (!jSet.size) reason = "Jev scored no metric";
      else if (rowCalls > lSet.size) reason = "an LLM judge call failed";
      else if (!(jSet.size === lSet.size && [...jSet].every(m => lSet.has(m)))) reason = "judges scored different metrics";
      else if (!num(meta.usd) || !rowUsdOk) reason = "cost not recorded";
      else if (!num(meta.latency_ms) || !rowLatOk) reason = "latency not recorded";
      // per-row case: identity is the run POSITION plus the id recorded in the result; unknown stays null, never 0
      const id = typeof r.id === "string" || typeof r.id === "number" ? String(r.id) : null;
      cases.push({ pos, id, status: reason ? "excluded" : "compared", reason,
        jev_metrics: METRICS.filter(m => jSet.has(m)), llm_metrics: METRICS.filter(m => lSet.has(m)).concat([...lSet].filter(m => !METRICS.includes(m))),
        llm_calls: llm ? rowCalls : null, llm_failed_calls: llm ? rowCalls - lSet.size : null,
        jev_usd: meta && num(meta.usd) ? meta.usd : null, llm_usd: llm && rowCalls && rowUsdOk ? rowUsd : null,
        jev_ms: meta && num(meta.latency_ms) ? meta.latency_ms : null, llm_sum_ms: llm && rowCalls && rowLatOk ? rowLat : null });
      pos++;
      if (reason) { bump(reason); continue; }
      matched.push({ id: r.id, metrics: jSet.size, jev_usd: meta.usd, llm_usd: rowUsd, jev_ms: meta.latency_ms, llm_seq_ms: rowLat });
    }
    const idN = new Map(); for (const c of cases) if (c.id != null) idN.set(c.id, (idN.get(c.id) || 0) + 1);
    for (const c of cases) c.id_unique = c.id != null && idN.get(c.id) === 1;
    const jevTotal = J.missing_cost_rows ? null : sum(J.usd), llmTotal = L.missing_cost ? null : sum(L.usd);
    const m = {
      rows: matched.length, metric_evals: sum(matched.map(x => x.metrics)),
      jev_usd: sum(matched.map(x => x.jev_usd)), llm_usd: sum(matched.map(x => x.llm_usd)),
      jev_p50_ms: pct(matched.map(x => x.jev_ms), .5), llm_seq_p50_ms: pct(matched.map(x => x.llm_seq_ms), .5),
      unmatched, unmatched_rows: R.length - matched.length,
    };
    m.jev_usd_per_1k_rows = per1k(m.jev_usd, m.rows); m.llm_usd_per_1k_rows = per1k(m.llm_usd, m.rows);
    m.cost_ratio = (m.rows && m.jev_usd > 0 && m.llm_usd > 0) ? m.llm_usd / m.jev_usd : null;
    const scope = !L.ran ? "no_baseline" : !m.rows ? "not_comparable" : m.unmatched_rows === 0 ? "same" : "partial";
    return {
      kind: "jfj-bench-compare", version: 1, scope,
      note: "Costs are estimates: recorded tokens × list price. They are not an invoice.",
      pricing: opt.pricing || null,
      jev: { rows_sent: J.rows_sent, calls: J.calls, failed_rows: J.failed_rows, scored_evals: J.scored, not_applicable: J.not_applicable,
        missing_cost_rows: J.missing_cost_rows, missing_latency_rows: J.missing_latency_rows,
        total_usd: jevTotal, known_usd: sum(J.usd), usd_per_1k_rows: J.missing_cost_rows ? null : per1k(jevTotal, J.calls),
        p50_ms_per_call: pct(J.lat, .5), p95_ms_per_call: pct(J.lat, .95) },
      llm: L.ran ? { calls: L.calls, scored_evals: L.scored, failed_calls: L.failed, not_applicable: L.not_applicable,
        missing_cost: L.missing_cost, missing_latency: L.missing_latency, rows_with_calls: L.rows_with_calls,
        total_usd: llmTotal, known_usd: sum(L.usd), usd_per_1k_evals: L.missing_cost ? null : per1k(llmTotal, L.calls),
        p50_ms_per_call: pct(L.lat, .5), p95_ms_per_call: pct(L.lat, .95),
        p50_ms_per_row_sequential: pct(L.row_seq, .5), rows_sequential_n: L.row_seq.length } : null,
      matched: m,
      cases,
    };
  }
  // Run-bound pricing: the ONLY pricing source for a completed run's comparison/brief/package. It reads the prices
  // recorded in the run config at run start, never today's mutable app config. No recorded config (older run or
  // labelled replay) => every price null + source "not_recorded", so nothing borrows current prices.
  function runPricing(runCfg) {
    const rc = runCfg && typeof runCfg === "object" ? runCfg : null;
    const v = k => rc && num(rc[k]) ? rc[k] : null;
    return { source: rc ? "recorded_at_run_start" : "not_recorded",
      jev_usd_per_mtok_input: v("jev_usd_per_mtok_input"), llm_usd_per_mtok_in: v("baseline_usd_per_mtok_in"), llm_usd_per_mtok_out: v("baseline_usd_per_mtok_out") };
  }
  const api = { buildBenchCompare, runPricing };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

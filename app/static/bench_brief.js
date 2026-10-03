// Benchmark brief (.md): a compact, publication-ready text rendering of ONE completed run.
// Pure: it formats the SAME buildBenchCompare() projection shown in the same-workload panel plus the run's frozen
// backend summary (agreement). It computes no metric of its own. Unknown values are written "unknown", never 0.
// No trace text, prompts, keys or provider secrets: only ids-free aggregates, denominators and method notes.
// Loaded by the browser (window.buildBenchBrief) and by node tests (module.exports). No globals, no network.
"use strict";
(function (root) {
  const MN = { intent_resolution: "Intent resolution", task_adherence: "Task adherence", tool_call_accuracy: "Tool call accuracy", groundedness: "Groundedness" };
  const METRICS = Object.keys(MN);
  const num = v => typeof v === "number" && Number.isFinite(v);
  const usd = v => !num(v) ? "unknown" : v < 0.01 ? "$" + v.toFixed(5) : "$" + v.toFixed(3);
  const ms = v => !num(v) ? "unknown" : v >= 1000 ? (v / 1000).toFixed(2) + " s" : Math.round(v) + " ms";
  const x = v => !num(v) ? "unknown" : v >= 10 ? Math.round(v) + "×" : v.toFixed(1) + "×";
  const pc = v => !num(v) ? "unknown" : (v * 100).toFixed(1) + "%";
  const cell = s => String(s).replace(/[\r\n]+/g, " ").replace(/[\\`*_\[\]<>|]/g, c => "\\" + c);
  const txt = v => v == null || v === "" ? "unknown" : cell(v);
  const ag = a => !a || !a.n ? "no comparable pairs (n = 0)" : `${pc(a.pass_fail_agreement)} pass/fail agreement, MAE ${num(a.mae) ? a.mae : "unknown"} (n = ${a.n} score pairs)`;

  function buildBenchBrief({ compare, summary, meta = {} } = {}) {
    const c = compare, s = summary;
    if (!c || !s || !(c.jev?.rows_sent > 0)) return null;           // no completed run: nothing to export
    const J = c.jev, L = c.llm, m = c.matched, P = c.pricing || {}, K = c.cases || [];
    const L_ = [];
    const p = (...a) => L_.push(...a);
    p("# Jev vs LLM judge: benchmark brief", "");
    p(`- App version recorded with the run: ${txt(s.version)}`,
      `- Run completed: ${txt(s.at)}`,
      `- Brief generated: ${txt(meta.generated_at)} by current app ${txt(meta.app_version)} (export version; may differ from the recorded version above)`,
      `- Rows in the run: ${J.rows_sent} (frozen when the run started; later dataset edits are not included)`,
      `- LLM judge: ${L ? txt(s.baseline_label) : "not run in this run"}`,
      `- Pass threshold for agreement: score ≥ ${txt(s.threshold)}`, "");

    p("## Same-workload comparison", "");
    const reasons = Object.entries(m.unmatched || {});
    const exBreak = reasons.length ? reasons.map(([k, n]) => `${k}: ${n}`).join("; ") : "none";
    if (c.scope === "no_baseline") {
      p("Scope: **no baseline**. Only Jev ran, so there is no like-for-like comparison and no cost ratio.", "");
    } else if (c.scope === "not_comparable") {
      p(`Scope: **not comparable**. No row had both judges score exactly the same metrics with cost and time recorded, so no like-for-like figure or cost ratio is given. Excluded rows: ${m.unmatched_rows} of ${J.rows_sent} (${exBreak}).`, "");
    } else {
      p(`Scope: **${c.scope === "same" ? "same workload (all rows matched)" : "partial"}**. A row is compared only when both judges scored exactly the same metrics and cost and time were recorded for both.`, "",
        `- Compared rows: **${m.rows} of ${J.rows_sent}**, covering ${m.metric_evals} metric evaluations per judge`,
        `- Excluded rows: ${m.unmatched_rows} (${exBreak})`,
        `- Estimated cost on the compared rows: Jev ${usd(m.jev_usd)}, LLM judge ${usd(m.llm_usd)}`,
        `- Same-workload cost ratio (LLM judge ÷ Jev): ${m.cost_ratio != null ? `**${x(m.cost_ratio)}**` : "not given (a total is zero or missing)"}`,
        `- Projected: Jev ${usd(m.jev_usd_per_1k_rows)} vs LLM judge ${usd(m.llm_usd_per_1k_rows)} per 1,000 rows (from the compared rows)`,
        `- Time per compared row (median): Jev ${ms(m.jev_p50_ms)} (one call scores all metrics of the row); LLM judge ${ms(m.llm_seq_p50_ms)} (sum of its per-metric call times; calls run in parallel, so actual wait per row is lower and was not measured)`, "");
    }
    if (K.length) {
      const inc = K.filter(k => k.status === "compared").length;
      p(`Case membership (${inc} compared, ${K.length - inc} excluded) is listed per row in the app's "Show compared / excluded cases" view and can be re-derived from the full results export.`, "");
    }

    p("## Full run, measured", "", "| | Jev | LLM judge |", "|---|---|---|");
    const lc = f => L ? f() : "not run";
    p(`| Calls | ${J.calls} of ${J.rows_sent} rows (one per row, all metrics)${J.failed_rows ? `; ${J.failed_rows} failed` : ""} | ${lc(() => `${L.calls} (one per metric)${L.failed_calls ? `; ${L.failed_calls} failed` : ""}`)} |`,
      `| Metric scores returned | ${J.scored_evals}${J.not_applicable ? ` (+${J.not_applicable} not applicable)` : ""} | ${lc(() => `${L.scored_evals}${L.not_applicable ? ` (+${L.not_applicable} not applicable, no call)` : ""}`)} |`,
      `| Time per call, median / p95 | ${ms(J.p50_ms_per_call)} / ${ms(J.p95_ms_per_call)} (covers every metric of the row) | ${lc(() => `${ms(L.p50_ms_per_call)} / ${ms(L.p95_ms_per_call)} (one metric)`)} |`,
      `| Time per row, median | ${ms(J.p50_ms_per_call)} (same single call) | ${lc(() => `${ms(L.p50_ms_per_row_sequential)} (sum of per-metric calls over ${L.rows_sequential_n} rows)`)} |`,
      `| Estimated cost, whole run | ${J.total_usd == null ? `unknown (${usd(J.known_usd)} recorded; ${J.missing_cost_rows} row(s) without cost)` : usd(J.total_usd)} | ${lc(() => L.total_usd == null ? `unknown (${usd(L.known_usd)} recorded; ${L.missing_cost} call(s) without cost)` : usd(L.total_usd))} |`,
      `| Projected cost | ${J.usd_per_1k_rows == null ? "unknown" : `${usd(J.usd_per_1k_rows)} per 1,000 rows`} | ${lc(() => L.usd_per_1k_evals == null ? "unknown" : `${usd(L.usd_per_1k_evals)} per 1,000 metric calls`)} |`, "");
    p("Whole-run totals use different units (Jev per row, LLM judge per metric call), so they are not divided into a ratio; the only ratio is the same-workload one above.", "");
    const pr = v => num(v) ? "$" + v : "unknown";
    if (P.source === "not_recorded") p("Pricing: not recorded for this run (older or replayed run). Unit prices are unknown; the app's current prices are not applied. Row costs above are the ones recorded with the results.", "");
    else p(`Pricing${P.source === "recorded_at_run_start" ? " recorded at run start" : ""} (estimate = recorded tokens × list price, not an invoice): Jev ${pr(P.jev_usd_per_mtok_input)} per 1M input tokens (output free); LLM judge ${pr(P.llm_usd_per_mtok_in)} in / ${pr(P.llm_usd_per_mtok_out)} out per 1M tokens.`, "");

    p("## Agreement with dataset labels", "");
    const o = s.overall || {};
    p("| Metric | Jev ↔ labels | LLM judge ↔ labels | Jev ↔ LLM judge |", "|---|---|---|---|");
    for (const k of METRICS) { const a = s.metrics?.[k] || {}; p(`| ${MN[k]} | ${ag(a.jev_vs_human)} | ${L ? ag(a.llm_vs_human) : "not run"} | ${L ? ag(a.jev_vs_llm) : "not run"} |`); }
    p(`| All metrics | ${ag(o.jev_vs_human)} | ${L ? ag(o.llm_vs_human) : "not run"} | ${L ? ag(o.jev_vs_llm) : "not run"} |`, "");
    p("n counts metric score pairs where both sides have a numeric score; unlabelled, not-applicable and failed scores are left out, not counted as 0.", "");

    p("## Limitations", "",
      "- Labels are the ones in this dataset. For the bundled samples they are synthetic labels written by the dataset author, not an independent human study.",
      "- One run on one dataset. No confidence interval is given; this is not a general performance claim for either judge.",
      "- Costs are estimates from recorded tokens and list prices. Missing cost or time is reported as unknown and excluded from like-for-like figures.",
      "- LLM judge per-row time is a sum of per-metric call times, not measured wall time. Jev time is one call per row.",
      "- Cost and speed say nothing about accuracy; read agreement separately with its own n.", "");
    p("## Full evidence", "",
      "This brief contains no trace text, prompts or keys. For row-level evidence use the app's Export step: Results (JSONL/CSV, every row and metric of this run), Benchmark summary (JSON) and Dataset (JSONL/CSV; note it holds the current dataset, which may include edits made after this run).", "");
    return L_.join("\n");
  }
  const api = { buildBenchBrief, mdCell: cell };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

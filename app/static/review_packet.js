// Disagreement review packet: a pure function over the COMPLETED run (summary.disagreements +
// results + the runRows snapshot frozen at run start). No network, no inference, no key.
// Loaded by the browser (window.buildReviewPacket) and by node tests (module.exports).
"use strict";
(function (root) {
  const METRICS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"];
  const NAMES = { jev_vs_human: ["jev", "human"], jev_vs_llm: ["jev", "llm"] };
  const DISCLOSURE = "This file contains the full trace text (query, response, context, tool definitions) of every row listed, " +
    "exactly as it was sent to the judges. It was built in your browser from the completed run and saved only to your device; " +
    "it was not uploaded or stored on the server and nothing was re-judged. Review it before sharing.";
  const fin = v => typeof v === "number" && isFinite(v);
  const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));

  // returns {ok:true, packet} or {ok:false, reason}
  function buildReviewPacket({ summary, results, runRows, view, metric, generatedAt }) {
    if (!summary || !Array.isArray(results) || !results.length) return { ok: false, reason: "No completed run to export." };
    if (!NAMES[view]) return { ok: false, reason: "Choose Jev vs human or Jev vs LLM judge first." };
    const c = summary.disagreements?.[view]?.[metric];
    if (!c) return { ok: false, reason: "This comparison is not available for this run." };
    if (c.comparable === 0) return { ok: false, reason: "No comparable score pairs for this filter, so there is no disagreement review to export." };
    const th = summary.threshold, other = NAMES[view][1];
    const score = (x, who, m) => who === "llm" ? x?.llm?.[m]?.score : x?.[who]?.[m];
    const snapOk = Array.isArray(runRows) && runRows.length === results.length;
    if (c.items.length && !snapOk) return { ok: false, reason: "The trace snapshot for this run is missing, so the review cannot include the judged traces; export refused." };
    const rows = new Map(), pairs = [];
    for (const it of c.items) {
      const x = results[it.idx];
      // bind strictly by run position; the id must match too, else the item is refused (not guessed)
      if (!x || x.id !== it.id) return { ok: false, reason: `Run data is inconsistent at row ${it.idx + 1}; export refused.` };
      const a = score(x, "jev", it.metric), b = score(x, other, it.metric);
      if (!fin(a) || !fin(b) || a !== it.a || b !== it.b || (a >= th) === (b >= th))
        return { ok: false, reason: `Stored scores no longer match the review at row ${it.idx + 1}; export refused.` };
      const src = runRows[it.idx], bound = !!src && src.id === x.id;
      if (!bound) return { ok: false, reason: `Trace snapshot does not match row ${it.idx + 1}; export refused.` };
      if (!rows.has(it.idx)) {
        rows.set(it.idx, {
          row_index: it.idx, row_number: it.idx + 1, id: x.id,
          trace_status: "frozen snapshot from run start",
          trace: { query: clone(src.query), response: clone(src.response), context: clone(src.context),
            tool_definitions: clone(src.tool_definitions), scenario: src.scenario ?? null,
            generated: !!src.generated, note: src.note ?? null },
        });
      }
      const d = x.jev_detail?.[it.metric] || null, l = x.llm?.[it.metric] || null;
      const snapLabel = src["human_" + it.metric] ?? null, stored = x.human?.[it.metric] ?? null;
      const same = snapLabel === stored || (snapLabel !== null && stored !== null && Number(snapLabel) === Number(stored));
      pairs.push({
        row_index: it.idx, row_number: it.idx + 1, id: x.id, metric: it.metric,
        compared: { jev: { score: a, pass: a >= th }, [other]: { score: b, pass: b >= th } },
        stored_scores: { jev: score(x, "jev", it.metric) ?? null, llm: l?.score ?? null, human: stored },
        jev_detail: d ? { result: d.result ?? null, confidence: d.confidence ?? null, reason: d.reason ?? null, checks: clone(d.checks || []) } : null,
        llm_judge: l ? { score: l.score ?? null, error: l.error ?? null } : null,
        human_label_provenance: {
          source: `human_${it.metric} field of this row in the run snapshot (as entered/uploaded before the run)`,
          value_in_run_snapshot: snapLabel,
          matches_stored_result: same,
        },
      });
    }
    if (pairs.length !== c.disagree || rows.size !== c.rows_disagree)
      return { ok: false, reason: "Listed pairs do not match the review counts; export refused." };
    const packet = {
      kind: "jev-foundry-judge disagreement review", schema_version: 1,
      disclosure: DISCLOSURE,
      generated_at: generatedAt || new Date().toISOString(),
      run: { app_version: summary.version ?? null, completed_at: summary.at ?? null, threshold: th,
        pass_rule: `score >= ${th}`, rows_in_run: results.length, baseline_label: summary.baseline_label ?? null },
      filter: { comparison: view, compared: ["jev", other], metric, metrics_in_scope: metric === "all" ? METRICS : [metric] },
      counts: { comparable_pairs: c.comparable, disagreeing_pairs: c.disagree, rows_with_comparable_pairs: c.rows_comparable,
        rows_with_disagreements: c.rows_disagree, excluded_pairs_by_reason: clone(c.excluded) },
      status: c.disagree === 0 ? "no disagreements for this filter" : "disagreements listed",
      notes: "Scores, checks and labels are copied from the completed run; no new verdicts or annotations are added. " +
        "Pairs where either score is missing, not applicable, errored or non-numeric are excluded and counted above.",
      rows: [...rows.values()],
      pairs,
    };
    return { ok: true, packet };
  }
  const api = { buildReviewPacket, DISCLOSURE };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

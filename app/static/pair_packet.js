// Original vs variant comparison export: a pure projection of buildPairs() over the COMPLETED, FROZEN run
// (results + the runRows snapshot taken at run start). It never re-pairs, re-scores, fetches or reads the
// live dataset (S.rows), so edits made after the run cannot change it. No key, no Foundry link, no globals.
// Loaded by the browser (window.buildPairPacket) and by node tests (module.exports).
"use strict";
(function (root) {
  const bp = root.buildPairs || (typeof require === "function" ? require("./pair_compare.js").buildPairs : null);
  const METRICS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"];
  const DISCLOSURE = "This file contains the full trace text (query, response, context, tool definitions) of every paired row, " +
    "exactly as it was sent to the judges. It was built in your browser from the completed run and saved only to your device; " +
    "it was not uploaded or stored on the server and nothing was re-judged. Review it before sharing.";
  const EVIDENCE = "Variants are contrast cases a user authored (edited copies of another case). They are not observed agent runs, " +
    "so the changes describe how each judge responded to an authored contrast, not how any agent performed. No better/worse verdict is made.";
  const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));

  function side(i, results, runRows) {
    const x = results[i], src = runRows[i], metrics = {};
    if (!x || !src || x.id !== src.id) throw new Error(`row ${i + 1} is not bound to its snapshot row`);
    for (const m of METRICS) {
      const d = x.jev_detail?.[m], l = x.llm?.[m];
      metrics[m] = {
        jev_detail: d ? { result: d.result ?? null, confidence: d.confidence ?? null, reason: d.reason ?? null, checks: clone(d.checks || []) } : null,
        llm_judge: l ? { score: l.score ?? null, result: l.result ?? null, error: l.error ?? null } : null,
        // scores.*.human (from the stored result) is authoritative; this records the label as frozen in the run snapshot
        human_label_in_run_snapshot: src["human_" + m] ?? null,
        human_label_matches_stored_result: (src["human_" + m] ?? null) === (x.human?.[m] ?? null) ||
          (src["human_" + m] != null && x.human?.[m] != null && Number(src["human_" + m]) === Number(x.human[m])),
      };
    }
    return {
      row_index: i, row_number: i + 1, id: x.id,
      error: x.error ?? null,
      provenance: { source: src.source ?? null, derived_from: clone(src.derived_from ?? null), scenario: src.scenario ?? null,
        generated: !!src.generated, note: src.note ?? null },
      trace_status: "frozen snapshot from run start",
      trace: { query: clone(src.query), response: clone(src.response), context: clone(src.context),
        tool_definitions: clone(src.tool_definitions) },
      jev_model: x.jev_meta?.model ?? null,
      metrics,
    };
  }

  // returns {ok:true, packet} or {ok:false, reason}
  function buildPairPacket({ summary, results, runRows, generatedAt }) {
    if (!summary || !Array.isArray(results) || !results.length) return { ok: false, reason: "No completed run to export." };
    const P = bp({ results, runRows });
    if (!P.ok) return { ok: false, reason: P.reason };
    try { return { ok: true, packet: build(P, summary, results, runRows, generatedAt) }; }
    catch (e) { return { ok: false, reason: `Run data is inconsistent (${e.message}); export refused.` }; }
  }
  function build(P, summary, results, runRows, generatedAt) {
    const inPair = new Set(P.pairs.flatMap(p => [p.original_idx, p.variant_idx]));
    const exIdx = new Set(P.excluded.map(e => e.idx));
    const unpaired = results.map((x, i) => i).filter(i => !inPair.has(i)).map(i => ({
      row_index: i, row_number: i + 1, id: results[i].id,
      reason: exIdx.has(i) ? "variant excluded (see excluded)"
        : runRows[i]?.derived_from?.id != null && runRows[i]?.source !== "user-authored" ? "has derived_from but is not marked user-authored, so it is not paired"
        : "not linked to another row of this run by a paired variant's recorded source id",
    }));
    const packet = {
      kind: "jev-foundry-judge original vs variant comparison", schema_version: 1,
      disclosure: DISCLOSURE, evidence_status: EVIDENCE,
      generated_at: generatedAt || new Date().toISOString(),
      run: { app_version: summary.version ?? null, completed_at: summary.at ?? null, rows_in_run: results.length,
        baseline_label: summary.baseline_label ?? null, llm_evaluations: summary.llm?.evaluations ?? null },
      method: {
        pairing: "A row with source 'user-authored' and derived_from.id is paired only with the single row of this run whose id equals derived_from.id. Nothing is inferred from similar ids.",
        delta: "variant − original on the same judge's own scale, rounded to 2 dp; null (unknown) when either score is missing. Missing is never 0.",
        scale: clone(P.scale),
        scores: "Copied from the stored run results. No new evaluation or network call was made to build this file.",
      },
      counts: { pairs: P.pairs.length, excluded_variants: P.excluded.length, rows_not_in_a_pair: unpaired.length,
        comparable_by_metric_and_judge: clone(P.totals) },
      status: P.pairs.length ? "pairs listed" : "no original / variant pairs in this run",
      pairs: P.pairs.map(p => ({
        original_id: p.original_id, variant_id: p.variant_id, nested_variant: p.nested, root_id: p.root_id,
        scores: clone(p.metrics),
        original: side(p.original_idx, results, runRows),
        variant: side(p.variant_idx, results, runRows),
      })),
      excluded: P.excluded.map(e => ({ variant_id: e.variant_id, source_id: e.source_id, row_index: e.idx, row_number: e.idx + 1, reason: e.reason })),
      rows_not_in_a_pair: unpaired,
    };
    return packet;
  }
  const api = { buildPairPacket };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

// Benchmark package: ONE self-contained, versioned JSON bundle of the last COMPLETED run, so a reviewer never pairs
// today's edited dataset with yesterday's scores. Pure: no DOM, no network, no scoring. It only wraps texts that the
// existing exports already produce (evaluated dataset .jsonl, results .jsonl, benchmark summary .json, brief .md),
// byte-for-byte, plus a small manifest. Readiness is delegated to buildEvaluatedDataset (same refusal rules:
// before run / running / partial / misaligned / after Clear). Unknown values stay null ("unknown"), never inferred.
"use strict";
(function (root) {
  const FORMAT = "jev-foundry-judge.benchmark-package";
  const FORMAT_VERSION = 1;
  const u8 = t => new TextEncoder().encode(t).length; // UTF-8 bytes of the stored text
  function buildBenchPackage({ runRows, results, summary, key, resultsText, summaryText, briefText, runConfig, appVersion, exportedAt, build } = {}) {
    const ev = build({ runRows, results, summary, key });
    if (!ev.ok) return ev;
    if (typeof resultsText !== "string" || typeof summaryText !== "string") return { ok: false, reason: "partial" };
    const brief = typeof briefText === "string" ? briefText : null;
    const all = [ev.text, resultsText, summaryText, brief || ""].join("\n");
    if (typeof key === "string" && key.length >= 8 && all.includes(key)) return { ok: false, reason: "key_in_rows" };
    const rc = runConfig && typeof runConfig === "object" ? runConfig : null;
    const errs = results.filter(x => x && x.error).length;
    const manifest = {
      format: FORMAT, format_version: FORMAT_VERSION,
      run: {
        recorded_app_version: summary.version ?? null,
        completed_at: summary.at ?? null,
        scope: summary.scope ?? null,
        rows: runRows.length, results: results.length, rows_with_error: errs,
        ids_in_order: runRows.map(r => (r && "id" in r) ? r.id : null),
        threshold: summary.threshold ?? null,
        baseline_label: summary.baseline_label ?? null,
        wall_s: summary.wall_s ?? null,
        // only what the app recorded when the run started; null = not recorded for this run (e.g. older/replayed run)
        recorded_config: rc,
      },
      export: { app_version: appVersion ?? null, exported_at: exportedAt ?? null },
      components: {
        evaluated_dataset: { file: "evaluated-dataset.jsonl", media_type: "application/x-ndjson", rows: ev.rows, bytes: u8(ev.text), source: "frozen rows sent to the judges at run start (same as 'Download evaluated dataset')" },
        results: { file: "results.jsonl", media_type: "application/x-ndjson", rows: results.length, bytes: u8(resultsText), source: "same text as Export > Results JSONL" },
        summary: { file: "benchmark.json", media_type: "application/json", bytes: u8(summaryText), source: "same text as Export > Benchmark summary JSON" },
        brief: brief == null ? null : { file: "benchmark-brief.md", media_type: "text/markdown", bytes: u8(brief), source: "same text as Export > Benchmark brief" },
      },
      notes: [
        "Contains case text and tool data from the evaluated rows. It is a local file, not an anonymised or public artefact.",
        "No API key, endpoint credential or local path is included. Scores were not recomputed for this export.",
        "Null means unknown or not recorded; nothing was inferred.",
      ],
    };
    const pkg = { manifest, files: { "evaluated-dataset.jsonl": ev.text, "results.jsonl": resultsText, "benchmark.json": summaryText, "benchmark-brief.md": brief } };
    return { ok: true, text: JSON.stringify(pkg, null, 2) + "\n", manifest, rows: ev.rows, version: ev.version, at: ev.at };
  }
  const api = { buildBenchPackage, BENCH_PACKAGE_FORMAT: FORMAT, BENCH_PACKAGE_FORMAT_VERSION: FORMAT_VERSION };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

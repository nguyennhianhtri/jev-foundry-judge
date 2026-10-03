// Handoff review summary (.md), t_656eefbb: a compact first-reviewer note rendering EXACTLY the Inspect handoff outcome
// reading on screen. Pure: it formats an existing inspectHandoffOutcome() result (label_coverage.js) plus the file's
// parsed meta/claimed counts and the existing handoffDiffTargets() left-out tally. It parses nothing, matches nothing
// and decides no reading of its own. Unknown / pending / cannot-compute stay named, never 0. No trace text, notes,
// keys or scores: only typed IDs, metrics, labels, statuses and counts. Markdown cells use bench_brief.js mdCell.
"use strict";
(function (root) {
  const MN = { intent_resolution: "Intent resolution", task_adherence: "Task adherence", tool_call_accuracy: "Tool call accuracy", groundedness: "Groundedness" };
  const ACT = { saved: "saved", skipped: "skipped", not_reached: "not reached" };
  const NOW = { matched: "one case with this exact ID", missing: "missing (no case with this exact ID)", ambiguous: "ambiguous (more than one case with this ID)", invalid: "invalid target in file" };
  const TR = { same: "same as reviewed", changed: "CHANGED since reviewed", not_checkable: "not checkable (no single case)", pending: "still computing", cannot_compute: "cannot compute in this browser" };
  const RD = { consistent: "consistent (label now = their saved label, trace same)", consistent_stale: "equal to the file, but they marked this Save stale", label_differs: "label differs now", trace_changed: "trace changed since, so their Save is about another trace", not_checkable: "cannot check now", pending: "still checking" };

  function buildHandoffSummary({ inspect: r, parsed: p, diff, meta = {} } = {}, deps = {}) {
    const md = deps.mdCell || root.mdCell;
    if (!r || !r.ready || !p || !p.ok || typeof md !== "function") return null;   // only a fully resolved reading is summarised
    const clip = (v, n) => v.length > n ? v.slice(0, n) + "… (cut)" : v;
    const txt = v => v == null || v === "" ? "unknown" : typeof v === "string" ? md(clip(v, 120)) : typeof v === "number" ? md(v) : "unknown (not text)";
    // mdCell escapes table/emphasis/link/html characters; every value here sits mid-line after a fixed prefix.
    const id = v => typeof v === "number" ? `${md(v)} (number)` : typeof v === "string" ? `${md(JSON.stringify(v))} (text)` : `${md(JSON.stringify(v ?? null))} (no usable id)`;
    const lb = x => !x ? "unknown" : x.present ? md(clip(JSON.stringify(x.value) ?? "null", 32)) : "blank";
    const mn = m => MN[m] || (m == null ? "unknown metric" : md(String(m)));
    const m = p.meta || {}, c = p.counts, cc = p.claimed_counts, n = r.now_counts, t = r.trace_counts, rd = r.saved_reading, lv = r.label_vs_claim;
    const L = [], o = (...a) => L.push(...a);
    o("# Handoff review summary (first reviewer's reading)", "");
    o("This note records what this browser read when the other reviewer's handoff outcome file was compared with the current dataset. The file is an unsigned claim with no reviewer identity. Nothing here is proof that any Save happened, and it is not an independent check of their labels. Nothing was applied, copied or uploaded.", "");
    o("## Reviewed file", "",
      `- File: ${txt(meta.file_name)}${Number.isInteger(meta.file_bytes) ? ` (${meta.file_bytes} bytes)` : ""}`,
      `- File SHA-256: ${meta.file_sha256 ? md(meta.file_sha256) : "unknown"}`,
      "- Kind / version: jev-foundry-judge/relabel-handoff-outcome v1 (checked when opened; other files are refused)",
      `- Exported by: app ${txt(m.app_version)} at ${txt(m.generated_at)}${m.checked_at ? ` (their re-check ${md(m.checked_at)})` : ""}`,
      `- Their dataset rows: ${m.dataset_rows == null ? "unknown" : m.dataset_rows}${m.dataset_changed_since_check ? " (they say their dataset changed after their check)" : ""}${m.comparison_file ? ` · from comparison ${md(m.comparison_file)}` : ""}`,
      `- Read here: ${txt(meta.generated_at)} by app ${txt(meta.app_version)} against the current dataset (${Number.isInteger(meta.dataset_rows) ? meta.dataset_rows : "unknown"} rows)`, "");
    o("## Claimed in the file (at their export)", "",
      `- Targets: ${c.targets} case·metric targets on ${c.target_cases} cases (${c.entries_in_file} comparison entries → ${c.eligible_entries} eligible, ${c.duplicate_entries_merged} merged, ${c.not_eligible_entries} not eligible${c.outcomes_dropped_at_recheck ? `, ${c.outcomes_dropped_at_recheck} dropped at their re-check` : ""})`,
      `- Actions: ${cc.outcome.saved_changed} saved, changed · ${cc.outcome.saved_unchanged} saved, unchanged · ${cc.outcome.skipped} skipped · ${cc.outcome.not_reached} not reached (sum ${cc.outcome.saved_changed + cc.outcome.saved_unchanged + cc.outcome.skipped + cc.outcome.not_reached} of ${c.targets})`,
      `- Evidence they exported on Saves: ${cc.evidence.current} current · ${cc.evidence.stale} stale`, "");
    o("## Checked now against the current dataset", "",
      `- Exact typed ID + metric match (the number 7 and the text "7" are different IDs): ${n.matched} matched · ${n.missing} missing · ${n.ambiguous} ambiguous · ${n.invalid} invalid (sum ${n.matched + n.missing + n.ambiguous + n.invalid} of ${r.targets_total})`,
      `- Trace vs the fingerprint they reviewed: ${t.same} same · ${t.changed} changed · ${t.not_checkable} not checkable · ${t.cannot_compute} cannot compute${t.pending ? ` · ${t.pending} still computing` : ""} (sum ${t.same + t.changed + t.not_checkable + t.cannot_compute + t.pending} of ${r.targets_total})`,
      `- Label now vs their saved label (labels only; the trace is not considered here): ${lv.same} same · ${lv.different} different · ${lv.not_checkable} not checkable · ${lv.no_claim} no label claim (skipped / not reached) (sum ${lv.same + lv.different + lv.not_checkable + lv.no_claim} of ${r.targets_total})`, "");
    const sv = r.saved_claims;
    o(`### Reading of the ${sv} claimed Save${sv === 1 ? "" : "s"}`, "",
      `- Consistent: ${rd.consistent}`, `- Equal but marked stale by them: ${rd.consistent_stale}`, `- Label differs now: ${rd.label_differs}`,
      `- Trace changed since: ${rd.trace_changed}`, `- Cannot check: ${rd.not_checkable}`, ...(rd.pending ? [`- Still checking: ${rd.pending}`] : []),
      `- Sum: ${rd.consistent + rd.consistent_stale + rd.label_differs + rd.trace_changed + rd.not_checkable + rd.pending} of ${sv} Saves; the other ${r.targets_total - sv} target${r.targets_total - sv === 1 ? "" : "s"} (skipped / not reached) make no label claim.`, "",
      "\"Consistent\" only means the label and trace here equal what the file says; it does not show that they saved it.", "");
    if (diff && diff.ready) { const x = diff.excluded;
      o(`Review label differences would step through ${diff.list.length} target${diff.list.length === 1 ? "" : "s"}; left out: ${x.consistent + x.consistent_stale} consistent · ${x.trace_changed} trace changed · ${x.not_checkable} cannot check · ${x.no_save_claim} skipped / not reached.`, ""); }
    o("## Per target (file order)", "", "| # | Case ID | Metric | Claimed in file | Checked now: case | Label now | Trace | Reading |", "|---|---|---|---|---|---|---|---|");
    for (const x of r.targets) { const k = x.claimed;
      const cl = `${ACT[k.action] || md(String(k.action))}${k.action === "saved" ? `${k.label_changed ? ", changed" : ", unchanged"} ${lb(k.label_before)} → ${lb(k.label_after)} (evidence ${txt(k.evidence)})` : ""}`;
      const cs = `${NOW[x.status] || md(String(x.status))}${x.idx != null ? `, row ${x.idx + 1}` : ""}${x.reason && x.status !== "matched" ? ` (${md(clip(String(x.reason), 200))})` : ""}`;
      o(`| ${x.pos} | ${id(x.id)} | ${mn(x.metric)} | ${cl} | ${cs} | ${x.status === "matched" ? lb(x.label_now) : "not checkable"} | ${TR[x.trace] || md(String(x.trace))} | ${x.reading ? RD[x.reading] : "no label claim"} |`); }
    o("", "## Not included", "",
      "No trace text, request/answer/tool content, reviewer notes, keys or model scores. Only typed IDs, metrics, labels, statuses and counts. Their labels were not applied: any label shown as \"label now\" is what is stored in this dataset.", "");
    return L.join("\n");
  }
  const api = { buildHandoffSummary };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

// Recorded-run comparison brief (.md), t_3d9f9b07: a compact Markdown rendering of EXACTLY the Compare-with-recorded-run
// view the reviewer is looking at. Pure: it formats an existing buildRunCompare() result and, for the "Recorded score
// decreases"/"increases" order, the existing sign-aware runCompareChanges() projection (both from run_compare.js). It parses nothing,
// matches nothing and computes no score or delta of its own. Missing scores are written "unavailable (<reason>)",
// never 0. No trace text, prompts, labels, notes or keys: only typed IDs, run rows, stored scores and denominators.
// Markdown escaping is the SAME cell escaper the benchmark brief uses (bench_brief.js mdCell), passed in or global.
"use strict";
(function (root) {
  const MN = { intent_resolution: "Intent resolution", task_adherence: "Task adherence", tool_call_accuracy: "Tool call accuracy", groundedness: "Groundedness" };
  const JN = { jev: "Jev", llm: "LLM judge" };
  const ST = { no_result: "no result", row_error: "row failed", not_recorded: "not recorded", not_applicable: "not applicable", no_score: "no score", error: "judge error" };
  const TR = { same: "same input", changed: "input changed", cannot_compare: "input not comparable" };
  const pl = p => `${JN[p.judge] || p.judge}: ${MN[p.metric] || p.metric}`;
  const j0 = k => k.split(":")[0], m0 = k => k.split(":")[1];

  function buildRunCompareBrief({ compare: r, view = {}, meta = {}, decreases } = {}, deps = {}) {
    const md = deps.mdCell || root.mdCell, dec = deps.runCompareDecreases || root.runCompareDecreases;
    const chg = deps.runCompareChanges || root.runCompareChanges || ((r, j, m, o) => o === "dec" && typeof dec === "function" ? dec(r, j, m) : null);
    if (!r || !r.ok || typeof md !== "function") return null;
    const txt = v => v == null || v === "" ? "unknown" : md(Array.isArray(v) ? v.map(x => MN[x] || x).join(", ") || "none" : v);
    const id = v => typeof v === "number" ? `${md(v)} (number)` : `${md(JSON.stringify(String(v)))} (text)`;
    const sc = x => x.state === "score" ? md(x.v) : `unavailable (${ST[x.state] || md(x.state)})`;
    const dl = d => d === null || d === undefined ? "not compared" : d === 0 ? "0" : (d > 0 ? "+" : "-") + Math.abs(d);
    const C = r.counts, nm = C.ambiguous + C.baseline_only + C.current_only + r.noId.baseline.length + r.noId.current.length;
    const ord = r.pairs.length && (view.order === "dec" || view.order === "inc") ? view.order : "dataset";
    const L = [], p = (...a) => L.push(...a);
    p("# Recorded run vs current run: comparison brief", "");
    p(`- Baseline (recorded run, from the opened benchmark package${meta.file_name ? " " + md(meta.file_name) : ""}): app ${txt(r.baseline.app_version)}, completed ${txt(r.baseline.completed_at)}, ${r.baseline.rows} rows`,
      `- Current (completed run in this tab): app ${txt(r.current.app_version)}, completed ${txt(r.current.completed_at)}, ${r.current.rows} rows`,
      `- Brief generated: ${txt(meta.generated_at)} by current app ${txt(meta.app_version)} (export version; may differ from both recorded versions)`, "");

    p("## What was compared", "");
    p(`- Matched by exact typed ID (unique on both sides; the number 7 and the text "7" are different IDs): ${C.matched} (same input ${C.same_trace} · input changed ${C.changed_trace}${C.cannot_compare ? ` · input not comparable ${C.cannot_compare}` : ""})`,
      `- Not matched: ${nm} (ambiguous ${C.ambiguous} · only in recorded ${C.baseline_only} · only in current ${C.current_only} · no ID ${r.noId.baseline.length} recorded / ${r.noId.current.length} current)`,
      `- Judge x metric recorded in both runs: ${r.pairs.length ? r.pairs.map(pl).join("; ") : "none"}`);
    if (r.notCommon.length) p(`- Recorded on one side only, not compared: ${r.notCommon.map(x => `${pl(x)} (${x.only === "baseline" ? "recorded" : "current"} only)`).join("; ")}`);
    p("");

    const diff = r.config.filter(x => !x.same && !x.unknown), unk = r.config.filter(x => x.unknown);
    p("## Differing settings", "");
    if (!diff.length) p("- No recorded setting differs.");
    else p(...diff.map(x => `- ${md(x.label)}: recorded ${txt(x.baseline)} · current ${txt(x.current)}`));
    if (unk.length) p(`- Not recorded on either side (so not known to be the same): ${unk.map(x => md(x.label)).join(", ")}`);
    p("");

    p("## View exported", "");
    let shown = [], cols;
    if (!r.pairs.length) {
      p("No judge and metric was recorded in both runs, so no scores are compared and no cases are listed.", "");
    } else if (ord === "dec" || ord === "inc") {
      const inc = ord === "inc", key = view.dec && r.pairs.some(q => `${q.judge}:${q.metric}` === view.dec) ? view.dec : `${r.pairs[0].judge}:${r.pairs[0].metric}`;
      const given = decreases && decreases.judge === j0(key) && decreases.metric === m0(key) && (decreases.direction || "dec") === ord ? decreases : null;
      const [j, m] = key.split(":"), d = given || (typeof chg === "function" ? chg(r, j, m, ord) : null);
      if (!d || !d.ok) return null;
      const E = d.excluded, w = inc ? "increase" : "decrease";
      p(`- Order: Recorded score ${w}s, largest ${w} first; ties keep current row order`,
        `- Judge and metric: ${pl({ judge: j, metric: m })}`,
        `- Shown: ${d.shown.length} of ${d.eligible} eligible cases have a ${inc ? "higher" : "lower"} recorded score (eligible = matched by exact ID, same input, both stored scores present)`,
        `- Not ${inc ? "higher" : "lower"}: ${inc ? d.not_higher : d.not_lower} (unchanged ${d.unchanged} · ${inc ? "lower" : "higher"} ${d.opposite}) · left out: input changed ${E.changed} · input not comparable ${E.cannot_compare} · a score missing ${E.missing} · not matched by ID ${d.not_matched}`, "");
      cols = ["#", "Case ID", "Run row (recorded → current)", "Baseline (recorded)", "Current", "Delta"];
      shown = d.shown.map((x, i) => [i + 1, id(x.id), `${x.baseline_pos + 1} → ${x.current_pos + 1}`, md(x.baseline), md(x.current), dl(x.delta)]);
    } else {
      const sel = ["same", "changed"].includes(view.trace) ? view.trace : "all";
      const flt = r.matched.filter(m => sel === "all" || m.trace === sel);
      p(`- Order: Current dataset order`,
        `- Show: ${sel === "all" ? `All matched (${C.matched})` : sel === "same" ? `Same input (${C.same_trace})` : `Input changed (${C.changed_trace})`}`,
        `- Shown: ${flt.length} of ${C.matched} matched cases`, "");
      cols = ["#", "Case ID", "Run row (recorded → current)", "Input", ...r.pairs.map(q => `${pl(q)}: baseline → current (delta)`)];
      shown = flt.map((m, i) => [i + 1, id(m.id), `${m.baseline_pos + 1} → ${m.current_pos + 1}`, TR[m.trace],
        ...r.pairs.map(q => { const c = m.cells.find(x => x.judge === q.judge && x.metric === q.metric); return `${sc(c.baseline)} → ${sc(c.current)} (${dl(c.delta)})`; })]);
    }
    if (cols) {
      p(`## Cases shown (${shown.length})`, "");
      if (!shown.length) p(ord !== "dataset" ? `None: no eligible case has a ${ord === "inc" ? "higher" : "lower"} recorded score for this judge and metric.` : "None: no matched cases in this group.", "");
      else p(`| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`, ...shown.map(row => `| ${row.join(" | ")} |`), "");
    }

    p("## Method note", "",
      "- Delta = current minus recorded stored score, exact (no rounding), only when both scores exist. Missing scores are written as unavailable, never 0. No pass/fail threshold is applied.",
      "- Descriptive only: a lower score means the judge scored that case lower this time. These are recorded score decreases, not verified regressions; a higher score means the judge scored it higher this time: a recorded score increase, not a verified improvement or accuracy gain.",
      "- Cases whose input changed, or runs with differing settings, describe different measurements. No overall winner, mean, pooled metric, significance test or cost ratio is given.",
      "- The recorded run comes from an unsigned file checked only for internal consistency. This brief contains no trace text, prompts, labels, notes or keys.", "");
    return L.join("\n");
  }
  const api = { buildRunCompareBrief };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

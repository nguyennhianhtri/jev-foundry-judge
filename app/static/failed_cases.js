// Failed cases of a completed run (t_cfc8f5a5). Pure: no DOM, no network, never mutates results/runCfg.
// A FAILURE is a judge call that did not return a result for a metric that was requested in this run:
//  - Jev (row level): results[i].error is set (the one Jev call that scores every metric of the row failed, e.g.
//    "Jev error 500", "No evaluate() output for this row", "Jev evaluator failed on this row").
//  - Jev (metric level): no row error, the metric was requested, no score AND not marked not_applicable.
//  - Optional Foundry LLM judge: requested at run start and llm[metric].error is set.
// NOT failures (excluded, counted by distinct reason): Jev not_applicable (required inputs missing), LLM judge
// not recorded (off / host cap), LLM judge no score without an error. A LOW score is never a failure; a missing
// score is never 0. Members are run positions + typed ids (7 !== "7"), in run order, for prepareRerun binding.
(function (root) {
  const fin = v => typeof v === "number" && Number.isFinite(v);
  function failedCases({ results, runCfg, metrics } = {}) {   // metrics: optional override (tests); default = the run's recorded metrics
    const res = Array.isArray(results) ? results : [];
    if (!res.length) return { ok: false, reason: "no_run" };
    const ms = Array.isArray(metrics) && metrics.length ? metrics : Array.isArray(runCfg?.metrics) ? runCfg.metrics : [];
    if (!ms.length) return { ok: false, reason: "no_metrics" };
    const llmReq = runCfg?.baseline_requested === true, fnd = runCfg?.foundry_logging_requested === true;
    const members = [], jevWhy = {}, llmWhy = {}, excluded = {};
    const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
    let jevRows = 0, llmRows = 0;
    res.forEach((x, pos) => {
      const reasons = [];
      if (x?.error) { reasons.push({ judge: "jev", metric: null, why: String(x.error) }); bump(jevWhy, String(x.error)); }
      for (const m of ms) {
        if (!x?.error) {
          const v = x?.jev?.[m], na = x?.jev_detail?.[m]?.result === "not_applicable";
          if (na) bump(excluded, "Jev not applicable (required inputs missing)");
          else if (!fin(v)) { const rs = x?.jev_detail?.[m]?.reason; const w = rs ? `Jev returned no score: ${String(rs)}` : "Jev returned no score (no reason recorded)"; reasons.push({ judge: "jev", metric: m, why: w }); bump(jevWhy, w); }
        }
        if (llmReq) {
          const l = x?.llm?.[m];
          if (!x?.llm || l === undefined) bump(excluded, fnd ? "LLM judge error not recorded by the Foundry run path" : "LLM judge not recorded");
          else if (l && l.error) { const w = `LLM judge error: ${l.error}`; reasons.push({ judge: "llm", metric: m, why: w }); bump(llmWhy, w); }
          else if (!fin(l?.score)) bump(excluded, fnd ? "LLM judge no score (Foundry run path records no error field)" : "LLM judge no score (no error recorded)");
        }
      }
      if (!reasons.length) return;
      if (reasons.some(r => r.judge === "jev")) jevRows++;
      if (reasons.some(r => r.judge === "llm")) llmRows++;
      members.push({ pos, id: x?.id, reasons });
    });
    return { ok: true, rows: res.length, members, jev_rows: jevRows, llm_rows: llmRows, jev_reasons: jevWhy, llm_reasons: llmWhy,
      excluded, metrics: ms.slice(), llm_requested: llmReq, llm_errors_unrecorded: llmReq && fnd, ok_rows: res.length - members.length };
  }
  // ---- failed-case stepping (t_5a0f5b6a): the SAME failedCases members in run order as [{pos,id,reasons}] = the list the
  // user opened from. Step via score_dist.js distNavStep (position + typed id; 7 !== "7"). Freshness = same results
  // reference AND the same member list re-derived now (a changed/replaced run or list refuses).
  function failNavList(F) { return F && F.ok ? F.members.map(m => ({ pos: m.pos, id: m.id, reasons: m.reasons })) : []; }
  function failNavKey(L) { return JSON.stringify((L || []).map(m => [m.pos, m.id === undefined ? null : m.id, typeof m.id, m.reasons])); }
  // ---- failure focus (t_c1326574): narrow the SAME failedCases members to one recorded judge and/or metric. Options
  // come ONLY from recorded failure entries (never from the run config). A row is kept once when ANY one of its recorded
  // failure entries matches both the judge (if set) and the metric (if set); ROW = the row-level Jev call (metric null).
  // Returns a failedCases-shaped object (members filtered, run order kept) so the list, stepping, export and prepare
  // share ONE visible scope. Pure: no mutation, no calls, no rescoring.
  const ROW = "__row";
  function failFocusOptions(F, judge) {
    if (!F || !F.ok) return { judges: [], metrics: [] };
    const js = [], ms = [];
    for (const m of F.members) for (const r of m.reasons) {
      if (!js.includes(r.judge)) js.push(r.judge);
      if (judge && r.judge !== judge) continue;
      const k = r.metric == null ? ROW : r.metric; if (!ms.includes(k)) ms.push(k);
    }
    const ord = ["jev", "llm"]; js.sort((a, b) => ord.indexOf(a) - ord.indexOf(b));
    const mo = [ROW, ...(F.metrics || [])]; ms.sort((a, b) => mo.indexOf(a) - mo.indexOf(b));
    return { judges: js, metrics: ms };
  }
  function failFocus(F, { judge = "", metric = "" } = {}) {
    if (!F || !F.ok) return F;
    const hit = r => (!judge || r.judge === judge) && (!metric || (metric === ROW ? r.metric == null : r.metric === metric));
    const all = !judge && !metric;
    const members = all ? F.members : F.members.filter(m => m.reasons.some(hit)).map(m => ({ pos: m.pos, id: m.id, reasons: m.reasons.slice() }));
    return { ...F, members, failed_total: F.members.length, focus: { judge, metric, all } };
  }
  const api = { failedCases, failNavList, failNavKey, failFocus, failFocusOptions, FAIL_ROW: ROW };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

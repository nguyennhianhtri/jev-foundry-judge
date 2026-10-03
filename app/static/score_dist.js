// Jev score distribution for one metric of a COMPLETED run (t_028e8703). Pure: no DOM, no network, never mutates.
// Membership = the run's own results (results[i] <-> runRows[i]); the current dataset/search/selection never enters.
// Only Jev scores are binned (never the LLM judge or human labels). Bins are explicit half-open intervals over the
// raw stored value, compared numerically with no rounding: [1,2) [2,3) [3,4) [4,5]. A score of exactly 2 is in
// [2,3); 1.999 is in [1,2). Non-scores are never zero: they are counted by reason and excluded from the denominator.
(function (root) {
  const BINS = [
    { key: "1-2", lo: 1, hi: 2, hiIncl: false, label: "1 ≤ score < 2" },
    { key: "2-3", lo: 2, hi: 3, hiIncl: false, label: "2 ≤ score < 3" },
    { key: "3-4", lo: 3, hi: 4, hiIncl: false, label: "3 ≤ score < 4" },
    { key: "4-5", lo: 4, hi: 5, hiIncl: true, label: "4 ≤ score ≤ 5" },
  ];
  const isScore = v => typeof v === "number" && Number.isFinite(v);
  const binOf = v => BINS.find(b => v >= b.lo && (b.hiIncl ? v <= b.hi : v < b.hi)) || null;
  // why a row has no Jev score for metric m (same wording family as stats.py disagreement exclusions)
  function reasonOf(x, m, inRun) {
    if (!inRun) return "metric not in this run";
    if (x && x.error) return "row error";
    const d = x && x.jev_detail && x.jev_detail[m];
    if (d && d.result === "not_applicable") return "not applicable";
    return "no score recorded";
  }
  // metrics: the run's recorded metrics (runCfg.metrics) or null (older run: any metric with a Jev key present)
  function scoreDist(results, metric, opt = {}) {
    const R = Array.isArray(results) ? results : [];
    const runMetrics = Array.isArray(opt.metrics) ? opt.metrics : null;
    const inRun = runMetrics ? runMetrics.includes(metric) : R.some(x => x && x.jev && Object.hasOwn(x.jev, metric));
    const th = isScore(opt.threshold) ? opt.threshold : null;
    const bins = BINS.map(b => ({ ...b, n: 0, items: [] }));
    const excluded = {}, excludedItems = [], outOfRange = [];
    let scored = 0, below = 0, sum = 0;
    R.forEach((x, pos) => {
      const v = x && x.jev ? x.jev[metric] : undefined;
      const item = { pos, id: x ? x.id : undefined, score: isScore(v) ? v : null };
      if (!isScore(v) || !inRun) { const r = reasonOf(x, metric, inRun); excluded[r] = (excluded[r] || 0) + 1; excludedItems.push({ ...item, reason: r }); return; }
      const b = binOf(v);
      if (!b) { outOfRange.push(item); excluded["outside 1–5"] = (excluded["outside 1–5"] || 0) + 1; excludedItems.push({ ...item, reason: "outside 1–5" }); return; }
      const t = bins[BINS.indexOf(b)]; t.n++; t.items.push(item);
      scored++; sum += v; if (th != null && v < th) below++;
    });
    return {
      metric, in_run: inRun, rows: R.length, scored, excluded, excluded_n: R.length - scored, excluded_items: excludedItems,
      mean: scored ? sum / scored : null, threshold: th, below_threshold: th == null ? null : below, bins,
    };
  }
  // default: the run metric with the most scored cases below the threshold; ties -> lowest mean, then canonical order.
  function defaultMetric(results, metrics, threshold) {
    const ms = (metrics || []).map(m => ({ m, d: scoreDist(results, m, { metrics, threshold }) })).filter(o => o.d.scored > 0);
    if (!ms.length) return (metrics || [])[0] ?? null;
    ms.sort((a, b) => (b.d.below_threshold ?? 0) - (a.d.below_threshold ?? 0) || a.d.mean - b.d.mean);
    return ms[0].m;
  }
  // re-bind a listed case to the run at click time: same results array identity, same position, same typed id
  function resolveDistCase(results, runRows, pos, id) {
    const x = Array.isArray(results) ? results[pos] : null, src = Array.isArray(runRows) ? runRows[pos] : null;
    if (!x || !src || JSON.stringify(x.id) !== JSON.stringify(id) || JSON.stringify(src.id) !== JSON.stringify(id)) return { ok: false };
    return { ok: true, pos };
  }
  // ---- paired comparison (t_10def3c9): Jev vs ONE stored comparator on the SAME completed run. Only metric/case pairs
  // where BOTH judges have a valid 1–5 score count; everything else is excluded by reason (never imputed, never 0).
  // comparator "human" = the run's frozen human label x.human[m]; "llm" = the stored Foundry built-in judge x.llm[m].score.
  const CMP = { human: "Human label", llm: "Foundry LLM judge" };
  const inRange = v => isScore(v) && v >= 1 && v <= 5;
  function cmpScore(x, c, m) { return c === "human" ? (x && x.human ? x.human[m] : undefined) : (x && x.llm && x.llm[m] ? x.llm[m].score : undefined); }
  function cmpReason(x, c, m, v) {
    if (c === "human") return v === undefined || v === null || v === "" ? "no human label" : "human label not a 1–5 number";
    const o = x && x.llm ? x.llm[m] : undefined;
    if (!x || !x.llm) return "LLM judge not run for this row";
    if (!o) return "LLM judge not run for this metric";
    if (o.error) return "LLM judge error";
    if (o.result === "not_applicable") return "LLM judge: not applicable";
    return isScore(v) ? "LLM judge score outside 1–5" : "no LLM judge score recorded";
  }
  // availability: the comparator exists in THIS run for this metric iff at least one row has a valid comparator score.
  function cmpAvailable(results, c, m) { return (Array.isArray(results) ? results : []).some(x => inRange(cmpScore(x, c, m))); }
  function pairedDist(results, metric, comparator, opt = {}) {
    const R = Array.isArray(results) ? results : [];
    const runMetrics = Array.isArray(opt.metrics) ? opt.metrics : null;
    const inRun = runMetrics ? runMetrics.includes(metric) : R.some(x => x && x.jev && Object.hasOwn(x.jev, metric));
    const available = Object.hasOwn(CMP, comparator) && inRun && cmpAvailable(R, comparator, metric);
    const jevB = BINS.map(b => ({ ...b, n: 0 })), cmpB = BINS.map(b => ({ ...b, n: 0 }));
    const pairs = [], excluded = {}, excludedItems = [];
    const ex = (r, item) => { excluded[r] = (excluded[r] || 0) + 1; excludedItems.push({ ...item, reason: r }); };
    R.forEach((x, pos) => {
      const j = x && x.jev ? x.jev[metric] : undefined, c = cmpScore(x, comparator, metric);
      const item = { pos, id: x ? x.id : undefined, jev: isScore(j) ? j : null, cmp: isScore(c) ? c : null };
      if (!inRun || !isScore(j)) return ex("Jev: " + reasonOf(x, metric, inRun), item);
      if (!binOf(j)) return ex("Jev: outside 1–5", item);
      const lo = comparator === "llm" && x && x.llm ? x.llm[metric] : null;
      if (lo && (lo.error || lo.result === "not_applicable")) return ex(lo.error ? "LLM judge error" : "LLM judge: not applicable", item);
      if (!inRange(c)) return ex(cmpReason(x, comparator, metric, c), item);
      const jb = binOf(j).key, cb = binOf(c).key;
      jevB[BINS.findIndex(b => b.key === jb)].n++; cmpB[BINS.findIndex(b => b.key === cb)].n++;
      pairs.push({ ...item, jevBin: jb, cmpBin: cb });
    });
    const all = scoreDist(R, metric, opt);
    return { metric, comparator, comparator_label: CMP[comparator] || null, in_run: inRun, available, rows: R.length,
      paired: pairs.length, jev_scored_all: all.scored, pairs, jev_bins: jevB, cmp_bins: cmpB, excluded,
      excluded_n: R.length - pairs.length, excluded_items: excludedItems };
  }
  // cases for one bin: every paired case whose Jev OR comparator score falls in it (flags say which), in run order
  function pairedBinCases(pd, key) { return pd.pairs.filter(p => p.jevBin === key || p.cmpBin === key).map(p => ({ ...p, jevIn: p.jevBin === key, cmpIn: p.cmpBin === key })); }
  // ---- paired points (t_c1201840): the SAME pd.pairs, one point per exact (Jev, comparator) coordinate. Cases with
  // identical stored coordinates are grouped (count + every member, run order); nothing is jittered or rounded.
  // diff = comparator − Jev on the shared 1–5 scale (distinct measurements, not calibrated truth).
  // Sorted by |diff| desc, then first run position, so the pairs driving disagreement come first.
  function pairPoints(pd) {
    const G = new Map();
    for (const p of (pd && pd.pairs) || []) {
      const k = JSON.stringify([p.jev, p.cmp]);
      if (!G.has(k)) G.set(k, { key: k, jev: p.jev, cmp: p.cmp, diff: p.cmp - p.jev, items: [] });
      G.get(k).items.push(p);
    }
    const pts = [...G.values()].map(g => ({ ...g, n: g.items.length, first: g.items[0].pos, sameBin: g.items[0].jevBin === g.items[0].cmpBin }));
    pts.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.first - b.first);
    const on = pts.filter(g => g.diff === 0).reduce((s, g) => s + g.n, 0);
    const above = pts.filter(g => g.diff > 0).reduce((s, g) => s + g.n, 0), below = pts.filter(g => g.diff < 0).reduce((s, g) => s + g.n, 0);
    const otherBin = pts.filter(g => !g.sameBin).reduce((s, g) => s + g.n, 0);
    return { points: pts, paired: (pd && pd.paired) || 0, equal: on, cmp_higher: above, cmp_lower: below, other_bin: otherBin,
      max_abs_diff: pts.length ? Math.abs(pts[0].diff) : null };
  }
  // ---- compared-case stepping (t_ad616649): the EXACT list the user opened from — pairedBinCases(pd, key) for the Bins
  // view, or the selected pairPoints group's members for Score pairs — as [{pos,id}] in that list's own order.
  function distNavList(pd, view, key) {
    if (!pd || !pd.available) return [];
    const L = view === "pairs" ? ((pairPoints(pd).points.find(g => g.key === key) || {}).items || []) : pairedBinCases(pd, key);
    return L.map(p => ({ pos: p.pos, id: p.id }));
  }
  // step from the member at run position `pos` with typed id `id` by dir (+1/-1). The current case must be in the list
  // by BOTH position and typed id (7 and "7" differ; a repeated id at another position is another member).
  function distNavStep(L, pos, id, dir) {
    const i = (L || []).findIndex(e => e.pos === pos && JSON.stringify(e.id) === JSON.stringify(id));
    if (i < 0) return { ok: false, edge: null };
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0) return { ok: false, edge: "first" };
    if (j >= L.length) return { ok: false, edge: "last" };
    return { ok: true, i: j, n: L.length, pos: L[j].pos, id: L[j].id };
  }
  const api = { distNavList, distNavStep, SCORE_BINS: BINS, scoreDist, defaultMetric, resolveDistCase, binOf, COMPARATORS: CMP, pairedDist, pairedBinCases, cmpAvailable, pairPoints };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

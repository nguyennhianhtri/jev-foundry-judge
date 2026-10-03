// Searched-run export (t_aaeefd58): the exact cases shown by "Search this run" (visible, ordered search+view
// projection = case_find.js runMatchList entries {pos, id, open}) as a .jsonl evaluation dataset for a focused
// follow-up. Pure: no DOM, no network, no mutation. Entries whose frozen trace cannot bind to their result (open ===
// false, or run row / result id differ by type or value) are EXCLUDED and reported, never substituted; the rest go
// through case_list_export.js (position + typed id bind, evaluated-dataset serializer: byte-identical frozen rows,
// shown order, no scores, key refusal). Anything else refuses the whole file.
(function (root) {
  const same = (a, b) => typeof a === typeof b && JSON.stringify(a) === JSON.stringify(b);
  function planRunFindExport({ runRows, results, list } = {}) {
    const rr = Array.isArray(runRows) ? runRows : [], res = Array.isArray(results) ? results : [], L = Array.isArray(list) ? list : [];
    const include = [], excluded = [];
    for (const e of L) {
      const p = e && e.pos, ok = Number.isInteger(p) && p >= 0 && p < res.length && e.open !== false && !!rr[p] && !!res[p]
        && same(rr[p].id, e.id) && same(res[p].id, e.id);
      (ok ? include : excluded).push({ pos: p, id: e ? e.id : undefined });
    }
    return { shown: L.length, include, excluded };
  }
  function buildRunFindExport({ runRows, results, summary, key, list, build, buildList } = {}) {
    const plan = planRunFindExport({ runRows, results, list });
    if (!plan.shown) return { ok: false, reason: "empty", plan };
    if (!plan.include.length) return { ok: false, reason: "none_bound", plan };
    const mk = buildList || root.buildCaseListExport;
    const r = mk({ runRows, results, summary, key, list: plan.include, build });
    return r.ok ? { ...r, ok: true, shown: plan.shown, excluded: plan.excluded, plan } : { ok: false, reason: r.reason, plan };
  }
  // t_d1c0abe0: prepare exactly the shown, bound matches for another run IN PLACE. Members = the SAME plan.include
  // (shown order, position + typed id) fed to the SAME slow_prepare.js prepareRerun binding; nothing new is matched.
  // Unbound matches stay excluded and reported; a run that is not complete refuses; prepareRerun's refusals stand.
  function prepareRunFind({ runRows, results, summary, list, runPos, rows, selected, prepare } = {}) {
    const plan = planRunFindExport({ runRows, results, list });
    const pr = prepare || root.prepareRerun;
    const r0 = pr({ members: null, runRows, runPos, rows, selected });
    if (!plan.shown) return { ...r0, ok: false, reason: "empty", problems: [], plan };
    if (!summary || !Array.isArray(results) || !Array.isArray(runRows) || results.length !== runRows.length) return { ...r0, ok: false, reason: "partial", problems: [], plan };
    if (!plan.include.length) return { ...r0, ok: false, reason: "none_bound", problems: [], plan };
    return { ...pr({ members: plan.include, runRows, runPos, rows, selected }), plan };
  }
  const api = { planRunFindExport, buildRunFindExport, prepareRunFind };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

// Prepare the slow cases (slow_cases.js members) for another run IN PLACE (t_7d8754cd). Pure: no DOM, no network,
// never mutates input. It only proposes a new value for the EXISTING Dataset selection (S.selected), which the
// existing "Selected cases only" Run scope already uses; no second dataset or result store.
// Binding: each member is the frozen run row runRows[pos]. It maps to a CURRENT dataset position only when
//  1. runPos (dataset positions recorded at run start) says where it came from and that row is still byte-identical
//     (canonical JSON, keys sorted: input, trace, labels, provenance, typed id; 7 !== "7"), or
//  2. otherwise, exactly ONE current row is byte-identical to it (a stable re-location after rows moved).
// Anything else (row edited/relabelled/removed, dataset replaced, several identical rows, two members on one row)
// refuses the WHOLE preparation with reasons; the caller keeps the current selection. Scores are never read here.
(function (root) {
  // canonical form: object keys sorted, array order and value types kept (7 !== "7", null !== absent)
  const canon = v => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(y => [y, x[y]])) : x);
  const idTxt = v => typeof v === "string" ? JSON.stringify(v) : v === undefined ? "(no id)" : JSON.stringify(v);
  function prepareSlowRerun({ sc, runRows, runPos, rows, selected } = {}) {
    return prepareRerun({ members: sc?.ok ? sc.members : null, runRows, runPos, rows, selected });
  }
  // Generalized (t_0e0d57f4): any shown member list [{pos, id}] of the completed run (slow cases, disagreement cases)
  // binds through the SAME rules. A member whose shown id differs from the frozen row at pos is refused, never re-bound.
  function prepareRerun({ members, runRows, runPos, rows, selected } = {}) {
    const list = Array.isArray(rows) ? rows : [], rr = Array.isArray(runRows) ? runRows : [];
    const before = [...(selected || [])].filter(i => Number.isInteger(i) && i >= 0 && i < list.length).sort((a, b) => a - b);
    const base = { before: { n: before.length, positions: before, ids: before.map(i => list[i]?.id) } };
    if (!Array.isArray(members) || !members.length) return { ...base, ok: false, reason: "empty", problems: [] };
    if (!list.length) return { ...base, ok: false, reason: "no_dataset", problems: [] };
    const sigs = list.map(canon);
    const problems = [], mapped = [];
    for (const e of members) {
      const f = Number.isInteger(e?.pos) ? rr[e.pos] : undefined, label = `${idTxt(f?.id ?? e?.id)} (run row ${Number.isInteger(e?.pos) ? e.pos + 1 : "?"})`;
      if (f === undefined) { problems.push({ pos: e?.pos, id: e?.id, label, why: "the frozen run row is missing" }); continue; }
      if (e && "id" in e && JSON.stringify(e.id ?? null) !== JSON.stringify(f.id ?? null)) { problems.push({ pos: e.pos, id: e.id, label, why: "the case shown no longer matches the frozen run row at that position" }); continue; }
      const sig = canon(f);
      const rp = Array.isArray(runPos) && runPos.length === rr.length ? runPos[e.pos] : undefined;
      if (Number.isInteger(rp) && sigs[rp] === sig) {
        mapped.push({ pos: e.pos, id: f.id, at: rp, via: "run position" }); continue;
      }
      const hits = []; sigs.forEach((s, i) => { if (s === sig) hits.push(i); });
      if (hits.length === 1) { mapped.push({ pos: e.pos, id: f.id, at: hits[0], via: "unique identical row" }); continue; }
      const sameId = list.filter(r => r && typeof r === "object" && JSON.stringify(r.id) === JSON.stringify(f.id)).length;
      problems.push({ pos: e.pos, id: f.id, label, why: hits.length > 1
        ? `${hits.length} identical rows in the dataset match it, so which one to select is ambiguous`
        : sameId ? "its input, trace or labels changed since the run (a row with the same ID is no longer identical)"
        : "it is no longer in the dataset" });
    }
    const seen = new Map(); for (const m of mapped) { if (seen.has(m.at)) problems.push({ pos: m.pos, id: m.id, label: `${idTxt(m.id)} (run row ${m.pos + 1})`, why: "two cases map to the same dataset row" }); seen.set(m.at, m); }
    if (problems.length) return { ...base, ok: false, reason: "unmappable", problems, mapped_n: mapped.length };
    const after = mapped.map(m => m.at).sort((a, b) => a - b);
    const kept = after.filter(i => before.includes(i)).length;
    return { ...base, ok: true, reason: null, problems: [], mapped, after: { n: after.length, positions: after, ids: after.map(i => list[i].id) },
      added: after.length - kept, removed: before.length - kept, unchanged: kept, same: kept === after.length && kept === before.length, total: list.length };
  }
  const api = { prepareSlowRerun, prepareRerun };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

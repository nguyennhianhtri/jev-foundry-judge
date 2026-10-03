// Compared-case list export (t_fb8d75e1): the exact cases of ONE opened paired list (Bins bin or Score-pairs group)
// as JSONL, for a focused later run. Pure: no DOM, no network, no mutation. Reuses the evaluated-dataset gate and
// serializer (buildEvaluatedDataset: completed run, results aligned 1:1 with frozen S.runRows, key refusal), then keeps
// only the listed members in the SHOWN order, each bound by run position AND typed id (7 ≠ "7"). Every line is the
// byte-identical serialization of that frozen row (original trace, labels, provenance, unknown fields), never the
// working dataset and never a score written into a label. Anything that does not bind exactly refuses the whole file.
(function (root) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function buildCaseListExport({ runRows, results, summary, key, list, build } = {}) {
    const L = Array.isArray(list) ? list : [];
    if (!L.length) return { ok: false, reason: "empty" };
    const mk = build || root.buildEvaluatedDataset;
    const e = mk({ runRows, results, summary, key });
    if (!e.ok) return { ok: false, reason: e.reason };
    const lines = e.text.split("\n"); lines.pop(); // one frozen row per line, run order (same bytes as the full export)
    const seen = new Set(), out = [];
    for (const m of L) {
      const p = m && m.pos;
      if (!Number.isInteger(p) || p < 0 || p >= runRows.length || seen.has(p)) return { ok: false, reason: "stale" };
      if (!same(runRows[p]?.id, m.id) || !same(results[p]?.id, m.id)) return { ok: false, reason: "stale" };
      seen.add(p); out.push(lines[p]);
    }
    return { ok: true, text: out.join("\n") + "\n", n: out.length, total: runRows.length, ids: L.map(m => m.id), positions: L.map(m => m.pos),
      version: e.version, at: e.at };
  }
  const api = { buildCaseListExport };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

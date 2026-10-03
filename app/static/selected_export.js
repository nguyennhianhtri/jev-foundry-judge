// Export only the explicitly selected dataset cases (t_39302f7d). Pure: no DOM, no network, never mutates input.
// rows = S.rows (working dataset), selected = S.selected (row positions ticked by the user), shown = positions the
// view-only search currently shows (or null when no search is active). Output rows are the SAME objects serialized
// with the SAME serializer as the whole-dataset export (one JSON.stringify per line), in dataset order, so typed ids,
// traces, labels, provenance and unknown fields are kept byte-for-byte and nothing is normalized or repaired.
// Hidden-by-search rows are exported only when the user ticked them; the counts say so, so nothing is silent.
(function (root) {
  function selectionSummary({ rows, selected, shown } = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const pos = [...(selected || [])].filter(i => Number.isInteger(i) && i >= 0 && i < list.length).sort((a, b) => a - b);
    const vis = Array.isArray(shown) ? new Set(shown) : null;
    const hidden = vis ? pos.filter(i => !vis.has(i)) : [];
    return { total: list.length, shown: vis ? vis.size : list.length, search: !!vis, n: pos.length, positions: pos, hidden_selected: hidden.length };
  }
  function buildSelectedExport(args = {}) {
    const s = selectionSummary(args);
    if (!s.total) return { ok: false, reason: "no_rows", ...s };
    if (!s.n) return { ok: false, reason: "none_selected", ...s };
    const picked = s.positions.map(i => args.rows[i]);
    const text = picked.map(x => JSON.stringify(x)).join("\n") + "\n";
    const key = args.key;
    if (typeof key === "string" && key.length >= 8 && text.includes(key)) return { ok: false, reason: "key_in_rows", ...s };
    return { ok: true, text, rows: picked, ids: picked.map(r => r?.id), ...s };
  }
  const api = { selectionSummary, buildSelectedExport };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

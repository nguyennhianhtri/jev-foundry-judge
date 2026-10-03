// Run scope: which dataset rows pressing Run will send (t_7936c995). Pure: no DOM, no network, never mutates input.
// mode "all" (the DEFAULT, and anything that is not exactly "selected") = every row of the full dataset, in order,
// search ignored: exactly what Run always sent. mode "selected" = only the ticked positions (S.selected, the SAME
// selection the Dataset step's Export selected uses, via selectionSummary), in dataset order. Selected with nothing
// ticked is REFUSED (ok:false) and never falls back to all rows. Rows returned are the same objects; the caller
// freezes them with structuredClone at run start.
(function (root) {
  const summ = root.selectionSummary || (typeof require === "function" ? require("./selected_export.js").selectionSummary : null);
  function runRowsFor({ rows, selected, shown, mode } = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const s = summ({ rows: list, selected, shown });
    const sel = mode === "selected";
    const base = { mode: sel ? "selected" : "all", total: s.total, shown: s.shown, search: s.search, selected_n: s.n, hidden_selected: s.hidden_selected };
    if (!list.length) return { ...base, ok: false, reason: "no_rows", rows: [], positions: [], ids: [], n: 0 };
    if (!sel) { const positions = list.map((_, i) => i); return { ...base, ok: true, reason: null, rows: list.slice(), positions, ids: list.map(r => r?.id), n: list.length }; }
    if (!s.n) return { ...base, ok: false, reason: "none_selected", rows: [], positions: [], ids: [], n: 0 };
    const picked = s.positions.map(i => list[i]);
    return { ...base, ok: true, reason: null, rows: picked, positions: s.positions.slice(), ids: picked.map(r => r?.id), n: picked.length };
  }
  const api = { runRowsFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

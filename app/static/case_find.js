// Dataset case search (view-only). Pure: no DOM, no network, never mutates its input.
// items: [{ id, req, ans }] in dataset order (req/ans = the displayed user request / final answer text).
// Query is split on whitespace; every term must appear (case-insensitive) in id, request or answer.
// Keys, labels and other fields are never searched. Returns the matching positions in the original order.
(function (root) {
  const norm = s => String(s ?? "").toLocaleLowerCase();
  function findCases(items, query) {
    const list = Array.isArray(items) ? items : [], total = list.length;
    const terms = norm(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return { active: false, total, shown: list.map((_, i) => i) };
    const shown = [];
    list.forEach((x, i) => {
      const hay = [x?.id, x?.req, x?.ans].map(norm).join("\u0000");
      if (terms.every(t => hay.includes(t))) shown.push(i);
    });
    return { active: true, total, shown, terms };
  }
  // Frozen-run search (t_d45415fb). results[i] pairs with runRows[i] by POSITION; request/answer come from the frozen
  // run row only when it is bound to that result (same typed id), so 7 and "7" never borrow each other's text.
  // Literal, case-insensitive substring of the whole trimmed query (no term splitting, no regex, no network).
  function findRunCases(results, runRows, query, textOf) {
    const res = Array.isArray(results) ? results : [], rr = Array.isArray(runRows) ? runRows : [], total = res.length;
    const raw = String(query ?? "").trim(), q = norm(raw);
    if (!q) return { active: false, total, shown: res.map((_, i) => i), query: "" };
    const shown = [];
    res.forEach((x, i) => {
      const src = rr[i], bound = !!src && !!x && src.id === x.id;
      const t = bound && textOf ? textOf(src) : { req: "", ans: "" };
      const id = x?.id === undefined || x?.id === null ? "" : typeof x.id === "string" ? x.id : JSON.stringify(x.id);
      if ([id, t.req, t.ans].some(v => norm(v).includes(q))) shown.push(i);
    });
    return { active: true, total, shown, query: raw };
  }
  // t_eae08a5f: rows whose frozen trace cannot bind to their result (missing run row or different typed id). Their
  // request/answer text is NOT searchable (only the recorded ID is), so a no-match must never claim to be exhaustive.
  function unboundRunRows(results, runRows) {
    const res = Array.isArray(results) ? results : [], rr = Array.isArray(runRows) ? runRows : [];
    return res.map((x, i) => (!rr[i] || !x || rr[i].id !== x.id) ? i : -1).filter(i => i >= 0);
  }
  // Match navigation list = exactly the visible, ordered rows of the search+view projection (positions + typed ids).
  // canOpen(pos, id) -> false marks a visible match that the inspector cannot open (no bound frozen trace); stepping skips it.
  function runMatchList(results, visiblePositions, canOpen) {
    const res = Array.isArray(results) ? results : [];
    return (visiblePositions || []).filter(p => Number.isInteger(p) && p >= 0 && p < res.length).map(pos => {
      const e = { pos, id: res[pos]?.id }; if (canOpen && !canOpen(pos, e.id)) e.open = false; return e; });
  }
  const runMatchKey = L => JSON.stringify((L || []).map(e => [e.pos, typeof e.id, e.id === undefined ? null : e.id, e.open !== false]));
  function runMatchStep(L, pos, id, dir) {
    const list = L || [], i = list.findIndex(e => e.pos === pos && typeof e.id === typeof id && JSON.stringify(e.id) === JSON.stringify(id));
    if (i < 0) return { ok: false, i: -1, n: list.length, edge: null };
    if (!dir) return { ok: false, i, n: list.length, edge: null };
    let j = i + (dir < 0 ? -1 : 1), skipped = 0;
    while (j >= 0 && j < list.length && list[j].open === false) { j += dir < 0 ? -1 : 1; skipped++; }
    if (j < 0) return { ok: false, i, n: list.length, edge: "first", skipped };
    if (j >= list.length) return { ok: false, i, n: list.length, edge: "last", skipped };
    return { ok: true, i: j, n: list.length, pos: list[j].pos, id: list[j].id, skipped };
  }
  const api = { findCases, findRunCases, unboundRunRows, runMatchList, runMatchKey, runMatchStep };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

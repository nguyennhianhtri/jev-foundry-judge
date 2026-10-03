// Evaluated dataset export: the exact rows frozen at run start (S.runRows), never the working dataset.
// Pure: no DOM, no network. One JSON object per line in run order, byte-for-byte JSON.stringify of each frozen
// row (typed ids, unknown fields, labels and provenance as they were when the run started), so the file
// re-imports through the existing Upload path. Ready only for a completed run whose results align 1:1 by position.
(function (root) {
  function buildEvaluatedDataset({ runRows, results, summary, key } = {}) {
    const rr = Array.isArray(runRows) ? runRows : [], res = Array.isArray(results) ? results : [];
    if (!rr.length) return { ok: false, reason: "no_run" };
    if (!summary) return { ok: false, reason: res.length ? "partial" : "running_or_none" };
    if (res.length !== rr.length) return { ok: false, reason: "partial" };
    for (let i = 0; i < rr.length; i++) {
      if (!res[i] || String(res[i].id) !== String(rr[i]?.id)) return { ok: false, reason: "misaligned", at: i };
    }
    const text = rr.map(x => JSON.stringify(x)).join("\n") + "\n";
    if (typeof key === "string" && key.length >= 8 && text.includes(key)) return { ok: false, reason: "key_in_rows" };
    return { ok: true, text, rows: rr.length, version: summary.version ?? null, at: summary.at ?? null };
  }
  const api = { buildEvaluatedDataset };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

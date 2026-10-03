// Open a benchmark package (.json, format v1 written by bench_package.js) for READ-ONLY offline review.
// Pure: no DOM, no network, no storage, no scoring. It validates the file against its own manifest (kind, version,
// size, shape, byte counts, row counts, ids in order, row membership) BEFORE anything is rendered, then rebuilds the
// fields the same-workload comparison needs from the contained Results JSONL and re-derives the brief with the SAME
// buildBenchCompare/buildBenchBrief projections, priced ONLY from the config recorded in the file (never the app's
// current config). The re-derived brief is compared byte-for-byte with the brief stored in the file:
//   reproduced = the panel below is exactly what produced the stored brief; otherwise only stored texts are trusted.
// Nothing here is proof of a live run: it is unverified file evidence (no signature).
"use strict";
(function (root) {
  const FORMAT = "jev-foundry-judge.benchmark-package", VERSION = 1, MAX_BYTES = 8000000, MAX_ROWS = 5000;
  const METRICS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"];
  const FILES = ["evaluated-dataset.jsonl", "results.jsonl", "benchmark.json", "benchmark-brief.md"];
  const u8 = t => new TextEncoder().encode(t).length;
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const num = v => typeof v === "number" && Number.isFinite(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const idOk = v => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
  const same = (a, b) => typeof a === typeof b && a === b;              // typed id equality: 7 ≠ "7"
  const fail = error => ({ ok: false, error });
  function lines(t, what) {
    if (t === "") return { rows: [] };
    if (!t.endsWith("\n")) return { error: `${what} does not end with a newline` };
    const out = [], L = t.slice(0, -1).split("\n");
    for (let i = 0; i < L.length; i++) {
      let o; try { o = JSON.parse(L[i]); } catch { return { error: `${what} line ${i + 1} is not JSON` }; }
      if (!isObj(o)) return { error: `${what} line ${i + 1} is not an object` };
      out.push(o);
    }
    return { rows: out };
  }
  // Rebuild the raw result shape used by buildBenchCompare from one flat Results JSONL row (app.js flatResults()).
  // JSON.stringify drops undefined keys, so key PRESENCE carries what was recorded: jev_* meta keys only when Jev
  // answered, llm_<m> only when the LLM judge produced an entry for that metric. A null score with no recorded time
  // or cost is read as "not applicable (no call)"; the brief check below confirms or rejects every such reading.
  function rawFromFlat(f) {
    const r = { id: f.id, human: {} };
    for (const m of METRICS) r.human[m] = has(f, `human_${m}`) ? f[`human_${m}`] : undefined;
    const meta = ["jev_latency_ms", "jev_input_tokens", "jev_usd", "jev_model"].some(k => has(f, k));
    if (!meta) r.error = "Jev result not recorded in this file";
    else {
      r.jev_meta = { latency_ms: f.jev_latency_ms ?? null, input_tokens: f.jev_input_tokens ?? null, usd: f.jev_usd ?? null, model: f.jev_model ?? null };
      r.jev = {}; r.jev_detail = {};
      for (const m of METRICS) {
        if (!has(f, `jev_${m}`)) continue;
        const s = f[`jev_${m}`];
        r.jev[m] = s;
        r.jev_detail[m] = { result: num(s) ? null : "not_applicable", confidence: f[`jev_${m}_confidence`] ?? null, reason: f[`jev_${m}_reason`] ?? null };
      }
    }
    const llm = {};
    for (const m of METRICS) {
      if (!has(f, `llm_${m}`)) continue;
      const s = f[`llm_${m}`], lat = f[`llm_${m}_latency_ms`], usd = f[`llm_${m}_usd`];
      // The flat export drops the LLM "result" field. A null score with no recorded cost, or a recorded cost of
      // exactly 0 (the host's no-call shortcut), is read as not applicable; anything else keeps its recorded values.
      // A failed LLM call is indistinguishable here, which is why the stored-brief check below exists.
      llm[m] = (!num(s) && !(num(usd) && usd > 0)) ? { score: null, result: "not_applicable" } : { score: s, latency_ms: lat ?? null, usd: usd ?? null };
    }
    if (Object.keys(llm).length) r.llm = llm;
    return r;
  }
  function openBenchPackage(text, { buildBenchCompare, runPricing, buildBenchBrief } = {}) {
    if (typeof text !== "string") return fail("the file could not be read as text");
    if (text.length > MAX_BYTES || u8(text) > MAX_BYTES) return fail(`it is over ${MAX_BYTES / 1e6} MB`);
    let p; try { p = JSON.parse(text); } catch { return fail("it is not JSON"); }
    if (!isObj(p) || !isObj(p.manifest) || !isObj(p.files)) return fail("it has no manifest and files, so it is not a benchmark package");
    const M = p.manifest;
    if (M.format !== FORMAT) return fail(`its kind is ${JSON.stringify(String(M.format ?? "missing")).slice(0, 80)}, not a benchmark package`);
    if (M.format_version !== VERSION) return fail(`its format version ${JSON.stringify(M.format_version ?? null)} is not supported here (this app opens version ${VERSION})`);
    const F = p.files, fk = Object.keys(F);
    if (fk.length !== FILES.length || !FILES.every(k => has(F, k))) return fail(`its files must be exactly ${FILES.join(", ")}`);
    for (const k of FILES.slice(0, 3)) if (typeof F[k] !== "string") return fail(`${k} is not text`);
    if (F["benchmark-brief.md"] !== null && typeof F["benchmark-brief.md"] !== "string") return fail("benchmark-brief.md is not text or null");
    const R = M.run, C = M.components, E = M.export;
    if (!isObj(R) || !isObj(C) || !isObj(E)) return fail("its manifest is missing run, components or export");
    if (!Array.isArray(R.ids_in_order) || !Number.isInteger(R.rows) || !Number.isInteger(R.results) || !Number.isInteger(R.rows_with_error)) return fail("its manifest run counts are missing or not whole numbers");
    if (R.recorded_config !== null && !isObj(R.recorded_config)) return fail("its recorded configuration is neither an object nor null");
    const rcx = R.recorded_config;
    if (rcx && rcx.metrics !== undefined && !(Array.isArray(rcx.metrics) && rcx.metrics.every(x => typeof x === "string"))) return fail("its recorded metrics are not a list of names");
    for (const k of ["recorded_app_version", "completed_at", "scope", "baseline_label"]) if (R[k] != null && typeof R[k] !== "string") return fail(`its manifest ${k} is not text`);
    for (const k of ["threshold", "wall_s"]) if (R[k] != null && !num(R[k])) return fail(`its manifest ${k} is not a number`);
    for (const k of ["app_version", "exported_at"]) if (E[k] != null && typeof E[k] !== "string") return fail(`its export ${k} is not text`);
    const comp = [["evaluated_dataset", "evaluated-dataset.jsonl"], ["results", "results.jsonl"], ["summary", "benchmark.json"], ["brief", "benchmark-brief.md"]];
    for (const [c, file] of comp) {
      const t = F[file], d = C[c];
      if (t === null) { if (d !== null) return fail(`the manifest lists ${file} but the file is empty`); continue; }
      if (!isObj(d) || d.file !== file || d.bytes !== u8(t)) return fail(`${file} does not match its declared size in the manifest`);
    }
    const ds = lines(F["evaluated-dataset.jsonl"], "evaluated-dataset.jsonl"); if (ds.error) return fail(ds.error);
    const rs = lines(F["results.jsonl"], "results.jsonl"); if (rs.error) return fail(rs.error);
    const rows = ds.rows, flat = rs.rows;
    if (!rows.length) return fail("it contains no evaluated rows");
    if (rows.length > MAX_ROWS) return fail(`it has more than ${MAX_ROWS} rows`);
    if (rows.length !== R.rows || rows.length !== C.evaluated_dataset.rows) return fail(`it declares ${R.rows} rows but contains ${rows.length}`);
    if (flat.length !== R.results || flat.length !== C.results.rows) return fail(`it declares ${R.results} results but contains ${flat.length}`);
    if (flat.length !== rows.length) return fail("its results and evaluated rows differ in number");
    if (R.ids_in_order.length !== rows.length) return fail("its list of IDs in order has the wrong length");
    for (let i = 0; i < rows.length; i++) {
      const a = has(rows[i], "id") ? rows[i].id : null, b = R.ids_in_order[i], c = flat[i].id;
      if (!same(a, b)) return fail(`row ${i + 1}: its ID does not match the manifest's IDs in order`);
      if (!(a === null ? c === null || c === undefined : same(a, c))) return fail(`row ${i + 1}: the result belongs to a different ID than the evaluated row`);
      if (a !== null && !idOk(a)) return fail(`row ${i + 1} has an unsupported ID type`);
    }
    let summary; try { summary = JSON.parse(F["benchmark.json"]); } catch { return fail("benchmark.json is not JSON"); }
    if (!isObj(summary) || !isObj(summary.overall) || !isObj(summary.metrics)) return fail("benchmark.json is not a benchmark summary");
    if (summary.rows !== rows.length) return fail(`benchmark.json says ${summary.rows} rows but the package has ${rows.length}`);
    if ((summary.version ?? null) !== (R.recorded_app_version ?? null) || (summary.at ?? null) !== (R.completed_at ?? null)) return fail("benchmark.json's recorded version or time differs from the manifest");
    const results = flat.map(rawFromFlat);
    const errs = results.filter(x => x.error).length;
    if (errs !== R.rows_with_error) return fail(`it declares ${R.rows_with_error} failed rows but the results show ${errs}`);
    // Same projections as the live panel/brief, priced only from the config recorded in THIS file.
    const pricing = runPricing(R.recorded_config);
    const compare = buildBenchCompare(results, { pricing });
    const stored = F["benchmark-brief.md"];
    const rebuilt = buildBenchBrief({ compare, summary, meta: { app_version: E.app_version ?? null, generated_at: E.exported_at ?? null } });
    const reproduced = typeof stored === "string" && rebuilt === stored;
    let briefDiff = null;
    if (typeof stored === "string" && !reproduced) { const a = stored.split("\n"), b = (rebuilt || "").split("\n"); briefDiff = 0; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) briefDiff++; }
    return { ok: true, manifest: M, rows, flat, results, summary, compare, pricing, brief: stored, briefReproduced: reproduced, briefDiffLines: briefDiff,
      bytes: u8(text), counts: { rows: rows.length, results: flat.length, rows_with_error: errs } };
  }
  const api = { openBenchPackage, rawFromFlat, BENCH_PACKAGE_OPEN_MAX_BYTES: MAX_BYTES };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

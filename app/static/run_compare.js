// Compare the CURRENT completed run with a RECORDED run opened from a benchmark package (bench_package_open.js).
// Pure: no DOM, no network, no storage, no scoring, never mutates its inputs. Both sides are read as frozen evidence:
//   baseline = openBenchPackage() output (rows + raw results rebuilt from the file's Results JSONL, manifest)
//   current  = the completed run in this tab (S.runRows / S.results / S.summary / S.runCfg)
// Cases are matched ONLY by exact typed id (7 ≠ "7") that is unique on BOTH sides; duplicates are "ambiguous",
// ids on one side only are "unmatched", rows without an id are "no id". Nothing is guessed.
// Each matched case carries a trace check: the jfj-trace-v1 canonical projection (labels excluded, keys sorted,
// array order kept; the same projection the fingerprint hashes) of the frozen baseline row vs the frozen current row.
// Per judge x metric: exact stored scores and signed delta = current − baseline ONLY when both are finite numbers;
// otherwise a reason (never 0). No pass/fail switch, no mean, no winner, no cost ratio.
"use strict";
(function (root) {
  const METRICS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"];
  const JUDGES = ["jev", "llm"];
  const num = v => typeof v === "number" && Number.isFinite(v);
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const idKey = v => (typeof v === "string" ? "s:" + v : typeof v === "number" && Number.isFinite(v) ? "n:" + v : null);
  const canon = v => Array.isArray(v) ? "[" + v.map(x => x === undefined ? "null" : canon(x)).join(",") + "]"
    : isObj(v) ? "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
    : JSON.stringify(v ?? null);
  const proj = row => { try { return isObj(row) ? canon(Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("human_")))) : null; } catch { return null; } };
  // exact decimal difference of two stored scores (they are short decimals); strips float noise only
  const delta = (b, c) => Number((c - b).toFixed(12));

  function score(res, judge, m) {
    if (!res) return { state: "no_result" };
    if (res.error && !res.jev) return { state: "row_error" };
    if (judge === "jev") {
      if (!res.jev || !Object.prototype.hasOwnProperty.call(res.jev, m)) return { state: "not_recorded" };
      const s = res.jev[m]; return num(s) ? { state: "score", v: s } : { state: res.jev_detail?.[m]?.result === "not_applicable" ? "not_applicable" : "no_score" };
    }
    const e = res.llm?.[m]; if (!e) return { state: "not_recorded" };
    if (num(e.score)) return { state: "score", v: e.score };
    return { state: e.result === "not_applicable" ? "not_applicable" : e.error ? "error" : "no_score" };
  }
  function index(ids) {
    const map = new Map(), noId = [];
    ids.forEach((id, i) => { const k = idKey(id); if (k === null) { noId.push(i); return; } (map.get(k) || map.set(k, []).get(k)).push(i); });
    return { map, noId };
  }
  function side(meta) {
    const rc = isObj(meta.config) ? meta.config : null, pick = k => rc && rc[k] !== undefined ? rc[k] : null;
    const models = [...new Set((meta.results || []).map(r => r?.jev_meta?.model).filter(x => typeof x === "string"))].sort();
    return { app_version: meta.version ?? null, completed_at: meta.at ?? null, rows: meta.rows.length, scope: meta.scope ?? null,
      threshold: num(meta.threshold) ? meta.threshold : null, llm_label: meta.llmLabel ?? null, config_recorded: !!rc,
      metrics: Array.isArray(pick("metrics")) ? [...pick("metrics")] : null, llm_requested: pick("baseline_requested"),
      cases: pick("cases"), jev_usd_per_mtok_input: pick("jev_usd_per_mtok_input"),
      llm_usd_per_mtok_in: pick("baseline_usd_per_mtok_in"), llm_usd_per_mtok_out: pick("baseline_usd_per_mtok_out"), jev_models: models };
  }
  const CFG_KEYS = [["app_version", "App version"], ["jev_models", "Jev model"], ["metrics", "Metrics requested"], ["llm_requested", "LLM judge requested"],
    ["llm_label", "LLM judge"], ["threshold", "Pass threshold"], ["scope", "Scope"], ["jev_usd_per_mtok_input", "Jev price per 1M input tokens"],
    ["llm_usd_per_mtok_in", "LLM judge price per 1M input tokens"], ["llm_usd_per_mtok_out", "LLM judge price per 1M output tokens"]];

  // baseline: { rows, results, version, at, scope, threshold, llmLabel, config }; current: same shape
  function buildRunCompare(baseline, current) {
    if (!baseline || !Array.isArray(baseline.rows) || !Array.isArray(baseline.results) || baseline.rows.length !== baseline.results.length)
      return { ok: false, reason: "no_baseline" };
    if (!current || !Array.isArray(current.rows) || !current.rows.length || !current.complete) return { ok: false, reason: "no_current" };
    if (!Array.isArray(current.results) || current.results.length !== current.rows.length) return { ok: false, reason: "no_current" };
    for (let i = 0; i < current.rows.length; i++) if (idKey(current.rows[i]?.id) !== idKey(current.results[i]?.id)) return { ok: false, reason: "misaligned" };
    const B = index(baseline.rows.map(r => r?.id)), C = index(current.rows.map(r => r?.id));
    const sb = side(baseline), sc = side(current);
    const config = CFG_KEYS.map(([k, label]) => ({ key: k, label, baseline: sb[k], current: sc[k], same: canon(sb[k]) === canon(sc[k]) && sb[k] !== null, unknown: sb[k] === null && sc[k] === null }));
    // both sides unrecorded is "unknown on both", not a stated difference; it still prevents claiming "same config"
    const configSame = config.every(x => x.same);
    // a judge x metric pair is compared only when BOTH recorded runs hold at least one entry for it
    const recorded = (res, j, m) => res.some(r => j === "jev" ? isObj(r?.jev) && Object.prototype.hasOwnProperty.call(r.jev, m) : isObj(r?.llm?.[m]));
    const pairs = [], notCommon = [];
    for (const j of JUDGES) for (const m of METRICS) {
      const inB = recorded(baseline.results, j, m), inC = recorded(current.results, j, m);
      if (inB && inC) pairs.push({ judge: j, metric: m }); else if (inB || inC) notCommon.push({ judge: j, metric: m, only: inB ? "baseline" : "current" });
    }
    const matched = [], ambiguous = [], baselineOnly = [], currentOnly = [];
    const keys = [...new Set([...B.map.keys(), ...C.map.keys()])];
    for (const k of keys) {
      const bi = B.map.get(k) || [], ci = C.map.get(k) || [];
      const id = bi.length ? baseline.rows[bi[0]].id : current.rows[ci[0]].id;
      if (bi.length > 1 || ci.length > 1) { ambiguous.push({ id, baseline_rows: bi.map(x => x + 1), current_rows: ci.map(x => x + 1) }); continue; }
      if (!ci.length) { baselineOnly.push({ id, baseline_row: bi[0] + 1 }); continue; }
      if (!bi.length) { currentOnly.push({ id, current_row: ci[0] + 1 }); continue; }
      const b = bi[0], c = ci[0], pb = proj(baseline.rows[b]), pc = proj(current.rows[c]);
      const trace = pb === null || pc === null ? "cannot_compare" : pb === pc ? "same" : "changed";
      const cells = pairs.map(({ judge, metric }) => {
        const x = score(baseline.results[b], judge, metric), y = score(current.results[c], judge, metric);
        const both = x.state === "score" && y.state === "score";
        return { judge, metric, baseline: x, current: y, delta: both ? delta(x.v, y.v) : null };
      });
      matched.push({ id, baseline_pos: b, current_pos: c, trace, cells });
    }
    matched.sort((a, b) => a.current_pos - b.current_pos);
    const tally = trace => pairs.map(({ judge, metric }) => {
      const t = { judge, metric, compared: 0, up: 0, down: 0, equal: 0, missing: 0 };
      for (const r of matched) if (r.trace === trace) { const c = r.cells.find(x => x.judge === judge && x.metric === metric); if (c.delta === null) t.missing++; else { t.compared++; c.delta > 0 ? t.up++ : c.delta < 0 ? t.down++ : t.equal++; } }
      return t;
    });
    return { ok: true, baseline: sb, current: sc, config, configSame, pairs, notCommon, matched, ambiguous, baselineOnly, currentOnly,
      noId: { baseline: B.noId.map(x => x + 1), current: C.noId.map(x => x + 1) },
      counts: { matched: matched.length, same_trace: matched.filter(r => r.trace === "same").length, changed_trace: matched.filter(r => r.trace === "changed").length,
        cannot_compare: matched.filter(r => r.trace === "cannot_compare").length, ambiguous: ambiguous.length, baseline_only: baselineOnly.length, current_only: currentOnly.length },
      tallySame: tally("same"), tallyChanged: tally("changed") };
  }
  // t_444de45e / t_5c9dac5a: sign-aware "recorded score decreases | increases" focus over an existing buildRunCompare
  // result (no re-parse, no rescore). Eligible = matched, SAME input (trace === "same"), both stored scores finite for the
  // chosen common judge x metric. Shown = eligible with delta < 0 (dec) or delta > 0 (inc); a zero delta is unchanged and
  // never shown in either. Largest change first, ties by current row position. Everything else is counted by reason, never
  // slipped in: input changed, input not comparable, a score missing. Ambiguous/unmatched never match.
  function runCompareChanges(r, judge, metric, dir) {
    if (dir !== "dec" && dir !== "inc") return { ok: false, reason: "bad_direction" };
    if (!r || !r.ok) return { ok: false, reason: "no_compare" };
    if (!r.pairs.some(p => p.judge === judge && p.metric === metric)) return { ok: false, reason: r.pairs.length ? "not_common" : "no_pairs" };
    const ex = { changed: 0, cannot_compare: 0, missing: 0 }, eligible = [];
    for (const m of r.matched) {
      const c = m.cells.find(x => x.judge === judge && x.metric === metric);
      if (m.trace === "changed") { ex.changed++; continue; }
      if (m.trace !== "same") { ex.cannot_compare++; continue; }
      if (!c || c.delta === null || !num(c.delta)) { ex.missing++; continue; }
      eligible.push({ id: m.id, baseline_pos: m.baseline_pos, current_pos: m.current_pos, baseline: c.baseline.v, current: c.current.v, delta: c.delta });
    }
    const s = dir === "dec" ? -1 : 1;
    const shown = eligible.filter(x => x.delta * s > 0).sort((a, b) => b.delta * s - a.delta * s || a.current_pos - b.current_pos);
    const out = { ok: true, direction: dir, judge, metric, shown, eligible: eligible.length, matched: r.matched.length, excluded: ex,
      not_matched: r.counts.ambiguous + r.counts.baseline_only + r.counts.current_only + r.noId.baseline.length + r.noId.current.length,
      unchanged: eligible.filter(x => x.delta === 0).length, opposite: eligible.filter(x => x.delta * s < 0).length };
    out[dir === "dec" ? "not_lower" : "not_higher"] = eligible.length - shown.length;
    return out;
  }
  const runCompareDecreases = (r, judge, metric) => runCompareChanges(r, judge, metric, "dec");
  const runCompareIncreases = (r, judge, metric) => runCompareChanges(r, judge, metric, "inc");
  // t_b3ac81fe: the dataset-order matched view (All matched / Same input / Input changed) as ONE list that both the table
  // and the inspector's Previous/Next use. Current row order (as buildRunCompare sorts matched); bound by current+baseline
  // position and typed id; ambiguous/unmatched are never in r.matched so they are never stepped to.
  function runCompareMatchedList(r, trace) {
    if (!r || !r.ok) return [];
    if (trace !== "all" && trace !== "same" && trace !== "changed") return [];
    return r.matched.filter(m => trace === "all" || m.trace === trace).map(m => ({ pos: m.current_pos, id: m.id, b: m.baseline_pos, trace: m.trace }));
  }
  // t_3d3710ee: view-only search that NARROWS an already-shown comparison list (runCompareMatchedList entries or the
  // runCompareChanges shown list mapped to {pos,id,b}). Literal, case-insensitive substring of the trimmed query over the
  // typed ID's display text and the request/answer text of BOTH frozen traces (baseline row b from the file, current row
  // pos of the run). Keeps list order and identity: number 7 and text "7" can both match "7" but stay separate entries.
  // Pure: no DOM, no network, never mutates inputs. hit = where it matched (id | baseline | current).
  function runCompareFind(list, baseRows, curRows, query, textOf) {
    const L = Array.isArray(list) ? list : [], raw = String(query ?? "").trim(), q = raw.toLowerCase();
    if (!q) return { active: false, query: "", total: L.length, shown: L.slice() };
    const has = v => String(v ?? "").toLowerCase().includes(q);
    const txt = row => { if (!isObj(row) || !textOf) return ["", ""]; const t = textOf(row) || {}; return [t.req, t.ans]; };
    const shown = [];
    for (const e of L) {
      const idT = typeof e.id === "string" ? e.id : typeof e.id === "number" ? JSON.stringify(e.id) : "";
      const hit = [];
      if (has(idT)) hit.push("id");
      const br = Array.isArray(baseRows) ? baseRows[e.b] : null, cr = Array.isArray(curRows) ? curRows[e.pos] : null;
      // a frozen row is searched only when it carries the same typed id (never borrow another case's text)
      if (isObj(br) && idKey(br.id) === idKey(e.id) && txt(br).some(has)) hit.push("baseline");
      if (isObj(cr) && idKey(cr.id) === idKey(e.id) && txt(cr).some(has)) hit.push("current");
      if (hit.length) shown.push({ ...e, hit });
    }
    return { active: true, query: raw, total: L.length, shown };
  }
  const api = { buildRunCompare, runCompareChanges, runCompareDecreases, runCompareIncreases, runCompareMatchedList, runCompareFind, RUN_COMPARE_METRICS: METRICS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

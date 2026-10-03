// Lightweight inline-SVG charts (no dependencies). Pure string builders over a /api/summary-shaped object
// (same schema as the dashboard's S.summary and the published benchmark/results/summary.json).
// Never invents numbers: missing values render as "—" and are not drawn.
(function (root) {
  const M = { intent_resolution: "Intent Resolution", task_adherence: "Task Adherence", tool_call_accuracy: "Tool Call Accuracy", groundedness: "Groundedness" };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const has = (s, m) => { const x = s.metrics?.[m]; return !!x && ((x.jev_vs_human?.n || 0) + (x.llm_vs_human?.n || 0) > 0 || typeof x.jev_mean === "number"); };
  const fin = v => typeof v === "number" && isFinite(v);
  const pct = v => fin(v) ? Math.round(v * 100) + "%" : "—";
  const ms = v => !fin(v) ? "—" : v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms";
  const usd = v => !fin(v) ? "—" : v < 0.1 ? "$" + v.toFixed(3) : "$" + v.toFixed(2);

  // HTML rows + a tiny inline SVG bar each (text stays crisp; bars scale to the container).
  function bars(groups, max, title) {
    return `<div class="cx" role="img" aria-label="${esc(title)}">${groups.map(g => `<div class="cx-g"><div class="cx-gl">${esc(g.label)}</div>${g.bars.map(b => {
      const w = fin(b.v) && max > 0 ? Math.max(1.2, Math.min(100, (b.v / max) * 100)) : 0;
      return `<div class="cx-row"><span class="cx-n">${esc(b.name)}</span><svg class="cx-svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="cx-track" x="0" y="0" width="100" height="10" rx="2"></rect>${w ? `<rect class="cx-bar ${b.cls}" x="0" y="0" width="${w}" height="10" rx="2"></rect>` : ""}</svg><span class="cx-v">${esc(b.text)}</span></div>`;
    }).join("")}</div>`).join("")}</div>`;
  }
  const legend = items => `<div class="cx-legend">${items.map(([c, t]) => `<span><i class="${c}"></i>${esc(t)}</span>`).join("")}</div>`;

  function agreement(s) {
    const hasL = (s.llm?.evaluations || 0) > 0;
    const g = Object.keys(M).filter(m => has(s, m)).map(m => ({ label: M[m], bars: [
      { name: "Jev", v: s.metrics[m].jev_vs_human?.n ? s.metrics[m].jev_vs_human.pass_fail_agreement : null, text: s.metrics[m].jev_vs_human?.n ? `${pct(s.metrics[m].jev_vs_human.pass_fail_agreement)} · n ${s.metrics[m].jev_vs_human.n}` : "no paired labels", cls: "c-jev" },
      ...(hasL ? [{ name: "LLM judge", v: s.metrics[m].llm_vs_human?.n ? s.metrics[m].llm_vs_human.pass_fail_agreement : null, text: s.metrics[m].llm_vs_human?.n ? `${pct(s.metrics[m].llm_vs_human.pass_fail_agreement)} · n ${s.metrics[m].llm_vs_human.n}` : "no paired labels", cls: "c-llm" }] : []),
    ] }));
    return bars(g, 1, "Pass/fail agreement with human labels per metric");
  }
  function mae(s) {
    const hasL = (s.llm?.evaluations || 0) > 0;
    const g = Object.keys(M).filter(m => has(s, m)).map(m => ({ label: M[m], bars: [
      { name: "Jev", v: s.metrics[m].jev_vs_human?.n ? s.metrics[m].jev_vs_human.mae : null, text: s.metrics[m].jev_vs_human?.n ? String(s.metrics[m].jev_vs_human.mae) : "—", cls: "c-jev" },
      ...(hasL ? [{ name: "LLM judge", v: s.metrics[m].llm_vs_human?.n ? s.metrics[m].llm_vs_human.mae : null, text: s.metrics[m].llm_vs_human?.n ? String(s.metrics[m].llm_vs_human.mae) : "—", cls: "c-llm" }] : []),
    ] }));
    return bars(g, 4, "Mean absolute error against human labels on the 1–5 scale (lower is better)");
  }
  function latency(s) {
    const j = s.jev || {}, l = s.llm || {}, hasL = (l.evaluations || 0) > 0;
    const rows = [{ name: "Jev p50", v: j.p50_ms, text: ms(j.p50_ms), cls: "c-jev" }, { name: "Jev p95", v: j.p95_ms, text: ms(j.p95_ms), cls: "c-jev2" }];
    if (hasL) rows.push({ name: "LLM p50", v: l.p50_ms_per_row_sequential, text: ms(l.p50_ms_per_row_sequential), cls: "c-llm" });
    const ratioL = hasL && fin(j.p50_ms) && j.p50_ms > 0 && fin(l.p50_ms_per_row_sequential) ? l.p50_ms_per_row_sequential / j.p50_ms : null;
    const max = Math.max(...rows.map(r => fin(r.v) ? r.v : 0));
    return bars([{ label: "Time to score one conversation (all metrics); LLM judge runs one call per metric, in sequence", bars: rows }], max, "Latency per conversation") + (ratioL ? `<p class="cx-note">Jev median is <b>~${Math.round(ratioL)}× faster</b> per conversation.</p>` : "");
  }
  function cost(s) {
    const j = s.jev || {}, l = s.llm || {}, hasL = (l.evaluations || 0) > 0;
    const rows = [{ name: "Jev", v: j.usd_per_1k_evals, text: usd(j.usd_per_1k_evals), cls: "c-jev" }];
    if (hasL) rows.push({ name: "LLM judge", v: l.usd_per_1k_evals, text: usd(l.usd_per_1k_evals), cls: "c-llm" });
    const max = Math.max(...rows.map(r => fin(r.v) ? r.v : 0));
    const r2 = hasL && fin(j.usd_per_1k_evals) && j.usd_per_1k_evals > 0 && fin(l.usd_per_1k_evals) ? l.usd_per_1k_evals / j.usd_per_1k_evals : null;
    return bars([{ label: "Cost per 1,000 metric evaluations (estimate at list price)", bars: rows }], max, "Cost per 1,000 evaluations") + (r2 ? `<p class="cx-note">Jev is <b>~${Math.round(r2)}× cheaper</b> per evaluation on this workload.</p>` : "");
  }
  function headline(s) {
    const j = s.jev || {}, l = s.llm || {}, o = s.overall || {}, hasL = (l.evaluations || 0) > 0;
    const ratio = hasL && fin(j.usd_per_1k_evals) && j.usd_per_1k_evals > 0 && fin(l.usd_per_1k_evals) ? Math.round(l.usd_per_1k_evals / j.usd_per_1k_evals) : null;
    const speed = hasL && fin(j.p50_ms) && j.p50_ms > 0 && fin(l.p50_ms_per_row_sequential) ? Math.round(l.p50_ms_per_row_sequential / j.p50_ms) : null;
    const t = (v, l2, c) => `<div class="hl-stat"><div class="hl-v">${v}</div><div class="hl-l">${esc(l2)}</div><div class="hl-c">${c}</div></div>`;
    return `<div class="hl-grid">${[
      t(pct(o.jev_vs_human?.pass_fail_agreement), "agreement with human labels", hasL ? `vs ${pct(o.llm_vs_human?.pass_fail_agreement)} LLM judge · n ${o.jev_vs_human?.n ?? "—"} / ${o.llm_vs_human?.n ?? "—"}` : `n ${o.jev_vs_human?.n ?? "—"} scores`),
      t(ms(j.p50_ms), "median time per conversation", speed ? `vs ${ms(l.p50_ms_per_row_sequential)} LLM judge (~${speed}×)` : `p95 ${ms(j.p95_ms)}`),
      t(usd(j.usd_per_1k_evals), "per 1,000 evaluations", ratio ? `vs ${usd(l.usd_per_1k_evals)} LLM judge (~${ratio}×)` : "estimate at list price"),
      t(fin(o.jev_vs_human?.pearson) ? o.jev_vs_human.pearson.toFixed(2) : "—", "correlation with human 1–5 scores", hasL && fin(o.llm_vs_human?.pearson) ? `vs ${o.llm_vs_human.pearson.toFixed(2)} LLM judge · Pearson r` : "Pearson r on 1–5"),
    ].join("")}</div>`;
  }
  function full(s) {
    const hasL = (s.llm?.evaluations || 0) > 0;
    const lg = legend([["c-jev", "Jev (typed judge)"], ["c-jev2", "Jev p95"], ...(hasL ? [["c-llm", "Foundry built-in LLM judge"]] : [])]);
    return `${lg}<div class="cx-grid">
      <figure class="cx-card"><figcaption>Agreement with human labels <span class="hint">pass/fail at threshold, higher is better</span></figcaption>${agreement(s)}</figure>
      <figure class="cx-card"><figcaption>Error against human labels <span class="hint">MAE on 1–5, lower is better</span></figcaption>${mae(s)}</figure>
      <figure class="cx-card"><figcaption>Latency <span class="hint">measured per live call</span></figcaption>${latency(s)}</figure>
      <figure class="cx-card"><figcaption>Cost <span class="hint">from reported tokens</span></figcaption>${cost(s)}</figure>
    </div>`;
  }
  const api = { headline, full, agreement, mae, latency, cost };
  if (typeof module !== "undefined") module.exports = api; else root.JCharts = api;
})(typeof window !== "undefined" ? window : globalThis);

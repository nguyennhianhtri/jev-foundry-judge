// "What these metrics check": a pure projection of the SELECTED metrics (canonical order) from the server's own
// evaluator definitions (/api/config atoms + levels = evaluators.SPECS / LEVELS_5) plus the shared applicability
// rule (label_coverage.applicable). No DOM, no network, never mutates input. Nothing here is a scoring guarantee:
// it restates what the canonical prompts ask and how evaluators.combine records the result.
(function (root) {
  // Mirrors SPECS[m].requires (evaluators.py) and label_coverage.applicable; fields named as the row keys the app sends.
  const NEEDS = {
    intent_resolution: { always: true, purpose: "Did the final answer resolve what the user actually asked for, every part of it?",
      fields: "query + response. Scored on every row." },
    task_adherence: { always: true, purpose: "Did the agent follow its system instructions: rules, scope and required steps, without asserting unverified specifics?",
      fields: "query + response. Scored on every row; if the query has no system message the judge sees \"(none provided)\", so rules and required steps have little to check." },
    tool_call_accuracy: { always: false, purpose: "Were the right tools called with correct, grounded arguments, and no missing or redundant calls? Pick this for agents that call tools.",
      fields: "a tool call in response or tool_calls, OR a tool list in tool_definitions", na: "no tool call or tool list in this trace" },
    groundedness: { always: false, purpose: "Are the answer's factual claims supported by, and not contradicting, the provided context or tool results? Pick this for answers that should stick to evidence.",
      fields: "context, OR a tool result (a role:\"tool\" message) in response", na: "no context or tool result in this trace" },
  };
  // Where the optional Foundry built-in (baseline.run_metric) differs in what it needs or records. Different judge,
  // different prompt: scores are compared, never assumed equal.
  const BASELINE_DIFF = {
    tool_call_accuracy: "The Foundry built-in LLM judge scores this only when the row has tool_definitions, so a row with tool calls but no tool list can be scored by Jev and n/a for the built-in.",
    task_adherence: "In the current Foundry SDK the built-in returns 0 or 1 for this metric; the app maps 1 to 5 and 0 to 1 on the 1–5 axis, so its values are coarser than Jev's.",
  };
  function guide(selected, cfg, rows, applicable) {
    const all = Array.isArray(cfg?.metrics) ? cfg.metrics : [], sel = new Set(Array.isArray(selected) ? selected : []);
    const list = Array.isArray(rows) ? rows : [];
    return all.filter(m => sel.has(m)).map(m => {
      const atoms = (cfg.atoms && cfg.atoms[m]) || [], lv = (cfg.levels && cfg.levels[m]) || [];
      const n = NEEDS[m] || { always: false, fields: "see evaluator definition" };
      const na = typeof applicable === "function" ? list.filter(r => !applicable(r, m)).length : 0;
      return {
        metric: m, purpose: n.purpose || null, needs: n.fields, always: !!n.always, na_reason: n.na || null, na_now: na, rows: list.length,
        low: lv[0] || null, high: lv[lv.length - 1] || null, levels: lv,
        checks: atoms.map(a => ({ label: a.label, type: a.type, weight: a.weight, invert: !!a.invert, critical: !!a.critical, question: a.question })),
        critical: atoms.filter(a => a.critical).map(a => a.label),
        baseline_diff: BASELINE_DIFF[m] || null,
      };
    });
  }
  const api = { guide, NEEDS, BASELINE_DIFF };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, { metricGuide: guide });
})(typeof window !== "undefined" ? window : globalThis);

// Starter dataset template for first-time uploaders (t_ed766f3f). A FIXED, synthetic, authored example row in
// exactly the columns the existing Upload parser (app.js parseCSV + normalize) accepts. It is a constant: it never
// reads the current dataset, a run, a key or any trace, and it is not evaluation output. Download is local only.
// Loaded by the browser (window.templateJSONL / templateCSV / TEMPLATE_ROW) and by node tests (module.exports).
"use strict";
(function (root) {
  const TEMPLATE_ROW = Object.freeze({
    id: "example-01",
    scenario: "template-example",
    query: "SYNTHETIC EXAMPLE: Where is my order A-100?",
    response: [
      { role: "assistant", content: [{ type: "tool_call", tool_call_id: "call_1", name: "lookup_order", arguments: { order_id: "A-100" } }] },
      { role: "tool", tool_call_id: "call_1", content: [{ type: "tool_result", tool_result: { order_id: "A-100", status: "shipped", eta: "Friday" } }] },
      { role: "assistant", content: [{ type: "text", text: "Order A-100 has shipped and should arrive on Friday." }] },
    ],
    tool_definitions: [{ name: "lookup_order", description: "Look up an order's status", parameters: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] } }],
    context: "SYNTHETIC: Order A-100 shipped on Tuesday; estimated arrival Friday.",
    human_intent_resolution: 5,
    human_task_adherence: 5,
    human_tool_call_accuracy: 5,
    human_groundedness: 5,
    note: "Synthetic example written for this template (not a real trace, not a model result). Replace it with your own cases.",
  });
  const COLUMNS = Object.keys(TEMPLATE_ROW);
  const clone = () => JSON.parse(JSON.stringify(TEMPLATE_ROW));
  const templateJSONL = () => JSON.stringify(clone()) + "\n";
  // same cell quoting as the app's CSV export (objects as JSON text; quote when , " or newline present)
  const cell = v => { const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const templateCSV = () => { const r = clone(); return COLUMNS.join(",") + "\n" + COLUMNS.map(k => cell(r[k])).join(",") + "\n"; };
  const api = { TEMPLATE_ROW, TEMPLATE_COLUMNS: COLUMNS, templateJSONL, templateCSV };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);

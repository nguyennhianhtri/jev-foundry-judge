// Jev model router: home page. One Jev Choice call per prompt (visitor's key). The policy runs in the browser,
// so moving a setting re-routes the recorded probabilities without new calls. Must stay a pure module for tests.
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt$ = v => v == null ? "—" : v === 0 ? "$0" : v < 0.01 ? "$" + v.toPrecision(2) : "$" + v.toFixed(3);
  const fmtMs = v => v == null ? "—" : v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms";
  const pct = v => v == null ? "—" : Math.round(v * 100) + "%";
  // A model identity as one unit: moves to the next line whole instead of splitting at its hyphens.
  const id = s => `<span class="rt-id">${esc(s)}</span>`;
  const cleanKey = raw => String(raw || "").replace(/[\s\u200B-\u200F\u2028\u2029\u202F\u2060\uFEFF\u00AD]+/g, "")
    .replace(/^['"`\u2018\u2019\u201C\u201D]+|['"`\u2018\u2019\u201C\u201D]+$/g, "").replace(/^bearer:?/i, "")
    .replace(/^['"`\u2018\u2019\u201C\u201D]+|['"`\u2018\u2019\u201C\u201D]+$/g, "");
  const EXAMPLES = [
    ["Simple fact", "What is the capital of Australia?"],
    ["Maths", "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Explain step by step."],
    ["Code", "Write a Python function that returns the longest palindromic substring of a string."],
  ];
  const SAMPLES = [
    "hey! how's your day going?", "Translate 'where is the train station' into French.",
    "Summarise in one sentence: The meeting moved to Thursday because the venue flooded.",
    "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Explain step by step.",
    "Prove that the square root of 2 is irrational.",
    "A drug trial has 3 arms; with a 5% false-positive rate per pairwise test, what is the family-wise error rate for all pairwise comparisons, and how would Bonferroni change the threshold?",
    "Write a Python function that returns the longest palindromic substring of a string.",
    "Fix this JS: const add = (a, b) => { a + b }; console.log(add(2, 3)); // prints undefined",
    "Write pytest unit tests for a function slugify(title: str) -> str.",
  ];
  const ROLE = { small: "Small and fast", strong: "Strong reasoning", code: "Code" };
  const R = { key: null, cfg: null, models: [], fallback: "strong", results: [], busy: false, resSig: null };
  // What a routing result depends on: the exact prompts plus each model's key, name and description.
  // Prices, fallback and knobs are excluded on purpose: they only re-run the local policy on recorded probabilities.
  const inputSig = (ps, models) => JSON.stringify([ps, models.map(m => [m.key, m.name, m.desc])]);

  // Routing decision brief (.md) of the CURRENT result. Pure: built only from the submit-time snapshot (prompts,
  // model identities), the recorded Jev responses and the visible policy/prices. Missing values say "unavailable".
  function routeBrief(snap, results, models, fb, k, meta) {
    const na = v => v == null || v === "" || (typeof v === "number" && !isFinite(v)) ? "unavailable" : v;
    const num = (v, d) => typeof v === "number" && isFinite(v) ? v.toFixed(d) : "unavailable";
    const usd = v => typeof v === "number" && isFinite(v) ? "$" + (v === 0 ? "0" : v.toPrecision(3)) : "unavailable";
    const cell = v => String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const mk = key => snap.models.find(m => m.key === key);
    const price = key => models.find(m => m.key === key);
    const cost = key => answerCost(price(key), k.tin, k.tout);
    // Same policy input as the screen: frozen submitted identities (key/name/desc) + the prices shown now.
    // The snapshot has no prices, so selecting on snap.models alone would ignore price edits (cheapest rule).
    const priced = snap.models.map(m => { const p = price(m.key); return { ...m, in: p ? p.in : NaN, out: p ? p.out : NaN }; });
    const L = [];
    L.push("# Jev routing decision brief", "");
    L.push(`- Routed at (UTC): ${na(snap.routedAt)}`, `- Brief created (UTC): ${na(meta.now)}`, `- App version: ${na(snap.version || meta.version)}`,
      `- Prompts routed: ${results.length}`, `- Method: one Jev Choice call per prompt; the policy below is applied in the browser to the recorded probabilities.`, "");
    L.push("> Local content: this file contains the prompts and model descriptions exactly as submitted from this browser. It contains no API key. Review before sharing.", "");
    L.push("## Policy (as shown when this brief was created)", "");
    L.push(`- Fallback model: ${na(mk(fb)?.name)} (key ${fb})`, `- Fall back below confidence: ${num(k.confT, 2)}`,
      `- Prefer cheapest model above probability: ${k.cheapP == null ? "off" : num(k.cheapP, 2) + " (cheapest = lowest estimated answer cost at the token assumption below: tokens in × $ in + tokens out × $ out, same rule as the screen)"}`,
      `- Cost assumption per call: ${k.tin} input + ${k.tout} output tokens`, "");
    L.push("## Models (as submitted; prices as shown)", "", "| Key | Name | $ in / 1M | $ out / 1M | Description |", "|---|---|---|---|---|");
    snap.models.forEach(m => { const p = price(m.key); L.push(`| ${cell(m.key)} | ${cell(m.name)} | ${p ? p.in : "unavailable"} | ${p ? p.out : "unavailable"} | ${cell(m.desc)} |`); });
    L.push("", "## Decisions", "");
    let tot = 0, fbTot = 0;
    results.forEach((r, i) => {
      const pol = policy(r.probabilities || {}, r.confidence, priced, fb, k.confT, k.cheapP, k.tin, k.tout);
      const c = cost(pol.routed), cf = cost(fb); tot += c || 0; fbTot += cf || 0;
      L.push(`### Prompt ${i + 1}`, "", "```text", String(r.prompt).replace(/```/g, "`\u200b``"), "```", "");
      L.push(`- Selected model: ${na(mk(pol.routed)?.name)} (key ${pol.routed})`, `- Rule applied: ${pol.why}`,
        `- Jev top choice: ${na(mk(r.choice)?.name ?? r.choice)} · highest probability: ${na(mk(pol.argmax)?.name)}`,
        `- Jev confidence: ${num(r.confidence, 3)}`,
        `- Probabilities: ${snap.models.map(m => `${m.name} ${num(r.probabilities?.[m.key], 3)}`).join(" · ")}`,
        `- Routing latency (measured Jev call): ${typeof r.latency_ms === "number" ? r.latency_ms + " ms" : "unavailable"}`,
        `- Jev routing call: model ${na(r.model)}, ${na(r.input_tokens)} input tokens, ${usd(r.usd)} (estimate)`,
        `- Estimated answer cost on selected model: ${usd(c)} (estimate from list prices and the token assumption above, not billed)`, "");
    });
    if (results.length > 1) L.push("## Totals (estimate)", "", `- Selected models: ${usd(tot)} · all to fallback ${na(mk(fb)?.name)}: ${usd(fbTot)}`, "");
    L.push("## Limits", "", "- Costs are estimates from list prices and a fixed token assumption; nothing here was billed or measured as quality.",
      "- Changing the policy or prices re-applies it to the same recorded probabilities; changing a prompt or model name/description needs a new route.", "");
    return L.join("\n");
  }

  async function api(path, body, key) {
    const h = { "Content-Type": "application/json" };
    if (key) h["X-Jev-Key"] = R.key;
    const r = await fetch(path, { method: body ? "POST" : "GET", headers: h, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || j.error || r.statusText);
    return j;
  }

  // The ONE answer-cost formula (USD per call) used by the policy, the screen and the brief; mirrors
  // router.answer_cost on the server. Unknown/invalid price or token count -> null (unavailable, never free).
  // Tokens 0 are allowed here (0 * price = 0), so both 0 makes every model cost 0: a tie, not NaN.
  function answerCost(m, tin, tout) {
    const ok = v => typeof v === "number" && isFinite(v) && v >= 0;
    if (!m || !ok(m.in) || !ok(m.out) || !ok(tin) || !ok(tout)) return null;
    return (tin * m.in + tout * m.out) / 1e6;
  }
  // policy mirrors router.apply_policy on the server (tests/test_router.py checks parity).
  // Cheapest = lowest answerCost for the entered token mix; unknown cost never wins; ties keep model-list order.
  function policy(p, conf, models, fb, confT, cheapP, tin, tout) {
    const keys = models.map(m => m.key);
    const argmax = keys.reduce((a, b) => (p[b] ?? 0) > (p[a] ?? 0) ? b : a, keys[0]);
    let pick = argmax, why = "most likely fit";
    if (cheapP != null) {
      const ok = models.filter(m => (p[m.key] ?? 0) >= cheapP);
      const c$ = m => answerCost(m, tin, tout) ?? Infinity;
      if (ok.length) { const c = ok.reduce((a, b) => c$(b) < c$(a) ? b : a); pick = c.key; why = "cheapest good fit"; }
      else { pick = fb; why = "no clear fit, used fallback"; }
    }
    if (conf < confT && pick !== fb) { pick = fb; why = "low confidence, used fallback"; }
    return { routed: pick, why, argmax };
  }
  // Numeric assumptions are parsed, never coerced: blank, bad, negative or non-finite input is invalid (not 0, not a
  // hidden default). An explicit 0 price is valid and means free. `bad` = the browser could not parse the draft.
  function readNum(raw, bad, kind) {
    const t = String(raw ?? "").trim();
    if (bad) return { ok: false, msg: "Enter a number." };
    if (!t) return { ok: false, msg: kind === "price" ? "Enter a price. Use 0 only if the model is free." : "Enter the number of tokens." };
    const v = Number(t);
    if (!isFinite(v)) return { ok: false, msg: "Enter a number." };
    if (kind === "price") return v < 0 ? { ok: false, msg: "A price can't be negative." } : { ok: true, v };
    return Number.isInteger(v) && v >= 1 ? { ok: true, v } : { ok: false, msg: "Use a whole number, 1 or more." };
  }
  const tokField = id => { const el = $(id); return readNum(el.value, el.validity?.badInput, "tokens"); };
  // Which numeric inputs are invalid now: [{what, msg}]. Prices come from each model's validity; tokens from the fields.
  function problems() {
    const out = [];
    R.models.forEach(m => ["in", "out"].forEach(f => { if (m.bad?.[f]) out.push({ what: `${m.name || ROLE[m.key] || m.key} ${f === "in" ? "input" : "output"} price`, msg: m.bad[f], price: true }); }));
    [["#rt-tin", "Tokens in"], ["#rt-tout", "Tokens out"]].forEach(([id, what]) => { const r = tokField(id); if (!r.ok) out.push({ what, msg: r.msg }); });
    return out;
  }
  const knobs = () => { const a = tokField("#rt-tin"), b = tokField("#rt-tout");
    return { confT: +$("#rt-conf").value, cheapP: $("#rt-cheap-on").checked ? +$("#rt-cheap").value : null,
      tin: a.ok ? a.v : NaN, tout: b.ok ? b.v : NaN }; };
  const callCost = (m, k) => answerCost(m, k.tin, k.tout) ?? 0;  // summed only when noCost is false
  function markField(el, r) {
    const box = el.closest("label"); let e = box.querySelector(".rt-ferr");
    el.setAttribute("aria-invalid", r.ok ? "false" : "true");
    if (r.ok) { if (e) e.remove(); el.removeAttribute("aria-describedby"); return; }
    if (!e) { e = document.createElement("span"); e.className = "rt-ferr"; e.id = "rt-ferr-" + Math.random().toString(36).slice(2, 8); box.appendChild(e); }
    e.textContent = r.msg; el.setAttribute("aria-describedby", e.id);
  }
  const byKey = k => R.models.find(m => m.key === k);

  function renderModels() {
    $("#rt-models").innerHTML = R.models.map((m, i) => `<fieldset class="rt-m" data-i="${i}"><legend>${esc(ROLE[m.key] || m.key)}</legend>
      <label>Name <input type="text" data-f="name" value="${esc(m.name)}" maxlength="80"></label>
      <label>What it is good at <textarea data-f="desc" rows="3" maxlength="1200">${esc(m.desc)}</textarea></label>
      <div class="sx-tok"><label>$ in / 1M <input type="number" step="0.01" min="0" data-f="in" value="${m.in}"></label>
        <label>$ out / 1M <input type="number" step="0.01" min="0" data-f="out" value="${m.out}"></label>
        <label class="sx-check"><input type="radio" name="rt-fb" value="${esc(m.key)}" ${m.key === R.fallback ? "checked" : ""}> Fallback</label></div></fieldset>`).join("");
    $("#rt-models").querySelectorAll("[data-f]").forEach(el => el.oninput = () => {
      const m = R.models[+el.closest(".rt-m").dataset.i], f = el.dataset.f;
      if (f === "in" || f === "out") {
        // keep the typed draft in the field; only a valid number becomes the price the policy uses
        const r = readNum(el.value, el.validity?.badInput, "price");
        m[f] = r.ok ? r.v : NaN; m.bad = { ...m.bad, [f]: r.ok ? null : r.msg }; markField(el, r);
      } else m[f] = el.value;
      if (f === "name" || f === "desc") m.edited = true;
      renderOut();
    });
    $("#rt-models").querySelectorAll("input[name=rt-fb]").forEach(el => el.onchange = () => { R.fallback = el.value; renderOut(); });
  }

  function prompts() {
    const v = $("#rt-prompt").value;
    return ($("#rt-batch").checked ? v.split(/\n+/) : [v]).map(s => s.trim()).filter(Boolean);
  }
  function syncGo() { const n = prompts().length; $("#rt-go").disabled = R.busy; $("#rt-go").textContent = R.busy ? "Routing…" : n > 1 ? `Route ${n} prompts` : "Route"; }
  function fail(msg) { const e = $("#rt-err"); e.textContent = msg; e.hidden = false; }

  async function connect() {
    const raw = $("#rt-key").value, k = cleanKey(raw), st = $("#rt-keystatus");
    if (!k) return !!R.key;
    R.key = k; st.textContent = "Checking your key…";
    try {
      const r = await api("/api/verify-key", {}, true);
      st.innerHTML = `<span class="ok">Key connected</span> · ${fmtMs(r.latency_ms)}. It stays in this tab.`;
      $("#rt-key").value = ""; $("#rt-key").placeholder = "Key connected";
      return true;
    } catch (e) { R.key = null; st.textContent = "Your key stays in this tab. It is never stored."; fail(`Key not accepted: ${e.message}`); return false; }
  }

  async function go() {
    $("#rt-err").hidden = true;
    const ps = prompts();
    if (!ps.length) { fail("Type a prompt or pick an example."); $("#rt-prompt").focus(); return; }
    if (!R.key && !cleanKey($("#rt-key").value)) { fail("Paste your Jev API key to route."); $("#rt-key").focus(); return; }
    const max = R.cfg?.max_batch || 50;
    if (ps.length > max) { fail(`Up to ${max} prompts at a time. You have ${ps.length}.`); return; }
    const bad = R.models.findIndex(m => !m.name.trim() || !m.desc.trim());
    if (bad >= 0) { fail(`Model ${bad + 1} needs a name and a description.`); return; }
    const pb = problems().filter(x => x.price);
    if (pb.length) { fail(`Fix ${pb[0].what}: ${pb[0].msg}`); R.numErr = true; return; }
    R.busy = true; syncGo(); renderOut();
    try {
      if (cleanKey($("#rt-key").value) && !(await connect())) return;
      const models = R.models.map(({ key, name, desc, in: i, out }) => ({ key, name, desc, in: i, out }));
      const sig = inputSig(ps, models);
      const j = await api("/api/router/route", { prompts: ps, models }, true);
      // bind the result to what was submitted, not to whatever the draft is when the reply lands
      R.results = j.results.map((r, i) => ({ ...r, prompt: ps[i] }));
      R.resSig = sig; R.answers = {}; R.copy = null;
      R.snap = { prompts: ps, models: models.map(({ key, name, desc }) => ({ key, name, desc })), routedAt: new Date().toISOString(), version: j.version };
    } catch (e) { fail(e.message); }
    finally { R.busy = false; syncGo(); renderOut(); }
  }

  function renderOut() {
    if (R.numErr && !problems().some(x => x.price)) { R.numErr = false; $("#rt-err").hidden = true; }
    const out = $("#rt-out");
    if (!R.results.length) { out.innerHTML = ""; return; }
    const k = knobs(), fbM = byKey(R.fallback), stale = isStale(), probs = problems();
    // Unknown is never free: with any invalid price or token count, costs, savings, the brief and Get the answer are
    // withheld. The pick is withheld too when it depends on the numbers (cheapest rule on: every price AND the token mix).
    const noCost = probs.length > 0, noPick = k.cheapP != null && noCost;
    let routed$ = 0, strong$ = 0;
    const one = R.results.length === 1;
    const rows = R.results.map((r, i) => {
      const pol = policy(r.probabilities, r.confidence, R.models, R.fallback, k.confT, k.cheapP, k.tin, k.tout);
      const m = byKey(pol.routed); routed$ += callCost(m, k); strong$ += callCost(fbM, k);
      // Per-answer cost facts (same answerCost as the policy and the brief). Model identities are never split.
      const c = !noCost && m ? answerCost(m, k.tin, k.tout) : null, cf = !noCost && fbM ? answerCost(fbM, k.tin, k.tout) : null;
      const vs = pol.routed === R.fallback ? `This is your fallback model`
        : cf == null || c == null ? "" : cf === 0 ? `Fallback ${id(fbM.name)} <span class="rt-nw">is ${fmt$(0)}</span>`
        : c < cf ? `<b>${pct(1 - c / cf)} cheaper</b> than ${id(fbM.name)} <span class="rt-nw">at ${fmt$(cf)}</span>`
        : c > cf ? `<b>${pct(c / cf - 1)} more</b> than ${id(fbM.name)} <span class="rt-nw">at ${fmt$(cf)}</span>` : `Same cost as ${id(fbM.name)}`;
      const facts = noCost || !m ? "" : `<dl class="rt-facts">
          <div><dt>Est. cost per answer</dt><dd><b class="rt-usd">${fmt$(c)}</b>${vs ? ` <span class="rt-vs">${vs}</span>` : ""}</dd></div>
          <div><dt>Why</dt><dd>${esc(pol.why)} · routed in ${fmtMs(r.latency_ms)}</dd></div></dl>`;
      const bars = R.models.map(mm => `<div class="rt-bar${mm.key === pol.routed && !noPick ? " pick" : ""}"><span>${esc(mm.name)}</span>
        <div class="rt-track" role="img" aria-label="${esc(mm.name)} ${pct(r.probabilities[mm.key])}"><i style="width:${(r.probabilities[mm.key] || 0) * 100}%"></i></div><b>${pct(r.probabilities[mm.key])}</b></div>`).join("");
      const ans = R.answers?.[i];
      const canExec = one && !stale && !noCost && R.cfg?.exec_enabled && m?.deployment && !m.edited;
      return `<article class="rt-res">
        ${one ? "" : `<p class="rt-q">${esc(r.prompt.length > 160 ? r.prompt.slice(0, 160) + "…" : r.prompt)}</p>`}
        ${noPick ? `<p class="rt-pick"><span class="rt-to rt-na">Choice unavailable</span><span class="sx-note">The cheapest rule needs every price and token count · ${fmtMs(r.latency_ms)}</span></p>`
          : `<div class="rt-pick"><p class="rt-to" title="${esc(m?.name)}">${esc(m?.name)}</p>${noCost ? `<span class="sx-note">${esc(pol.why)} · ${fmtMs(r.latency_ms)}</span>` : ""}${facts}</div>`}
        ${canExec ? `<button class="sx-btn rt-exec" data-i="${i}" type="button" ${ans?.busy ? "disabled" : ""}>${ans?.busy ? "Getting the answer…" : `Get the answer from ${id(m.name)}`}</button>` : ""}
        ${ans?.text != null ? `<div class="rt-ans" tabindex="0" aria-label="Answer">${ans.text ? esc(ans.text).replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>") : "(The model returned an empty answer.)"}</div>
          <p class="sx-note">${esc(ans.model)} · ${fmtMs(ans.latency_ms)} · ${fmt$(ans.usd)}</p>` : ""}
        ${ans?.error ? `<p class="sx-err" role="alert">${esc(ans.error)}</p>` : ""}
        ${one ? `<div class="rt-bars">${bars}</div>` : ""}</article>`;
    });
    const n = R.results.length;
    out.classList.toggle("rt-is-stale", stale);
    out.innerHTML = `${stale ? `<p class="sx-note rt-stale" role="status">Input changed since this route. Showing the previous result. Route again to update.</p>` : ""}
      ${noCost ? `<p class="sx-note rt-invalid" role="status">Cost estimate unavailable until you fix: ${probs.map(x => esc(x.what)).join(", ")}. Nothing is treated as free.</p>` : ""}
      ${n > 1 && !noCost ? `<p class="rt-total"><b>${strong$ ? pct(1 - routed$ / strong$) : "—"}</b> cheaper than sending all ${n} prompts to ${id(fbM?.name)} <span class="sx-note">(${fmt$(routed$)} vs ${fmt$(strong$)}, estimated)</span></p>` : ""}
      ${rows.join("")}`;
    out.querySelectorAll(".rt-exec").forEach(b => b.onclick = () => execute(+b.dataset.i));
    renderBrief(stale, noCost);
  }

  function briefText() {
    return routeBrief(R.snap, R.results, R.models, R.fallback, knobs(), { now: new Date().toISOString(), version: R.ver });
  }
  function renderBrief(stale, invalid) {
    const out = $("#rt-out"), box = document.createElement("details");
    box.className = "sx-details rt-brief"; box.id = "rt-brief";
    const wasOpen = R.briefOpen;
    if (stale || R.busy || !R.snap || invalid) {
      box.innerHTML = `<summary>Decision brief (.md)</summary><p class="sx-note rt-brief-wait" role="status">${R.busy ? "Routing in progress. The brief is available when the new result arrives." : stale ? "Input changed since this route. Route again to download a brief." : "Fix the highlighted prices or token counts to download a brief."}</p>`;
    } else {
      box.innerHTML = `<summary>Decision brief (.md)</summary><p class="sx-note">Saves this result with the policy and prices shown now. It includes your prompts and model descriptions, no key. Saved to this device only.</p>
        <div class="rt-brief-bar"><button class="sx-btn rt-brief-btn" id="rt-brief-dl" type="button">Download brief (.md)</button>
        <button class="sx-btn rt-brief-btn" id="rt-brief-read" type="button" aria-controls="rt-brief-pre" aria-expanded="false">Read full brief</button></div>
        <pre class="rt-brief-pre" id="rt-brief-pre" tabindex="0" role="region" aria-label="Decision brief preview (exact file text)"></pre>`;
      const cur = briefText();
      briefPreview(box.querySelector("pre"), cur);
      box.querySelector("#rt-brief-dl").onclick = download;
      // Copy sits right after Download so phones pair them on one row; Read full brief spans the row below (t_9714d3b7).
      box.querySelector("#rt-brief-dl").insertAdjacentHTML("afterend", `<button class="sx-btn rt-brief-btn" id="rt-brief-cp" type="button">Copy brief</button>`);
      box.querySelector("#rt-brief-cp").onclick = copyBrief;
      copyStatus(box, cur);
      const rd = box.querySelector("#rt-brief-read"), pre = box.querySelector("pre");
      // Reading view: 15px body text, whole brief in page flow (no nested scroll); Download + Close stay pinned above it.
      const setFull = (on, focus) => { R.briefFull = on; box.classList.toggle("rt-brief-full", on); rd.setAttribute("aria-expanded", String(on));
        rd.textContent = on ? "Close full brief" : "Read full brief";
        if (focus === "pre") pre.focus(); else if (focus === "btn") { rd.focus(); rd.scrollIntoView({ block: "nearest" }); } };
      rd.onclick = () => setFull(!R.briefFull, R.briefFull ? "btn" : "pre");
      box.onkeydown = e => { if (e.key === "Escape" && R.briefFull) { e.preventDefault(); setFull(false, "btn"); } };
      setFull(!!R.briefFull);
    }
    box.open = !!wasOpen; box.ontoggle = () => { R.briefOpen = box.open; };
    out.appendChild(box);
  }
  // Preview = the exact file text (pre.textContent === briefText()); only presentation spans are added:
  // headings stand out, and each hyphenated token (ISO time, model id, key) moves whole to the next line when it fits.
  function briefPreview(pre, txt) {
    pre.textContent = "";
    let fence = false; // prompt text sits in ``` fences: never styled as a brief heading
    txt.split("\n").forEach((line, i, all) => {
      const s = document.createElement("span");
      if (/^```/.test(line)) fence = !fence;
      else if (!fence && /^#{1,3} /.test(line)) s.className = "rt-bh";
      line.split(/(\S*-\S*)/).forEach((part, j) => {
        if (!part) return;
        if (j % 2 && part.length <= 48) { const t = document.createElement("span"); t.className = "rt-id"; t.textContent = part; s.appendChild(t); }
        else s.appendChild(document.createTextNode(part));
      });
      pre.appendChild(s);
      if (i < all.length - 1) pre.appendChild(document.createTextNode("\n"));
    });
  }
  function download() {
    if (R.busy || isStale() || !R.snap || problems().length) { renderOut(); return; }
    const txt = briefText(), a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/markdown" }));
    a.download = `jev-routing-brief-${R.snap.routedAt.replace(/[:.]/g, "-")}.md`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Copy brief (t_a76c0f94): clipboard only, on an explicit press. Same briefText() as the preview and the download.
  // "Copied" only after the clipboard write resolves; if the brief changed meanwhile we say the OLD text was copied.
  // On failure the exact text is shown selectable so it can be copied by hand. Nothing is sent or stored.
  const noTs = t => String(t || "").replace(/^- Brief created \(UTC\): .*$/m, "");
  async function copyBrief() {
    if (R.busy || isStale() || !R.snap || problems().length) { R.copy = null; renderOut(); return; }
    const txt = briefText(), c = R.copy = { state: "pending", text: txt };
    renderOut(); $("#rt-brief-cp")?.focus();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("This browser does not allow copying from the page.");
      await navigator.clipboard.writeText(txt);
      if (R.copy === c) c.state = "ok";
    } catch (e) { if (R.copy === c) { c.state = "fail"; c.err = (e && e.message) || "Copy was blocked."; } }
    if (R.copy === c) renderOut();
    const f = c.state === "fail" ? $("#rt-brief-cpfb") : $("#rt-brief-cp"); f?.focus(); if (c.state === "fail") selTop(f);
    announce(R.copy === c ? $("#rt-brief-cpst")?.textContent : "");
  }
  // Select the whole fallback but keep it anchored at its first line (select() alone scrolls it to the end).
  function selTop(ta) { if (!ta) return; ta.setSelectionRange(0, ta.value.length, "backward"); ta.scrollTop = 0;
    requestAnimationFrame(() => { ta.scrollTop = 0; }); }
  // renderOut() rebuilds #rt-out, so a new role=status node is not reliably announced; this persistent polite region is.
  function announce(t) { let r = $("#rt-cp-live"); if (!r) { r = document.createElement("div"); r.id = "rt-cp-live"; r.className = "sx-vh";
      r.setAttribute("role", "status"); r.setAttribute("aria-live", "polite"); document.body.appendChild(r); }
    r.textContent = ""; if (t) setTimeout(() => { r.textContent = t; }, 50); }
  function copyStatus(box, cur) {
    const c = R.copy; if (!c) return;
    const changed = noTs(c.text) !== noTs(cur);
    const p = document.createElement("p"); p.className = "sx-note rt-brief-cpst"; p.id = "rt-brief-cpst"; p.setAttribute("role", "status");
    if (c.state === "pending") p.textContent = "Copying…";
    else if (c.state === "ok") { if (!changed) p.classList.add("rt-brief-ok"); p.textContent = changed ? "Copied the earlier brief. The brief has changed since, so copy again for the current one." : "Brief copied to your clipboard. Paste it where you need it."; if (changed) p.classList.add("rt-brief-wait"); }
    else {
      p.className = "sx-err rt-brief-cpst"; p.setAttribute("role", "alert");
      p.textContent = `Not copied: ${c.err} Select the text below and copy it yourself${changed ? " (this is the earlier brief; the current one is in the preview)" : ""}.`;
    }
    box.querySelector(".rt-brief-bar").after(p);
    if (c.state === "fail") { const ta = document.createElement("textarea"); ta.id = "rt-brief-cpfb"; ta.className = "rt-brief-cpfb"; ta.readOnly = true; ta.rows = 6;
      ta.setAttribute("aria-label", "Brief text to copy by hand"); ta.value = c.text; ta.onfocus = () => selTop(ta); p.after(ta); }
  }

  function isStale() { return R.resSig != null && inputSig(prompts(), R.models) !== R.resSig; }

  async function execute(i) {
    if (isStale() || problems().length) { renderOut(); return; }
    const r = R.results[i], k = knobs(), pol = policy(r.probabilities, r.confidence, R.models, R.fallback, k.confT, k.cheapP, k.tin, k.tout);
    R.answers[i] = { busy: true }; renderOut();
    try { R.answers[i] = await api("/api/router/execute", { model: pol.routed, prompt: r.prompt }, true); }
    catch (e) { R.answers[i] = { error: e.message }; }
    renderOut();
  }

  // ---------- benchmark: one chart + compact table + one footnote
  const SHORT = { jev: "Jev", jev_pol: "Jev with fallback", llm: "LLM router", embed: "Embeddings", strong: "Always strong" };
  const NOTE = { jev: "jev-1.13", jev_pol: "falls back when unsure", llm: "gpt-5.4-mini", embed: "text-embedding-3-small", strong: "gpt-5.4 for everything" };
  function benchView(b) {
    const rs = b.routers.filter(r => SHORT[r.key]);
    const chart = `<div class="bx" role="img" aria-label="Routing accuracy by router">${rs.map(r => `<div class="bx-row${r.key.startsWith("jev") ? " jev" : ""}">
      <span class="bx-n">${esc(SHORT[r.key])}</span><div class="bx-t"><i style="width:${(r.accuracy || 0) * 100}%"></i></div><b>${pct(r.accuracy)}</b></div>`).join("")}</div>`;
    const tr = r => `<tr><th scope="row">${esc(SHORT[r.key])}<small>${esc(NOTE[r.key])}</small></th><td>${pct(r.accuracy)}</td><td>${pct(r.saving_vs_strong)}</td><td>${r.latency_p50_ms ? fmtMs(r.latency_p50_ms) : "—"}</td><td>${r.usd_per_1k_routes ? fmt$(r.usd_per_1k_routes) : "—"}</td></tr>`;
    const date = String(b.run_at || "").slice(0, 10);
    const jev = rs.find(r => r.key === "jev_pol");
    return `<div class="bx-wrap"><div><h3>Accuracy: routed to the labelled model</h3>${chart}</div>
      <div class="sx-tablewrap"><table class="sx-table"><thead><tr><th scope="col">Router</th><th scope="col">Accuracy</th><th scope="col">Saving</th><th scope="col">Latency</th><th scope="col">Per 1k routes</th></tr></thead>
      <tbody>${rs.map(tr).join("")}</tbody></table></div></div>
      <p class="sx-foot-note">One run on ${b.dataset.n} public prompts (${date}). Saving is estimated from list prices, not billed.${jev ? ` With fallback, ${pct(jev.quality_risk)} of hard prompts went to the small model.` : ""} <a href="#method">How we measured</a></p>
      <details class="sx-details" id="method"><summary>Method and limits</summary>
        <p>${esc(b.dataset.description)}. Labels were frozen before any router ran. Model descriptions were written before the run and not tuned.</p>
        <p>Accuracy counts a route as right when it matches the label. Saving compares the estimated cost with sending every prompt to the strong model, at ${b.assumed_tokens.in} input and ${b.assumed_tokens.out} output tokens per call. Latency is the median routing call. With n = ${b.dataset.n}, accuracy is within about ±5 points.</p>
        <p>Labels describe the task type, not which model actually answered correctly, so an easy maths item labelled strong may be fine on the small model.</p>
        <p><a href="/static/router_bench/results.json" download>results.json</a> · <a href="/static/router_bench/predictions.csv" download>predictions.csv</a></p>
      </details>`;
  }
  async function renderBench() {
    const box = $("#rt-bench-body");
    try {
      const b = await api("/api/router/benchmark");
      if (!b.available) { box.innerHTML = `<p class="sx-note">The benchmark isn't available yet.</p>`; return; }
      box.innerHTML = benchView(b);
      if (location.hash === "#method") $("#method").open = true;
    } catch (e) { box.innerHTML = `<p class="sx-err" role="alert">Couldn't load the benchmark. ${esc(e.message)}</p>`; }
  }

  function init() {
    const th = $("#theme");
    th.onclick = () => { const h = document.documentElement; h.dataset.theme = h.dataset.theme === "dark" ? "light" : "dark"; };
    $("#rt-examples").innerHTML = EXAMPLES.map(([l, p], i) => `<button type="button" class="sx-chip" data-i="${i}">${esc(l)}</button>`).join("");
    $("#rt-examples").onclick = e => { const b = e.target.closest("[data-i]"); if (!b) return; $("#rt-prompt").value = EXAMPLES[+b.dataset.i][1]; $("#rt-batch").checked = false; draft(); $("#rt-prompt").focus(); };
    api("/api/router/config").then(c => { R.cfg = c; R.models = c.models.map(m => ({ ...m })); renderModels(); }).catch(e => { $("#rt-models").innerHTML = `<p class="sx-err">Couldn't load models. ${esc(e.message)}</p>`; });
    api("/api/config").then(x => { R.ver = x.version; $("#ver").textContent = String(x.version || "").split("-")[0]; }).catch(() => {});
    $("#rt-reset").onclick = () => { R.models = R.cfg.models.map(m => ({ ...m })); R.fallback = "strong"; renderModels(); renderOut(); };
    $("#rt-key").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    const draft = () => { syncGo(); renderOut(); };
    $("#rt-prompt").oninput = draft; $("#rt-batch").onchange = draft;
    $("#rt-sample").onclick = () => { $("#rt-prompt").value = SAMPLES.join("\n"); $("#rt-batch").checked = true; draft(); $("#rt-prompt").focus(); };
    $("#rt-go").onclick = go;
    $("#rt-prompt").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); });
    $("#rt-conf").oninput = () => { $("#rt-conf-v").textContent = (+$("#rt-conf").value).toFixed(2); renderOut(); };
    $("#rt-cheap-on").onchange = () => { $("#rt-cheap").disabled = !$("#rt-cheap-on").checked; renderOut(); };
    $("#rt-cheap").oninput = () => { $("#rt-cheap-v").textContent = (+$("#rt-cheap").value).toFixed(2); renderOut(); };
    ["#rt-tin", "#rt-tout"].forEach(id => $(id).oninput = () => { markField($(id), tokField(id)); renderOut(); });
    syncGo(); renderBench();
  }
  if (typeof module !== "undefined") module.exports = { policy, answerCost, cleanKey, inputSig, routeBrief, readNum };
  else init();
})();

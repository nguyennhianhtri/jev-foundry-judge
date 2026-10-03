// Three-section shell (Evaluate · Route · Benchmark). View-only: never touches the key, dataset, runs or exports.
// Evaluate = the existing 5-step flow (go(step) in app.js, unchanged); Route/Benchmark are sibling panels.
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const steps = $("#steps"), SEC = { route: "s-route", bench: "s-bench" };
  let cur = "key";
  function mark(sec) {
    $$("#secnav button").forEach(b => { const on = b.dataset.sec === (sec === "route" || sec === "bench" ? sec : "key"); b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    document.body.dataset.sec = sec === "route" || sec === "bench" ? sec : "eval";
  }
  function show(sec) {
    if (SEC[sec]) {
      $$(".panel").forEach(p => p.classList.toggle("on", p.id === SEC[sec]));
      if (steps) steps.hidden = true; mark(sec); window.scrollTo(0, 0);
      if (sec === "bench") loadBench();
      if (sec === "route") loadRoute();
      history.replaceState(null, "", "#" + sec);
    } else {
      if (steps) steps.hidden = false; mark("key");
      const on = $("#steps button.on"); window.go(on ? on.dataset.step : "key");
      history.replaceState(null, "", location.pathname);
    }
  }
  // every in-app go(step) (Connect, Next, Run done, links) returns to the Evaluate section
  const orig = window.go;
  window.go = function (step) { if (steps) steps.hidden = false; mark("key"); document.body.dataset.step = step; return orig(step); };
  document.body.dataset.step = "key"; document.body.dataset.sec = "eval";
  $$("#secnav button").forEach(b => b.onclick = () => show(b.dataset.sec));
  document.addEventListener("click", e => { const t = e.target.closest("[data-sec-go]"); if (t) { e.preventDefault(); show(t.dataset.secGo); } });

  let bench = null;
  async function getBench() { if (bench) return bench; const r = await fetch("/static/bench/summary.json"); if (!r.ok) throw new Error("HTTP " + r.status); bench = await r.json(); return bench; }
  async function loadBench() {
    try {
      const s = await getBench();
      $("#benchHead").innerHTML = JCharts.headline(s);
      $("#benchCharts").innerHTML = JCharts.full(s);
      const d = s.at ? new Date(s.at) : null;
      $("#benchMeta").textContent = `${s.rows} labelled agent conversations · ${s.jev?.evaluations ?? "—"} Jev and ${s.llm?.evaluations ?? "—"} LLM-judge metric scores · both judges called live.`;
      $("#benchMeta").insertAdjacentHTML("beforeend", ` <span class="nw">Recorded ${d ? d.toISOString().slice(0, 10) : "—"}</span>`);
    } catch (e) { $("#benchCharts").innerHTML = `<p class="err" role="alert">The published benchmark could not be loaded (${String(e.message).replace(/[<>&]/g, "")}). Reload to try again.</p>`; }
  }
  async function heroStats() {
    try { const s = await getBench(); $("#heroStats").innerHTML = JCharts.headline(s) + `<p class="hint">Published benchmark, ${s.rows} labelled conversations. <button type="button" class="linkish" data-sec-go="bench">Method and charts →</button></p>`; }
    catch { $("#heroStats").hidden = true; }
  }
  let routeChecked = false;
  async function loadRoute() {
    if (routeChecked) return; routeChecked = true;
    const st = $("#routeStatus"), a = $("#routeOpen");
    try {
      const r = await fetch("/api/router/config");
      if (!r.ok) throw 0;
      const c = await r.json();
      st.textContent = `Router ready: ${(c.models || []).length} models described${c.exec_enabled ? ", live execution on this host" : ""}. Use your Jev key on the router page; it stays in that tab only.`;
      a.hidden = false;
    } catch { st.innerHTML = "The model router is not enabled on this host yet. It will appear here when it ships; nothing else is affected."; }
  }
  // progressive disclosure never hides a target: programmatic focus/scroll into a closed <details> opens it first (view-only)
  const opener = el => { for (let d = el && el.parentElement && el.closest("details:not([open])"); d; d = d.parentElement && d.parentElement.closest("details:not([open])")) { if (el.tagName === "SUMMARY" && el.parentElement === d) break; d.open = true; } };
  const pf = HTMLElement.prototype.focus, ps = Element.prototype.scrollIntoView;
  HTMLElement.prototype.focus = function (o) { opener(this); return pf.call(this, o); };
  Element.prototype.scrollIntoView = function (o) { opener(this); return ps.call(this, o); };
  heroStats();
  const h = location.hash.slice(1); if (SEC[h]) show(h);
})();

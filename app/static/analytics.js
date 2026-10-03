// Privacy-light first-party usage counts (t_8395031b). No cookies, no storage, no third parties.
// Sends only: event name + allow-listed fields (route, referrer HOST, counts, export kind). Never prompts or keys.
(function () {
  "use strict";
  function send(e, p) {
    try {
      var body = JSON.stringify({ e: e, p: p || {} });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/t", new Blob([body], { type: "application/json" }));
      else fetch("/api/t", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true });
    } catch (_) { /* never break the page */ }
  }
  var route = location.pathname === "/evaluate" ? "/evaluate" : "/";
  var ref = "";
  try { ref = document.referrer ? new URL(document.referrer).origin : ""; } catch (_) { ref = ""; }
  send("page_view", { route: route, ref: ref });

  // Exports: every download in the app goes through an <a download> (link or programmatic click).
  function kindOf(name) { return String(name || "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[-_]?\d.*$/, "").replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "file"; }
  var seen = 0;
  function onDl(a) { var now = Date.now(); if (now - seen < 300) return; seen = now; send("export", { kind: kindOf(a.getAttribute("download") || a.pathname.split("/").pop()) }); }
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute("download")) onDl(this); return click.apply(this, arguments); };
  document.addEventListener("click", function (ev) { var a = ev.target && ev.target.closest && ev.target.closest("a[download]"); if (a) onDl(a); }, true);

  // Benchmark opened: the section scrolled into view once per page load.
  var opened = false;
  function bench(where) { if (opened) return; opened = true; send("benchmark_opened", { where: where }); }
  function watch(sel, where) {
    var el = document.querySelector(sel);
    if (!el || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { bench(where); io.disconnect(); } }, { threshold: 0.25 });
    io.observe(el);
  }
  if (route === "/") watch("#benchmark", "router"); else watch("#s-bench", "evaluate");

  window.jevTrack = send; // app.js reports eval_run with a case count
})();

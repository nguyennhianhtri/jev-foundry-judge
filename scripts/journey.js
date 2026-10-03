// Live browser journey + screen recording of the deployed app.
// U=<url> KEYFILE=<0600 file with JEV key> OUT=<dir> node journey.js
// The key is typed into a password field (masked dots) and cleared from the field on connect,
// so it never renders in any frame. Captions are injected as an on-page overlay (no voice).
const pp = require(process.env.PUPPETEER_PATH || "puppeteer-core");  // npm i puppeteer-core
const fs = require("fs"), path = require("path"), sl = ms => new Promise(r => setTimeout(r, ms));
const U = process.env.U, KEY = fs.readFileSync(process.env.KEYFILE, "utf8").trim(), OUT = process.env.OUT;
const FR = path.join(OUT, "frames"); fs.mkdirSync(FR, { recursive: true });
const res = { url: U, at: new Date().toISOString(), checks: {}, captions: [] };
(async () => {
  const b = await pp.launch({ executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", timeout: 180000, protocolTimeout: 900000,
    userDataDir: "/tmp/jfj_prof_" + Date.now(), args: ["--window-size=1920,1080", "--hide-scrollbars"] });
  const p = await b.newPage(); await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const errs = []; p.on("pageerror", e => errs.push(String(e).slice(0, 200)));
  const reqKeyLeak = []; p.on("request", q => { if (q.url().includes(KEY)) reqKeyLeak.push(q.url()); });
  const dl = path.join(OUT, "downloads"); fs.mkdirSync(dl, { recursive: true });
  const cdp = await p.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl }).catch(() => cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dl }));
  // screencast
  const frames = []; let rec = false, t0 = 0;
  cdp.on("Page.screencastFrame", async f => {
    if (rec) { const n = frames.length; fs.writeFileSync(path.join(FR, `f${String(n).padStart(5, "0")}.jpg`), Buffer.from(f.data, "base64")); frames.push(f.metadata.timestamp); }
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => { });
  });
  const cap = async (text) => {
    res.captions.push({ t: rec ? +((Date.now() - t0) / 1000).toFixed(1) : 0, text });
    await p.evaluate(t => {
      let d = document.getElementById("__cap");
      if (!d) { d = document.createElement("div"); d.id = "__cap"; d.style.cssText = "position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:99999;background:#0a0e16;color:#fff;font:600 26px 'Segoe UI',system-ui,sans-serif;padding:14px 26px;border-radius:14px;max-width:1500px;text-align:center;box-shadow:0 8px 30px #0006;border:1px solid #ffffff22;transition:opacity .25s"; document.body.append(d); }
      d.textContent = t; d.style.opacity = t ? 1 : 0;
    }, text);
  };
  const shot = n => p.screenshot({ path: path.join(OUT, n) });
  const click = async s => { await p.waitForSelector(s, { visible: true, timeout: 30000 }); await p.click(s); };

  await p.goto(U, { waitUntil: "networkidle2", timeout: 120000 });
  await p.waitForFunction(() => document.querySelector("#ver").textContent.length > 0, { timeout: 60000 });
  res.version = await p.$eval("#ver", e => e.textContent);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  rec = true; t0 = Date.now();
  await cap("Jev Foundry Judge: Foundry-compatible agent evaluators, with Jev as the judge"); await sl(4500);
  await cap("Step 1 · Bring your own Jev key. It stays in this tab and is never stored on the server"); await sl(1200);
  await p.click("#key"); await p.type("#key", KEY, { delay: 8 }); await sl(900);
  res.checks.keyFieldIsPassword = await p.$eval("#key", e => e.type === "password");
  await p.click("#verify");
  await p.waitForFunction(() => /Connected/.test(document.querySelector("#keystatus").textContent), { timeout: 60000 });
  res.checks.keyClearedFromField = await p.$eval("#key", e => e.value === "");
  res.connect = await p.$eval("#keystatus", e => e.textContent); await sl(2200);
  // dataset
  await p.waitForSelector("#s-data.on"); 
  await cap("Step 2 · Load three synthetic agent scenarios: support with tools, RAG Q&A, travel booking");
  for (const v of ["customer_support", "rag_qa", "travel_booking"]) { await p.select("#sample", v); await sl(500); await p.click("#loadSample"); await sl(900); }
  res.rowsLoaded = await p.$$eval("#dtable tbody tr", r => r.length); await sl(1200);
  await cap("Each row keeps a human label (1–5) per metric, and you can edit any of them inline"); 
  await p.evaluate(() => { const i = document.querySelector('#dtable tbody tr input.lab[data-m="task_adherence"]'); i.scrollIntoView({ block: "center" }); });
  await sl(2500); await shot("shot-1-dataset.png");
  await cap("Generate labelled regression cases: code injects one known defect into a good row");
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('#dtable tbody tr[data-i="0"] input.rs'); await sl(400);
  await click("#genBtn"); await sl(1300); await click("#genGo");
  await p.waitForFunction(n => document.querySelectorAll("#dtable tbody tr").length > n, { timeout: 30000 }, res.rowsLoaded);
  res.rowsAfterGenerate = await p.$$eval("#dtable tbody tr", r => r.length);
  await p.evaluate(() => document.querySelector("#dtable tbody tr:last-child").scrollIntoView({ block: "center" })); await sl(3000);
  // run
  await p.click('[data-step="run"]'); await sl(700);
  await cap("Step 3 · Run Jev on every row, next to Foundry's built-in LLM-judge evaluators");
  const bl = await p.$eval("#useBaseline", e => !e.disabled); if (bl) await p.click("#useBaseline");
  res.checks.baselineAvailable = bl;
  res.checks.foundryLogging = await p.$eval("#useFoundry", e => e.checked && !e.closest("label").hidden).catch(() => false);
  await cap("Both judges run inside one azure.ai.evaluation evaluate() call, logged to a Foundry project"); await sl(3200);
  await p.click("#runBtn");
  await cap("One Jev call per conversation answers about 17 typed questions covering all four metrics");
  const tRun = Date.now();
  await p.waitForSelector("#s-dash.on", { timeout: 900000 });
  res.runSeconds = (Date.now() - tRun) / 1000;
  await sl(800);
  res.studioUrl = await p.$eval("#studioLink", e => e.hidden ? null : e.href).catch(() => null);
  res.checks.studioLinkShown = !!res.studioUrl;
  await cap("Step 4 · The dashboard: every number comes from the live calls just made"); await sl(3000);
  await cap("Open in Foundry portal: the same run, rows and metrics are in your Foundry project"); await sl(3500);
  res.kpis = await p.$$eval(".kpi", ks => ks.map(k => k.innerText.replace(/\n/g, " | ")));
  await shot("shot-2-dashboard.png");
  await cap("Agreement with your human labels: Jev compared with the Foundry LLM judge");
  await p.evaluate(() => document.querySelector("#agree").scrollIntoView({ block: "center" })); await sl(4000);
  await cap("Click any row to see which atomic checks drove the score. No generated essay");
  await p.evaluate(() => document.querySelector("#rtable").scrollIntoView({ block: "start" })); await sl(900);
  await p.click('#rtable tbody tr[data-i="1"]'); await sl(1200);
  await p.evaluate(() => document.querySelector("#detail").scrollIntoView({ block: "center" })); await sl(4200);
  await shot("shot-3-row-detail.png");
  // export
  await p.click('[data-step="export"]'); await sl(600);
  await cap("Step 5 · Export the dataset, results and benchmark, then run the same evaluators in Foundry");
  await p.click("#exDataJ"); await sl(500); await p.click("#exResC"); await sl(500); await p.click("#exSum"); await sl(1800);
  await p.evaluate(() => document.querySelector("#snippet").scrollIntoView({ block: "center" })); await sl(4200);
  await shot("shot-4-export.png");
  await cap("Jev Foundry Judge · bring your own key · MIT licensed"); await sl(3500);
  rec = false; await cdp.send("Page.stopScreencast");
  res.recordSeconds = (Date.now() - t0) / 1000;
  await sl(1500);
  res.downloads = fs.readdirSync(dl);
  res.checks.threeDownloads = res.downloads.filter(f => !f.endsWith(".crdownload")).length === 3;
  res.summary = JSON.parse(await p.evaluate(() => JSON.stringify(S.summary)));
  res.checks.keyNotInUrls = reqKeyLeak.length === 0;
  res.checks.keyNotInDOMText = !(await p.evaluate(k => document.documentElement.outerHTML.includes(k), KEY));
  res.pageErrors = errs;
  // frame timing file for ffmpeg concat
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const d = i + 1 < frames.length ? Math.max(0.01, frames[i + 1] - frames[i]) : 0.5;
    lines.push(`file 'frames/f${String(i).padStart(5, "0")}.jpg'`, `duration ${d.toFixed(3)}`);
  }
  lines.push(`file 'frames/f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
  fs.writeFileSync(path.join(OUT, "frames.txt"), lines.join("\n"));
  res.frames = frames.length;
  fs.writeFileSync(path.join(OUT, "journey.json"), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ version: res.version, checks: res.checks, rows: res.rowsAfterGenerate, runSeconds: res.runSeconds, studioUrl: res.studioUrl, kpis: res.kpis, frames: res.frames, rec: res.recordSeconds, errs }, null, 1));
  const pid = b.process() && b.process().pid; if (pid) process.kill(pid, "SIGKILL"); process.exit(0);
})().catch(e => { console.error("FAIL", e); process.exit(1); });

// Record a scripted walkthrough via agentos-chrome (connect only). WS=<ws url> APP=cut|judge OUT=<dir> PWFILE KEYFILE
const pp = require(process.env.HOME + "/.hermes/Projects/Health/gym/node_modules/puppeteer-core");
const fs = require("fs"), path = require("path"), sl = ms => new Promise(r => setTimeout(r, ms));
const OUT = process.env.OUT; fs.mkdirSync(OUT + "/f", { recursive: true });
const IC = "https://jev-instant-cut.proudmeadow-5820d74a.southeastasia.azurecontainerapps.io";
const FJ = "https://jev-foundry-judge.delightfulpebble-359be12c.southeastasia.azurecontainerapps.io";
const caps = []; let t0, n = 0, rec = false, page;
const cap = t => { caps.push({ t: (Date.now() - t0) / 1000, text: t }); console.log("cap", t) };
async function shooter() { while (rec) { const s = Date.now(); try { const b = await page.screenshot({ type: "jpeg", quality: 80 }); fs.writeFileSync(`${OUT}/f/${String(n++).padStart(5, "0")}_${Date.now() - t0}.jpg`, b) } catch (e) {} const d = 200 - (Date.now() - s); if (d > 0) await sl(d) } }
const smooth = (y) => page.evaluate(y => window.scrollTo({ top: y, behavior: "smooth" }), y);
const scrollTo = (sel) => page.evaluate(s => { const e = document.querySelector(s); e && e.scrollIntoView({ behavior: "smooth", block: "center" }) }, sel);
async function typeSlow(sel, txt) { await page.click(sel); await page.keyboard.type(txt, { delay: 35 }) }
(async () => {
  const br = await pp.connect({ browserWSEndpoint: process.env.WS, defaultViewport: null });
  page = await br.newPage(); await page.setViewport({ width: 1920, height: 1080 });
  try {
    if (process.env.APP === "cut") {
      const PW = fs.readFileSync(process.env.PWFILE, "utf8").trim();
      await page.goto(IC + "/", { waitUntil: "domcontentloaded" });
      if (await page.$("#p")) { await page.type("#p", PW); await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click("button[type=submit]")]); }
      await page.waitForFunction(() => typeof ytReady !== "undefined" && ytReady && typeof V !== "undefined" && V && Object.keys(DIMS).length, { timeout: 90000 });
      console.log("VER", await page.evaluate(() => document.querySelector("#ver").textContent)); await sl(1500);
      t0 = Date.now(); rec = true; const sh = shooter();
      cap("Instant Cut: turn a long talk into a short highlight cut, scored by Jev."); await sl(5000);
      cap("A preloaded talk is already scored. Each row of the heatmap is one quality Jev rates."); await scrollTo("#heat"); await sl(6000);
      cap("Drag Length to set how long the cut should be. The strongest moments are picked to fit."); await scrollTo("#dur");
      await page.focus("#dur"); for (let k = 0; k < 6; k++) { await page.keyboard.press("ArrowLeft"); await sl(500) } await sl(2500);
      for (let k = 0; k < 4; k++) { await page.keyboard.press("ArrowRight"); await sl(500) } await sl(2000);
      cap("Play the cut: the player jumps between the chosen moments of the original video."); await scrollTo("#play");
      await page.click("#play"); await sl(9000); await page.click("#play").catch(() => {}); await sl(1000);
      cap("Find a moment by the exact words you remember. This search runs in the browser, so it is free."); await scrollTo("#find"); await sl(1500);
      await typeSlow("#findq", "future"); await sl(5000);
      cap("Keep or Skip any result to shape the cut by hand."); await page.evaluate(() => { const b = document.querySelector('#findres button[data-a=keep]'); b && b.scrollIntoView({ block: "center", behavior: "smooth" }) }); await sl(1500);
      await page.evaluate(() => { const b = document.querySelector('#findres button[data-a=keep]'); b && b.click() }); await sl(5000);
      cap("Name and save the cut, then export it as text or .srt captions."); await scrollTo("#savename"); await sl(1000);
      await typeSlow("#savename", "Demo highlights"); await sl(800); await page.click("#savebtn"); await sl(5500);
      cap("Instant Cut. Live on Azure Container Apps. Silent fallback cut; narration comes later."); await smooth(0); await sl(6000);
      rec = false; await sh;
    } else {
      const KEY = fs.readFileSync(process.env.KEYFILE, "utf8").trim();
      await page.goto(FJ + "/router/", { waitUntil: "networkidle2", timeout: 90000 }); await sl(1500);
      t0 = Date.now(); rec = true; const sh = shooter();
      cap("Jev Foundry Judge, part 1: the router sends each prompt to the cheapest model that can handle it."); await sl(5000);
      cap("Paste a Jev key. It stays in this browser tab and the field is masked."); await page.click("#rt-key"); await page.keyboard.type(KEY.slice(0, 24), { delay: 20 }); await page.evaluate(k => { const e = document.querySelector("#rt-key"); e.value = k; e.dispatchEvent(new Event("input", { bubbles: true })) }, KEY); await sl(3000);
      cap("Load nine mixed prompts, from trivia to hard reasoning."); await page.evaluate(() => { const b = document.querySelector("#rt-sample"); b.scrollIntoView({ block: "center" }); b.click() }); await sl(4000);
      cap("Route them. Jev predicts which model can answer each one, and the cost is estimated."); await scrollTo("#rt-go"); await sl(800); await page.click("#rt-go");
      await page.waitForFunction(() => !/Routing/.test(document.querySelector("#rt-go").textContent), { timeout: 90000 }).catch(() => {}); await sl(1500);
      await page.evaluate(() => window.scrollBy({ top: 600, behavior: "smooth" })); await sl(5000); await page.evaluate(() => window.scrollBy({ top: 600, behavior: "smooth" })); await sl(4000);
      cap("Part 2: /evaluate. Jev scores agent conversations on four Azure AI Foundry evaluators."); await page.goto(FJ + "/evaluate", { waitUntil: "networkidle2", timeout: 90000 }); await sl(5000);
      cap("Connect the same key. It is never stored or logged."); await page.evaluate(k => { const e = document.querySelector("#key"); e.value = k; e.dispatchEvent(new Event("input", { bubbles: true })) }, KEY); await sl(1200); await page.click("#verify"); await sl(4000);
      cap("Pick a synthetic scenario dataset. Every case shows the request, answer and tools."); await page.evaluate(() => document.querySelector('button[data-step=data]').click()); await sl(2000);
      await page.click("#loadSample"); await sl(1500); await page.evaluate(() => { const b = [...document.querySelectorAll("dialog[open] button, .modal button")].find(b => /apply|add|ok|load/i.test(b.textContent)); b && b.click() }); await sl(3500);
      cap("Run Jev on the dataset. Latency and cost come from each live response."); await page.evaluate(() => document.querySelector('button[data-step=run]').click()); await sl(2500);
      await page.evaluate(() => { const b = document.querySelector("#runBtn"); b.scrollIntoView({ block: "center" }); if (!b.disabled) b.click() }); await sl(3000);
      await page.waitForFunction(() => document.querySelector('#kpis') && !/Run an evaluation/.test(document.querySelector('#kpis').textContent) && document.querySelector('#kpis').textContent.trim().length > 20, { timeout: 120000 }).catch(e => console.log("NO SUMMARY")); await sl(2000);
      cap("The dashboard shows each check, agreement with human labels, latency and cost."); await page.evaluate(() => document.querySelector('button[data-step=dash]').click()); await sl(4000);
      await page.evaluate(() => window.scrollBy({ top: 700, behavior: "smooth" })); await sl(5000); await page.evaluate(() => window.scrollBy({ top: 700, behavior: "smooth" })); await sl(4000);
      cap("Export the results, a brief or a benchmark package. Silent fallback cut; narration comes later."); await page.evaluate(() => document.querySelector('button[data-step=export]').click()); await sl(6000);
      rec = false; await sh;
    }
  } finally { fs.writeFileSync(OUT + "/caps.json", JSON.stringify({ caps, end: (Date.now() - t0) / 1000 }, null, 1)); await page.close().catch(() => {}); br.disconnect(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1) });

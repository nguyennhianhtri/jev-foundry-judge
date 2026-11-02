// Repo rules as code. Add a rule whenever a mistake repeats. Run: node scripts/guard.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".venv", "venv", "workspace", "__pycache__", ".next"]);
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".py", ".json", ".yaml", ".yml", ".env", ".sh"]);
const rules = [
  { id: "no-private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "no-azure-key-literal", re: /(AccountKey|SharedAccessKey|api[_-]?key)\s*[:=]\s*["'][A-Za-z0-9+\/=_-]{24,}["']/i },
  { id: "no-bearer-literal", re: /Bearer\s+[A-Za-z0-9._-]{30,}/ },
  { id: "no-github-token", re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
];
const files = [];
(function walk(d) { for (const n of readdirSync(d)) { if (SKIP.has(n)) continue; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (EXT.has(extname(n)) && s.size < 2e6) files.push(p); } })(ROOT);
let bad = 0;
for (const f of files) { const rel = relative(ROOT, f); readFileSync(f, "utf8").split("\n").forEach((l, i) => { for (const r of rules) if (r.re.test(l)) { console.error(`${rel}:${i + 1} [${r.id}]`); bad++; } }); }
if (bad) { console.error(`guard: ${bad} violation(s)`); process.exit(1); }
console.log(`guard: ok (${files.length} files)`);

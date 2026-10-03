"""Generate docs/apim-architecture.drawio: model router behind Azure API Management (official Azure icons, base64-embedded).
ICON_DIR = folder of official Microsoft/Azure product SVGs (Azure architecture icon set)."""
import base64, os, re
from pathlib import Path
from xml.sax.saxutils import escape

ICONS = Path(os.environ.get("ICON_DIR", "icons"))
OUT = Path(__file__).resolve().parent / "apim-architecture.drawio"
cells, n = [], [1]
GEOM = []  # (id, x, y, w, h, kind) for geometry QA


def b64(name):
    t = (ICONS / f"{name}.svg").read_text()
    t = re.sub(r'(<svg\b[^>]*?)\s+width="[^"]*"', r"\1", t, count=1)
    t = re.sub(r'(<svg\b[^>]*?)\s+height="[^"]*"', r"\1", t, count=1)
    return base64.b64encode(t.encode()).decode()


def nid():
    n[0] += 1; return f"c{n[0]}"


def esc(s):
    return escape(s, {'"': "&quot;"})


def box(x, y, w, h, label, fill="#FFFFFF", stroke="#C8D1DC", fs=12, bold=False, align="center", valign="middle", dashed=False, kind="box", fc="#1A2733"):
    i = nid()
    st = (f"rounded=1;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontSize={fs};fontColor={fc};align={align};"
          f"verticalAlign={valign};arcSize=5;spacing=8;" + ("dashed=1;" if dashed else "") + ("fontStyle=1;" if bold else ""))
    cells.append(f'<mxCell id="{i}" value="{esc(label)}" style="{st}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
    GEOM.append((i, x, y, w, h, kind)); return i


def icon(x, y, name, label, s=56, lw=170):
    i = nid()
    st = f"shape=image;aspect=fixed;imageAspect=0;html=1;image=data:image/svg+xml,{b64(name)};"
    cells.append(f'<mxCell id="{i}" value="" style="{st}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{s}" height="{s}" as="geometry"/></mxCell>')
    GEOM.append((i, x, y, s, s, "icon"))
    box(x + s / 2 - lw / 2, y + s + 2, lw, 40, label, fill="none", stroke="none", fs=11, kind="label", valign="top")
    return i


def edge(a, b, label="", color="#2F6BFF", dashed=False, ex=None, ey=None, nx=None, ny=None, pts=None, w=2):
    i = nid()
    st = f"edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor={color};strokeWidth={w};endArrow=block;endFill=1;fontSize=11;fontColor=#1A2733;labelBackgroundColor=#FFFFFF;"
    if dashed: st += "dashed=1;"
    if ex is not None: st += f"exitX={ex};exitY={ey};exitDx=0;exitDy=0;"
    if nx is not None: st += f"entryX={nx};entryY={ny};entryDx=0;entryDy=0;"
    p = ('<Array as="points">' + "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in pts) + "</Array>") if pts else ""
    cells.append(f'<mxCell id="{i}" value="{esc(label)}" style="{st}" edge="1" parent="1" source="{a}" target="{b}"><mxGeometry relative="1" as="geometry">{p}</mxGeometry></mxCell>')


W, H = 1640, 900
box(20, 14, 1600, 40, "Model router behind Azure API Management: one endpoint, the gateway picks the model", fill="none", stroke="none", fs=20, bold=True, align="left", kind="title")

# lanes
LX = {"client": 20, "apim": 250, "router": 900, "models": 1240}
box(LX["client"], 70, 210, 600, "CLIENT", fill="#EEF3FF", stroke="#C9D6F5", bold=True, valign="top", kind="lane")
box(LX["apim"], 70, 620, 600, "AZURE API MANAGEMENT (Consumption) · AI gateway", fill="#F3F0FF", stroke="#D5CCF5", bold=True, valign="top", kind="lane")
box(LX["router"], 70, 310, 600, "ROUTING DECISION", fill="#F3F6F9", stroke="#D3DAE3", bold=True, valign="top", kind="lane")
box(LX["models"], 70, 380, 600, "AZURE OPENAI · existing deployments", fill="#FFF7E8", stroke="#F0DDB5", bold=True, valign="top", kind="lane")

# client
cl = box(45, 180, 160, 150, "Any OpenAI SDK / app<br><br>POST<br>/openai/deployments/<b>auto</b><br>/chat/completions<br>header api-key", fill="#FFFFFF", kind="node")
box(45, 360, 160, 120, "Pinned classes still work:<br>/deployments/small, strong<br>or code (no router call)", fill="#FFFFFF", stroke="#C9D6F5", fs=11, kind="node")

# APIM
apim = icon(300, 120, "api-management-services", "API Management<br>gateway", lw=150)
steps = [
    "1  Extract last user message",
    "2  send-request → router (timeout 3 s)",
    "3  Fail-safe → strong on timeout / non-200 / conf < 0.6",
    "4  rate-limit (Consumption) · llm-token-limit on v2 tiers",
    "5  set-backend-service → pool-{class}",
    "6  authentication-managed-identity → AOAI",
    "7  code class: chat → Responses API translation",
    "8  llm-emit-token-metric {routed-model, route-source}",
    "out  x-routed-model · x-route-source · x-route-confidence",
]
pol = box(470, 105, 380, 240, "<b>Inbound policy (infra/apim/policy-auto.xml)</b><br>" + "<br>".join(steps), fill="#FFFFFF", stroke="#B9A9EE", fs=11, align="left", valign="top", kind="node")
pools = box(470, 420, 380, 110, "<b>Backends + pools (circuit breaker: 3× 429/5xx in 1 min → trip 1 min)</b><br>pool-small: nano (p1) → 5.4 (p2)<br>pool-strong: 5.4<br>pool-code: codex (Responses API only, no cross-model failover)", fill="#FFFFFF", stroke="#B9A9EE", fs=11, align="left", valign="top", kind="node")
kv = icon(290, 420, "key-vaults", "Key Vault<br>named value jev-key", s=48, lw=150)
mi = icon(290, 555, "managed-identities", "APIM system-assigned MI (Entra ID)", s=44, lw=160)

# router
jev = box(930, 120, 250, 120, "<b>Router API</b><br>POST /api/router/route<br>returns {choice, probabilities, confidence}<br><i>option A: Jev Choice (hosted)</i>", fill="#FFFFFF", kind="node")
aca = icon(950, 270, "container-apps-environments", "Container Apps<br>(existing demo app)", s=48, lw=130)
vm = icon(1090, 270, "virtual-machine", "Option B: OSS classifier<br>on CPU VM / ACA, in-VNet", s=48, lw=150)
box(930, 560, 250, 90, "Router only sees the prompt text and model cards. With option B no prompt leaves the tenant.", fill="#F3F6F9", stroke="#D3DAE3", fs=11, kind="note")

# models
nano = icon(1280, 120, "azure-openai", "small: gpt-5.4-nano", s=48, lw=150)
g54 = icon(1280, 245, "azure-openai", "strong: gpt-5.4", s=48, lw=150)
cdx = icon(1280, 370, "azure-openai", "code: gpt-5.3-codex", s=48, lw=150)
fmr = icon(1470, 245, "foundry", "Foundry model-router<br>(benchmark baseline only)", s=48, lw=140)
box(1440, 120, 160, 100, "No new model capacity: reuses the demo's router deployments", fill="#FFFFFF", stroke="#F0DDB5", fs=11, kind="note")

# observability band
box(20, 690, 1600, 190, "OBSERVABILITY & IDENTITY", fill="#EEF8F1", stroke="#BFE3CB", bold=True, valign="top", kind="lane")
ai = icon(300, 730, "application-insights", "Application Insights<br>customMetrics by routed-model", s=48, lw=190)
law = icon(560, 730, "log-analytics-workspaces", "Log Analytics workspace", s=48, lw=170)
ent = icon(820, 730, "entra-id", "Microsoft Entra ID<br>MI → Cognitive Services OpenAI User,<br>Key Vault Secrets User", s=48, lw=230)
box(1100, 725, 480, 120, "<b>Measured (60-prompt stratified subset)</b><br>APIM auto accuracy 58/60 · router agreement 47/47<br>fallback to strong 13/60 (low confidence) · 0 errors<br>routing overhead p50 125 ms / p95 1.6 s (auto − pinned)", fill="#FFFFFF", stroke="#BFE3CB", fs=11, align="left", valign="top", kind="node")

# edges
edge(cl, apim, "", ex=1, ey=0.3, nx=0, ny=0.5)
edge(apim, pol, "", ex=1, ey=0.5, nx=0, ny=0.1)
edge(pol, jev, "route?", color="#7A5AF8", ex=1, ey=0.15, nx=0, ny=0.4)
edge(jev, aca, "", color="#7A5AF8", dashed=True, ex=0.25, ey=1, nx=0.5, ny=0)
edge(jev, vm, "", color="#7A5AF8", dashed=True, ex=0.8, ey=1, nx=0.5, ny=0)
edge(kv, pol, "jev-key", color="#8A6D00", dashed=True, ex=1, ey=0.5, nx=0, ny=0.95)
edge(pol, pools, "", color="#2F6BFF", ex=0.5, ey=1, nx=0.5, ny=0)
edge(pools, nano, "", ex=1, ey=0.2, nx=0, ny=0.5, pts=[(1230, 442), (1230, 144)])
edge(pools, g54, "", ex=1, ey=0.5, nx=0, ny=0.5, pts=[(1210, 475), (1210, 269)])
edge(pools, cdx, "Responses API", ex=1, ey=0.85, nx=0, ny=0.5, pts=[(1250, 513), (1250, 394)])
edge(mi, pools, "Bearer (MI)", color="#1E8E3E", dashed=True, ex=1, ey=0.5, nx=0, ny=0.85)
edge(pools, ai, "token metrics", color="#1E8E3E", dashed=True, ex=0.05, ey=1, nx=0.5, ny=0, pts=[(489, 650), (324, 650)])
edge(ai, law, "", color="#1E8E3E", dashed=True, ex=1, ey=0.5, nx=0, ny=0.5)

xml = (f'<mxfile host="generator"><diagram name="APIM router" id="apim"><mxGraphModel dx="{W}" dy="{H}" grid="1" gridSize="10" page="1" pageWidth="{W}" pageHeight="{H}" background="#FFFFFF"><root>'
       '<mxCell id="0"/><mxCell id="1" parent="0"/>' + "".join(cells) + "</root></mxGraphModel></diagram></mxfile>")
OUT.write_text(xml)

# geometry QA: nodes/icons must not overlap each other; everything inside page
bad = []
nodes = [g for g in GEOM if g[5] in ("node", "icon", "note")]
for a in range(len(nodes)):
    for b in range(a + 1, len(nodes)):
        i1, x1, y1, w1, h1, _ = nodes[a]; i2, x2, y2, w2, h2, _ = nodes[b]
        if x1 < x2 + w2 and x2 < x1 + w1 and y1 < y2 + h2 and y2 < y1 + h1: bad.append((i1, i2))
clip = [g for g in GEOM if g[1] + g[3] > W or g[2] + g[4] > H]
print("wrote", OUT, "cells", len(cells), "overlaps", bad, "clipped", clip)

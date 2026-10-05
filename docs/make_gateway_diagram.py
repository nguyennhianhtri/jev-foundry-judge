"""Generate docs/gateway-architecture.drawio: white-label model gateway on Azure API Management (official Azure icons, base64-embedded).
ICON_DIR = folder of official Microsoft/Azure product SVGs (Azure architecture icon set)."""
import base64, os, re
from pathlib import Path
from xml.sax.saxutils import escape

ICONS = Path(os.environ.get("ICON_DIR", "icons"))
OUT = Path(__file__).resolve().parent / "gateway-architecture.drawio"
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


W, H = 1640, 880
box(20, 14, 1600, 40, "White-label model gateway: one OpenAI-compatible endpoint, many backends, metered per key", fill="none", stroke="none", fs=20, bold=True, align="left", kind="title")
box(20, 70, 230, 560, "CUSTOMERS", fill="#EEF3FF", stroke="#C9D6F5", bold=True, valign="top", kind="lane")
box(270, 70, 600, 560, "AZURE API MANAGEMENT (Consumption) · data plane", fill="#F3F0FF", stroke="#D5CCF5", bold=True, valign="top", kind="lane")
box(890, 70, 330, 560, "CONTROL PLANE + PORTAL (Container App)", fill="#F3F6F9", stroke="#D3DAE3", bold=True, valign="top", kind="lane")
box(1240, 70, 380, 560, "MODEL BACKENDS", fill="#FFF7E8", stroke="#F0DDB5", bold=True, valign="top", kind="lane")

sdk = box(40, 120, 190, 150, "OpenAI SDK / curl<br><br>POST /gw/v1/chat/completions<br>header api-key<br>model: <b>auto</b> or a named model", kind="node")
op = box(40, 330, 190, 150, "Operator / partner<br><br>Portal: catalogue, playground, usage &amp; credits, admin (keys, limits, policy)", kind="node")

apim = icon(300, 120, "api-management-services", "API Management", lw=140)
steps = ["1  validate api-key (APIM subscription)", "2  send-request → /api/gw/decide", "     allow-list · req/min · credits · budget guard", "     model auto → router classifier", "3  rejected → 403 / 429 / 402 JSON error", "4  set-backend-service → gw-pool-{model}", "5  managed identity → Azure OpenAI / Foundry", "out  x-gateway-model · reason · confidence · cost", "out  one-way usage event → /api/gw/meter"]
pol = box(450, 110, 400, 230, "<b>Policy (infra/apim/policy-gateway.xml)</b><br>" + "<br>".join(steps), fill="#FFFFFF", stroke="#B9A9EE", fs=11, align="left", valign="top", kind="node")
pools = box(450, 400, 400, 130, "<b>Pools with circuit breakers</b> (3× 429/5xx in 1 min → trip 1 min)<br>nano → mini · mini → strong · deepseek → mini<br>strong → mini · compat → mini (optional)<br>Control plane down → fallback model", fill="#FFFFFF", stroke="#B9A9EE", fs=11, align="left", valign="top", kind="node")
mi = icon(300, 420, "managed-identities", "APIM managed identity", s=44, lw=140)

app = icon(940, 230, "container-apps-environments", "Container App<br>scale to zero", s=48, lw=120)
cp = box(1040, 110, 165, 200, "<b>Control plane</b><br>decide · meter<br>keys = APIM subscriptions (ARM)<br>config = APIM named value gw-config<br>theme = gateway/themes/*.json", fill="#FFFFFF", fs=11, align="left", valign="top", kind="node")
jev = box(910, 350, 140, 100, "<b>Router A</b><br>Jev API<br>(Choice question)", fill="#FFFFFF", fs=11, kind="node")
vm = icon(1100, 360, "virtual-machine", "Router B: Clef-flash<br>self-hosted VM", s=44, lw=130)

def side_icon(x, y, name, label):
    i = nid()
    st = f"shape=image;aspect=fixed;imageAspect=0;html=1;image=data:image/svg+xml,{b64(name)};"
    cells.append(f'<mxCell id="{i}" value="" style="{st}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="48" height="48" as="geometry"/></mxCell>')
    GEOM.append((i, x, y, 48, 48, "icon"))
    box(x + 56, y - 6, 200, 60, label, fill="none", stroke="none", fs=11, align="left", kind="label")
    return i
aoai = side_icon(1290, 120, "azure-openai", "<b>Azure OpenAI</b><br>gpt-5.4-nano · gpt-5.4-mini · gpt-5.4")
fnd = side_icon(1290, 230, "foundry", "<b>Microsoft Foundry</b><br>DeepSeek-V4-Flash (open weights)")
cmp = box(1290, 330, 300, 80, "Any OpenAI-compatible URL (vLLM, llama.cpp, other cloud) → gw-compat", fill="#FFFFFF", stroke="#F0DDB5", fs=11, kind="node", dashed=True)

box(20, 650, 1600, 200, "OBSERVABILITY, IDENTITY AND REBRANDING", fill="#EEF8F1", stroke="#BFE3CB", bold=True, valign="top", kind="lane")
ai = icon(300, 690, "application-insights", "Application Insights<br>gw.call events (per-key spend)<br>token metrics by routed model", s=48, lw=210)
ent = icon(640, 690, "entra-id", "Entra ID: managed identities<br>no keys to model backends", s=48, lw=210)
box(960, 690, 620, 130, "<b>White-label</b>: name, logo text, accent colours, currency and FX in one theme file (GW_THEME). No customer brand in code.<br><b>Cost</b>: Consumption APIM, scale-to-zero app, pay-per-token models; the self-hosted router VM stays deallocated until needed.", fill="#FFFFFF", stroke="#BFE3CB", fs=11, align="left", valign="top", kind="node")

edge(sdk, apim, "", ex=1, ey=0.3, nx=0, ny=0.5)
edge(apim, pol, "", ex=1, ey=0.5, nx=0, ny=0.1)
edge(pol, cp, "decide", color="#7A5AF8", ex=1, ey=0.17, nx=0, ny=0.25)
edge(cp, jev, "", color="#7A5AF8", dashed=True, ex=0.2, ey=1, nx=0.5, ny=0, pts=[(1073, 330), (980, 330)])
edge(cp, vm, "", color="#7A5AF8", dashed=True, ex=0.6, ey=1, nx=0.5, ny=0)
edge(op, app, "portal", color="#1A2733", ex=0.5, ey=1, nx=0, ny=0.5, pts=[(135, 615), (880, 615), (880, 254)])
edge(pol, pools, "", ex=0.5, ey=1, nx=0.5, ny=0)
edge(mi, pools, "Bearer (MI)", color="#1E8E3E", dashed=True, ex=1, ey=0.5, nx=0, ny=0.5)
edge(pools, aoai, "", ex=1, ey=0.5, nx=0, ny=0.5, pts=[(1260, 465), (1260, 144)])
edge(pools, fnd, "", ex=1, ey=0.5, nx=0, ny=0.5, pts=[(1260, 465), (1260, 254)])
edge(pools, cmp, "", dashed=True, ex=1, ey=0.85, nx=0.5, ny=1, pts=[(1440, 510)])
edge(pools, ai, "metrics", color="#1E8E3E", dashed=True, ex=0.1, ey=1, nx=0.5, ny=0, pts=[(490, 640), (324, 640)])
xml = (f'<mxfile host="generator"><diagram name="Model gateway" id="gw"><mxGraphModel dx="{W}" dy="{H}" grid="1" gridSize="10" page="1" pageWidth="{W}" pageHeight="{H}" background="#FFFFFF"><root>'
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

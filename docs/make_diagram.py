"""Generate docs/architecture.drawio (real Microsoft product icons, base64-embedded)."""
import base64, re, time
from pathlib import Path
from xml.sax.saxutils import escape

import os
ICONS = Path(os.environ.get("ICON_DIR", "icons"))  # folder of official Microsoft product SVGs (Azure architecture icon set)
OUT = Path(__file__).resolve().parent / "architecture.drawio"


def b64(name):
    for _ in range(20):
        try:
            t = (ICONS / f"{name}.svg").read_text(); break
        except OSError:
            time.sleep(1)
    t = re.sub(r'(<svg\b[^>]*?)\s+width="[^"]*"', r"\1", t, count=1)
    t = re.sub(r'(<svg\b[^>]*?)\s+height="[^"]*"', r"\1", t, count=1)
    return base64.b64encode(t.encode()).decode()


cells, n = [], [1]


def nid():
    n[0] += 1; return f"c{n[0]}"


def box(x, y, w, h, label, fill="#FFFFFF", stroke="#C8D1DC", dashed=False, fs=12, bold=False, align="center", valign="middle", rounded=1):
    i = nid()
    st = (f"rounded={rounded};whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontSize={fs};fontColor=#1A2733;"
          f"align={align};verticalAlign={valign};arcSize=6;spacing=8;" + ("dashed=1;" if dashed else "") + ("fontStyle=1;" if bold else ""))
    cells.append(f'<mxCell id="{i}" value="{escape(label.replace(chr(38)+"#10;", "<br>"), {chr(34): "&quot;"})}" style="{st}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
    return i


def icon(x, y, name, label, s=54):
    i = nid()
    st = (f"shape=image;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;aspect=fixed;imageAspect=0;"
          f"html=1;fontSize=12;fontColor=#1A2733;image=data:image/svg+xml,{b64(name)};")
    cells.append(f'<mxCell id="{i}" value="" style="{st}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{s}" height="{s}" as="geometry"/></mxCell>')
    box(x + s / 2 - 80, y + s + 4, 160, 34, label, fill="none", stroke="none", fs=11)
    return i


def edge(a, b, label="", color="#2F6BFF", dashed=False, ex=None, ey=None, nx=None, ny=None, pts=None):
    i = nid()
    st = f"edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor={color};strokeWidth=2;endArrow=block;endFill=1;fontSize=11;fontColor=#1A2733;labelBackgroundColor=#FFFFFF;"
    if dashed: st += "dashed=1;"
    if ex is not None: st += f"exitX={ex};exitY={ey};exitDx=0;exitDy=0;"
    if nx is not None: st += f"entryX={nx};entryY={ny};entryDx=0;entryDy=0;"
    cells.append(f'<mxCell id="{i}" value="{escape(label)}" style="{st}" edge="1" parent="1" source="{a}" target="{b}"><mxGeometry relative="1" as="geometry">' + (('<Array as="points">' + "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in pts) + '</Array>') if pts else "") + '</mxGeometry></mxCell>')


W, H = 1560, 820
box(20, 16, 1520, 44, "Jev Foundry Judge — typed-judge agent evaluation, Foundry-compatible", fill="none", stroke="none", fs=20, bold=True, align="left")
# lanes
box(20, 80, 250, 700, "BROWSER (visitor)", fill="#EEF3FF", stroke="#C9D6F5", bold=True, valign="top")
box(300, 80, 700, 700, "TEAM AZURE · Container Apps (scale 0–2, no key storage, access logs off)", fill="#F3F6F9", stroke="#D3DAE3", bold=True, valign="top")
box(1030, 80, 510, 700, "JUDGES", fill="#FFF7E8", stroke="#F0DDB5", bold=True, valign="top")

u = icon(108, 112, "browser", "Web UI (dataset lives in the tab)")
k = box(40, 230, 210, 74, "BYO Jev key\nheld in tab memory, sent per request as X-Jev-Key".replace("\n", "&#10;"), fill="#FFFFFF")
ds = box(40, 330, 210, 96, "Dataset builder&#10;samples · JSONL/CSV upload · edit rows · human labels · generated defect cases", fill="#FFFFFF")
dash = box(40, 450, 210, 84, "Dashboard&#10;scores · agreement · p50/p95 · $/1k evals · Open in Foundry portal", fill="#FFFFFF")
ex = box(40, 560, 210, 74, "Export&#10;dataset · results · summary · Foundry snippet", fill="#FFFFFF")

aca = icon(440, 112, "container-apps-environments", "Container App: FastAPI (stateless)")
ev = box(330, 230, 320, 210, "jev_foundry_judge (Python package)&#10;&#10;JevIntentResolution · JevTaskAdherence&#10;JevToolCallAccuracy · JevGroundedness&#10;JevAgentJudge (all metrics, 1 call/row)&#10;&#10;same inputs + *_score/_result/_reason keys as azure-ai-evaluation", fill="#FFFFFF", stroke="#2F6BFF")
comb = box(680, 230, 290, 210, "Combine in code&#10;&#10;weighted atomic answers → 1–5&#10;critical checks cap the score&#10;confidence = mean certainty&#10;_reason lists failed checks&#10;(no generated prose)", fill="#FFFFFF")
bl = box(680, 480, 290, 110, "Baseline adapter (optional)&#10;Foundry built-ins: IntentResolution, TaskAdherence, ToolCallAccuracy, Groundedness&#10;Entra token via managed identity · 120 rows/hour/instance", fill="#FFFFFF", stroke="#E3A72F")
mi = icon(380, 650, "entra-managed-identities", "User-assigned managed identity")
acr = icon(580, 650, "container-registries", "Container Registry (AcrPull)")
cost = icon(800, 650, "cost-management", "Budget alert $10/mo (RG)")
st = box(330, 480, 320, 110, "Stats&#10;pass/fail agreement @ threshold · MAE · Pearson r&#10;latency p50/p95 · tokens · list-price $", fill="#FFFFFF")

jev = box(1060, 140, 450, 180, "TypeSafe Jev (jev-latest)&#10;api.typesafe.ai/v1/systemone&#10;&#10;ONE request per conversation: shared state + ~17 typed questions (Score · Noul)&#10;billed on input tokens only ($0.042 / 1M)&#10;visitor's own key", fill="#FFFFFF", stroke="#2F6BFF", bold=False)
aoai = icon(1110, 420, "azure-openai", "Azure OpenAI · gpt-5.4-mini (host-paid baseline)")
fnd = icon(1390, 420, "foundry", "Foundry project jev-judge: eval runs + 4 custom Jev evaluators")
run = box(1060, 600, 450, 150, "Every Run = one Foundry evaluation run&#10;azure.ai.evaluation.evaluate(evaluators={'jev': JevAgentJudge(key), 'task_adherence': built-in, ...}, azure_ai_project=&lt;project endpoint&gt;)&#10;→ rows + metrics in the project · studio_url back to the dashboard&#10;managed identity · role Foundry User", fill="#FFFFFF", stroke="#2F6BFF", fs=11)

edge(ds, ev, "rows + key", ex=1, ey=0.3, nx=0, ny=0.4)
edge(ev, jev, "state + typed questions", ex=0.7, ey=0, nx=0, ny=0.3)
edge(jev, comb, "typed answers", color="#2F6BFF", ex=0.2, ey=1, nx=1, ny=0.3)
edge(bl, aoai, "", color="#E3A72F", ex=1, ey=0.5, nx=0, ny=0.5)
edge(comb, st, color="#5B6B80", ex=0.3, ey=1, nx=0.8, ny=0)
edge(ev, bl, "", color="#E3A72F", dashed=True, ex=1, ey=0.9, nx=0, ny=0.3)
edge(ev, run, "evaluate() run", color="#2F6BFF", ex=0.97, ey=1, nx=0, ny=0.5, pts=[(640, 462), (1042, 462), (1042, 675)])
edge(run, fnd, "", color="#2F6BFF", ex=1, ey=0.15, nx=1, ny=0.5, pts=[(1526, 622), (1526, 447)])
edge(st, dash, "results JSON", color="#5B6B80", ex=0, ey=0.5, nx=1, ny=0.5)

xml = ('<mxfile host="app.diagrams.net" type="device"><diagram name="Architecture" id="arch">'
       f'<mxGraphModel dx="{W}" dy="{H}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{W}" pageHeight="{H}" math="0" shadow="0">'
       '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' + "".join(cells) + "</root></mxGraphModel></diagram></mxfile>")
OUT.write_text(xml)
print(OUT)

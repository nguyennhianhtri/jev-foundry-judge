# Deterministic silent captioned render: python3 render.py <recdir> <out.mp4> <title>
# Frames f/NNNNN_<ms>.jpg + caps.json -> captions burned via PIL, VFR concat -> 30fps 1080p H.264, no audio. Writes <out>.srt too.
import json, os, sys, subprocess, glob
from PIL import Image, ImageDraw, ImageFont
rd, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(f"{rd}/caps.json")); caps = d["caps"]; end = d["end"]
fr = sorted(glob.glob(f"{rd}/f/*.jpg")); ts = [int(os.path.basename(f).split("_")[1][:-4]) / 1000 for f in fr]
F = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 40); FS = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
od = f"{rd}/o"; os.makedirs(od, exist_ok=True)
def cap_at(t):
    c = [x for x in caps if x["t"] <= t + 0.05]; return c[-1]["text"] if c else caps[0]["text"]
def wrap(txt, w=1700):
    words, lines, cur = txt.split(), [], ""
    for wd in words:
        tt = (cur + " " + wd).strip()
        if F.getlength(tt) > w: lines.append(cur); cur = wd
        else: cur = tt
    return lines + [cur]
lst = []
for i, (f, t) in enumerate(zip(fr, ts)):
    im = Image.open(f).convert("RGB").resize((1920, 1080)); dr = ImageDraw.Draw(im, "RGBA")
    ls = wrap(cap_at(t)); h = 40 + 52 * len(ls)
    dr.rectangle([0, 1080 - h, 1920, 1080], fill=(8, 10, 20, 235))
    for k, l in enumerate(ls): dr.text((960, 1080 - h + 22 + 52 * k), l, font=F, fill=(255, 255, 255), anchor="ma")
    tw = FS.getlength(title); x0 = 1920 - 140 - tw - 36; dr.rounded_rectangle([x0, 1080 - h - 62, x0 + tw + 36, 1080 - h - 16], 10, fill=(8, 10, 20, 210)); dr.text((x0 + 18, 1080 - h - 52), title, font=FS, fill=(140, 220, 255))
    p = f"{od}/{i:05d}.jpg"; im.save(p, quality=88)
    dur = (ts[i + 1] if i + 1 < len(ts) else end) - t
    lst.append(f"file '{p}'\nduration {max(dur, 0.04):.3f}")
lst.append(f"file '{od}/{len(fr)-1:05d}.jpg'")
open(f"{rd}/list.txt", "w").write("\n".join(lst) + "\n")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{rd}/list.txt", "-vf", "fps=30,format=yuv420p",
                "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-an", "-movflags", "+faststart", "-map_metadata", "-1", out], check=True)
def st(s): return f"{int(s//3600):02d}:{int(s%3600//60):02d}:{int(s%60):02d},{int(s*1000%1000):03d}"
srt = [f"{i+1}\n{st(c['t'])} --> {st(caps[i+1]['t'] if i+1 < len(caps) else end)}\n{c['text']}\n" for i, c in enumerate(caps)]
open(out[:-4] + ".srt", "w").write("\n".join(srt)); print("ok", out)

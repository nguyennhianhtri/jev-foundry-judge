#!/usr/bin/env python3
"""Add T's own Azure voice to the silent demo cut.

Reads narration lines from narration-script.md (lines like `[00:04.5] text`), synthesises each
line with Azure AI Speech via SSML, places each clip at its timestamp and muxes the result with
the silent MP4 into jev-foundry-judge-demo.mp4.

Voices supported:
  * Custom neural voice (professional): --voice <name> --endpoint-id <deployment id>
  * Personal voice:                      --voice DragonLatestNeural --speaker-profile-id <id>
  * Any voice name the Speech resource can serve: --voice <name>

The key is read from --key or the AZURE_SPEECH_KEY env var and is never printed.

Your own recorded voice (no synthesis): record one file per script line (l00.wav, l01.wav, ... in
script order; any format ffmpeg reads, e.g. .wav/.m4a/.mp3) and run
    python make_voiceover.py --recordings <dir>

Test without any synthetic voice:  python make_voiceover.py --placeholder
  (creates silent clips of the estimated spoken length so timing/mux can be verified)
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
LINE = re.compile(r"^\s*[-*]?\s*\[(\d+):(\d+(?:\.\d+)?)\]\s*(.+?)\s*$")


def parse_script(path: Path) -> list[tuple[float, str]]:
    out = []
    for l in path.read_text(encoding="utf-8").splitlines():
        m = LINE.match(l)
        if m:
            out.append((int(m.group(1)) * 60 + float(m.group(2)), m.group(3)))
    if not out:
        sys.exit(f"no [mm:ss.s] lines found in {path}")
    return out


def ssml(text: str, voice: str, rate: str, speaker_profile_id: str | None, lang: str) -> str:
    body = escape(text)
    if speaker_profile_id:
        body = (f'<mstts:ttsembedding speakerProfileId="{escape(speaker_profile_id)}">'
                f'<lang xml:lang="{lang}">{body}</lang></mstts:ttsembedding>')
    return (f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            f'xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="{lang}">'
            f'<voice name="{escape(voice)}"><prosody rate="{rate}">{body}</prosody></voice></speak>')


def synth(text, a, out: Path):
    url = f"https://{a.region}.tts.speech.microsoft.com/cognitiveservices/v1"
    if a.endpoint_id:
        url += f"?deploymentId={a.endpoint_id}"
    req = urllib.request.Request(url, ssml(text, a.voice, a.rate, a.speaker_profile_id, a.lang).encode("utf-8"), {
        "Ocp-Apim-Subscription-Key": a.key, "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-48khz-16bit-mono-pcm", "User-Agent": "jev-foundry-judge-voiceover"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out.write_bytes(r.read())


def placeholder(text, out: Path):
    secs = max(1.0, len(text.split()) / 2.6)  # ~156 wpm
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
                    "-t", f"{secs:.2f}", out.as_posix()], check=True)


def dur(p: Path) -> float:
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", p.as_posix()]).decode().strip())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", default=os.getenv("AZURE_SPEECH_REGION"))
    ap.add_argument("--key", default=os.getenv("AZURE_SPEECH_KEY"))
    ap.add_argument("--voice", default=os.getenv("AZURE_SPEECH_VOICE"))
    ap.add_argument("--endpoint-id", default=os.getenv("AZURE_SPEECH_ENDPOINT_ID"), help="custom neural voice deployment id")
    ap.add_argument("--speaker-profile-id", default=os.getenv("AZURE_SPEECH_SPEAKER_PROFILE_ID"), help="personal voice")
    ap.add_argument("--lang", default="en-US")
    ap.add_argument("--rate", default="0%")
    ap.add_argument("--script", default=str(HERE / "narration-script.md"))
    ap.add_argument("--video", default=str(HERE / "jev-foundry-judge-demo-silent.mp4"))
    ap.add_argument("--out", default=str(HERE / "jev-foundry-judge-demo.mp4"))
    ap.add_argument("--placeholder", action="store_true", help="silent clips only (timing test, no voice)")
    ap.add_argument("--recordings", help="dir with your own recorded clips l00.*, l01.*, ... (one per script line)")
    a = ap.parse_args()
    if not (a.placeholder or a.recordings) and not (a.region and a.key and a.voice):
        sys.exit("need --recordings <dir>, --placeholder, or --region/--key/--voice")
    lines = parse_script(Path(a.script))
    vdur = dur(Path(a.video))
    with tempfile.TemporaryDirectory() as td:
        clips, warn = [], []
        for i, (t, text) in enumerate(lines):
            p = Path(td) / f"l{i:02d}.wav"
            if a.recordings:
                src = sorted(Path(a.recordings).glob(f"l{i:02d}.*"))
                if not src:
                    sys.exit(f"missing recording l{i:02d}.* for line {i}: {text[:60]}")
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src[0].as_posix(), "-ac", "1", "-ar", "48000", p.as_posix()], check=True)
            elif a.placeholder:
                placeholder(text, p)
            else:
                synth(text, a, p)
            d = dur(p)
            nxt = lines[i + 1][0] if i + 1 < len(lines) else vdur
            if t + d > nxt + 0.05:
                warn.append(f"line {i} at {t:.1f}s runs {t + d - nxt:.1f}s past the next cue")
            clips.append((t, p, d))
            print(f"[{t:6.1f}s] {d:4.1f}s  {text[:70]}")
        ins, filt = [], []
        for i, (t, p, _) in enumerate(clips):
            ins += ["-i", p.as_posix()]
            filt.append(f"[{i + 1}:a]adelay={int(t * 1000)}:all=1[a{i}]")
        filt.append("".join(f"[a{i}]" for i in range(len(clips))) +
                    f"amix=inputs={len(clips)}:normalize=0,apad,atrim=0:{vdur:.3f}[aout]")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", a.video, *ins, "-filter_complex", ";".join(filt),
                        "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                        "-movflags", "+faststart", a.out], check=True)
    for w in warn:
        print("WARN:", w)
    print("wrote", a.out, f"({Path(a.out).stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

# Silent captioned demo (fallback)

- jev-foundry-judge-demo-silent-20261006.mp4 (the earlier jev-foundry-judge-demo-silent.mp4 is kept unchanged): 1920x1080, 81 s, no audio. Recorded 2026-10-06 against live v1.84.1-202609291840 (/healthz): router home, then /evaluate (Key, Dataset, Run on 8 synthetic rows with a real Jev call, Dashboard, Export).
- .srt: the same captions as a sidecar file, for adding T's voice later (t_cb92dc23).
- The key was entered only into password-masked fields and is not in any frame.
- Re-record: `APP=judge WS=<ws> OUT=<dir> KEYFILE=<0600 file> node record_walkthrough.js`, then `python3 render_silent.py`.

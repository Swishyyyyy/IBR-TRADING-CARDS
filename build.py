#!/usr/bin/env python3
"""Turn a night's scan (scan.txt) into tracks.json for Ice Lap Exchange.

scan.txt has one line per track:   <slug>@<display name>|<player>,<time>;<player>,<time>;...
or                                 <slug>@<display name>|NONE      (track has no leaderboard)

Tracks missing from tonight's scan keep their previous leaderboard, so a few failed
page loads never wipe data. Refuses to write if the scan looks broken.
"""
import json, re, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
scan_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "scan.txt"
out_path = ROOT / "tracks.json"
SLUG = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
NAME = re.compile(r"^[A-Za-z0-9_]{1,32}$")

prev = {}
if out_path.exists():
    try:
        prev = {t["id"]: t for t in json.loads(out_path.read_text())["tracks"]}
    except Exception:
        prev = {}

fresh, none, bad = {}, set(), []
for raw in scan_path.read_text(encoding="utf-8").splitlines():
    line = raw.strip().replace("\\_", "_")
    if not line or "|" not in line or "@" not in line.split("|", 1)[0]:
        continue
    head, rest = line.split("|", 1)
    slug, name = head.split("@", 1)
    slug, name = slug.strip(), name.strip()
    if name.endswith(" Track"):
        name = name[:-6]
    if not SLUG.match(slug):
        bad.append(slug); continue
    if rest.strip().upper() == "NONE":
        none.add(slug); continue
    top = []
    for i, pair in enumerate(p for p in rest.split(";") if "," in p):
        mc, t = pair.rsplit(",", 1)
        mc, t = mc.strip(), t.strip()
        if NAME.match(mc) and re.match(r"^[0-9:.]{3,12}$", t):
            top.append({"pos": i + 1, "mc": mc, "time": t})
    if top:
        fresh[slug] = {"id": slug, "name": name or slug, "top": top[:20]}
    else:
        bad.append(slug)

if len(fresh) < max(20, 0.5 * len(prev)):
    sys.exit(f"Refusing to write: only {len(fresh)} tracks parsed (had {len(prev)}). Scan looks broken.")

merged = dict(prev)
merged.update(fresh)
for slug in none:
    merged.pop(slug, None)
changed = sum(1 for k, v in fresh.items() if prev.get(k, {}).get("top") != v["top"])
doc = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "source": "https://boatlabs.net/tracks",
    "count": len(merged),
    "tracks": sorted(merged.values(), key=lambda t: t["id"].lower()),
}
out_path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"tracks.json: {len(merged)} tracks ({len(fresh)} scanned tonight, {changed} changed, {len(none)} without leaderboard, {len(bad)} unreadable)")

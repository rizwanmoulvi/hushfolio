#!/bin/bash
# Builds the read-only public demo from a running local app (npm run app):
# the web UI plus JSON snapshots of real testnet data. Nothing that can spend is included.
set -euo pipefail
APP=${APP:-http://localhost:7070}
OUT=${1:-dist/hushfolio}
rm -rf "$OUT" && mkdir -p "$OUT/snapshot"
cp web/* "$OUT/"
for p in account portfolio quote spend vault-book; do curl -sf "$APP/api/$p" > "$OUT/snapshot/$p.json"; done
curl -sf -X POST "$APP/api/disclose" -d '{}' > "$OUT/snapshot/disclose.json"
curl -sf --max-time 300 -X POST "$APP/api/audit" --data-binary @"$OUT/snapshot/disclose.json" > "$OUT/snapshot/audit.json"
at=$(date -u '+%-d %b %Y, %H:%M UTC')
sed -i '' "s#<script type=\"module\" src=\"app.js\"></script>#<script>window.HF_SNAPSHOT = 'snapshot/'; window.HF_SNAPSHOT_AT = '$at';</script>\n<script type=\"module\" src=\"app.js\"></script>#" "$OUT/index.html"
echo "built $OUT ($at)"

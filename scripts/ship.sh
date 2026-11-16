#!/bin/bash
# ship.sh — test, commit, push, deploy. Usage: npm run ship -- "commit message"
set -euo pipefail
cd "$(dirname "$0")/.."
MSG="${1:-Update Pulse Safety Desk}"
npm run check
npm test
git add -A
git diff --cached --quiet || git commit -m "$MSG"
git push
bash scripts/deploy.sh

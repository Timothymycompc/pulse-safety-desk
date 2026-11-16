#!/bin/bash
# deploy.sh — builds in Cloud Build and deploys to Cloud Run.
# Usage: scripts/deploy.sh          -> Pulse Safety Desk (service pulse-safety-desk)
#        scripts/deploy.sh helper   -> Wallet Helper, the second agent site (service pulse-wallet-helper)
# The Gemini key is read at startup from Secret Manager (GEMINI_API_KEY); it is never baked into the image.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=x300-506418
REGION=us-central1
SITE="${1:-desk}"
if [ "$SITE" = "helper" ]; then SERVICE=pulse-wallet-helper; else SITE=desk; SERVICE=pulse-safety-desk; fi
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" --source . \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT_ID=$PROJECT,DESK_SITE=$SITE" \
  --memory 512Mi --cpu 1 --min-instances 0 --max-instances 1 \
  --quiet
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format "value(status.url)"

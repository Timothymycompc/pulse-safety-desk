#!/bin/bash
# deploy.sh — builds in Cloud Build and deploys Pulse Safety Desk to Cloud Run.
# The Gemini key is read at startup from Secret Manager (GEMINI_API_KEY); it is never baked into the image.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=x300-506418
REGION=us-central1
SERVICE=pulse-safety-desk
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" --source . \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT_ID=$PROJECT" \
  --memory 512Mi --cpu 1 --min-instances 0 --max-instances 3 \
  --quiet
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format "value(status.url)"

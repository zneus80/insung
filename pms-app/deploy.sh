#!/bin/bash
set -e

GCLOUD=/Users/sooya/Downloads/google-cloud-sdk/bin/gcloud

echo "🚀 Cloud Run 배포 시작..."

$GCLOUD run deploy insung-pms \
  --source . \
  --region asia-northeast3 \
  --platform managed \
  --allow-unauthenticated \
  --project insung-pms

echo "✅ 배포 완료!"

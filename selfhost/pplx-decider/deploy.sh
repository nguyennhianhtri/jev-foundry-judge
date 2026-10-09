#!/usr/bin/env bash
# Deploy pplx-decider-v1.1-27b on Azure Container Apps serverless GPU (NVIDIA A100 80GB) behind /v1/systemone.
# Usage: RG=rg-pplx LOCATION=swedencentral ./deploy.sh
# Needs: az CLI with the containerapp extension, and Container Apps serverless A100 capacity in LOCATION
# (check: az containerapp env workload-profile list-supported -l $LOCATION). No VM GPU quota is required.
# The weights download from Hugging Face on first start (about 54 GB, a few minutes) and are cached on the replica.
set -euo pipefail
RG=${RG:?set RG}; LOCATION=${LOCATION:-swedencentral}
SUFFIX=${SUFFIX:-$(echo -n "$RG$LOCATION" | md5sum | cut -c1-6)}
ACR=${ACR:-acrpplx$SUFFIX}; ENV_NAME=${ENV_NAME:-cae-pplx-$SUFFIX}; APP=${APP:-pplx-decider}
KEY=${PPLX_API_KEY:-$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")}

az group create -n "$RG" -l "$LOCATION" -o none
az acr create -g "$RG" -n "$ACR" --sku Basic -l "$LOCATION" -o none
az acr build -r "$ACR" -t pplx-decider:v1.1.1 --no-logs ${PIP_INDEX_URL:+--build-arg PIP_INDEX_URL=$PIP_INDEX_URL} "$(dirname "$0")"
az containerapp env create -g "$RG" -n "$ENV_NAME" -l "$LOCATION" --enable-workload-profiles -o none
az containerapp env workload-profile add -g "$RG" -n "$ENV_NAME" --workload-profile-name gpu \
  --workload-profile-type Consumption-GPU-NC24-A100 -o none
# Create with a placeholder image so the app gets a managed identity, grant it AcrPull, then switch to our image.
az containerapp create -g "$RG" -n "$APP" --environment "$ENV_NAME" --workload-profile-name gpu \
  --image mcr.microsoft.com/k8se/quickstart:latest --system-assigned \
  --cpu 24 --memory 220Gi --min-replicas 0 --max-replicas 1 \
  --ingress external --target-port 8000 --secrets apikey="$KEY" --env-vars AUTOJEV_API_KEY=secretref:apikey PORT=8000 -o none
PID=$(az containerapp show -g "$RG" -n "$APP" --query identity.principalId -o tsv)
az role assignment create --assignee-object-id "$PID" --assignee-principal-type ServicePrincipal --role AcrPull \
  --scope "$(az acr show -n "$ACR" --query id -o tsv)" -o none
sleep 30  # role assignment propagation
az containerapp registry set -g "$RG" -n "$APP" --server "$ACR.azurecr.io" --identity system -o none
az containerapp update -g "$RG" -n "$APP" --image "$ACR.azurecr.io/pplx-decider:v1.1.1" \
  --min-replicas "${MIN_REPLICAS:-0}" -o none
FQDN=$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)
echo "Endpoint:  https://$FQDN/v1/systemone   (poll /health until status is ready; first start downloads the weights)"
echo "Router:    JEV_URL=https://$FQDN/v1/systemone JEV_MODEL=jev-latest JEV_API_KEY=<the key below>"
echo "API key:   $KEY   (store it in a secret manager; it is not saved anywhere else)"

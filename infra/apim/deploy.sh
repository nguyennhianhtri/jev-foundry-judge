#!/usr/bin/env bash
# Reproduce the APIM AI-gateway router. Idempotent (PUTs). No secrets in this file.
# Required env: SUB, RG, LOC, APIM, KV, AOAI, APPI, ROUTER_URL, PUBLISHER_EMAIL
# Pre-req: Key Vault secret "jev-key" already set (az keyvault secret set ... or ARM PUT).
set -euo pipefail
: "${SUB:?}" "${RG:?}" "${LOC:?}" "${APIM:?}" "${KV:?}" "${AOAI:?}" "${APPI:?}" "${ROUTER_URL:?}" "${PUBLISHER_EMAIL:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
V=2024-06-01-preview
A="https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.ApiManagement/service/$APIM"
put() { az rest --method put --url "$A/$1?api-version=$V" --body "$2" -o none; echo "  put $1"; }

# 1. APIM Consumption + system MI
az apim show -g "$RG" -n "$APIM" -o none 2>/dev/null || az apim create -g "$RG" -n "$APIM" -l "$LOC" \
  --sku-name Consumption --publisher-email "$PUBLISHER_EMAIL" --publisher-name "Jev router" --enable-managed-identity true -o none
PID=$(az apim show -g "$RG" -n "$APIM" --query identity.principalId -o tsv)
KVID=$(az keyvault show -n "$KV" --query id -o tsv)
AOID=$(az cognitiveservices account show -g "$RG" -n "$AOAI" --query id -o tsv)
AOEP=$(az cognitiveservices account show -g "$RG" -n "$AOAI" --query properties.endpoint -o tsv)
az role assignment create --assignee-object-id "$PID" --assignee-principal-type ServicePrincipal --role "Key Vault Secrets User" --scope "$KVID" -o none || true
az role assignment create --assignee-object-id "$PID" --assignee-principal-type ServicePrincipal --role "Cognitive Services OpenAI User" --scope "$AOID" -o none || true

dep() { case $1 in small) echo "${DEP_SMALL:-router-gpt-5-4-nano}";; strong) echo "${DEP_STRONG:-router-gpt-5-4}";; code) echo "${DEP_CODE:-router-gpt-5-3-codex}";; esac; }
# 2. Named values (jev-key from Key Vault via MI)
put namedValues/jev-key "{\"properties\":{\"displayName\":\"jev-key\",\"secret\":true,\"keyVault\":{\"secretIdentifier\":\"https://$KV.vault.azure.net/secrets/jev-key\"}}}"
put namedValues/code-deployment "{\"properties\":{\"displayName\":\"code-deployment\",\"value\":\"$(dep code)\"}}"
put namedValues/router-url "{\"properties\":{\"displayName\":\"router-url\",\"value\":\"$ROUTER_URL\"}}"
put namedValues/router-timeout-s "{\"properties\":{\"displayName\":\"router-timeout-s\",\"value\":\"${ROUTER_TIMEOUT_S:-3}\"}}"
put namedValues/router-min-confidence "{\"properties\":{\"displayName\":\"router-min-confidence\",\"value\":\"${ROUTER_MIN_CONF:-0.6}\"}}"
put namedValues/calls-per-minute "{\"properties\":{\"displayName\":\"calls-per-minute\",\"value\":\"${CPM:-120}\"}}"
put namedValues/tpm-per-subscription "{\"properties\":{\"displayName\":\"tpm-per-subscription\",\"value\":\"${TPM:-200000}\"}}"

# 3. Backends: one per AOAI deployment, circuit breaker on 429/5xx
CB='{"rules":[{"name":"trip","failureCondition":{"count":3,"interval":"PT1M","statusCodeRanges":[{"min":429,"max":429},{"min":500,"max":599}]},"tripDuration":"PT1M","acceptRetryAfter":true}]}'
for k in small strong code; do
  put backends/aoai-$k "{\"properties\":{\"url\":\"${AOEP%/}/openai/deployments/$(dep $k)\",\"protocol\":\"http\",\"circuitBreaker\":$CB}}"
done
# 4. Pools per route class: class deployment priority 1, strong priority 2 (failover when breaker trips)
# code: Responses API base (/openai/v1); codex has no chat-completions surface, so no cross-model failover in its pool
put backends/aoai-code "{\"properties\":{\"url\":\"${AOEP%/}/openai/v1\",\"protocol\":\"http\",\"circuitBreaker\":$CB}}"
put backends/pool-code "{\"properties\":{\"type\":\"Pool\",\"pool\":{\"services\":[{\"id\":\"/backends/aoai-code\",\"priority\":1,\"weight\":1}]}}}"
for k in small; do
  put backends/pool-$k "{\"properties\":{\"type\":\"Pool\",\"pool\":{\"services\":[{\"id\":\"/backends/aoai-$k\",\"priority\":1,\"weight\":1},{\"id\":\"/backends/aoai-strong\",\"priority\":2,\"weight\":1}]}}}"
done
put backends/pool-strong "{\"properties\":{\"type\":\"Pool\",\"pool\":{\"services\":[{\"id\":\"/backends/aoai-strong\",\"priority\":1,\"weight\":1}]}}}"

# 5. App Insights logger + API (Azure OpenAI chat-completions contract)
APPIKEY=$(az monitor app-insights component show -g "$RG" -a "$APPI" --query connectionString -o tsv)
APPID=$(az monitor app-insights component show -g "$RG" -a "$APPI" --query id -o tsv)
put loggers/appi "{\"properties\":{\"loggerType\":\"applicationInsights\",\"resourceId\":\"$APPID\",\"credentials\":{\"connectionString\":\"$APPIKEY\"}}}"
put apis/aoai-router "{\"properties\":{\"displayName\":\"Azure OpenAI (routed)\",\"path\":\"openai\",\"protocols\":[\"https\"],\"subscriptionRequired\":true,\"subscriptionKeyParameterNames\":{\"header\":\"api-key\",\"query\":\"subscription-key\"}}}"
put apis/aoai-router/operations/chat "{\"properties\":{\"displayName\":\"Chat completions\",\"method\":\"POST\",\"urlTemplate\":\"/deployments/{deployment-id}/chat/completions\",\"templateParameters\":[{\"name\":\"deployment-id\",\"type\":\"string\",\"required\":true}]}}"
python3 - "$HERE/policy-auto.xml" > /tmp/apim-pol.json <<'PY'
import json,sys; print(json.dumps({"properties":{"format":"rawxml","value":open(sys.argv[1]).read()}}))
PY
put apis/aoai-router/operations/chat/policies/policy @/tmp/apim-pol.json; rm -f /tmp/apim-pol.json
put apis/aoai-router/diagnostics/applicationinsights "{\"properties\":{\"loggerId\":\"/loggers/appi\",\"alwaysLog\":\"allErrors\",\"sampling\":{\"samplingType\":\"fixed\",\"percentage\":100},\"metrics\":true,\"verbosity\":\"information\"}}"
# 6. Product-less subscription scoped to the API (key: store in your vault, do not print)
put subscriptions/router-client "{\"properties\":{\"scope\":\"/apis/aoai-router\",\"displayName\":\"router-client\",\"state\":\"active\"}}"
echo "Gateway: $(az apim show -g "$RG" -n "$APIM" --query gatewayUrl -o tsv)/openai/deployments/auto/chat/completions"

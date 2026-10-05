#!/usr/bin/env bash
# White-label model gateway on the existing APIM (adds to deploy.sh; idempotent PUTs, no secrets in this file).
# Required env: SUB RG APIM CONTROL_URL (portal/control-plane base URL, e.g. the Container App)
#   AOAI_ENDPOINT      Azure OpenAI resource with deployments for nano / mini / strong
#   FOUNDRY_ENDPOINT   Foundry resource with an open-weight deployment (DeepSeek-V4-Flash)
# Optional: DEP_NANO DEP_MINI DEP_STRONG DEP_DEEPSEEK (deployment names), GW_CPM (gateway-wide calls/min),
#   OPENAI_COMPAT_URL (any OpenAI-compatible base, e.g. a vLLM VM: https://host/v1) -> backend gw-compat
# The internal token is generated and stored as a secret named value; set the same value as GW_INTERNAL_TOKEN on the app.
set -euo pipefail
: "${SUB:?}" "${RG:?}" "${APIM:?}" "${CONTROL_URL:?}" "${AOAI_ENDPOINT:?}" "${FOUNDRY_ENDPOINT:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
V=2024-06-01-preview
A="https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.ApiManagement/service/$APIM"
put() { az rest --method put --url "$A/$1?api-version=$V" --body "$2" -o none; echo "  put $1"; }
nv() { put "namedValues/$1" "{\"properties\":{\"displayName\":\"$1\",\"value\":\"$2\",\"secret\":${3:-false}}}"; }

CB='{"rules":[{"name":"trip","failureCondition":{"count":3,"interval":"PT1M","statusCodeRanges":[{"min":429,"max":429},{"min":500,"max":599}]},"tripDuration":"PT1M","acceptRetryAfter":true}]}'
be() { put "backends/$1" "{\"properties\":{\"url\":\"$2\",\"protocol\":\"http\",\"circuitBreaker\":$CB}}"; }
AO=${AOAI_ENDPOINT%/}; FD=${FOUNDRY_ENDPOINT%/}
be gw-nano     "$AO/openai/deployments/${DEP_NANO:-router-gpt-5-4-nano}"
be gw-mini     "$AO/openai/deployments/${DEP_MINI:-judge-gpt-5-4-mini}"
be gw-strong   "$AO/openai/deployments/${DEP_STRONG:-router-gpt-5-4}"
be gw-deepseek "$FD/openai/deployments/${DEP_DEEPSEEK:-gw-deepseek-v4-flash}"
pool() { # pool name, primary, failover...
  local n=$1 s="" p=1; shift
  for b in "$@"; do s="$s{\"id\":\"/backends/$b\",\"priority\":$p,\"weight\":1},"; p=$((p+1)); done
  put "backends/gw-pool-$n" "{\"properties\":{\"type\":\"Pool\",\"pool\":{\"services\":[${s%,}]}}}"
}
pool nano gw-nano gw-mini
pool mini gw-mini gw-strong
pool deepseek gw-deepseek gw-mini
pool strong gw-strong gw-mini
if [ -n "${OPENAI_COMPAT_URL:-}" ]; then be gw-compat "${OPENAI_COMPAT_URL%/}"; pool compat gw-compat gw-mini; fi

TOKEN=$(az rest --url "$A/namedValues/gw-internal-token/listValue?api-version=$V" --method post --query value -o tsv 2>/dev/null || true)
[ -n "$TOKEN" ] || TOKEN=$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")
nv gw-internal-token "$TOKEN" true
nv gw-control-url "${CONTROL_URL%/}"
nv gw-decide-timeout-s "${GW_DECIDE_TIMEOUT_S:-10}"
nv gw-calls-per-minute "${GW_CPM:-600}"
nv gw-fallback-model "gpt-5.4"
nv gw-fallback-pool "strong"
az rest --url "$A/namedValues/gw-config?api-version=$V" -o none 2>/dev/null || nv gw-config "{}"

put apis/gateway '{"properties":{"displayName":"Model gateway (OpenAI-compatible)","path":"gw/v1","protocols":["https"],"subscriptionRequired":true,"subscriptionKeyParameterNames":{"header":"api-key","query":"subscription-key"}}}'
put apis/gateway/operations/chat '{"properties":{"displayName":"Chat completions","method":"POST","urlTemplate":"/chat/completions"}}'
python3 - "$HERE/policy-gateway.xml" > /tmp/gw-pol.json <<'PY'
import json,sys; print(json.dumps({"properties":{"format":"rawxml","value":open(sys.argv[1]).read()}}))
PY
put apis/gateway/operations/chat/policies/policy @/tmp/gw-pol.json; rm -f /tmp/gw-pol.json
az rest --url "$A/diagnostics/applicationinsights?api-version=$V" -o none 2>/dev/null && \
  put apis/gateway/diagnostics/applicationinsights '{"properties":{"loggerId":"/loggers/appi","alwaysLog":"allErrors","sampling":{"samplingType":"fixed","percentage":100},"metrics":true,"verbosity":"information"}}' || true
put subscriptions/playground '{"properties":{"scope":"/apis/gateway","displayName":"playground","state":"active"}}'

# APIM managed identity must call both model resources.
PID=$(az apim show -g "$RG" -n "$APIM" --query identity.principalId -o tsv)
for ep in "$AO" "$FD"; do
  host=${ep#https://}; name=${host%%.*}
  id=$(az cognitiveservices account list --query "[?name=='$name'].id | [0]" -o tsv)
  [ -n "$id" ] && az role assignment create --assignee-object-id "$PID" --assignee-principal-type ServicePrincipal \
    --role "Cognitive Services OpenAI User" --scope "$id" -o none 2>/dev/null || true
done
echo "Gateway: $(az apim show -g "$RG" -n "$APIM" --query gatewayUrl -o tsv)/gw/v1/chat/completions"
echo "Set on the app: GW_INTERNAL_TOKEN (named value gw-internal-token), GW_APIM_ID=/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.ApiManagement/service/$APIM"

#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
NAME="yugi-bench-llm-proxy"
ORIGIN="${YUGI_WEB_ORIGIN:-https://d2lfte619q36vi.cloudfront.net}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/trust.json" <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
if ! aws iam get-role --role-name "$NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$NAME" \
    --assume-role-policy-document "file://$TMP/trust.json" >/dev/null
  sleep 10
fi
ROLE_ARN="$(aws iam get-role --role-name "$NAME" --query Role.Arn --output text)"
(cd "$ROOT/infra/llm-proxy" && python3 -m zipfile -c "$TMP/function.zip" handler.mjs)
if ! aws lambda get-function --region "$REGION" --function-name "$NAME" >/dev/null 2>&1; then
  aws lambda create-function --region "$REGION" --function-name "$NAME" \
    --runtime nodejs22.x --handler handler.handler --role "$ROLE_ARN" \
    --zip-file "fileb://$TMP/function.zip" --timeout 30 --memory-size 128 >/dev/null
else
  aws lambda update-function-code --region "$REGION" --function-name "$NAME" \
    --zip-file "fileb://$TMP/function.zip" >/dev/null
fi
aws lambda wait function-updated --region "$REGION" --function-name "$NAME"
if ! aws lambda put-function-concurrency --region "$REGION" --function-name "$NAME" \
  --reserved-concurrent-executions 3 >/dev/null 2>&1; then
  echo "WARNING: account concurrency quota prevents a reserved-concurrency cap." >&2
fi
cat >"$TMP/cors.json" <<EOF
{"AllowOrigins":["$ORIGIN"],"AllowMethods":["POST"],"AllowHeaders":["content-type"],"MaxAge":300}
EOF
if aws lambda get-function-url-config --region "$REGION" --function-name "$NAME" >/dev/null 2>&1; then
  aws lambda update-function-url-config --region "$REGION" --function-name "$NAME" \
    --auth-type NONE --cors "file://$TMP/cors.json" >/dev/null
else
  aws lambda create-function-url-config --region "$REGION" --function-name "$NAME" \
    --auth-type NONE --cors "file://$TMP/cors.json" >/dev/null
fi
for action in lambda:InvokeFunctionUrl lambda:InvokeFunction; do
  if [[ "$action" == "lambda:InvokeFunctionUrl" ]]; then
    aws lambda add-permission --region "$REGION" --function-name "$NAME" \
      --statement-id PublicFunctionUrl --action "$action" --principal '*' \
      --function-url-auth-type NONE >/dev/null 2>&1 || true
  else
    aws lambda add-permission --region "$REGION" --function-name "$NAME" \
      --statement-id PublicViaFunctionUrl --action "$action" --principal '*' \
      --invoked-via-function-url >/dev/null 2>&1 || true
  fi
done
URL="$(aws lambda get-function-url-config --region "$REGION" --function-name "$NAME" --query FunctionUrl --output text)"
printf '%s\n' "$URL" > "$ROOT/infra/llm-proxy-url.txt"
echo "LLM relay: $URL"

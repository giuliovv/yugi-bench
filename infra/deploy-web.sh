#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="yugi-bench-web-${ACCOUNT_ID}"
OAC_NAME="yugi-bench-web-${ACCOUNT_ID}"
COMMENT="Yugi Bench UI"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

OAC_ID="$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id | [0]" --output text)"
if [[ "$OAC_ID" == "None" || -z "$OAC_ID" ]]; then
  OAC_ID="$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "{\"Name\":\"$OAC_NAME\",\"Description\":\"Private S3 access for Yugi Bench\",\"SigningProtocol\":\"sigv4\",\"SigningBehavior\":\"always\",\"OriginAccessControlOriginType\":\"s3\"}" \
    --query OriginAccessControl.Id --output text)"
fi

DIST_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$COMMENT'].Id | [0]" --output text)"
if [[ "$DIST_ID" == "None" || -z "$DIST_ID" ]]; then
  BUCKET="$BUCKET" REGION="$REGION" OAC_ID="$OAC_ID" COMMENT="$COMMENT" \
    node -e '
      const fs = require("fs");
      const config = {
        CallerReference: `yugi-bench-${process.env.BUCKET}`,
        Comment: process.env.COMMENT,
        Enabled: true,
        DefaultRootObject: "index.html",
        Origins: { Quantity: 1, Items: [{
          Id: "yugi-bench-s3",
          DomainName: `${process.env.BUCKET}.s3.${process.env.REGION}.amazonaws.com`,
          S3OriginConfig: { OriginAccessIdentity: "" },
          OriginAccessControlId: process.env.OAC_ID
        }] },
        DefaultCacheBehavior: {
          TargetOriginId: "yugi-bench-s3",
          ViewerProtocolPolicy: "redirect-to-https",
          AllowedMethods: { Quantity: 2, Items: ["GET", "HEAD"], CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
          Compress: true,
          CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6"
        },
        PriceClass: "PriceClass_100",
        ViewerCertificate: { CloudFrontDefaultCertificate: true },
        Restrictions: { GeoRestriction: { RestrictionType: "none", Quantity: 0 } },
        IsIPV6Enabled: true,
        HttpVersion: "http2and3"
      };
      fs.writeFileSync(process.argv[1], JSON.stringify(config));
    ' "$TMP/distribution.json"
  DIST_ID="$(aws cloudfront create-distribution \
    --distribution-config "file://$TMP/distribution.json" \
    --query Distribution.Id --output text)"
fi

BUCKET="$BUCKET" ACCOUNT_ID="$ACCOUNT_ID" DIST_ID="$DIST_ID" \
  node -e '
    const fs = require("fs");
    const policy = {
      Version: "2012-10-17",
      Statement: [{
        Sid: "AllowCloudFrontReadOnly",
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${process.env.BUCKET}/*`,
        Condition: { StringEquals: { "AWS:SourceArn": `arn:aws:cloudfront::${process.env.ACCOUNT_ID}:distribution/${process.env.DIST_ID}` } }
      }]
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(policy));
  ' "$TMP/policy.json"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "file://$TMP/policy.json"
aws s3 sync "$ROOT/web/" "s3://$BUCKET/" --delete --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null

DOMAIN="$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)"
echo "Distribution: $DIST_ID"
echo "Bucket: $BUCKET"
echo "URL: https://$DOMAIN/"

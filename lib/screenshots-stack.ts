import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

const TARGET_DOMAIN = "shitposting.pictures";
const ACCOUNT_ID = "024196225137";
const CERTIFICATE_ARN =
  "arn:aws:acm:us-east-1:024196225137:certificate/59e87919-7258-4933-bb80-8dc350776628";
const HOSTED_ZONE_ID = "Z0013102DU3IS6GKE2D5";
// AWS managed cache policy: CachingOptimized (gzip+brotli, no forwarding)
const CACHING_OPTIMIZED_POLICY_ID = "658327ea-f89d-4fab-a63d-7e88639e58f6";

export class ScreenshotsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Tags matching existing resources
    cdk.Tags.of(this).add("project", "screenshots-cquinn");
    cdk.Tags.of(this).add("service", "screenshots-cquinn");
    cdk.Tags.of(this).add("user:Stack", "prod");
    cdk.Tags.of(this).add("user:email", "corey@duckbillgroup.com");

    // --- S3 Content Bucket ---
    const contentBucket = new s3.Bucket(this, "ContentBucket", {
      bucketName: TARGET_DOMAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: "intelligent-tiering",
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(0),
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const cfnContentBucket = contentBucket.node
      .defaultChild as s3.CfnBucket;
    cfnContentBucket.addPropertyDeletionOverride(
      "PublicAccessBlockConfiguration",
    );
    cfnContentBucket.addPropertyDeletionOverride("OwnershipControls");

    // --- S3 Logs Bucket (retained, no longer used for CF logging) ---
    const logsBucket = new s3.Bucket(this, "LogsBucket", {
      bucketName: `${TARGET_DOMAIN}-logs`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const cfnLogsBucket = logsBucket.node.defaultChild as s3.CfnBucket;
    cfnLogsBucket.addPropertyDeletionOverride(
      "PublicAccessBlockConfiguration",
    );
    cfnLogsBucket.addPropertyDeletionOverride("OwnershipControls");

    // --- Origin Access Control ---
    const oac = new cloudfront.CfnOriginAccessControl(this, "OAC", {
      originAccessControlConfig: {
        name: `oac-arn:aws:s3:::${TARGET_DOMAIN}-mn6dyutdpl0`,
        description: "Created by CloudFront",
        signingProtocol: "sigv4",
        signingBehavior: "always",
        originAccessControlOriginType: "s3",
      },
    });

    // --- CloudFront Distribution ---
    const distribution = new cloudfront.CfnDistribution(
      this,
      "Distribution",
      {
        distributionConfig: {
          enabled: true,
          aliases: [TARGET_DOMAIN],
          defaultRootObject: "index.html",
          comment: "",
          httpVersion: "http2",
          ipv6Enabled: false,
          priceClass: "PriceClass_100",
          origins: [
            {
              id: `arn:aws:s3:::${TARGET_DOMAIN}`,
              domainName: `${TARGET_DOMAIN}.s3.us-west-2.amazonaws.com`,
              s3OriginConfig: {
                originAccessIdentity: "",
              },
              originAccessControlId: oac.attrId,
              connectionAttempts: 3,
              connectionTimeout: 10,
            },
          ],
          defaultCacheBehavior: {
            targetOriginId: `arn:aws:s3:::${TARGET_DOMAIN}`,
            viewerProtocolPolicy: "redirect-to-https",
            allowedMethods: ["HEAD", "GET", "OPTIONS"],
            cachedMethods: ["HEAD", "GET", "OPTIONS"],
            compress: true,
            cachePolicyId: CACHING_OPTIMIZED_POLICY_ID,
          },
          customErrorResponses: [
            {
              errorCode: 404,
              responseCode: 404,
              responsePagePath: "/404.html",
              errorCachingMinTtl: 0,
            },
          ],
          viewerCertificate: {
            acmCertificateArn: CERTIFICATE_ARN,
            sslSupportMethod: "sni-only",
            minimumProtocolVersion: "TLSv1.2_2021",
          },
          restrictions: {
            geoRestriction: {
              restrictionType: "none",
            },
          },
        },
      },
    );

    // --- Bucket Policy (OAC only, stale OAI statement removed) ---
    new s3.CfnBucketPolicy(this, "ContentBucketPolicy", {
      bucket: TARGET_DOMAIN,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowCloudFrontServicePrincipal",
            Effect: "Allow",
            Principal: {
              Service: "cloudfront.amazonaws.com",
            },
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${TARGET_DOMAIN}/*`,
            Condition: {
              StringEquals: {
                "AWS:SourceArn": `arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${distribution.ref}`,
              },
            },
          },
        ],
      },
    });

    // --- Route53 A Record (alias to CloudFront) ---
    new route53.CfnRecordSet(this, "AliasRecord", {
      hostedZoneId: HOSTED_ZONE_ID,
      name: `${TARGET_DOMAIN}.`,
      type: "A",
      aliasTarget: {
        dnsName: distribution.attrDomainName,
        hostedZoneId: "Z2FDTNDATAQYW2", // CloudFront global hosted zone
        evaluateTargetHealth: true,
      },
    });

    // --- Deploy www/ contents ---
    new s3deploy.BucketDeployment(this, "DeployWebsite", {
      sources: [s3deploy.Source.asset("./www")],
      destinationBucket: contentBucket,
      prune: false, // Don't delete existing screenshots
    });
  }
}

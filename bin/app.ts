#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ScreenshotsStack } from "../lib/screenshots-stack";

const app = new cdk.App();
new ScreenshotsStack(app, "ScreenshotsCquinnStack", {
  env: {
    account: "024196225137",
    region: "us-west-2",
  },
});

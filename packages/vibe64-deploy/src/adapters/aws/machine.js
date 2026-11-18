// A service on whole machines of its own at AWS (a sandbox allowance, or reached at each instance): an EC2 Auto Scaling
// group from a launch template whose user data is machine.sh after one line, the service's spec. The script is the
// same for every service; it reads the spec from the machine's own user data and:
//
//   - installs Docker and jq on Amazon Linux 2023, signs in to the deployment's ECR with the machine's role;
//   - gives the container the instance facts (V64_INSTANCE_ID, V64_PRIVATE_ADDRESS, V64_INSTANCE_URL, V64_WORK_DIR, a
//     folder on the machine's own disk), the spec's settings, and each secret one read from Secrets Manager as the
//     machine starts (the spec holds where each is, never its value);
//   - runs the image with the machine's network, privileged where the service's sandbox allowances need user
//     namespaces or FUSE (the machine is the service's alone, so it is the boundary), its logs to CloudWatch Logs;
//   - once the service answers its health path, starts a second container (NAMES_IMAGE, AWS's own CLI image) that adds
//     the machine to the deployment's private names and takes it out as Docker stops it at shutdown, Docker's restart
//     policy bringing both back after a reboot, so nothing is written outside Docker; then tells Auto Scaling the
//     machine is ready (READY_HOOK). A machine whose service never answers is never ready, and Auto Scaling ends it
//     when its wait (READY_SECONDS) runs out.
//
// specOf reads the spec back from a template's user data, which is how the adapter knows what a group runs.
import { readFileSync } from "node:fs";

const SCRIPT = readFileSync(new URL("./machine.sh", import.meta.url), "utf8");
const SPEC_LINE = "# vibe64-spec ";
const READY_HOOK = "vibe64-ready";
const READY_SECONDS = 900;
// AWS's CLI image on its public registry, which a machine pulls with no sign-in through its public address.
const NAMES_IMAGE = "public.ecr.aws/aws-cli/aws-cli:2.17.0";

/**
 * A machine's user data, base64 as EC2 takes it: the script with the spec on its second line.
 * @param {{ service: string, name: string, region: string, image: string, version: string, size: string, port: number, healthPath: string, logGroup: string, privileged: boolean, namesService: string, namesImage: string, group: string, env: Record<string, string>, secrets: Record<string, { arn: string, key: string, versionId?: string | null }> }} spec
 */
function userDataOf(spec) {
  return Buffer.from(`#!/bin/bash\n${SPEC_LINE}${Buffer.from(JSON.stringify(spec)).toString("base64")}\n${SCRIPT}`).toString("base64");
}

/** The spec a machine's user data (base64) carries, or null. @param {string} userData */
function specOf(userData) {
  const line = Buffer.from(String(userData ?? ""), "base64").toString("utf8").split("\n").find((one) => one.startsWith(SPEC_LINE));
  return line ? JSON.parse(Buffer.from(line.slice(SPEC_LINE.length), "base64").toString("utf8")) : null;
}

export { NAMES_IMAGE, READY_HOOK, READY_SECONDS, specOf, userDataOf };

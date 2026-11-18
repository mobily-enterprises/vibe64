import assert from "node:assert/strict";
import test from "node:test";

import { AwsError, createAwsClient } from "../../packages/vibe64-deploy/src/adapters/aws/client.js";
import { STANDIN_KEYS, createAwsStandIn } from "../../packages/vibe64-deploy/src/adapters/aws/standIn.js";

// The AWS client against AWS's stand-in: each request signed with Signature Version 4 for its service's host, or sent
// through a gateway that signs with a token of its own; AWS's refusals in its three protocols read into one error; a
// credential that expired refreshed once; nothing secret handed to the logger.

const GATEWAY = "https://gateway.example/aws";

/** The stand-in, and a fetch that keeps what each request was sent to and with. */
function world(options = {}) {
  const standIn = createAwsStandIn(options.gateway ? { gateway: { url: GATEWAY, token: "token-1" } } : {});
  const sent = [];
  const fetch = (url, init) => {
    sent.push({ url: String(url), headers: { ...init.headers } });
    return standIn.fetch(url, init);
  };
  return { standIn, sent, fetch };
}

/** A few calls, one per protocol and kind of host. */
async function fewCalls(client) {
  await client.json("ecs", "DescribeClusters", { clusters: ["none"] });
  await client.query("ec2", "DescribeVpcs");
  await client.query("iam", "GetRole", { RoleName: "none" }).catch(() => null);
  await client.json("pricing", "GetProducts", { ServiceCode: "AWSELB", MaxResults: 1 });
  await client.s3("GET", "", "", { query: { prefix: "v64-" } });
}

test("the direct pathway signs each request for its service's host and region; through a gateway, the same calls go under its address", async () => {
  const direct = world();
  await fewCalls(createAwsClient({ region: "us-east-1", credential: STANDIN_KEYS, fetch: direct.fetch, now: direct.standIn.now }));
  assert.deepEqual(direct.sent.map((one) => one.url), [
    "https://ecs.us-east-1.amazonaws.com/", "https://ec2.us-east-1.amazonaws.com/", "https://iam.amazonaws.com/", "https://api.pricing.us-east-1.amazonaws.com/",
    "https://s3.us-east-1.amazonaws.com/?prefix=v64-"
  ]);
  assert.deepEqual(direct.sent.map((one) => /Credential=AKIDSTANDINEXAMPLE\/20261120\/([^/]+\/[^/]+)\/aws4_request/u.exec(one.headers.authorization)?.[1]),
    ["us-east-1/ecs", "us-east-1/ec2", "us-east-1/iam", "us-east-1/pricing", "us-east-1/s3"]);
  assert.deepEqual(direct.standIn.requests().map((one) => [one.mode, one.errorCode]), [["signed", null], ["signed", null], ["signed", "NoSuchEntity"], ["signed", null], ["signed", null]]);

  const gateway = world({ gateway: true });
  await fewCalls(createAwsClient({ region: "us-east-1", credential: { gateway: GATEWAY, token: () => "token-1" }, fetch: gateway.fetch, now: gateway.standIn.now }));
  assert.deepEqual(gateway.sent.map((one) => one.url), [
    `${GATEWAY}/ecs/us-east-1/ecs.us-east-1.amazonaws.com/`, `${GATEWAY}/ec2/us-east-1/ec2.us-east-1.amazonaws.com/`, `${GATEWAY}/iam/us-east-1/iam.amazonaws.com/`,
    `${GATEWAY}/pricing/us-east-1/api.pricing.us-east-1.amazonaws.com/`, `${GATEWAY}/s3/us-east-1/s3.us-east-1.amazonaws.com/?prefix=v64-`
  ]);
  assert.ok(gateway.sent.every((one) => one.headers.authorization === "Bearer token-1" && !one.headers["x-amz-date"]));
  assert.deepEqual(gateway.standIn.requests().map((one) => [one.mode, one.status]), [["gateway", 200], ["gateway", 200], ["gateway", 404], ["gateway", 200], ["gateway", 200]]);
  // A gateway's address is https, or http on this machine alone.
  assert.throws(() => createAwsClient({ region: "us-east-1", credential: { gateway: "http://gateway.example/aws", token: () => "t" } }), /https:\/\/…, or http:\/\/ on this machine only/u);
  assert.throws(() => createAwsClient({ region: "Virginia", credential: STANDIN_KEYS }), /An AWS region is a name such as us-east-1/u);
});

test("a wrong key, a wrong secret, a stale clock or a wrong gateway token is refused as AWS refuses it, never tried again", async () => {
  const { standIn, fetch } = world();
  const refusal = async (credential, now = standIn.now, protocol = "json") => {
    const client = createAwsClient({ region: "us-east-1", credential, fetch, now });
    const error = await (protocol === "json" ? client.json("ecs", "DescribeClusters", { clusters: [] }) : client.query("rds", "DescribeDBInstances")).catch((caught) => caught);
    assert.ok(error instanceof AwsError);
    return [error.code, error.status, error.retryable];
  };
  assert.deepEqual(await refusal({ ...STANDIN_KEYS, accessKeyId: "AKIDSOMEONEELSE00000" }), ["UnrecognizedClientException", 400, false]);
  assert.deepEqual(await refusal({ ...STANDIN_KEYS, secretAccessKey: "not-the-secret" }), ["InvalidSignatureException", 400, false]);
  assert.deepEqual(await refusal({ ...STANDIN_KEYS, secretAccessKey: "not-the-secret" }, standIn.now, "query"), ["SignatureDoesNotMatch", 403, false]);
  assert.deepEqual(await refusal(STANDIN_KEYS, () => new Date(standIn.now().getTime() - 20 * 60_000), "query"), ["RequestExpired", 403, false]);
  const gateway = world({ gateway: true });
  const client = createAwsClient({ region: "us-east-1", credential: { gateway: GATEWAY, token: () => "token-0" }, fetch: gateway.fetch, now: gateway.standIn.now });
  const error = await client.json("ecs", "DescribeClusters", { clusters: [] }).catch((caught) => caught);
  assert.deepEqual([error.code, error.status, error.retryable], ["unauthenticated", 401, false]);
  assert.equal(gateway.standIn.requests().length, 1);
});

test("AWS's errors in each protocol become an AwsError with its code; a throttle and no answer may answer later, a refusal waits", async () => {
  const { standIn, fetch } = world();
  const client = createAwsClient({ region: "us-east-1", credential: STANDIN_KEYS, fetch, now: standIn.now });
  const caught = async (call) => {
    const error = await call().catch((thrown) => thrown);
    assert.ok(error instanceof AwsError, String(error));
    return [error.service, error.code, error.status, error.retryable, Boolean(error.requestId)];
  };
  // JSON 1.1, ECS's error named with its namespace; EC2's own XML; RDS's ErrorResponse; S3's Error.
  assert.deepEqual(await caught(() => client.json("ecs", "DescribeServices", { cluster: "none", services: ["web"] })), ["ecs", "ClusterNotFoundException", 400, false, true]);
  assert.deepEqual(await caught(() => client.query("ec2", "AuthorizeSecurityGroupIngress", { GroupId: "sg-none", IpPermissions: [{ IpProtocol: "tcp", FromPort: 1, ToPort: 1, IpRanges: [{ CidrIp: "10.0.0.0/8" }] }] })),
    ["ec2", "InvalidGroup.NotFound", 400, false, true]);
  assert.deepEqual(await caught(() => client.query("rds", "DescribeDBInstances", { DBInstanceIdentifier: "none" })), ["rds", "DBInstanceNotFound", 404, false, true]);
  assert.deepEqual(await caught(() => client.s3("GET", "v64-none", "a/b.json")), ["s3", "NoSuchBucket", 404, false, true]);
  standIn.faults.throttle = 2;
  assert.deepEqual(await caught(() => client.json("ecs", "DescribeClusters", { clusters: [] })), ["ecs", "ThrottlingException", 400, true, true]);
  assert.deepEqual(await caught(() => client.query("ec2", "DescribeVpcs")), ["ec2", "Throttling", 400, true, true]);
  standIn.faults.down = true;
  assert.deepEqual(await caught(() => client.query("ec2", "DescribeVpcs")), ["ec2", "unreachable", null, true, false]);
});

test("an expired credential is refreshed once and the request asked again; the gateway's token too; the logger never sees a body", async () => {
  const { standIn, fetch } = world();
  let refreshed = 0;
  const heard = [];
  const client = createAwsClient({
    region: "us-east-1", credential: { credentials: () => STANDIN_KEYS, refresh: () => { refreshed += 1; } }, fetch, now: standIn.now, onRequest: (entry) => heard.push(entry)
  });
  standIn.faults.expiredToken = true;
  const made = await client.json("secretsmanager", "CreateSecret", { Name: "vibe64/test", SecretString: JSON.stringify({ password: "s3cr3t-value" }) });
  assert.match(made.ARN, /:secret:vibe64\/test-/u);
  assert.equal(refreshed, 1);
  assert.deepEqual(heard.map((one) => [one.service, one.action, one.status, one.errorCode]), [["secretsmanager", "CreateSecret", 400, "ExpiredTokenException"], ["secretsmanager", "CreateSecret", 200, null]]);
  assert.deepEqual(Object.keys(heard[0]).sort(), ["action", "errorCode", "ms", "requestId", "service", "status"]);
  // Neither the logger nor the stand-in's own log holds the secret.
  assert.equal(JSON.stringify(heard).includes("s3cr3t-value"), false);
  assert.equal(JSON.stringify(standIn.requests()).includes("s3cr3t-value"), false);

  const gateway = world({ gateway: true });
  let token = "token-1";
  const viaGateway = createAwsClient({ region: "us-east-1", credential: { gateway: GATEWAY, token: () => token, refresh: () => { token = "token-2"; } }, fetch: gateway.fetch, now: gateway.standIn.now });
  gateway.standIn.rotateGatewayToken("token-2");
  await viaGateway.query("ec2", "DescribeVpcs");
  assert.deepEqual(gateway.standIn.requests().map((one) => one.status), [401, 200]);
});

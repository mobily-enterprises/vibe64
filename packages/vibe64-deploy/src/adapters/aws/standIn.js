import { sha256Hex, signRequest } from "./sigv4.js";
import { createStandInCompute } from "./standIn/compute.js";
import { createStandInData } from "./standIn/data.js";
import { createStandInNetwork } from "./standIn/network.js";
import { createStandInPrices } from "./standIn/prices.js";
import { Fault, fault, listOf, unflatten } from "./standIn/wire.js";
import { specOf } from "./machine.js";
import { xmlOf } from "./xml.js";

// AWS's stand-in for the deploy engine's AWS adapter: a `fetch` that answers the requests the adapter's client makes
// (client.js), in memory, for one region of one AWS account, in AWS's three wire protocols and their shapes as AWS's
// API references and service models give them: JSON 1.1 (ECS, ECR, CodeBuild, Secrets Manager, CloudWatch Logs, ACM,
// Cloud Map, the Price List), Query (EC2 and its <item> lists, Auto Scaling, Elastic Load Balancing, RDS, IAM, with
// their <member> lists and Result wrappers) and S3's REST. The parts: standIn/network.js (EC2, load balancing),
// standIn/compute.js (ECS, ECR, CodeBuild, Cloud Map, Auto Scaling), standIn/data.js (RDS, IAM, Secrets Manager, ACM,
// Logs, S3) and standIn/prices.js. Nothing here reaches a network.
//
// Every request is authenticated as AWS or a signing gateway would: a request to an AWS host must carry a Signature
// Version 4 signature, by the stand-in's key, for the host's signing name and region, made within 15 minutes, over the
// headers and body that arrived (checked with sigv4.js, which the tests hold to AWS's published vectors); a request to
// the gateway (`gateway: { url, token }`) carries its bearer token and no AWS signature, at
// <gateway>/<signing name>/<signing region>/<host><path>. A wrong key, signature or token is refused as AWS refuses it.
//
// Everything slow at AWS moves on only when `advance()` runs: RDS boots, a namespace is made, a build ends, an ECS
// deployment rolls out (or back), a machine says it is ready, an instance refresh goes through, a deletion ends. A
// certificate is issued only once the test says its DNS records are in place (`issue(domain)`). Each advance moves
// AWS's clock (`now()`) 30 seconds on; a client signs with it. Faults, each a switch
// on `faults`: down (fetch fails), throttle (the next N requests are throttled), expiredToken (the next request's
// credential has expired), tasksFail, machinesNeverReady, buildFails.
//
// Every request is kept in order (`requests()`: how it was authenticated, its service and action, its parameters with
// any secret value replaced, and the status and error code it got).
// STAND-IN ONLY: one region; IAM evaluates the roles' inline Allow statements for Secrets Manager reads alone; tasks and
// machines are counted, not run; Cloud Map answers no DNS.

const STANDIN_KEYS = Object.freeze({ accessKeyId: "AKIDSTANDINEXAMPLE", secretAccessKey: "stand-in/secret/key/for/tests/only/0000000" });
const QUERY = Object.freeze({
  ec2: { version: "2016-11-15", namespace: "http://ec2.amazonaws.com/doc/2016-11-15/" },
  autoscaling: { version: "2011-01-01", namespace: "https://autoscaling.amazonaws.com/doc/2011-01-01/" },
  elasticloadbalancing: { version: "2015-12-01", namespace: "http://elasticloadbalancing.amazonaws.com/doc/2015-12-01/" },
  rds: { version: "2014-10-31", namespace: "http://rds.amazonaws.com/doc/2014-10-31/" },
  iam: { version: "2010-05-08", namespace: "https://iam.amazonaws.com/doc/2010-05-08/" }
});
const JSON_SERVICES = Object.freeze({
  AmazonEC2ContainerServiceV20141113: "ecs",
  AmazonEC2ContainerRegistry_V20150921: "ecr",
  CodeBuild_20161006: "codebuild",
  secretsmanager: "secretsmanager",
  Logs_20140328: "logs",
  CertificateManager: "acm",
  Route53AutoNaming_v20170314: "servicediscovery",
  AWSPriceListService: "pricing"
});
const FAULTS = Object.freeze({ down: false, throttle: 0, expiredToken: false, tasksFail: false, machinesNeverReady: false, buildFails: false });
const CLOCK_SKEW_MS = 15 * 60_000;
const STEP_MS = 30_000;
const SECRET_FIELDS = new Set(["SecretString", "SecretBinary"]);

/** The service a host is, and the name and region its requests are signed for, or null. */
function serviceOfHost(host, region) {
  if (host === "iam.amazonaws.com") return { service: "iam", signing: "iam", signingRegion: "us-east-1" };
  if (host === "api.pricing.us-east-1.amazonaws.com") return { service: "pricing", signing: "pricing", signingRegion: "us-east-1" };
  if (host === `api.ecr.${region}.amazonaws.com`) return { service: "ecr", signing: "ecr", signingRegion: region };
  const bucket = new RegExp(`^(?:([a-z0-9][a-z0-9.-]*)\\.)?s3\\.${region}\\.amazonaws\\.com$`, "u").exec(host);
  if (bucket) return { service: "s3", signing: "s3", signingRegion: region, bucket: bucket[1] ?? "" };
  const match = /^(ec2|autoscaling|elasticloadbalancing|rds|ecs|codebuild|secretsmanager|logs|acm|servicediscovery)\.([a-z0-9-]+)\.amazonaws\.com$/u.exec(host);
  return match && match[2] === region ? { service: match[1], signing: match[1], signingRegion: region } : null;
}

/** A value with secret fields replaced, to keep in the request log. */
function redacted(value) {
  if (Array.isArray(value)) return value.map(redacted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_FIELDS.has(key) ? "[secret]" : redacted(child)]));
  return value;
}

/**
 * @param {object} [options]
 * @param {string} [options.region]
 * @param {string} [options.account]
 * @param {{ accessKeyId: string, secretAccessKey: string, sessionToken?: string }} [options.credentials] the key requests are signed with
 * @param {{ url: string, token: string } | null} [options.gateway] a signing gateway and the token it takes
 * @param {() => Date} [options.now]
 */
function createAwsStandIn({ region = "us-east-1", account = "123456789012", credentials = STANDIN_KEYS, gateway = null, start = new Date("2026-11-20T09:00:00.000Z") } = {}) {
  let clock = start.getTime();
  const now = () => new Date(clock);
  const world = {
    region,
    account,
    seq: 0,
    now,
    faults: { ...FAULTS },
    id(prefix) {
      world.seq += 1;
      return `${prefix}-${world.seq.toString(16).padStart(17, "0")}`;
    }
  };
  world.network = createStandInNetwork(world);
  world.data = createStandInData(world);
  world.compute = createStandInCompute(world);
  world.certificateStatus = (arn) => world.data.certificateStatus(arn);
  const handlers = {
    ec2: world.network.ec2,
    elasticloadbalancing: world.network.elasticloadbalancing,
    rds: world.data.rds,
    iam: world.data.iam,
    secretsmanager: world.data.secretsmanager,
    acm: world.data.acm,
    logs: world.data.logs,
    autoscaling: world.compute.autoscaling,
    ecs: world.compute.ecs,
    ecr: world.compute.ecr,
    codebuild: world.compute.codebuild,
    servicediscovery: world.compute.servicediscovery,
    pricing: null
  };
  const prices = createStandInPrices(world);
  handlers.pricing = { GetProducts: prices.GetProducts };
  const log = [];
  const gatewayTokens = new Set(gateway ? [gateway.token] : []);

  /**
   * What a service runs with, by its ECS service's or Auto Scaling group's name: the image, its settings and each secret
   * read as ECS or the machine reads it (its version, or the current one), for its newest revision or template version.
   * @param {string} name
   */
  function environmentOf(name) {
    const { services, taskDefinitions, scalingGroups } = world.compute.view();
    const service = services.filter((one) => one.name === name && one.status === "ACTIVE").at(-1);
    let container;
    if (service) {
      const primary = service.deployments.find((one) => one.status === "PRIMARY");
      container = taskDefinitions.find((one) => one.taskDefinitionArn === primary.taskDefinition).containerDefinitions[0];
    } else {
      const group = scalingGroups.find((one) => one.name === name);
      if (!group) return null;
      const spec = specOf(world.network.templateData(group.template.id, group.template.version).UserData);
      container = { image: spec.image, environment: Object.entries(spec.env).map(([key, value]) => ({ name: key, value })), secrets: Object.entries(spec.secrets).map(([key, ref]) => ({ name: key, valueFrom: `${ref.arn}:${ref.key}::${ref.versionId ?? ""}` })) };
    }
    const env = Object.fromEntries((container.environment ?? []).map((one) => [one.name, one.value]));
    for (const secret of container.secrets ?? []) {
      const parts = secret.valueFrom.split(":");
      env[secret.name] = world.data.readSecretKey(parts.slice(0, 7).join(":"), parts[7], parts[9] || null).value;
    }
    return { image: container.image, env, secrets: (container.secrets ?? []).map((one) => one.name) };
  }

  /** A service's security groups, by its ECS service's or Auto Scaling group's name. @param {string} name */
  function securityGroupsOf(name) {
    const { services, scalingGroups } = world.compute.view();
    const service = services.filter((one) => one.name === name && one.status === "ACTIVE").at(-1);
    if (service) return service.networkConfiguration.awsvpcConfiguration.securityGroups;
    const group = scalingGroups.find((one) => one.name === name);
    const data = group ? world.network.templateData(group.template.id, group.template.version) : null;
    return data ? listOf(data.NetworkInterface).flatMap((one) => listOf(one.SecurityGroupId)) : [];
  }

  /** The request's signature checked against what arrived, or the refusal AWS gives. */
  function checkSignature({ method, url, headers, body, where, protocol }) {
    const refuse = (code, message, status = protocol === "json" ? 400 : 403) => fault(status, code, message);
    const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/u.exec(headers.get("authorization") ?? "");
    if (!match) throw refuse(protocol === "json" ? "MissingAuthenticationTokenException" : "MissingAuthenticationToken", "Request is missing Authentication Token");
    const [, keyId, day, signingRegion, signingName, signedHeaders] = match;
    if (keyId !== credentials.accessKeyId) throw refuse(protocol === "json" ? "UnrecognizedClientException" : protocol === "s3" ? "InvalidAccessKeyId" : "InvalidClientTokenId", "The security token included in the request is invalid.");
    if (signingRegion !== where.signingRegion || signingName !== where.signing) throw refuse("SignatureDoesNotMatch", `Credential should be scoped to a valid region and service: ${where.signingRegion}/${where.signing}.`);
    const stamp = headers.get("x-amz-date") ?? "";
    const when = Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`);
    if (!Number.isFinite(when) || stamp.slice(0, 8) !== day || Math.abs(when - now().getTime()) > CLOCK_SKEW_MS) throw refuse(protocol === "json" ? "InvalidSignatureException" : "RequestExpired", "Signature expired: the request's time is too far from now.");
    if ((headers.get("x-amz-security-token") ?? undefined) !== credentials.sessionToken) throw refuse(protocol === "json" ? "UnrecognizedClientException" : "InvalidClientTokenId", "The security token included in the request is invalid.");
    if (protocol === "s3" && headers.get("x-amz-content-sha256") !== sha256Hex(body)) throw fault(400, "XAmzContentSHA256Mismatch", "The provided 'x-amz-content-sha256' header does not match what was computed.");
    const sent = Object.fromEntries(signedHeaders.split(";").filter((name) => name !== "host").map((name) => [name, headers.get(name) ?? ""]));
    const expected = signRequest({
      method, url, headers: sent, body, service: signingName, region: signingRegion, credentials, date: new Date(when), payloadHash: headers.get("x-amz-content-sha256") ?? undefined
    }).headers.authorization;
    if (expected !== headers.get("authorization")) throw refuse(protocol === "json" ? "InvalidSignatureException" : "SignatureDoesNotMatch", "The request signature we calculated does not match the signature you provided.");
  }

  /** A JSON 1.1 answer or refusal. */
  function jsonAnswer(service, result, error, requestId) {
    const headers = { "content-type": "application/x-amz-json-1.1", "x-amzn-requestid": requestId };
    if (!error) return new Response(JSON.stringify(result), { status: 200, headers });
    // ECS names its errors with their namespace, as Smithy's JSON protocol allows; a client keeps the part after the #.
    const type = service === "ecs" ? `com.amazonaws.ecs#${error.code}` : error.code;
    return new Response(JSON.stringify({ __type: type, [error.messageKey ?? (service === "secretsmanager" ? "Message" : "message")]: error.message }), { status: error.status, headers });
  }

  /** A Query answer or refusal: EC2's own shape, or <Action>Response with its Result. */
  function queryAnswer(service, action, result, error, requestId) {
    const { namespace } = QUERY[service];
    const headers = { "content-type": "text/xml;charset=UTF-8", "x-amzn-requestid": requestId };
    if (error && service === "ec2") {
      return new Response(xmlOf("Response", { Errors: { Error: { Code: error.code, Message: error.message } }, RequestID: requestId }), { status: error.status, headers });
    }
    if (error) {
      return new Response(xmlOf("ErrorResponse", { Error: { Type: error.status >= 500 ? "Receiver" : "Sender", Code: error.code, Message: error.message }, RequestId: requestId }, ` xmlns="${namespace}"`), { status: error.status, headers });
    }
    const body = service === "ec2"
      ? xmlOf(`${action}Response`, { requestId, ...result }, ` xmlns="${namespace}"`)
      : xmlOf(`${action}Response`, { [`${action}Result`]: result, ResponseMetadata: { RequestId: requestId } }, ` xmlns="${namespace}"`);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, { status: 200, headers });
  }

  /**
   * The stand-in's fetch.
   * @param {string | URL} input @param {RequestInit} [init]
   */
  async function standInFetch(input, init = {}) {
    if (world.faults.down) throw new TypeError("fetch failed (the stand-in is down)");
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const method = String(init.method ?? "GET").toUpperCase();
    const body = init.body === undefined || init.body === null ? Buffer.alloc(0) : Buffer.from(init.body);
    const requestId = `${world.id("req").slice(4)}-standin`;
    let host = url.host;
    let path = url.pathname;
    let mode = "signed";
    const entry = { mode, method, service: null, action: null, params: null, status: 0, errorCode: null };
    log.push(entry);

    // Through the gateway: its token, then the AWS host and path it names.
    let gatewayRefusal = null;
    if (gateway && url.href.startsWith(gateway.url.replace(/\/$/u, "") + "/")) {
      mode = "gateway";
      entry.mode = mode;
      const [signingName, signingRegion, named, ...rest] = url.pathname.slice(new URL(gateway.url).pathname.replace(/\/$/u, "").length + 1).split("/");
      host = named;
      path = `/${rest.join("/")}`;
      const where = serviceOfHost(host, region);
      const token = /^Bearer (.+)$/u.exec(headers.get("authorization") ?? "")?.[1];
      if (!token || !gatewayTokens.has(token)) gatewayRefusal = { status: 401, code: "unauthenticated", message: "The gateway's token is missing, wrong or expired." };
      else if (!where || where.signing !== signingName || where.signingRegion !== signingRegion) gatewayRefusal = { status: 400, code: "bad_route", message: `The gateway can't sign for ${signingName} in ${signingRegion} at ${host}.` };
    }
    if (gatewayRefusal) {
      Object.assign(entry, { status: gatewayRefusal.status, errorCode: gatewayRefusal.code });
      return new Response(JSON.stringify({ code: gatewayRefusal.code, message: gatewayRefusal.message }), { status: gatewayRefusal.status, headers: { "content-type": "application/json" } });
    }

    const where = serviceOfHost(host, region);
    if (!where) {
      Object.assign(entry, { status: 404, errorCode: "UnknownEndpoint" });
      throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${host}`);
    }
    const protocol = where.service === "s3" ? "s3" : QUERY[where.service] ? "query" : "json";
    entry.service = where.service;
    let action = null;
    let params = null;
    let answer;
    try {
      if (protocol === "json") {
        const target = headers.get("x-amz-target") ?? "";
        const [prefix, name] = target.split(".");
        if (JSON_SERVICES[prefix] !== where.service || headers.get("content-type") !== "application/x-amz-json-1.1") throw fault(400, "UnknownOperationException", `No ${target} at ${host}.`);
        action = name;
        params = body.length > 0 ? JSON.parse(body.toString("utf8")) : {};
      } else if (protocol === "query") {
        const form = new URLSearchParams(body.toString("utf8"));
        if (form.get("Version") !== QUERY[where.service].version) throw fault(400, "InvalidAction", `${host} takes Version ${QUERY[where.service].version}.`);
        action = form.get("Action");
        params = unflatten([...form].filter(([key]) => key !== "Action" && key !== "Version"));
      } else {
        const sub = ["tagging", "publicAccessBlock", "list-type"].find((one) => url.searchParams.has(one));
        action = `${method} ${path === "/" ? sub ?? (where.bucket ? "bucket" : "buckets") : "object"}`;
        params = { bucket: where.bucket, key: decodeURIComponent(path.slice(1)), bytes: body.length };
      }
      Object.assign(entry, { action, params: redacted(params) });
      if (mode === "signed") {
        if (headers.get("authorization")?.startsWith("Bearer ")) throw fault(protocol === "json" ? 400 : 403, "IncompleteSignature", "Authorization header requires 'Credential' parameter.");
        checkSignature({ method, url: `https://${host}${path}${url.search}`, headers, body, where, protocol });
        if (world.faults.expiredToken) {
          world.faults.expiredToken = false;
          throw fault(400, protocol === "json" ? "ExpiredTokenException" : "ExpiredToken", "The security token included in the request is expired");
        }
      }
      if (world.faults.throttle > 0) {
        world.faults.throttle -= 1;
        throw fault(400, protocol === "json" ? "ThrottlingException" : protocol === "s3" ? "SlowDown" : "Throttling", "Rate exceeded");
      }
      if (protocol === "s3") {
        const result = world.data.s3({ method, bucket: where.bucket, key: decodeURIComponent(path.slice(1)), query: url.searchParams, headers, body });
        answer = new Response(method === "HEAD" || result.status === 204 ? null : result.body, { status: result.status, headers: { "x-amz-request-id": requestId, ...(result.headers ?? {}) } });
      } else {
        const handler = handlers[where.service]?.[action];
        if (!handler) throw fault(400, protocol === "json" ? "UnknownOperationException" : "InvalidAction", `The action ${action} is not valid for this web service.`);
        const result = handler(params);
        answer = protocol === "json" ? jsonAnswer(where.service, result, null, requestId) : queryAnswer(where.service, action, result, null, requestId);
      }
    } catch (error) {
      if (!(error instanceof Fault)) throw error;
      Object.assign(entry, { errorCode: error.code });
      if (protocol === "json") answer = jsonAnswer(where.service, null, error, requestId);
      else if (protocol === "query") answer = queryAnswer(where.service, action, null, error, requestId);
      else answer = new Response(method === "HEAD" ? null : xmlOf("Error", { Code: error.code, Message: error.message, RequestId: requestId }), { status: error.status, headers: { "x-amz-request-id": requestId } });
    }
    entry.status = answer.status;
    return answer;
  }

  return Object.freeze({
    fetch: standInFetch,
    region,
    account,
    credentials,
    faults: world.faults,
    /** AWS's clock, which moves STEP_MS at each advance: the time clients sign with. */
    now,
    /** Moves everything slow on one step, and the clock on. */
    advance() {
      clock += STEP_MS;
      world.data.advance();
      world.compute.advance();
    },
    /** The owner put the domain's validation records in place: its certificates are issued. @param {string} domain */
    issue: (domain) => world.data.issue(domain),
    /** The Price List without the entries whose usage type matches. @param {RegExp} pattern */
    dropPrices: (pattern) => prices.drop(pattern),
    /** A bucket name another AWS account holds. @param {string} name */
    takeBucketName: (name) => world.data.othersBuckets.add(name),
    /** The gateway's token expired: the next request with it is refused, and `token` is the one it takes now. */
    rotateGatewayToken(token) {
      gatewayTokens.clear();
      gatewayTokens.add(token);
    },
    /** Every request so far, in order. */
    requests: () => structuredClone(log),
    /** What the stand-in holds now, part by part. */
    view: () => ({ ...world.network.view(), ...world.data.view(), ...world.compute.view() }),
    /** Runs a call as the stand-in's own account would at AWS (to make things the deployment didn't). */
    handlers,
    environmentOf,
    securityGroupsOf,
    /** Whether a service's security groups let another's in on a port. @param {string} from @param {string} to @param {number} port */
    reaches: (from, to, port) => {
      const sources = securityGroupsOf(from);
      return world.network.view().securityGroups.filter((one) => securityGroupsOf(to).includes(one.id))
        .some((one) => one.rules.some((rule) => rule.protocol === "tcp" && rule.from <= port && port <= rule.to && sources.includes(rule.group)));
    }
  });
}

export { STANDIN_KEYS, createAwsStandIn, serviceOfHost };

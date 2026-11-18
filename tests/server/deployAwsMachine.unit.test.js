import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { NAMES_IMAGE, specPlaceOf, userDataOf } from "../../packages/vibe64-deploy/src/adapters/aws/machine.js";

// A machine's user data at AWS, run for real with bash: the script reads its spec from where its user data names (the
// releases bucket, checked against its SHA-256), gives
// the service's container every setting, each secret read from Secrets Manager at its version, and the instance facts,
// runs it with the machine's network (privileged only for a sandbox), keeps the machine in the private names through a
// container Docker restarts, and says the machine is ready once the service answers. Stand-in commands record what
// the script asked of dnf, Docker, the AWS CLI and the metadata service.

const run = promisify(execFile);
const SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123456789012:secret:vibe64/dep_x/services/workers-AbCdEf";

/** A spec, privileged or not. */
function specFor(privileged) {
  return {
    service: "workers", name: "shop-workers", region: "us-east-1", image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/v64-x/shop-workers:abc", version: "abc",
    size: "m7i.xlarge", port: 3000, healthPath: "/api/health", logGroup: "/vibe64/shop/production/x", privileged, namesService: "srv-0123456789abcdef",
    namesImage: NAMES_IMAGE, group: "v64-x-service-workers",
    env: { MODE: "jobs", GREETING: "hello world = yes" },
    secrets: { TOKEN: { arn: SECRET_ARN, key: "token", versionId: "v-2" }, V64_DATABASE_PASSWORD: { arn: SECRET_ARN, key: "password", versionId: null } }
  };
}

const SPEC_URI = "s3://v64-x-releases/specs/workers/spec.json";
/** The place a spec is kept, as the adapter names it. */
const placeOf = (body) => `${SPEC_URI} ${createHash("sha256").update(body).digest("hex")}`;

/** Runs a machine's user data with stand-in commands (S3 holding `kept`, the spec unless given); what each was asked. */
async function runMachine(t, spec, kept = JSON.stringify(spec)) {
  const root = await mkdtemp(path.join(tmpdir(), "aws-machine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const userData = Buffer.from(userDataOf(placeOf(JSON.stringify(spec))), "base64").toString("utf8");
  await writeFile(path.join(root, "user-data"), userData);
  await writeFile(path.join(root, "spec.json"), kept);
  const stub = (name, body) => writeFile(path.join(bin, name), `#!/bin/bash\nroot=${JSON.stringify(root)}\n${body}\n`).then(() => chmod(path.join(bin, name), 0o755));
  // Each call's own files, named by when it ran (a pipeline's two sides run at once).
  const record = 'n="$(date +%s%N)-$$"; printf "%s\\0" "$(basename "$0")" "$@" > "$root/call-$n"; env > "$root/env-$n"';
  await stub("curl", [
    record,
    'url="${@: -1}"',
    'case "$url" in',
    "  */latest/api/token) printf tok;;",
    '  */latest/user-data) cat "$root/user-data";;',
    "  */latest/meta-data/instance-id) printf i-0abc;;",
    "  */latest/meta-data/local-ipv4) printf 10.64.0.7;;",
    "  */latest/meta-data/placement/region) printf us-east-1;;",
    "  http://127.0.0.1:3000/api/health) exit 0;;",
    "  *) exit 22;;",
    "esac"
  ].join("\n"));
  await stub("aws", [
    record,
    'case "$1 $2" in',
    "  'secretsmanager get-secret-value')",
    '    case " $* " in',
    "      *' --version-id v-2 '*) printf '%s\\n' '{\"token\": \"t0k=en value\", \"password\": \"old\"}';;",
    "      *' --version-id '*) exit 254;;",
    "      *) printf '%s\\n' '{\"token\": \"old\", \"password\": \"s3cr=t pass\"}';;",
    "    esac;;",
    "  'ecr get-login-password') printf pw;;",
    `  's3 cp') [ "$3 $4 $5 $6" = "${SPEC_URI} - --region us-east-1" ] && cat "$root/spec.json";;`,
    "esac"
  ].join("\n"));
  // docker login reads its password from its input, as Docker does.
  await stub("docker", `${record}\ncase " $* " in *" --password-stdin "*) cat >/dev/null;; esac`);
  for (const name of ["dnf", "systemctl", "chown"]) await stub(name, record);
  const script = userData.replaceAll("/srv/work", path.join(root, "work"));
  const ran = await run("bash", ["-c", script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }).then(() => null, (error) => error);
  const calls = [];
  for (const file of (await readdir(root)).filter((name) => name.startsWith("call-")).sort()) {
    const args = (await readFile(path.join(root, file), "utf8")).split("\0").slice(0, -1);
    const env = Object.fromEntries((await readFile(path.join(root, file.replace("call-", "env-")), "utf8")).split("\n").filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    calls.push({ command: args[0], args: args.slice(1), env });
  }
  return { root, calls, failed: ran };
}

test("a machine's user data names where its spec is on its second line, read back from it, and holds no setting", () => {
  const place = placeOf(JSON.stringify(specFor(true)));
  const userData = Buffer.from(userDataOf(place), "base64").toString("utf8");
  assert.deepEqual(userData.split("\n").slice(0, 2), ["#!/bin/bash", `# vibe64-spec ${place}`]);
  assert.equal(specPlaceOf(userDataOf(place)), place);
  assert.equal(specPlaceOf(Buffer.from("#!/bin/bash\necho hi\n").toString("base64")), null);
  assert.equal(["MODE", "GREETING", "TOKEN", "jobs"].some((word) => userData.includes(word)), false);
});

test("the machine runs the image with every setting, each secret read at its version, the instance facts, then joins the names and is ready", async (t) => {
  const { root, calls, failed } = await runMachine(t, specFor(true));
  assert.equal(failed, null);
  const of = (command, first) => calls.filter((one) => one.command === command && (!first || one.args[0] === first));
  assert.deepEqual(of("dnf")[0].args, ["install", "-y", "-q", "docker", "jq"]);
  // The spec, from the releases bucket in the machine's region.
  assert.deepEqual(of("aws", "s3")[0].args, ["s3", "cp", SPEC_URI, "-", "--region", "us-east-1"]);
  // Secrets Manager: the token at its version, the password at the current one; the login to the deployment's ECR.
  assert.deepEqual(of("aws", "secretsmanager").map((one) => one.args.slice(one.args.indexOf("--secret-id"), one.args.indexOf("--query"))),
    [["--secret-id", SECRET_ARN, "--version-id", "v-2"], ["--secret-id", SECRET_ARN]]);
  assert.deepEqual(of("docker", "login")[0].args, ["login", "--username", "AWS", "--password-stdin", "123456789012.dkr.ecr.us-east-1.amazonaws.com"]);

  // The service's container: the machine's network, privileged for its sandbox, every setting by name only, its logs to
  // CloudWatch; the values are in the environment Docker reads them from, never on its command line.
  const [app, names] = of("docker", "run");
  const flags = app.args;
  assert.deepEqual([flags.slice(0, 7), flags.at(-1)], [["run", "-d", "--name", "app", "--restart", "unless-stopped", "--network"], specFor(true).image]);
  assert.ok(flags.includes("--privileged"));
  const named = flags.flatMap((flag, index) => (flag === "-e" ? [flags[index + 1]] : []));
  assert.deepEqual(named.sort(), ["GREETING", "MODE", "TOKEN", "V64_DATABASE_PASSWORD", "V64_INSTANCE_ID", "V64_INSTANCE_URL", "V64_PRIVATE_ADDRESS", "V64_WORK_DIR"]);
  assert.deepEqual([app.env.MODE, app.env.GREETING, app.env.TOKEN, app.env.V64_DATABASE_PASSWORD], ["jobs", "hello world = yes", "t0k=en value", "s3cr=t pass"]);
  assert.deepEqual([app.env.V64_INSTANCE_ID, app.env.V64_PRIVATE_ADDRESS, app.env.V64_INSTANCE_URL, app.env.V64_WORK_DIR], ["i-0abc", "10.64.0.7", "http://10.64.0.7:3000", path.join(root, "work")]);
  assert.equal(calls.some((one) => one.args.some((arg) => arg.includes("t0k=en value") || arg.includes("s3cr=t pass"))), false);
  assert.ok(flags.includes("awslogs-group=/vibe64/shop/production/x") && flags.includes("awslogs-stream=workers/i-0abc"));

  // The names container: AWS's CLI image, restarted by Docker, registering once the port answers, deregistering at stop.
  assert.deepEqual(names.args.slice(0, 12), ["run", "-d", "--name", "names", "--restart", "unless-stopped", "--stop-timeout", "30", "--network", "host", "--entrypoint", "/bin/bash"]);
  assert.equal(names.args[12], NAMES_IMAGE);
  const job = names.args[14];
  assert.match(job, /^until \(exec 3<>\/dev\/tcp\/127\.0\.0\.1\/3000\)/u);
  assert.match(job, /\naws servicediscovery register-instance --region us-east-1 --service-id srv-0123456789abcdef --instance-id i-0abc --attributes AWS_INSTANCE_IPV4=10\.64\.0\.7,AWS_INSTANCE_PORT=3000\n/u);
  assert.match(job, /\ntrap 'aws servicediscovery deregister-instance --region us-east-1 --service-id srv-0123456789abcdef --instance-id i-0abc; exit 0' TERM\n/u);
  // Ready only after the health path answered, and last.
  const order = calls.map((one) => `${one.command} ${one.args[0]}`);
  assert.ok(order.indexOf("curl -fsS") < order.lastIndexOf("aws autoscaling"));
  assert.deepEqual(calls.at(-1).args, ["autoscaling", "complete-lifecycle-action", "--region", "us-east-1", "--auto-scaling-group-name", "v64-x-service-workers",
    "--lifecycle-hook-name", "vibe64-ready", "--instance-id", "i-0abc", "--lifecycle-action-result", "CONTINUE"]);
  // Nothing is written outside Docker but the work folder: no unit, no file in a system folder.
  assert.equal(calls.some((one) => one.command === "systemctl" && one.args[0] !== "enable"), false);
});

test("a machine without a sandbox allowance runs its container unprivileged", async (t) => {
  const { calls } = await runMachine(t, specFor(false));
  const app = calls.find((one) => one.command === "docker" && one.args[0] === "run");
  assert.equal(app.args.includes("--privileged"), false);
});

test("a machine whose kept spec isn't the one its user data names runs nothing", async (t) => {
  const { calls, failed } = await runMachine(t, specFor(false), JSON.stringify({ ...specFor(false), image: "elsewhere/other:1" }));
  assert.match(failed?.stderr ?? "", /^The spec at s3:\/\/v64-x-releases\/specs\/workers\/spec\.json is not the one this machine's user data names\.$/mu);
  assert.equal(calls.some((one) => one.command === "docker" || (one.command === "aws" && one.args[0] !== "s3")), false);
});

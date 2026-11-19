import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { servicePackages, servicePackagesProblem } from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { envEntryProblem, settingsPerService, stackSettingsPerService } from "../../packages/vibe64-deploy/src/package.js";
import { MEMOBOT_COMPUTERS_PACKAGES, MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES } from "../fixtures/deploymentServices.js";

// The package of a two-service app: one declaration per service at mobilynet, the settings each service is given, and
// the serve scripts run in bash as each instance runs them, with the instance facts mobilynet's `_mobilynet` gives.
const exec = promisify(execFile);

const DEPLOYMENT = vibe64DeploymentInspection({
  environment: { stackHash: "sha256:stack", resources: MEMOBOT_RESOURCES },
  section: { status: "ready", stackHash: "sha256:stack", lines: MEMOBOT_DEPLOYMENT_LINES, components: [], source: "project" }
});
const { needs: NEEDS } = needsOfStack(DEPLOYMENT, { preferredAlternative, resourceKindIsDatabase });
// The Production Env's entries: most go to web (an entry naming no service does), two to computers.
const ENV = Object.freeze([
  { key: "OPENAI_API_KEY", secret: true, services: ["web"] },
  { key: "STRIPE_SECRET_KEY", secret: true },
  { key: "MEMOBOT_OWNERS", secret: false, services: ["web"] },
  { key: "MEMOBOT_MAX_COMPUTERS", secret: false, services: ["computers"] },
  { key: "MEMOBOT_GVISOR_PLATFORM", secret: false, services: ["computers"] }
]);
const PRODUCTION_OWN = { APP_ENV: false, HOST: false, PORT: false, APP_PUBLIC_URL: false, TRUSTED_PROXIES: false };
const GENERATED = ["AUTH_LOCAL_SESSION_SECRET", "MEMOBOT_VAULT_KEY", "AUTH_LOCAL_SECOND_FACTOR_KEY", "MEMOBOT_FILES_PASSPHRASE", "MEMOBOT_COMPUTERS_SECRET"];

/** A declaration's settings from { name: [secret, required] }. */
function declared(entries) {
  return Object.fromEntries(Object.entries(entries).map(([name, [secret, required]]) => [name, { type: "string", secret, required }]));
}

test("each service is its own declaration: its name, its serve script, its packages and machine features, every resource's need and the settings its Stack names", () => {
  const settings = settingsPerService(NEEDS, ENV);
  const own = Object.fromEntries(Object.keys(PRODUCTION_OWN).map((name) => [name, [false, true]]));
  const generated = Object.fromEntries(GENERATED.map((name) => [name, [true, true]]));
  const flags = (entries) => Object.fromEntries(Object.entries(entries).map(([name, [secret, required]]) => [name, { secret, required }]));
  // What each service is given: the setup code and the reached service's address only on web, a web-only secret never
  // on computers, and each Production Env entry the services it names.
  const webStack = { ...own, ...generated, AUTH_LOCAL_SETUP_CODE: [true, false], MEMOBOT_COMPUTERS_URL: [false, true] };
  assert.deepEqual(settings.web, flags({ ...webStack, OPENAI_API_KEY: [true, false], STRIPE_SECRET_KEY: [true, false], MEMOBOT_OWNERS: [false, false] }));
  assert.deepEqual(Object.keys(settings.computers), [...Object.keys(own), ...GENERATED, "MEMOBOT_MAX_COMPUTERS", "MEMOBOT_GVISOR_PLATFORM"]);
  // What each release declares: the Stack's alone, with no Production Env entry.
  assert.deepEqual(stackSettingsPerService(NEEDS), { web: flags(webStack), computers: flags({ ...own, ...generated }) });

  const { declarations, scripts } = servicePackages({ app: "memobot", deployment: DEPLOYMENT, needs: NEEDS, settings });
  const shared = DEPLOYMENT.packages;
  const base = ["bash", "coreutils", "curl", "jq", "nodejs_26", "corepack"];
  const common = (name) => ({
    name,
    build: { command: "bash vibe64-app/build.sh", cache: ["~/.npm"], output: ["."] },
    start: `install -D --owner=${name} --mode=0400 /run/mobilynet/apps/${name}/settings.json /run/app-settings/${name}/settings.json`,
    check: "curl --fail --silent --show-error --output /dev/null --retry 30 --retry-delay 3 --retry-all-errors "
      + "--retry-max-time 100 --max-time 10 http://127.0.0.1:3000/api/health",
    logins: [{ name }],
    machineFeatures: ["userns"],
    needs: [{ interface: "postgresql", as: "V64_DATABASE" }, { interface: "s3", as: "V64_FILES" }]
  });
  assert.deepEqual(declarations.web, {
    ...common("memobot-web"),
    requiredPackages: [...new Set([...base, ...shared])],
    services: [{ name: "web", command: "bash vibe64-app/serve-web.sh", user: "memobot-web", port: 3000, healthPath: "/api/health" }],
    settings: declared(webStack)
  });
  assert.deepEqual(declarations.computers, {
    ...common("memobot-computers"),
    requiredPackages: [...new Set([...base, ...shared, ...MEMOBOT_COMPUTERS_PACKAGES])],
    services: [{ name: "computers", command: "bash vibe64-app/serve-computers.sh", user: "memobot-computers", port: 3000, healthPath: "/api/health" }],
    settings: declared({ ...own, ...generated })
  });
  // The Production Env is no part of a release: without its entries, or with others, the declarations are the same.
  assert.deepEqual(servicePackages({ app: "memobot", deployment: DEPLOYMENT, needs: NEEDS, settings: settingsPerService(NEEDS) }).declarations, declarations);
  // The shared packages once: jq is the base's and the Stack's.
  assert.equal(declarations.computers.requiredPackages.filter((name) => name === "jq").length, 1);
  assert.equal(declarations.computers.requiredPackages.length, 4 + 2 + shared.length - 1 + MEMOBOT_COMPUTERS_PACKAGES.length);
  assert.deepEqual(Object.keys(scripts), ["vibe64-app/build.sh", "vibe64-app/serve-web.sh", "vibe64-app/serve-computers.sh"]);
  assert.match(scripts["vibe64-app/build.sh"], /^npm run deploy:prepare\nprintf '%s\\n' 'Build: Build'\nnpm --prefix \.memobot-server-generated\/app run build$/mu);
  // A long app name is shortened so that each service's name fits mobilynet's 32 characters.
  const long = servicePackages({ app: "a-very-long-project-name-for-it", deployment: DEPLOYMENT, needs: NEEDS, settings });
  assert.deepEqual([long.declarations.web.name, long.declarations.computers.name], ["a-very-long-project-name-for-web", "a-very-long-project-na-computers"]);
});

test("a service given more settings than mobilynet takes, packages it can't take, or an Env entry Production sets itself is refused, naming the service", () => {
  // 100 settings is mobilynet's own limit per declaration, which a service's settings are held to with its Env entries:
  // computers has 10 without them, so 90 of its own fit (100 settings, packaged, its declaration the Stack's 10) and 91
  // don't, naming the limit.
  const extra = (count) => Array.from({ length: count }, (_, at) => ({ key: `COMPUTERS_${at}`, secret: false, services: ["computers"] }));
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, extra(90))), null);
  const hundred = servicePackages({ app: "shop", deployment: DEPLOYMENT, needs: NEEDS, settings: settingsPerService(NEEDS, extra(90)) });
  assert.equal(Object.keys(hundred.declarations.computers.settings).length, 10);
  const over = servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, extra(91)));
  assert.equal(over.code, "vibe64_production_too_many_settings");
  assert.match(over.message, /^mobilynet takes at most 100 settings for a service and service computers would need 101\./u);
  assert.throws(() => servicePackages({ app: "shop", deployment: DEPLOYMENT, needs: NEEDS, settings: settingsPerService(NEEDS, extra(91)) }),
    { code: "vibe64_production_too_many_settings", status: 422 });

  // Packages: the shared and a service's own together count against the 200, naming the service.
  const many = Array.from({ length: 200 - 87 - 10 + 1 }, (_, at) => `extra${at}`);
  const crowded = { ...DEPLOYMENT, services: DEPLOYMENT.services.map((service) => (service.id === "computers" ? { ...service, packages: [...service.packages, ...many] } : service)) };
  const packages = servicePackagesProblem(crowded, settingsPerService(NEEDS));
  assert.equal(packages.code, "vibe64_app_package_packages_invalid");
  assert.match(packages.message, /for service computers can't be declared: With those every app and its runtimes need, that is 201 packages/u);
  assert.equal(servicePackagesProblem({ ...crowded, services: [DEPLOYMENT.services[0]] }, {}), null, "web alone stays within 200");
  const unsupported = servicePackagesProblem({ ...DEPLOYMENT, runtimeRequirements: ["nodejs", "playwright"] }, {});
  assert.equal(unsupported.code, "vibe64_app_package_runtime_unsupported");
  assert.equal(servicePackagesProblem({ status: "blocked", diagnostics: [{ message: "No." }] }, {}).code, "vibe64_app_package_deployment_unready");

  // An Env entry the Stack's resources or services set, or Production's own, or one for a service there isn't.
  for (const key of ["DB_HOST", "MEMOBOT_FILES_BUCKET", "MEMOBOT_COMPUTERS_AGENT", "MEMOBOT_COMPUTERS_URL", "PORT", "V64_WORK_DIR"]) {
    assert.match(envEntryProblem({ key }, NEEDS), /is set by Production itself/u, key);
    assert.throws(() => settingsPerService(NEEDS, [{ key, secret: false }]), { code: "vibe64_production_env_invalid" }, key);
  }
  assert.match(envEntryProblem({ key: "WORKER_SECRET", services: ["worker"] }, NEEDS),
    /^WORKER_SECRET is given to worker, which this Deployment doesn't have: its services are web, computers\.$/u);
  assert.equal(envEntryProblem({ key: "OPENAI_API_KEY", services: ["web", "computers"] }, NEEDS), "");
});

test("each service's script exports its settings, its resources' names, the instance facts from _mobilynet and its own settings, then migrates and serves", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-deploy-serve-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { scripts } = servicePackages({ app: "memobot", deployment: DEPLOYMENT, needs: NEEDS, settings: settingsPerService(NEEDS, ENV) });
  // npm and node stand in for the app's own: npm records the step, node what the service was given.
  const bin = path.join(root, "bin");
  await mkdir(bin);
  await writeFile(path.join(bin, "npm"), `#!/bin/sh\necho "npm $*" >> "${root}/steps"\n`);
  await writeFile(path.join(bin, "node"), `#!/bin/sh\necho "node $*" >> "${root}/steps"\nenv | grep -E '^(V64_|MEMOBOT_COMPUTERS_|NODE_ENV=|DB_HOST=|_mobilynet)' | sort > "${root}/given"\n`);
  await Promise.all(["npm", "node"].map((file) => chmod(path.join(bin, file), 0o755)));
  const release = path.join(root, "release");
  await mkdir(path.join(release, "vibe64-app"), { recursive: true });
  const settingsFile = (service) => path.join(root, `${service}.json`);
  for (const [file, text] of Object.entries(scripts)) {
    const service = /serve-([a-z-]+)\.sh$/u.exec(file)?.[1];
    await writeFile(path.join(release, file), service ? text.replace(`/run/app-settings/memobot-${service}/settings.json`, settingsFile(service)) : text);
  }
  const serve = async (service, settings) => {
    await writeFile(settingsFile(service), JSON.stringify(settings));
    await rm(path.join(root, "given"), { force: true });
    await rm(path.join(root, "steps"), { force: true });
    await exec("bash", [`vibe64-app/serve-${service}.sh`], { cwd: release, env: { PATH: `${bin}:${process.env.PATH}` } });
    return { given: (await readFile(path.join(root, "given"), "utf8")).trim().split("\n"), steps: await readFile(path.join(root, "steps"), "utf8") };
  };
  const instance = (service, hostname) => ({
    _mobilynet: { instanceId: `in_${hostname}`, hostname, privateAddress: "10.4.0.7", service: `memobot-${service}`, projectId: "prj_q7_memobot", version: "v3", edgeAddresses: [] },
    V64_DATABASE_HOST: "db.internal", MEMOBOT_COMPUTERS_AGENT: "0", NODE_ENV: "development"
  });

  // computers, reached at each instance: its own address, the four facts, its Setting over what the settings say.
  const computers = await serve("computers", instance("computers", "c-0a1b"));
  assert.deepEqual(computers.given, [
    "DB_HOST=db.internal",
    "MEMOBOT_COMPUTERS_AGENT=1",
    "NODE_ENV=development",
    "V64_DATABASE_HOST=db.internal",
    "V64_INSTANCE_ID=c-0a1b",
    "V64_INSTANCE_URL=http://c-0a1b.memobot-computers.prj-q7-memobot.internal:3000",
    "V64_PRIVATE_ADDRESS=10.4.0.7",
    "V64_WORK_DIR=/srv/memobot-computers"
  ]);
  assert.equal(computers.steps, "npm --prefix .memobot-server-generated/app run db:migrate\nnode bin/memobot-server.js serve\n");
  // web, reached at any instance: no address of its own, and Serve's production default for what nothing set.
  const { NODE_ENV: _unset, ...webSettings } = instance("web", "w-9z");
  const web = await serve("web", webSettings);
  assert.deepEqual(web.given, ["DB_HOST=db.internal", "MEMOBOT_COMPUTERS_AGENT=0", "NODE_ENV=production", "V64_DATABASE_HOST=db.internal",
    "V64_INSTANCE_ID=w-9z", "V64_PRIVATE_ADDRESS=10.4.0.7", "V64_WORK_DIR=/srv/memobot-web"]);

  // Without _mobilynet (another host) a service gets no facts, and one reached at each instance stops, naming why.
  const elsewhere = { V64_DATABASE_HOST: "db.internal", V64_INSTANCE_URL: "http://planted:3000" };
  const plain = await serve("web", elsewhere);
  assert.deepEqual(plain.given, ["DB_HOST=db.internal", "NODE_ENV=production", "V64_DATABASE_HOST=db.internal"]);
  await assert.rejects(serve("computers", elsewhere), (error) => error.code === 1
    && error.stderr.includes("Service computers is reached at each instance, so it needs this instance's own address: its settings have no _mobilynet"));
  await assert.rejects(readFile(path.join(root, "steps"), "utf8"), { code: "ENOENT" }, "neither Migrate nor Serve ran");
});

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
import { envEntryProblem, settingValues, settingsPerService, stackSettingsPerService } from "../../packages/vibe64-deploy/src/package.js";
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
    needs: [{ interface: "postgresql", as: "V64_DATABASE" }, { interface: "s3", as: "V64_FILES" }],
    tasks: { migrate: { command: `systemd-run --pipe --wait --collect --service-type=exec --same-dir --uid=${name} `
      + `--property=EnvironmentFile=/etc/mobilynet/service.env --property=LoadCredential=settings.json:/run/mobilynet/apps/${name}/settings.json `
      + `bash vibe64-app/migrate-${name.replace("memobot-", "")}.sh` } }
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
  assert.deepEqual(Object.keys(scripts), ["vibe64-app/build.sh", "vibe64-app/serve-web.sh", "vibe64-app/migrate-web.sh", "vibe64-app/serve-computers.sh", "vibe64-app/migrate-computers.sh"]);
  assert.match(scripts["vibe64-app/build.sh"], /^npm run deploy:prepare\nprintf '%s\\n' 'Build: Build'\nnpm --prefix \.memobot-server-generated\/app run build$/mu);
  // A long app name is shortened so that each service's name fits mobilynet's 32 characters.
  const long = servicePackages({ app: "a-very-long-project-name-for-it", deployment: DEPLOYMENT, needs: NEEDS, settings });
  assert.deepEqual([long.declarations.web.name, long.declarations.computers.name], ["a-very-long-project-name-for-web", "a-very-long-project-na-computers"]);
});

test("a service given more settings than mobilynet takes, or one by a name its runtime sets, packages it can't take, or an Env entry Production sets itself is refused, naming the service and the fix", () => {
  // mobilynet gives an App Service at most 49 settings and secrets in all, its links' among them: computers has 10 of
  // the Stack's and 11 from its links (database, PostgreSQL: 6; files, S3: 5), so 28 Env entries of its own fit (49,
  // packaged, its declaration the Stack's 10) and 29 don't, naming the count.
  const extra = (count) => Array.from({ length: count }, (_, at) => ({ key: `COMPUTERS_${at}`, secret: false, services: ["computers"] }));
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, extra(28))), null);
  const full = servicePackages({ app: "shop", deployment: DEPLOYMENT, needs: NEEDS, settings: settingsPerService(NEEDS, extra(28)) });
  assert.equal(Object.keys(full.declarations.computers.settings).length, 10);
  const over = servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, extra(29)));
  assert.deepEqual(over, {
    code: "vibe64_production_too_many_settings",
    message: "mobilynet gives an App Service at most 49 settings and secrets in all, its links' among them, and service computers would "
      + "have 50: 39 of its own and 11 from its links. Remove Production Env entries it doesn't use, or give them only to the services that "
      + "use them, then deploy to production."
  });
  assert.throws(() => servicePackages({ app: "shop", deployment: DEPLOYMENT, needs: NEEDS, settings: settingsPerService(NEEDS, extra(29)) }),
    { code: "vibe64_production_too_many_settings", status: 422 });
  // Without the database, its 6 link settings are free for Env entries: 34 fit.
  const bucketOnly = { ...DEPLOYMENT, resources: DEPLOYMENT.resources.filter((one) => one.resource.id === "files") };
  assert.equal(servicePackagesProblem(bucketOnly, settingsPerService(NEEDS, extra(34))), null);
  assert.equal(servicePackagesProblem(bucketOnly, settingsPerService(NEEDS, extra(35))).code, "vibe64_production_too_many_settings");

  // A name mobilynet's runtime sets on every instance, given by the Production Env or named by the Stack, each fix its own.
  const reserved = (key, services = ["web"]) => servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, [{ key, secret: true, services }]));
  for (const key of ["PATH", "HOME", "LANG", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "MOBILYNET_TOKEN"]) {
    assert.equal(reserved(key).code, "vibe64_production_setting_reserved", key);
  }
  assert.equal(reserved("PATH").message, "Service web would be given PATH, and mobilynet sets that name itself on every instance, so the app "
    + "would lose it. Save its value in the Production Env under another name and remove PATH, then deploy to production.");
  assert.match(reserved("MOBILYNET_TOKEN", ["computers"]).message, /^Service computers would be given MOBILYNET_TOKEN, and mobilynet sets every name starting MOBILYNET_ itself/u);
  for (const key of ["PATHS", "HOMEPAGE", "GIT_CONFIG", "MOBILYNETX"]) assert.equal(reserved(key), null, key);
  const homeSecret = { ...DEPLOYMENT, generatedSecrets: [...DEPLOYMENT.generatedSecrets, "HOME"] };
  const { needs: homeNeeds } = needsOfStack(homeSecret, { preferredAlternative, resourceKindIsDatabase });
  assert.equal(servicePackagesProblem(homeSecret, settingsPerService(homeNeeds)).message, "Service web would be given HOME, and mobilynet sets "
    + "that name itself on every instance, so the app would lose it. Name it otherwise in genesis/stack.md (the coding agent can do this), "
    + "Save, then deploy to production.");

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
  // STAGING_REACHES_REAL_PEOPLE is a Staging's alone: a production app refuses to start with it.
  assert.equal(envEntryProblem({ key: "STAGING_REACHES_REAL_PEOPLE" }, NEEDS), "STAGING_REACHES_REAL_PEOPLE says real people "
    + "use a Staging, so Production never takes it: an app refuses to start with it there.");
  assert.throws(() => settingsPerService(NEEDS, [{ key: "STAGING_REACHES_REAL_PEOPLE", secret: false }]), {
    code: "vibe64_production_env_invalid",
    message: /^STAGING_REACHES_REAL_PEOPLE says real people use a Staging, so Production never takes it: .* Remove it from the Production Env, then deploy to production\.$/u
  });
});

test("mobilynet's count is the names a service is sent with its links' fields, each once: a production web holding 48 is taken, and the 50 its next Deploy would send are taken where its region holds 199, refused where it holds 49", () => {
  // A production app's web on 19 Nov, by name only: the Production Env holds 33 entries for it, the Stack's generated
  // secrets and setup code among them (Vibe64 makes those into the Env), and its service at mobilynet holds 48 settings
  // and secrets in all, its links' 11 among them, from a Deploy before the last two entries were saved.
  const secrets = ["AUTH_LOCAL_SESSION_SECRET", "MEMOBOT_VAULT_KEY", "AUTH_LOCAL_SECOND_FACTOR_KEY", "MEMOBOT_FILES_PASSPHRASE",
    "MEMOBOT_COMPUTERS_SECRET", "AUTH_LOCAL_SETUP_CODE", "AI_PREMIUM_API_KEY", "AI_ECONOMY_API_KEY", "AI_IMAGES_API_KEY", "MAIL_URL",
    "STRIPE_SECRET_KEY", "AUTH_GOOGLE_CLIENT_SECRET", "AUTH_GITHUB_CLIENT_SECRET", "AUTH_MICROSOFT_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET",
    "MICROSOFT_CLIENT_SECRET", "GITHUB_CLIENT_SECRET", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"];
  const plain = ["MEMOBOT_OWNERS", "AI_PREMIUM_PROVIDER", "AI_ECONOMY_PROVIDER", "AI_IMAGES_PROVIDER", "MAIL_FROM", "AUTH_GOOGLE_CLIENT_ID",
    "AUTH_GITHUB_CLIENT_ID", "AUTH_MICROSOFT_CLIENT_ID", "GOOGLE_CLIENT_ID", "MICROSOFT_CLIENT_ID", "GITHUB_CLIENT_ID", "REDIRECT_WWW"];
  const entries = (...more) => [...secrets.map((key) => ({ key, secret: true, services: ["web"] })),
    ...plain.map((key) => ({ key, secret: false, services: ["web"] })), ...more.map((key) => ({ key, secret: true, services: ["web"] }))];
  // What a Deploy sends web (settingValues, every entry with a value) is what the count counts: Production's own 5, its
  // Reaches 1 and its 31 entries, 37, with its links' 11 (database 6, files 5): 48, the service's own count.
  const sent = (records) => {
    const values = settingValues({ declared: settingsPerService(NEEDS, records).web, env: Object.fromEntries(records.map((one) => [one.key, "x"])),
      domain: "app.example.com", trustedProxies: "10.0.0.0/8", port: 3000, reached: { MEMOBOT_COMPUTERS_URL: "http://computers:3000" } });
    return Object.keys(values.settings).length + Object.keys(values.secrets).length;
  };
  assert.equal(sent(entries()), 37);
  assert.equal(Object.keys(settingsPerService(NEEDS, entries()).web).length, 37, "each generated secret and the setup code once, though the Env holds them too");
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, entries())), null, "48 is taken");
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, entries("STRIPE_WEBHOOK_SECRET"))), null, "49 is taken");
  // Its next Deploy sends both new entries, 50: one of them by a name mobilynet's runtime sets is refused first, and
  // the 50 under another name are refused by the count.
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, entries("STRIPE_WEBHOOK_SECRET", "MOBILYNET_API_KEY"))).code,
    "vibe64_production_setting_reserved");
  const next = entries("STRIPE_WEBHOOK_SECRET", "MEMOBOT_MOBILYNET_API_KEY");
  assert.equal(sent(next), 39);
  assert.match(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, next)).message,
    /^mobilynet gives an App Service at most 49 settings and secrets in all, its links' among them, and service web would have 50: 39 of its own and 11 from its links\./u);
  // 49 is what a region holds while one of its hosts runs an agent before 2.9.0, and the count's figure where mobilynet
  // doesn't say. A region whose hosts all run 2.9.0 or later holds 199 (the adapter's serviceSettingsMax), which takes
  // the 50, packaged; past 199 it refuses, naming 199, the service and the count.
  const region = { settingsMax: 199 };
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, next), region), null, "50 is taken where the region holds 199");
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, next), { settingsMax: 49 }).code, "vibe64_production_too_many_settings");
  const packaged = servicePackages({ app: "shop", deployment: DEPLOYMENT, needs: NEEDS, settings: settingsPerService(NEEDS, next), settingsMax: 199 });
  assert.equal(packaged.declarations.web.name, "shop-web");
  assert.throws(() => servicePackages({ app: "shop", deployment: DEPLOYMENT, needs: NEEDS, settings: settingsPerService(NEEDS, next) }),
    { code: "vibe64_production_too_many_settings", status: 422 });
  const plenty = (count) => [...next, ...Array.from({ length: count }, (_, at) => ({ key: `WEB_${at}`, secret: false, services: ["web"] }))];
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, plenty(149)), region), null, "199 is taken");
  const past = servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, plenty(150)), region);
  assert.equal(past.code, "vibe64_production_too_many_settings");
  assert.match(past.message, /^mobilynet gives an App Service at most 199 settings and secrets in all, its links' among them, and service web would have 200: 189 of its own and 11 from its links\. Remove Production Env entries it doesn't use/u);

  // In fact both new entries hold no value (the card's "Secret, not set"): the Production Env gives a Deploy no value
  // for them, so none is sent, and neither is counted nor checked. web comes to 48, MOBILYNET_API_KEY kept or not.
  const unset = (key) => ({ key, secret: true, services: ["web"], valuePresent: false });
  const saved = [...entries(), unset("STRIPE_WEBHOOK_SECRET"), unset("MOBILYNET_API_KEY")];
  assert.equal(Object.keys(settingsPerService(NEEDS, saved).web).length, 37);
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, saved)), null);
  assert.equal(servicePackagesProblem(DEPLOYMENT, settingsPerService(NEEDS, [...entries(), unset("STRIPE_WEBHOOK_SECRET")])), null);
  // An entry with no value by a name Production sets itself is still refused.
  assert.throws(() => settingsPerService(NEEDS, [{ key: "PORT", secret: false, valuePresent: false }]), { code: "vibe64_production_env_invalid" });
});

test("each service's script exports its settings, its resources' names, the instance facts from _mobilynet and its own settings, then serves; its migrate task's exports them and migrates", async (t) => {
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
  assert.equal(computers.steps, "node bin/memobot-server.js serve\n", "no service migrates");
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
  await assert.rejects(readFile(path.join(root, "steps"), "utf8"), { code: "ENOENT" }, "Serve didn't run");

  // The migrate task's script takes the same settings from its credentials' folder and migrates; its instance serves
  // nothing, so one of computers, reached at each instance, needs no address of its own.
  const credentials = path.join(root, "credentials");
  await mkdir(credentials);
  await writeFile(path.join(credentials, "settings.json"), JSON.stringify(elsewhere));
  await exec("bash", ["vibe64-app/migrate-computers.sh"], { cwd: release, env: { PATH: `${bin}:${process.env.PATH}`, CREDENTIALS_DIRECTORY: credentials } });
  assert.equal(await readFile(path.join(root, "steps"), "utf8"), "npm --prefix .memobot-server-generated/app run db:migrate\n");
});

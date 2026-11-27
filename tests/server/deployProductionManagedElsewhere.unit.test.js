import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPLOYMENT_ENTRY_FORMS,
  parseVibe64DeploymentLines,
  vibe64DeploymentInspection
} from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES } from "../fixtures/deploymentServices.js";

// A Deployment's `- Production: managed by `name` at `https://address`` says that something other than a host's Deploy
// to production deploys the app's Production. The Stack line is the one place the name and address live: the
// inspection carries them, the deploy engine refuses Production naming them, and Staging reads the section as before.
const RESOURCE_RULES = Object.freeze({ preferredAlternative, resourceKindIsDatabase });
const NAME = "Example Console";
const URL = "https://console.example.com/deployments";
const LINE = `- Production: managed by \`${NAME}\` at \`${URL}\``;
const STEPS = [
  "- Runtimes: `nodejs`",
  "- Prepare `Install`: `npm` `ci`",
  "- Serve `Start`: `node` `server.js`",
  "- Ready when: `GET` `/health` returns `200`"
];

function inspect(lines, resources = []) {
  return vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources },
    section: { status: "ready", stackHash: "sha256:stack", lines, components: [], source: "project" }
  });
}

/** The refusal of these section lines: its code, the line it names in the section, and its message. */
function refusedAt(lines, line, pattern) {
  assert.throws(() => parseVibe64DeploymentLines(lines), (error) => {
    assert.equal(error?.code, "VIBE64_DEPLOYMENT_INVALID", error?.message);
    assert.equal(error.details?.line, line, error.message);
    assert.match(error.message, pattern);
    return true;
  }, lines.join("\n"));
}

test("the Production line names who manages Production and where, alone or beside the steps, and leaves Staging's recipe as it was", () => {
  assert.ok(DEPLOYMENT_ENTRY_FORMS.includes("- Production: managed by `name` at `https://address`"), "the form is listed");
  const managedBy = { name: NAME, url: URL };

  // Alone, it runs nothing on a host, like `- Nothing.`: Staging has nothing to publish.
  const alone = parseVibe64DeploymentLines(["", LINE, ""]);
  assert.deepEqual(alone.productionManagedBy, managedBy);
  assert.deepEqual(alone.steps, []);
  assert.deepEqual(alone.services, []);
  const aloneInspected = inspect([LINE]);
  assert.equal(aloneInspected.status, "unconfigured");
  assert.equal(aloneInspected.recipeHash, "");
  assert.deepEqual(aloneInspected.productionManagedBy, managedBy);

  // Beside the steps, Staging's plan is the same as without it: same steps, same recipe identity.
  const without = inspect(STEPS);
  const beside = inspect([STEPS[0], LINE, ...STEPS.slice(1)]);
  assert.equal(beside.status, "ready");
  assert.deepEqual(beside.productionManagedBy, managedBy);
  assert.equal(beside.recipeHash, without.recipeHash);
  assert.deepEqual(beside.steps, without.steps);
  assert.deepEqual(beside.services, without.services);
  // Without the line nothing new appears, in the parse or the inspection.
  assert.equal(Object.hasOwn(without, "productionManagedBy"), false);
  assert.equal(Object.hasOwn(parseVibe64DeploymentLines(STEPS), "productionManagedBy"), false);

  // Above the services of a Deployment with services, every service keeps its own lines.
  const services = inspect([LINE, ...MEMOBOT_DEPLOYMENT_LINES], MEMOBOT_RESOURCES);
  assert.deepEqual(services.productionManagedBy, managedBy);
  assert.deepEqual(services.services, inspect(MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES).services);

  // Names and addresses within the rules are kept exactly as written.
  for (const [name, url] of [
    ["Ops (EU) & Partners' Releases", "https://example.com"],
    ["Ünïcode 2 +x_y-z.", "https://ops.example.com:8443/app/deploy?tab=production&x=1#releases"],
    ["a".repeat(60), "https://xn--bcher-kva.example/a%20b"]
  ]) {
    assert.deepEqual(parseVibe64DeploymentLines([`- Production: managed by \`${name}\` at \`${url}\``]).productionManagedBy, { name, url });
  }
});

test("a malformed Production line is refused at its line, naming the fix", () => {
  const form = /Deployment Production says who deploys Production instead of a host, such as `- Production: managed by `Example Console` at `https:\/\/console\.example\.com\/deployments``; a service's `- Production: `N` instances` goes under its ### Service heading\./u;
  // Another form: a service's starting count above the services, or the values without their backticks.
  refusedAt([...STEPS, "- Production: `2` instances"], 5, form);
  refusedAt([`- Production: managed by ${NAME} at ${URL}`], 1, form);
  refusedAt([`- Production: managed by \`${NAME}\` at \`${URL}\` now`], 1, form);

  const name = /Deployment Production names who manages it in 1 to 60 letters, digits, single spaces and \. & ' \+ \( \) _ -, starting with a letter or digit, such as `Example Console`;/u;
  for (const wrong of ["", " Console", "Console ", "Two  spaces", "-Console", "<b>Console</b>", "Ops/Releases", "Tab\tName", "a".repeat(61)]) {
    refusedAt([STEPS[0], `- Production: managed by \`${wrong}\` at \`${URL}\``, ...STEPS.slice(1)], 2, name);
  }

  const address = /Deployment Production gives the https address where Production is managed, such as `https:\/\/console\.example\.com\/deployments`, without a user name or password;/u;
  for (const wrong of [
    "", "http://console.example.com", "ftp://console.example.com", "HTTPS://CONSOLE.EXAMPLE.COM", "https://", "https:///path",
    "https://user@console.example.com", "https://user:secret@console.example.com", "https://console.example.com/a b",
    "https://console.example.com/<script>", "javascript:alert(1)", "//console.example.com", "console.example.com",
    `https://console.example.com/${"a".repeat(2048)}`
  ]) {
    refusedAt([`- Production: managed by \`${NAME}\` at \`${wrong}\``], 1, address);
  }

  refusedAt([LINE, ...STEPS, LINE], 6, /Duplicate Deployment Production\./u);
  // It is the whole Deployment's: under a service's heading, where `- Production:` is that service's starting count.
  refusedAt([
    "- Runtimes: `nodejs`", "", "### Service `web`: pages", "", "- Exposure: `public`", LINE,
    "- Serve `Start`: `node` `server.js`", "- Ready when: `GET` `/health` returns `200`", "- Instances: `1` to `2`"
  ], 6, /Service `web`: who manages Production is the whole Deployment's: put `- Production: managed by` above the first ### heading\./u);
  // Only the line alone may leave out the steps.
  assert.throws(() => parseVibe64DeploymentLines(["- Runtimes: `nodejs`", LINE]),
    /## Deployment needs at least one command or exactly `- Nothing\.`\./u);
});

test("the deploy engine refuses Production of a project the Stack says is managed elsewhere, naming the manager, whatever else the Deployment says", () => {
  const expected = {
    code: "production_managed_elsewhere",
    message: `genesis/stack.md says ${NAME} manages this app's Production, at ${URL}, so Vibe64 doesn't deploy it to `
      + `production: deploy it with ${NAME}. To deploy it from Vibe64 instead, remove the Production line from `
      + "genesis/stack.md's Deployment section (the coding agent can do this), Save, then deploy to production.",
    managedBy: { name: NAME, url: URL }
  };
  for (const lines of [[LINE], [STEPS[0], LINE, ...STEPS.slice(1)]]) {
    assert.deepEqual(needsOfStack(inspect(lines), RESOURCE_RULES), { needs: null, problem: expected }, lines.join("\n"));
  }
  assert.deepEqual(needsOfStack(inspect([LINE, ...MEMOBOT_DEPLOYMENT_LINES], MEMOBOT_RESOURCES), RESOURCE_RULES),
    { needs: null, problem: expected });
  // Without the line the same Deployment gives its needs, as before.
  const { needs, problem } = needsOfStack(inspect(STEPS), RESOURCE_RULES);
  assert.equal(problem, null);
  assert.deepEqual(needs.services.map((service) => service.id), ["web"]);
});

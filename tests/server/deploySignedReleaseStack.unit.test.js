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

// A Deployment's `- Signed release `name`: `command` `argument`...` says that Production releases the project as one
// signed prebuilt release of an app a provider's machine already runs: the command, run at the saved commit, leaves
// output.tar and manifest.json, the key's holder signs the manifest where the key is, and the host hands the app the
// release. The line is the whole Deployment's; the inspection carries its name and command, outside Staging's recipe;
// the deploy engine's Plan refuses such a Production, which makes no App Services.
const RESOURCE_RULES = Object.freeze({ preferredAlternative, resourceKindIsDatabase });
const NAME = "Control plane release";
const LINE = `- Signed release \`${NAME}\`: \`sh\` \`release/signed-release.sh\``;
const SIGNED = Object.freeze({ name: NAME, argv: ["sh", "release/signed-release.sh"] });
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

test("the Signed release line names the release and its command, alone or beside the steps, and leaves Staging's recipe as it was", () => {
  assert.ok(DEPLOYMENT_ENTRY_FORMS.includes("- Signed release `name`: `command` `argument`..."), "the form is listed");

  // Alone, it runs nothing on a host, like `- Nothing.`: Staging has nothing to publish.
  const alone = parseVibe64DeploymentLines(["", LINE, ""]);
  assert.deepEqual(alone.signedRelease, SIGNED);
  assert.deepEqual(alone.steps, []);
  assert.deepEqual(alone.services, []);
  const aloneInspected = inspect([LINE]);
  assert.equal(aloneInspected.status, "unconfigured");
  assert.equal(aloneInspected.recipeHash, "");
  assert.deepEqual(aloneInspected.signedRelease, SIGNED);

  // Beside the steps, Staging's plan is the same as without it: same steps, same recipe identity.
  const without = inspect(STEPS);
  const beside = inspect([STEPS[0], LINE, ...STEPS.slice(1)]);
  assert.equal(beside.status, "ready");
  assert.deepEqual(beside.signedRelease, SIGNED);
  assert.equal(beside.recipeHash, without.recipeHash);
  assert.deepEqual(beside.steps, without.steps);
  assert.deepEqual(beside.services, without.services);
  // Without the line nothing new appears, in the parse or the inspection.
  assert.equal(Object.hasOwn(without, "signedRelease"), false);
  assert.equal(Object.hasOwn(parseVibe64DeploymentLines(STEPS), "signedRelease"), false);

  // Above the services of a Deployment with services, every service keeps its own lines.
  const services = inspect([LINE, ...MEMOBOT_DEPLOYMENT_LINES], MEMOBOT_RESOURCES);
  assert.deepEqual(services.signedRelease, SIGNED);
  assert.deepEqual(services.services, inspect(MEMOBOT_DEPLOYMENT_LINES, MEMOBOT_RESOURCES).services);

  // Names within the rules, and commands of any arguments, are kept exactly as written.
  for (const [name, command, argv] of [
    ["Ops (EU) & Partners' Release", "`node` `tools/release.mjs` `--signed`", ["node", "tools/release.mjs", "--signed"]],
    ["Ünïcode 2 +x_y-z.", "`release/make`", ["release/make"]],
    ["a".repeat(60), "`bash` `-e` `release/signed release.sh`", ["bash", "-e", "release/signed release.sh"]]
  ]) {
    assert.deepEqual(parseVibe64DeploymentLines([`- Signed release \`${name}\`: ${command}`]).signedRelease, { name, argv });
  }
});

test("a malformed Signed release line is refused at its line, naming the fix", () => {
  const form = /Deployment Signed release names the release and the command that builds it at the saved commit, such as `- Signed release `Control plane release`: `sh` `release\/signed-release\.sh``\./u;
  refusedAt([...STEPS, "- Signed release: `sh` `release/signed-release.sh`"], 5, form);
  refusedAt([`- Signed release ${NAME}: \`sh\` \`release/signed-release.sh\``], 1, form);
  refusedAt([`- Signed release \`${NAME}\`:`], 1, form);
  refusedAt([`- Signed release \`${NAME}\` \`sh\``], 1, form);

  const name = /Deployment Signed release names the release in 1 to 60 letters, digits, single spaces and \. & ' \+ \( \) _ -, starting with a letter or digit, such as `Control plane release`;/u;
  for (const wrong of [" Release", "Release ", "Two  spaces", "-Release", "<b>Release</b>", "Ops/Releases", "a".repeat(61)]) {
    refusedAt([STEPS[0], `- Signed release \`${wrong}\`: \`sh\` \`release/signed-release.sh\``, ...STEPS.slice(1)], 2, name);
  }
  // Its command is a command as a step's is, which serves nothing and sets none of the host's names.
  refusedAt([`- Signed release \`${NAME}\`: sh release/signed-release.sh`], 1, /Deployment Signed release command/u);
  refusedAt([`- Signed release \`${NAME}\`: \`sh\` \`release.sh\` \`--port={port}\``], 1,
    /Deployment Signed release's command takes no \{host\} or \{port\} placeholders: it builds a release and serves nothing\./u);
  refusedAt([`- Signed release \`${NAME}\`: \`APP_ENV=production\` \`sh\` \`release.sh\``], 1, /Deployment never sets APP_ENV/u);
  for (const own of ["V64_COMMIT", "V64_RELEASE_DIR", "V64_RELEASE_KEY"]) {
    refusedAt([`- Signed release \`${NAME}\`: \`${own}=x\` \`sh\` \`release.sh\``], 1,
      new RegExp(`Deployment Signed release never sets ${own}: the host gives the command V64_COMMIT, V64_RELEASE_DIR and V64_RELEASE_KEY\\.`, "u"));
  }

  refusedAt([LINE, ...STEPS, LINE], 6, /Duplicate Deployment Signed release\./u);
  // Production is released one way: by the line, or by whoever the Production line names, never both.
  refusedAt([LINE, ...STEPS, "- Production: managed by `Example Console` at `https://console.example.com/deployments`"], 6,
    /Deployment says both who manages Production elsewhere and that Production is a signed release from here: keep one of `- Production: managed by` and `- Signed release`\./u);
  refusedAt(["- Production: managed by `Example Console` at `https://console.example.com/deployments`", LINE], 2,
    /keep one of `- Production: managed by` and `- Signed release`\./u);
  // It is the whole Deployment's, never a service's.
  refusedAt([
    "- Runtimes: `nodejs`", "", "### Service `web`: pages", "", "- Exposure: `public`", LINE,
    "- Serve `Start`: `node` `server.js`", "- Ready when: `GET` `/health` returns `200`", "- Instances: `1` to `2`"
  ], 6, /Service `web`: a signed release is the whole Deployment's: put `- Signed release` above the first ### heading\./u);
  // Only the line alone may leave out the steps.
  assert.throws(() => parseVibe64DeploymentLines(["- Runtimes: `nodejs`", LINE]),
    /## Deployment needs at least one command or exactly `- Nothing\.`\./u);
});

test("the deploy engine's Plan refuses a Production the Stack releases as a signed release, naming it, whatever else the Deployment says", () => {
  const expected = {
    code: "production_signed_release",
    message: `genesis/stack.md releases this app's Production as one signed release (${NAME}) of an app a provider's machine `
      + "already runs, so Vibe64 makes no App Services for it: build it, sign it and hand it over from the Production card. "
      + "To deploy it as App Services instead, remove the Signed release line from genesis/stack.md's Deployment section "
      + "(the coding agent can do this), Save, then deploy to production.",
    signedRelease: { name: NAME }
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

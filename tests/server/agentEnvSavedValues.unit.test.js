import assert from "node:assert/strict";
import test from "node:test";

import { createAgentEnvCommandService } from "../../packages/vibe64-terminals/src/server/agentEnvCommand.js";
import { runWithProjectRequestContext } from "../../packages/vibe64-core/src/server/projectRequestContext.js";

const linkedRecord = {
  editable: false, key: "PAYMENTS_KEY", label: "From Test vault: Payments — main", owner: "system",
  requiredFor: [], scope: "dev", secret: true, source: "vibe64-host:saved-value", value: "********", valuePresent: true
};

function projectService(records = []) {
  return {
    async readCurrentProject() { return { projectRoot: "/srv/projects/demo", slug: "demo" }; },
    async readEnv() { return { ok: true, env: { records } }; },
    async runInProjectContext(_slug, operation) { return operation(); },
    async saveEnvUserValues() { return { ok: true, env: { records } }; }
  };
}

function testVault() {
  const calls = [];
  return {
    calls,
    label: "Test vault",
    async valuesForProject() { return { contract: "vibe64.saved-env-values.v1", values: [] }; },
    async list(input) {
      calls.push(["list", input]);
      return { entries: [
        { id: "saved_1", label: "Payments — main", description: "Live payments for the shop", environments: ["development"],
          fields: [{ id: "apiKey", label: "API key", secret: true }, { id: "region", label: "Region", secret: false }] }
      ] };
    },
    async link(input) {
      calls.push(["link", input]);
      return input.environment === "production"
        ? { ok: false, code: "vibe64_owner_required", error: "Only the owner can link keys in Production." }
        : { ok: true };
    },
    async unlink(input) { calls.push(["unlink", input]); return { ok: true }; }
  };
}

async function boundCommand(records = [], actor = { username: "teammate", role: "member" }) {
  const command = createAgentEnvCommandService({ projectService: projectService(records) });
  await runWithProjectRequestContext({ slug: "demo", vibe64User: actor }, () => command.bindSession("saved-session"));
  return command;
}

const run = (command, args) => command.run({ args, sessionId: "saved-session" });

test("without a saved-value host the helper says so and exits cleanly", async () => {
  const command = await boundCommand();
  const saved = await run(command, ["saved"]);
  assert.equal(saved.exitCode, 0);
  assert.equal(saved.stdout, "This workspace offers no saved values.\n");
  const linked = await run(command, ["link", "development", "PAYMENTS_KEY", "saved_1", "apiKey"]);
  assert.equal(linked.ok, false);
  assert.equal(linked.code, "vibe64_saved_env_values_unavailable");
});

test("saved lists names, descriptions and fields, never values, for the bound person", async () => {
  const command = await boundCommand();
  const vault = testVault();
  command.setSavedEnvValueProvider(vault);
  const saved = await run(command, ["saved"]);
  assert.equal(saved.stdout, "saved_1 Payments — main — Live payments for the shop (fields: apiKey*, region)\n");
  const json = JSON.parse((await run(command, ["saved", "--json"])).stdout);
  assert.equal(json.provider, "Test vault");
  assert.deepEqual(json.entries[0].fields.map((field) => field.id), ["apiKey", "region"]);
  assert.deepEqual(vault.calls[0][1], { actor: { username: "teammate", role: "member" }, projectSlug: "demo", sessionId: "saved-session" });
  assert.equal((await run(command, ["saved", "extra"])).code, "vibe64_agent_env_command_usage");
});

test("link and unlink go to the host with the bound person; its refusal is reported", async () => {
  const command = await boundCommand();
  const vault = testVault();
  command.setSavedEnvValueProvider(vault);
  const linked = await run(command, ["link", "development", "PAYMENTS_KEY", "saved_1", "apiKey"]);
  assert.equal(linked.exitCode, 0);
  assert.equal(linked.stdout, "Linked development Env PAYMENTS_KEY to saved_1 (apiKey).\nThe value was not printed.\n");
  assert.deepEqual(vault.calls.at(-1), ["link", { actor: { username: "teammate", role: "member" }, projectSlug: "demo",
    sessionId: "saved-session", environment: "development", key: "PAYMENTS_KEY", entryId: "saved_1", fieldId: "apiKey" }]);
  const refused = await run(command, ["link", "production", "PAYMENTS_KEY", "saved_1", "apiKey"]);
  assert.equal(refused.ok, false);
  assert.equal(refused.stderr, "Only the owner can link keys in Production.\n");
  const unlinked = await run(command, ["unlink", "development", "PAYMENTS_KEY"]);
  assert.equal(unlinked.stdout, "Unlinked development Env PAYMENTS_KEY; it is now an ordinary empty row.\n");
  assert.equal((await run(command, ["link", "development", "PAYMENTS_KEY"])).code, "vibe64_agent_env_command_usage");
  assert.equal((await run(command, ["unlink", "development", "PAYMENTS_KEY", "--secret"])).code, "vibe64_agent_env_command_usage");
});

test("status shows a linked row with its provenance and set refuses it", async () => {
  const command = await boundCommand([linkedRecord]);
  command.setSavedEnvValueProvider(testVault());
  const status = await run(command, ["status", "development"]);
  assert.equal(status.stdout, "Development Env:\n  PAYMENTS_KEY — linked — From Test vault: Payments — main\n");
  const json = JSON.parse((await run(command, ["status", "development", "--json"])).stdout);
  assert.equal(json.scopes.development.records[0].state, "linked");
  assert.equal(json.scopes.development.records[0].label, "From Test vault: Payments — main");
  const set = await command.run({ args: ["set", "development", "PAYMENTS_KEY"], sessionId: "saved-session", stdin: "typed" });
  assert.equal(set.code, "vibe64_env_value_linked");
  assert.equal(set.stderr, "PAYMENTS_KEY is linked to a saved value. Unlink it before entering a value here.\n");
  assert.equal((await run(command, ["remove", "development", "PAYMENTS_KEY"])).code, "vibe64_env_value_linked");
});

// Publishing targets are the person's choices about where a package lands. They
// are Vibe64 project state (never Stack): `<project runtime>/publishing/targets.json`.
import path from "node:path";

import { vibe64Destination } from "@local/vibe64-packaging/server/destinations";

import { readJsonFile, serialized, writeJsonFile } from "./jsonFile.js";

const TARGETS_CONTRACT = "vibe64.publishing-targets.v1";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/u;

function targetError(message, code = "vibe64_publishing_target_invalid") {
  return Object.assign(new Error(message), { code });
}

function plainSettings(settings = {}) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw targetError("Target settings must be an object.");
  const result = {};
  for (const [name, value] of Object.entries(settings)) {
    if (value === null || value === undefined || value === "") continue;
    if (!/^[a-z][A-Za-z0-9]*$/u.test(name)) throw targetError(`Setting ${name} is not a setting name.`);
    if (typeof value !== "string" && typeof value !== "boolean") throw targetError(`Setting ${name} must be text or true/false.`);
    if (typeof value === "string" && (value.length > 512 || /[\0\r\n]/u.test(value))) throw targetError(`Setting ${name} must be one short line.`);
    result[name] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeTarget(input = {}, { now }) {
  const destination = vibe64Destination(input.destination);
  const packageId = String(input.package || "").trim();
  if (!ID.test(packageId)) throw targetError("Choose the package this target publishes.");
  const id = String(input.id || `${packageId}-${destination.id}`).trim();
  if (!ID.test(id) || id.length > 64) throw targetError("A target id uses lowercase letters, digits and single hyphens.");
  const channel = input.channel ? String(input.channel).trim() : null;
  if (channel && !destination.channels.includes(channel)) throw targetError(`${destination.label} has no channel ${channel}.`);
  const account = input.account ? String(input.account).trim() : null;
  if (account !== null && !ACCOUNT_ID.test(account)) throw targetError("The publishing account id is not valid.");
  return {
    id,
    destination: destination.id,
    package: packageId,
    channel,
    settings: plainSettings(input.settings || {}),
    account,
    createdAt: input.createdAt || now()
  };
}

function createTargetsStore({ runtimeRoot, now = () => new Date().toISOString() } = {}) {
  if (!path.isAbsolute(runtimeRoot || "")) throw new TypeError("The targets store needs the project's publishing folder.");
  const file = path.join(runtimeRoot, "targets.json");
  const exclusive = serialized();

  async function read() {
    const value = await readJsonFile(file, () => ({ contract: TARGETS_CONTRACT, targets: [] }));
    if (value?.contract !== TARGETS_CONTRACT || !Array.isArray(value.targets)) {
      throw targetError("The saved publishing targets are not in a format this Vibe64 reads.", "vibe64_publishing_state_invalid");
    }
    return value.targets;
  }

  async function write(targets) {
    await writeJsonFile(file, { contract: TARGETS_CONTRACT, targets });
    return targets;
  }

  return Object.freeze({
    file,
    list: read,
    async get(id) {
      return (await read()).find((target) => target.id === id) || null;
    },
    add(input) {
      return exclusive(async () => {
        const targets = await read();
        const target = normalizeTarget(input, { now });
        if (targets.some((existing) => existing.id === target.id)) {
          throw targetError(`A target called ${target.id} already exists.`, "vibe64_publishing_target_exists");
        }
        await write([...targets, target]);
        return target;
      });
    },
    update(id, changes = {}) {
      return exclusive(async () => {
        const targets = await read();
        const index = targets.findIndex((target) => target.id === id);
        if (index === -1) throw targetError(`There is no target ${id}.`, "vibe64_publishing_target_missing");
        const next = normalizeTarget({ ...targets[index], ...changes, id, createdAt: targets[index].createdAt }, { now });
        targets[index] = next;
        await write(targets);
        return next;
      });
    },
    remove(id) {
      return exclusive(async () => {
        const targets = await read();
        if (!targets.some((target) => target.id === id)) throw targetError(`There is no target ${id}.`, "vibe64_publishing_target_missing");
        await write(targets.filter((target) => target.id !== id));
        return { removed: id };
      });
    }
  });
}

export { TARGETS_CONTRACT, createTargetsStore, normalizeTarget };

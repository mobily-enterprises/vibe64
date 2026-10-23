// "Checks on the saved commit": the project's own `## Verification` commands, run
// in a fresh checkout of exactly the commit being released, with no publishing
// credentials in their environment. Results are kept per commit in
// `<project runtime>/publishing/verification.json`.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { verifyGenesisProject } from "@local/vibe64-genesis/server";

import { readJsonFile, serialized, writeJsonFile } from "./state/jsonFile.js";

const VERIFICATION_CONTRACT = "vibe64.publishing-verification.v1";
const PASSTHROUGH = ["PATH", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "TERM"];
const KEEP = 10;

function checkEnvironment(home, base = process.env) {
  const environment = {};
  for (const name of PASSTHROUGH) if (typeof base[name] === "string") environment[name] = base[name];
  return { ...environment, HOME: home, TMPDIR: home, CI: "1", GIT_TERMINAL_PROMPT: "0" };
}

function createVerificationRunner({ runtimeRoot, repository, verify = verifyGenesisProject, now = () => new Date().toISOString() } = {}) {
  if (!path.isAbsolute(runtimeRoot || "")) throw new TypeError("Checks need the project's publishing folder.");
  const file = path.join(runtimeRoot, "verification.json");
  const exclusive = serialized();
  const running = new Map();

  async function results() {
    const value = await readJsonFile(file, () => ({ contract: VERIFICATION_CONTRACT, results: [] }));
    return value?.contract === VERIFICATION_CONTRACT ? value.results : [];
  }

  async function record(result) {
    return exclusive(async () => {
      const kept = (await results()).filter((entry) => entry.commit !== result.commit);
      await writeJsonFile(file, { contract: VERIFICATION_CONTRACT, results: [...kept, result].slice(-KEEP) });
      return result;
    });
  }

  async function status(commit) {
    if (running.has(commit)) return { commit, status: "running" };
    return (await results()).find((entry) => entry.commit === commit) || null;
  }

  // Runs the checks once per commit at a time; resolves with the result.
  function run({ repositoryRoot, commit }) {
    if (running.has(commit)) return running.get(commit);
    const startedAt = now();
    const work = (async () => {
      const home = await mkdtemp(path.join(os.tmpdir(), "vibe64-checks-home-"));
      try {
        const outcome = await repository.withCheckout(repositoryRoot, commit, (root) => verify({ projectRoot: root, environment: checkEnvironment(home) }));
        return await record({
          commit,
          status: outcome?.status === "passed" ? "passed" : outcome?.status === "unconfigured" ? "unconfigured" : "failed",
          summary: String(outcome?.summary || "").slice(0, 2000),
          commands: (outcome?.commands || []).map(({ label }) => label).slice(0, 50),
          startedAt,
          finishedAt: now()
        });
      } catch (error) {
        return record({ commit, status: "failed", summary: String(error?.message || "The checks could not run.").slice(-2000), commands: [], startedAt, finishedAt: now() });
      } finally {
        running.delete(commit);
        await rm(home, { recursive: true, force: true });
      }
    })();
    running.set(commit, work);
    return work;
  }

  return Object.freeze({ run, status });
}

export { createVerificationRunner };

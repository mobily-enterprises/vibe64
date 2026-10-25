// "Checks on the saved commit": the project's own `## Verification` commands, run
// in a fresh checkout of exactly the commit being released, with no publishing
// credentials in their environment. Results are kept per commit in
// `<project runtime>/publishing/verification.json`.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { verifyGenesisProject } from "@local/vibe64-genesis/server";
import { checkCommandRunner } from "@local/vibe64-packaging/server/projectCommands";
import { passthroughEnvironment } from "@local/vibe64-packaging/server/stages";

import { readJsonFile, serialized, writeJsonFile } from "./state/jsonFile.js";

const VERIFICATION_CONTRACT = "vibe64.publishing-verification.v1";
const KEEP = 10;
const OUTPUT_TAIL = 4000;

// The end of a failed command's output, so the person sees why without a terminal.
function failureOutput(outcome, home) {
  const details = (outcome?.diagnostics || []).find((entry) => entry?.details)?.details || {};
  const text = [details.stdout, details.stderr].map((value) => String(value || "").trimEnd()).filter(Boolean).join("\n");
  return text.replaceAll(home, "~").slice(-OUTPUT_TAIL);
}

function checkEnvironment(home, base = process.env) {
  return { ...passthroughEnvironment(base), HOME: home, TMPDIR: home, CI: "1", GIT_TERMINAL_PROMPT: "0" };
}

function createVerificationRunner({
  runtimeRoot, repository, verify = verifyGenesisProject, processRunner = checkCommandRunner(), now = () => new Date().toISOString()
} = {}) {
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
        let current = "";
        const onEvent = (event) => {
          if (event?.code === "VERIFICATION_STARTED") current = String(event.details?.label || "");
        };
        const outcome = await repository.withCheckout(repositoryRoot, commit, (root) => verify({ projectRoot: root, environment: checkEnvironment(home), onEvent, processRunner }));
        const status = outcome?.status === "passed" ? "passed" : outcome?.status === "unconfigured" ? "unconfigured" : "failed";
        return await record({
          commit,
          status,
          summary: String(outcome?.summary || "").slice(0, 2000),
          commands: (outcome?.commands || []).map(({ label }) => label).slice(0, 50),
          ...(status === "failed" ? { failedCommand: current.slice(0, 200), output: failureOutput(outcome, home) } : {}),
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

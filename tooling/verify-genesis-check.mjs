import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// `npm run verify`'s Genesis step: the project's own `genesis check`, with the Genesis it pins (npm exec --no runs
// node_modules' genesis-compiler, never a downloaded one). It fails on what that check finds invalid (a Program module,
// the managed-skill manifest, saved evidence) and on managed Agent Skill copies that are not exactly that Genesis's
// (`npm exec --no -- genesis skills sync` refreshes them with the same Genesis). Everything else the check reports,
// such as verification evidence never saved, is the check's attention, which a verify run does not fail on.

/**
 * What a `genesis check --json` result fails verify for: one line each, empty when it passes.
 * @param {{ status: string, program: string, skills: string, diagnostics?: Array<{ code: string, message: string }> }}
 *   result
 * @returns {string[]}
 */
export function genesisCheckFailures(result) {
  const failures = [];
  if (["invalid", "blocked"].includes(result.status)) {
    failures.push(`Genesis check is ${result.status} (Program: ${result.program}, Agent Skills: ${result.skills}).`);
    for (const { code, message } of result.diagnostics || []) failures.push(`${code}: ${message}`);
  }
  if (result.skills !== "current") {
    failures.push(
      `Agent Skills are ${result.skills}, not current: run \`npm exec --no -- genesis skills sync\` `
      + "(the pinned Genesis, never one on PATH) and commit the refreshed .agents/skills copies."
    );
  }
  return failures;
}

function run() {
  const check = spawnSync("npm", ["exec", "--no", "--", "genesis", "check", "--json"], { encoding: "utf8" });
  if (check.error) throw check.error;
  let result;
  try {
    result = JSON.parse(check.stdout.trim().split("\n").at(-1));
  } catch {
    process.stderr.write(`${check.stdout}${check.stderr}`);
    throw new Error(`genesis check --json gave no result (exit ${check.status}).`);
  }
  const failures = genesisCheckFailures(result);
  if (failures.length === 0) {
    const { status, program, skills } = result;
    process.stdout.write(`Genesis check: ${status} (Program: ${program}, Agent Skills: ${skills}).\n`);
    return 0;
  }
  process.stderr.write(`${failures.join("\n")}\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}

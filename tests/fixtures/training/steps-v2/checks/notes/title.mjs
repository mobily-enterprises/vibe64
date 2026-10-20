// Code check contract: read {check, filesHash, files} on stdin, import the
// learner's copy of the exercise and print exactly one JSON result line.
// Exit 0 with outcome "verified", or exit 1 with outcome "incomplete" and a reason.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const report = (outcome, reason) => {
  console.log(JSON.stringify({ check: input.check, filesHash: input.filesHash, outcome, ...(reason ? { reason } : {}) }));
  process.exitCode = outcome === "verified" ? 0 : 1;
};
const { isValidTitle } = await import(new URL("../../app/notes.mjs", import.meta.url));
if (isValidTitle("") !== false || isValidTitle("   ") !== false) report("incomplete", "Empty or blank titles are still accepted.");
else if (isValidTitle("Groceries") !== true) report("incomplete", "A real title such as Groceries is refused.");
else report("verified");

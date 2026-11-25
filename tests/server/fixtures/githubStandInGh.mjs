// The gh of the GitHub Releases stand-in (tests/server/packagingGithubStandIn.js), run as
// `node githubStandInGh.mjs <stand-in address> <gh arguments...>`. It sends its arguments, folder and environment,
// with the bytes of every argument that names a file, to the stand-in GitHub at that loopback address, prints the
// stand-in's answer and exits with its exit code. It reaches nothing else.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [address = "", ...args] = process.argv.slice(2);
const target = URL.canParse(address) ? new URL("_stand-in/gh", address) : null;
if (target?.protocol !== "http:" || target.hostname !== "127.0.0.1") {
  process.stderr.write(`githubStandInGh.mjs reaches only a loopback stand-in, not ${address || "nothing"}.\n`);
  process.exit(2);
}

const files = {};
for (const argument of args) {
  if (!path.isAbsolute(argument)) continue;
  const details = await stat(argument).catch(() => null);
  if (details?.isFile()) files[argument] = (await readFile(argument)).toString("base64");
}
const response = await fetch(target, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ args, cwd: process.cwd(), env: process.env, files })
});
const answer = await response.json();
process.stdout.write(answer.stdout);
process.stderr.write(answer.stderr);
process.exitCode = answer.exitCode;

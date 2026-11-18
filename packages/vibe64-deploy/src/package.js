// The archive a deploy sends its provider: the saved commit as a gzip tarball, made by git with no key and no
// provider's call, with the files Vibe64 makes for it (the app's build and service scripts and its provider's
// declaration) added. A commit that already has a file Vibe64 makes is refused: what the app needs is said once, in
// genesis/stack.md.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DECLARATION_FILE = "mobilynet.json";
const APP_SCRIPTS_FOLDER = "vibe64-app";
// The largest archive a deploy sends: what one deploy request could carry, base64, beside its small fields.
const PACKAGE_MAX_BYTES = Math.floor((64 * 1024 * 1024 - 64 * 1024) * 3 / 4);

/** A refusal a caller shows as it is, with its code and HTTP status. */
function packageError(message, code, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

/**
 * Why the saved commit can't be packed, as `{ code, message }`, or null: it has its own mobilynet.json, or its own
 * vibe64-app folder, where Vibe64 puts the scripts it makes.
 * @param {{ commit: string, git: (args: string[]) => Promise<string> }} source
 */
async function archiveProblem({ commit, git }) {
  const exists = (file) => git(["cat-file", "-e", `${commit}:${file}`]).then(() => true, () => false);
  const [ownDeclaration, scriptsFolderTaken] = await Promise.all([exists(DECLARATION_FILE), exists(APP_SCRIPTS_FOLDER)]);
  if (ownDeclaration) {
    return {
      code: "production_own_declaration",
      message: "The saved work has its own mobilynet.json, but Production makes the app's package from genesis/stack.md: say "
        + "what the app needs there (its Deployment section and ## Resources; the coding agent can do this), remove "
        + "mobilynet.json, Save, then deploy."
    };
  }
  if (scriptsFolderTaken) {
    return {
      code: "vibe64_production_folder_taken",
      message: `The saved work has its own ${APP_SCRIPTS_FOLDER}, where Vibe64 puts the build and service scripts of the `
        + "package it makes. Rename it, Save, then deploy."
    };
  }
  return null;
}

/**
 * Packs the commit as a gzip tarball with the made package's mobilynet.json and scripts, and answers it as the deploy
 * sends it. Refuses one too big to send.
 * @param {object} options
 * @param {string} options.commit
 * @param {(args: string[]) => Promise<string>} options.git
 * @param {string} options.scratch a folder git may write into
 * @param {{ declaration: object, scripts: Record<string, string> }} options.made the declaration and scripts
 * @param {number} [options.maxBytes] the largest archive taken
 */
async function packProduction({ commit, git, scratch, made, maxBytes = PACKAGE_MAX_BYTES }) {
  const output = path.join(scratch, "production-package.tar.gz");
  const args = ["archive", "--format=tar.gz", `--output=${output}`];
  // git archive adds each extra file under the last --prefix before it; the commit's own files take the last one.
  const folder = path.join(scratch, "production-package");
  await mkdir(path.join(folder, APP_SCRIPTS_FOLDER), { recursive: true });
  await writeFile(path.join(folder, DECLARATION_FILE), `${JSON.stringify(made.declaration, null, 2)}\n`);
  args.push(`--prefix=${APP_SCRIPTS_FOLDER}/`);
  for (const [file, text] of Object.entries(made.scripts)) {
    await writeFile(path.join(folder, file), text, { mode: 0o755 });
    args.push(`--add-file=${path.join(folder, file)}`);
  }
  args.push("--prefix=", `--add-file=${path.join(folder, DECLARATION_FILE)}`);
  await git([...args, commit]);
  const bytes = await readFile(output);
  if (bytes.length > maxBytes) {
    throw packageError(
      `The packed app is ${megabytes(bytes.length)} MiB; Production takes at most `
      + `${megabytes(maxBytes)} MiB. Keep built files and large assets out of the repository, Save, then deploy.`,
      "vibe64_production_package_too_large"
    );
  }
  return { archive: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** The settings a declaration names, which are the only ones the deploy sets. */
function declaredSettingsOf(declaration) {
  return Object.keys(isRecord(declaration?.settings) ? declaration.settings : {});
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function megabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export {
  PACKAGE_MAX_BYTES,
  archiveProblem,
  declaredSettingsOf,
  packProduction
};

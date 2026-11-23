// Where an agent's Git command acts: the repository its working directory,
// `-C`, `--git-dir`, `--work-tree`, GIT_DIR and GIT_WORK_TREE name (for init
// and clone, the repository they make; for push and fetch, a remote on this
// computer), placed in one of the session's places: its source, one of its
// connected copies or its own temporary folder. A command decides by those
// places, never by its working directory alone.
//
// - Wholly in the source, or wholly in one copy: that place's rules, as before.
// - Changing only the temporary folder, reading at most the source or a copy:
//   plain local Git, with none of the session's credentials or identity.
// - Anything else (another session, another project, the workspace's
//   temporary folder, or a change to the source or a copy made from outside
//   it): refused.

import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { pathInsideOrEqual } from "@local/vibe64-core/server/core";
import { sessionTempPath } from "@local/vibe64-core/server/sessionSourcePath";
import { GIT_READ_ONLY_OPERATIONS, parseGitInvocation } from "./codexGitCommandOperations.js";
import { commandFailure } from "./commandFailure.js";

// What the wrapper sends from the command's own environment: where its
// repository and work tree are, and the identity plain local Git's commits take.
const GIT_LOCATION_ENV_NAMES = Object.freeze(["GIT_DIR", "GIT_WORK_TREE"]);
const GIT_PLAIN_IDENTITY_ENV_NAMES = Object.freeze([
  "GIT_AUTHOR_DATE",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_NAME",
  "GIT_COMMITTER_DATE",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_NAME"
]);
const CODEX_GIT_COMMAND_FORWARDED_ENV_NAMES = Object.freeze([...GIT_LOCATION_ENV_NAMES, ...GIT_PLAIN_IDENTITY_ENV_NAMES]);

// Each subcommand's options that take the next argument, so its positional
// arguments can be found; the ones that name a repository are read below.
const FETCH_VALUE_OPTIONS = ["--depth", "--deepen", "--shallow-since", "--shallow-exclude", "-j", "--jobs",
  "--negotiation-tip", "--upload-pack", "-o", "--server-option", "--refmap"];
const SUBCOMMAND_VALUE_OPTIONS = Object.freeze({
  clone: new Set(["-o", "--origin", "-b", "--branch", "-u", "--upload-pack", "--reference", "--reference-if-able",
    "--separate-git-dir", "--depth", "--shallow-since", "--shallow-exclude", "-j", "--jobs", "-c", "--config",
    "--template", "--server-option", "--filter", "--bundle-uri", "--ref-format", "--revision"]),
  fetch: new Set(FETCH_VALUE_OPTIONS),
  init: new Set(["--template", "--separate-git-dir", "-b", "--initial-branch", "--object-format", "--ref-format"]),
  "ls-remote": new Set(["--upload-pack", "-o", "--server-option"]),
  pull: new Set([...FETCH_VALUE_OPTIONS, "-s", "--strategy", "-X", "--strategy-option"]),
  push: new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"])
});
const REMOTE_OPERATIONS = new Set(["fetch", "ls-remote", "pull", "push"]);
const PROBE_TOPLEVEL_ARGS = Object.freeze(["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir",
  "--is-bare-repository", "--show-toplevel"]);

/**
 * The forwarded names the wrapper sent, as plain strings with no NUL.
 * @param {unknown} value
 */
function forwardedGitEnv(value) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(CODEX_GIT_COMMAND_FORWARDED_ENV_NAMES
    .filter((name) => typeof record[name] === "string" && record[name] !== "" && !record[name].includes("\0"))
    .map((name) => [name, record[name]]));
}

/**
 * `given` as the operating system resolves it from `base`: each existing part
 * through its link, and `..` from where that leads. A missing part is kept as
 * written, as nothing can lead elsewhere through it.
 * @param {string} base an absolute folder
 * @param {string} given
 */
async function physicalPath(base, given = "") {
  const joined = path.isAbsolute(given) ? given : `${base}/${given}`;
  try {
    return await realpath(joined);
  } catch {
    let current = path.isAbsolute(given) ? "/" : await realpath(base).catch(() => path.resolve(base));
    for (const part of String(given).split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        current = path.dirname(current);
        continue;
      }
      const next = path.join(current, part);
      current = await realpath(next).catch(() => next);
    }
    return current;
  }
}

/**
 * A repository a remote command or clone names: a path on this computer, or a remote URL.
 * @param {string} value
 */
function repositoryArgument(value = "") {
  if (/^file:\/\//iu.test(value)) return { local: value.replace(/^file:\/\/(?:localhost)?/iu, "") || "/" };
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) || /^[^/]*:/u.test(value)) return { remote: value };
  return { local: value };
}

/** The folder `git clone <repository>` makes when it names none. */
function cloneDirectoryName(repository = "") {
  const trimmed = repository.replace(/\/+$/u, "").replace(/\/\.git$/u, "");
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf(":")) + 1).replace(/\.git$/u, "");
  return name || "repository";
}

function subcommandArguments(values, start, valueOptions = new Set()) {
  const options = new Map();
  const positionals = [];
  const add = (name, value) => options.set(name, [...(options.get(name) || []), value]);
  for (let index = start; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--") {
      positionals.push(...values.slice(index + 1));
      break;
    }
    if (value.startsWith("-") && value !== "-") {
      const equals = value.indexOf("=");
      if (value.startsWith("--") && equals > 0) {
        add(value.slice(0, equals), value.slice(equals + 1));
      } else if (valueOptions.has(value)) {
        add(value, values[index + 1] ?? "");
        index += 1;
      }
      continue;
    }
    positionals.push(value);
  }
  return { options, positionals };
}

/**
 * The session's places, read only as far as a command needs them: a command
 * that stays in the source reads no connected copies.
 * @param {{ readCopies: () => Promise<Array<{ name: string, path: string }>>, sourceRoot: string }} options
 */
function createSessionGitPlaces({ readCopies, sourceRoot }) {
  const tempRoot = sessionTempPath(sourceRoot);
  let source = null;
  let temp = null;
  let copies = null;
  const physicalSource = () => (source ||= physicalPath("/", sourceRoot));
  // The temporary folder counts only as the real folder beside the source: a
  // link put in its place leads somewhere else.
  const physicalTemp = () => (temp ||= lstat(tempRoot).then(
    (entry) => entry.isDirectory() && !entry.isSymbolicLink() ? realpath(tempRoot) : "",
    () => ""
  ));
  const physicalCopies = () => (copies ||= readCopies().then((list) => Promise.all(list.map(async (copy) => ({
    copy,
    root: await physicalPath("/", path.resolve(copy.path))
  })))));

  /**
   * @param {string} location a physical path
   * @returns {Promise<{ kind: "source" | "copy" | "temp" | "other", root: string, copy?: object, path: string }>}
   */
  async function placeOf(location) {
    if (pathInsideOrEqual(sourceRoot, location) || pathInsideOrEqual(await physicalSource(), location)) {
      return { kind: "source", path: location, root: sourceRoot };
    }
    const tempFolder = await physicalTemp();
    if (tempFolder && pathInsideOrEqual(tempFolder, location)) return { kind: "temp", path: location, root: tempRoot };
    const copy = (await physicalCopies()).find((entry) => pathInsideOrEqual(entry.root, location));
    if (copy) return { copy: copy.copy, kind: "copy", path: location, root: path.resolve(copy.copy.path) };
    return { kind: "other", path: location, root: "" };
  }

  // Inside the source as written, which needs no file system read.
  function insideSource(location) {
    return pathInsideOrEqual(sourceRoot, location);
  }

  // Where Git's repository discovery stops: the session's own folder, around
  // its source, copies and temporary folder.
  async function sessionFolder() {
    return path.dirname(await physicalSource());
  }

  return Object.freeze({
    insideSource,
    placeOf,
    sessionFolder,
    sourceRoot,
    tempRoot
  });
}

/**
 * Where gh and vibe64-github run: by their working directory, which is all
 * they name. Only the source runs them; a copy refuses them below.
 */
async function placeGithubCommand(places, cwd) {
  const place = places.insideSource(cwd) ? { kind: "source", path: cwd, root: places.sourceRoot } : await places.placeOf(cwd);
  if (place.kind === "source" || place.kind === "copy") return { env: {}, place };
  return {
    failure: commandFailure(
      `The AI's gh and vibe64-github run in this session's source, not in ${cwd}.`,
      "vibe64_codex_git_command_cwd_invalid",
      { cwd, statusCode: 403 }
    )
  };
}

function outsideFailure(place, tempRoot, { cwd = false } = {}) {
  return commandFailure(
    `The AI's Git works in this session's source, its connected copies and its own temporary folder, not in ${place.path}. ` +
      `Make throwaway repositories in ${tempRoot}, this session's temporary folder (its TMPDIR).`,
    cwd ? "vibe64_codex_git_command_cwd_invalid" : "vibe64_codex_git_command_place_invalid",
    { cwd: place.path, statusCode: 403, tempRoot }
  );
}

function severalPlacesFailure(places) {
  const named = places.map((place) => place.kind === "copy" ? `connected repository ${place.copy.name}` : "this session's source");
  return commandFailure(
    `This Git command acts on both ${named.join(" and ")}. Run it in one of them: Save publishes the copies and Update brings in their main.`,
    "vibe64_codex_git_command_place_mixed",
    { statusCode: 403 }
  );
}

function mixedFailure(place, tempRoot) {
  const where = place.kind === "copy" ? `connected repository ${place.copy.name} (${place.root})` : `this session's source (${place.root})`;
  return commandFailure(
    `This Git command would change ${where} from outside it. Run it there, for example with git -C ${place.root}, ` +
      `where the session's own Git rules apply; from ${tempRoot} Git only reads the source and the copies.`,
    "vibe64_codex_git_command_place_mixed",
    { cwd: place.path, statusCode: 403, tempRoot }
  );
}

/**
 * The repositories and folders a Git command changes or only reads, each as a
 * physical path: its repository (for init and clone, the one they make) and
 * the repositories clone copies from.
 */
async function gitCommandLocations({ cwd, env, invocation, values }) {
  let dir = cwd;
  for (const given of invocation.chdirs) dir = await physicalPath(dir, given);
  const givenGitDir = invocation.gitDir ?? env.GIT_DIR ?? null;
  const givenWorkTree = invocation.workTree ?? env.GIT_WORK_TREE ?? null;
  const gitDir = givenGitDir !== null ? await physicalPath(dir, givenGitDir) : invocation.bare ? dir : "";
  const workTree = givenWorkTree !== null ? await physicalPath(dir, givenWorkTree) : "";
  const operation = invocation.operation;
  const { options, positionals } = subcommandArguments(values, invocation.operationIndex + 1, SUBCOMMAND_VALUE_OPTIONS[operation]);
  const named = (...names) => names.flatMap((name) => options.get(name) || []);
  const writes = [];
  const reads = [];
  const repositoryEntries = gitDir || workTree ? [gitDir, workTree] : [dir];
  // A git folder named without a work tree works on the working directory
  // unless it is bare, which the temporary folder's probe tells.
  if (gitDir && !workTree && !invocation.bare) reads.push(dir);
  if (operation === "init" && positionals[0] !== undefined) {
    writes.push(await physicalPath(dir, positionals[0]), gitDir, workTree);
  } else if (operation === "clone") {
    const source = positionals[0] ?? "";
    writes.push(await physicalPath(dir, positionals[1] ?? cloneDirectoryName(source)), gitDir, workTree);
    const local = repositoryArgument(source).local;
    if (local !== undefined && source) reads.push(await physicalPath(dir, local));
    for (const reference of named("--reference", "--reference-if-able")) reads.push(await physicalPath(dir, reference));
  } else {
    (GIT_READ_ONLY_OPERATIONS.has(operation) ? reads : writes).push(...repositoryEntries);
  }
  for (const separate of named("--separate-git-dir")) writes.push(await physicalPath(dir, separate));
  return {
    dir,
    env: {
      ...(givenGitDir !== null ? { GIT_DIR: gitDir } : {}),
      ...(workTree ? { GIT_WORK_TREE: workTree } : {})
    },
    named,
    positionals,
    reads: reads.filter(Boolean),
    writes: writes.filter(Boolean)
  };
}

/**
 * The remotes on this computer a temporary folder's push, fetch, pull or
 * ls-remote reaches, as the command names them or its repository's remotes
 * list them: push changes them, the others read them.
 */
async function remoteLocations({ listRemotes, locations, operation }) {
  if (!REMOTE_OPERATIONS.has(operation)) return [];
  const given = locations.named("--repo").at(-1) ?? locations.positionals[0];
  const direction = operation === "push" ? "push" : "fetch";
  const known = given === undefined || !repositoryArgument(given).remote ? await listRemotes() : new Map();
  const urls = given === undefined
    ? [...known.values()].flatMap((remote) => remote[direction])
    : known.get(given)?.[direction] || [given];
  const found = [];
  for (const url of urls) {
    const local = url ? repositoryArgument(url).local : undefined;
    if (local !== undefined) found.push(await physicalPath(locations.dir, local));
  }
  return found;
}

function parseRemotes(stdout = "") {
  const remotes = new Map();
  for (const line of String(stdout).split("\n")) {
    const match = /^(\S+)\t(.*) \((fetch|push)\)$/u.exec(line);
    if (!match) continue;
    const remote = remotes.get(match[1]) || { fetch: [], push: [] };
    remote[match[3]].push(match[2]);
    remotes.set(match[1], remote);
  }
  return remotes;
}

/**
 * Where a session's AI Git command runs, by what it acts on.
 * @param {object} request
 * @param {string[]} request.args
 * @param {string} request.cwd the command's physical working directory
 * @param {Record<string, string>} request.env what the wrapper forwarded (forwardedGitEnv)
 * @param {ReturnType<typeof createSessionGitPlaces>} request.places
 * @param {(args: string[], env: Record<string, string>) => Promise<{ ok?: boolean, stdout?: string, outputEncoding?: string }>} request.runPlainGit
 *   runs plain local Git, as the temporary folder's commands run, from the command's working directory
 */
async function placeGitCommand({ args, cwd, env, places, runPlainGit }) {
  const values = Array.isArray(args) ? args.map((arg) => String(arg)) : [];
  const invocation = parseGitInvocation(values);
  const explicit = invocation.chdirs.length > 0 || invocation.gitDir !== null || invocation.workTree !== null ||
    invocation.bare || Boolean(env.GIT_DIR || env.GIT_WORK_TREE) || ["clone", "init"].includes(invocation.operation);
  // The hot path: Git run in the source on the source, as the AI's tools run it all the time.
  if (!explicit && places.insideSource(cwd)) return { env: {}, place: { kind: "source", path: cwd, root: places.sourceRoot } };
  const cwdPlace = await places.placeOf(cwd);
  if (cwdPlace.kind === "other") return { failure: outsideFailure(cwdPlace, places.tempRoot, { cwd: true }) };
  if (!explicit && cwdPlace.kind !== "temp") return { env: {}, place: cwdPlace };
  const locations = await gitCommandLocations({ cwd, env, invocation, values });
  const classify = async (list) => Promise.all(list.map((location) => places.placeOf(location)));
  const writes = await classify(locations.writes);
  const reads = await classify(locations.reads);
  const all = [...writes, ...reads];
  const outside = all.find((place) => place.kind === "other");
  if (outside) return { failure: outsideFailure(outside, places.tempRoot) };
  const sessionPlaces = uniquePlaces(all.filter(isSessionPlace));
  if (sessionPlaces.length > 1) return { failure: severalPlacesFailure(sessionPlaces) };
  // The source's and each copy's own rules, remotes included.
  if (sessionPlaces.length === 1 && all.every(isSessionPlace)) return { env: locations.env, place: sessionPlaces[0] };
  const changedFromOutside = writes.find(isSessionPlace);
  if (changedFromOutside) return { failure: mixedFailure(changedFromOutside, places.tempRoot) };

  // Plain local Git in the temporary folder. What Git itself finds there (a
  // `.git` file or core.worktree can lead elsewhere) and the remotes on this
  // computer it reaches must stay in the session too.
  const globalArgs = values.slice(0, invocation.operationIndex);
  const lookupEnv = plainEnv(env, locations.env, { ceiling: await places.sessionFolder() });
  const found = await classify(await probeRepository({ globalArgs, invocation, lookupEnv, runPlainGit, writes }));
  const remotes = await remoteLocations({
    listRemotes: async () => {
      const result = await runPlainGit([...globalArgs, "remote", "-v"], lookupEnv);
      return result?.ok === true ? parseRemotes(commandText(result)) : new Map();
    },
    locations,
    operation: invocation.operation
  });
  const reached = await classify(remotes);
  const changed = [...found.filter(() => writes.length > 0), ...(invocation.operation === "push" ? reached : [])];
  const refused = [...found, ...reached].find((place) => place.kind === "other");
  if (refused) return { failure: outsideFailure(refused, places.tempRoot) };
  const changedSession = changed.find(isSessionPlace);
  if (changedSession) return { failure: mixedFailure(changedSession, places.tempRoot) };
  const readPlaces = uniquePlaces([...sessionPlaces, ...found, ...reached].filter(isSessionPlace));
  if (readPlaces.length > 1) return { failure: severalPlacesFailure(readPlaces) };
  return {
    env: plainEnv(env, locations.env, { ceiling: lookupEnv.GIT_CEILING_DIRECTORIES, readsSession: readPlaces.length > 0 }),
    place: { kind: "temp", path: cwd, root: places.tempRoot },
    readRoots: readPlaces.map((place) => place.root)
  };
}

function uniquePlaces(list) {
  return [...new Map(list.map((place) => [place.root, place])).values()];
}

function isSessionPlace(place) {
  return place.kind === "source" || place.kind === "copy";
}

function commandText(result = {}) {
  return Buffer.from(result.stdout || "", result.outputEncoding === "base64" ? "base64" : "utf8").toString("utf8");
}

/**
 * The environment of a plain local Git command: the repository the command
 * named, the identity its own Env gave, discovery that stops at the session's
 * folder, and, while it reads the source or a copy, no index refresh there.
 */
function plainEnv(forwarded, locationEnv, { ceiling = "", readsSession = false } = {}) {
  return {
    ...Object.fromEntries(GIT_PLAIN_IDENTITY_ENV_NAMES.filter((name) => forwarded[name]).map((name) => [name, forwarded[name]])),
    ...locationEnv,
    ...(ceiling && ceiling !== "." ? { GIT_CEILING_DIRECTORIES: ceiling } : {}),
    ...(readsSession ? { GIT_OPTIONAL_LOCKS: "0" } : {})
  };
}

/**
 * The repository Git itself finds for a temporary-folder command (its git
 * folder, common folder and work tree), or none: init and clone make theirs,
 * and a folder that is no repository has none to follow.
 */
async function probeRepository({ globalArgs, invocation, lookupEnv, runPlainGit, writes }) {
  if (invocation.operation === "clone" || !invocation.operation) return [];
  const target = invocation.operation === "init" ? writes[0]?.path : "";
  if (target && !await lstat(target).then(() => true, () => false)) return [];
  const result = await runPlainGit([...globalArgs, ...(target ? ["-C", target] : []), ...PROBE_TOPLEVEL_ARGS], lookupEnv);
  const lines = commandText(result || {}).split("\n").filter(Boolean);
  const bare = lines[2] === "true";
  if (result?.ok !== true && !(bare && lines.length >= 3)) return [];
  return [lines[0], lines[1], bare ? "" : lines[3]].filter((line) => line && path.isAbsolute(line));
}

export {
  CODEX_GIT_COMMAND_FORWARDED_ENV_NAMES,
  createSessionGitPlaces,
  forwardedGitEnv,
  physicalPath,
  placeGitCommand,
  placeGithubCommand
};

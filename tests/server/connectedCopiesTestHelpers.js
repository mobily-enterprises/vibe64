// The real-Git fixture of the connected copies tests and of the session helper's Update: a session cloned from its
// own GitHub repository, its connected copies, and the session work service over them.
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  recordSessionConnectedCopyCommits,
  serializeSessionConnectedCopies,
  sessionConnectedCopies
} from "../../packages/vibe64-core/src/server/projectRepository.js";
import { prepareConnectedCopies } from "../../packages/vibe64-terminals/src/server/sessionConnectedCopies.js";
import { createServiceSessionWork } from "../../packages/vibe64-terminals/src/server/serviceSessionWork.js";
import { createServiceSessionWorkInspection } from "../../packages/vibe64-terminals/src/server/serviceSessionWorkInspection.js";
import { createWritesWhileAssistantWorks } from "../../packages/vibe64-terminals/src/server/writesWhileAssistantWorks.js";
import { endChildInput } from "./childInputTestHelpers.js";

// Every copy's GitHub URL reaches a local bare repository through Git's own
// URL rewriting, so the engine runs exactly as it does against GitHub.
const execFileAsync = promisify(execFile);
const IDENTITY = {
  GIT_AUTHOR_EMAIL: "vibe64@example.test",
  GIT_AUTHOR_NAME: "Vibe64 Test",
  GIT_COMMITTER_EMAIL: "vibe64@example.test",
  GIT_COMMITTER_NAME: "Vibe64 Test"
};
const SESSION_ID = "s1";

async function git(cwd, args) {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY } });
  return String(result.stdout || "").trim();
}

function commandRunner(request = {}) {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args || [], {
      cwd: request.cwd,
      env: { ...process.env, ...IDENTITY, ...(request.env || {}) }
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", (error) => resolve({ code: "git_failed", error: error.message, ok: false, output: stderr, stderr, stdout }));
    child.once("close", (code) => resolve({ ...(code === 0 ? {} : { code: "git_failed" }), ok: code === 0, output: stdout, stderr, stdout }));
    endChildInput(child, request.input ?? undefined);
  });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-connected-copies-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const githubConfig = path.join(root, "github.gitconfig");
  const plainConfig = path.join(root, "plain.gitconfig");
  await writeFile(githubConfig, `[url "${path.join(root, "github")}/"]\n\tinsteadOf = https://github.com/\n`);
  await writeFile(plainConfig, "");
  const runnerWith = (config) => (requests = null) => (request = {}) => {
    requests?.push(request);
    return commandRunner({ ...request, env: { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", ...(request.env || {}) } });
  };
  const source = path.join(root, "sessions", "active", SESSION_ID, "source");
  await mkdir(source, { recursive: true });
  const session = {
    metadata: { source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source" },
    sessionId: SESSION_ID,
    sourcePath: source
  };
  const store = {
    mutateSession: (_sessionId, operation) => operation(),
    readMetadataValue: async (_sessionId, name) => session.metadata[name] || "",
    writeMetadataValue: async (_sessionId, name, value) => { session.metadata[name] = value; }
  };
  const github = runnerWith(githubConfig);
  return {
    connectedRoot: path.join(path.dirname(source), "connected"),
    copies: () => sessionConnectedCopies(session),
    executionFor: async () => ({ commandOptions: {}, runCommand: github() }),
    github,
    plain: runnerWith(plainConfig)(),
    project: { ownerUserKey: "owner", slug: "project" },
    recordCommits: (commits) => recordSessionConnectedCopyCommits(store, SESSION_ID, commits),
    root,
    session,
    store,
    writeCopies: async (copies) => { session.metadata.connected_copies = serializeSessionConnectedCopies(copies); }
  };
}

/** A GitHub repository `example/<name>` with one commit on its default branch, and a seed clone for peers. */
async function githubRepository(f, name, { branch = "main" } = {}) {
  const bare = path.join(f.root, "github", "example", `${name}.git`);
  const seed = path.join(f.root, "seeds", name);
  await git(f.root, ["init", "--bare", `--initial-branch=${branch}`, bare]);
  await git(f.root, ["init", `--initial-branch=${branch}`, seed]);
  await git(seed, ["remote", "add", "origin", bare]);
  await writeFile(path.join(seed, `${name}.txt`), "initial\n");
  await git(seed, ["add", "."]);
  await git(seed, ["commit", "-m", "initial"]);
  await git(seed, ["push", "origin", `HEAD:${branch}`]);
  return { bare, base: await git(seed, ["rev-parse", "HEAD"]), branch, name, seed };
}

/** Someone else's saved work on the repository's main (or another branch). */
async function pushPeer(repository, file, content, ref = repository.branch) {
  await writeFile(path.join(repository.seed, file), content);
  await git(repository.seed, ["add", file]);
  await git(repository.seed, ["commit", "-m", `peer ${file}`]);
  await git(repository.seed, ["push", "origin", `HEAD:${ref}`]);
  return git(repository.seed, ["rev-parse", "HEAD"]);
}

function remoteMain(repository) {
  return git(repository.bare, ["rev-parse", `refs/heads/${repository.branch}`]);
}

function prepare(f, names, { mirrorFor, requests = null } = {}) {
  return prepareConnectedCopies({
    commandOptions: { runCommand: f.github(requests) },
    connections: names.map(name => ({ fullName: `example/${name}` })),
    mirrorFor,
    ownRepository: "example/project",
    runCommand: f.plain,
    session: f.session,
    writeCopies: f.writeCopies
  });
}

function copyPath(f, name) {
  return path.join(f.connectedRoot, name);
}

async function commitInCopy(f, name, file, content) {
  await writeFile(path.join(copyPath(f, name), file), content);
  await git(copyPath(f, name), ["add", file]);
  await git(copyPath(f, name), ["commit", "-m", `session ${file}`]);
  return git(copyPath(f, name), ["rev-parse", "HEAD"]);
}

/**
 * This session's own repository `example/project`, cloned as its source, and the Save and Update
 * service over it and its copies. Every Git command of the service goes through the fixture's GitHub.
 * `sessionAccess(runtime)` gives the service a real session access (its agent-write lock) in place of
 * one that runs every write at once.
 */
async function sessionService(f, {
  invalidateWorkspaceSetup = async () => {},
  requirePullRequest = false,
  sessionAccess: accessFor = null,
  workspacePreparation = null
} = {}) {
  const own = await githubRepository(f, "project");
  await git(f.root, ["clone", own.bare, f.session.sourcePath]);
  await git(f.session.sourcePath, ["checkout", "-B", `vibe64/session/${SESSION_ID}`]);
  Object.assign(f.session.metadata, {
    base_commit: own.base,
    canonical_commit: own.base,
    repository_mode: "github",
    source_remote_url: "https://github.com/example/project.git"
  });
  const github = { cloneUrl: "https://github.com/example/project.git", fullName: "example/project" };
  const projectRecord = {
    githubMirrorOptional: true,
    githubMirrorPath: "",
    githubRepository: github,
    ownerUserKey: "owner",
    repository: { defaultBranch: "main", github, mode: "github" },
    repositoryMode: "github",
    slug: "project"
  };
  const runtime = { getSessionWithoutSource: async () => f.session, store: f.store };
  const project = {
    readCurrentProject: async () => projectRecord,
    readRepositoryWorkflow: async () => ({ requirePullRequest }),
    runProjectSourceExclusive: (operation) => operation()
  };
  const sessionAccess = accessFor ? accessFor(runtime) : {
    runMainAgentWrite: (_sessionId, _options, operation) => operation({ runtime, session: f.session }),
    sessionContext: async () => ({ runtime, session: f.session })
  };
  const codexGitCommand = { sessionWorkSaveContext: async () => ({ commandOptions: {}, runCommand: f.github() }) };
  const work = createServiceSessionWork({
    agentConversations: {},
    codexGitCommand,
    env: {},
    logger: { error() {}, info() {}, warn() {} },
    project,
    sessionAccess,
    sessionAgent: {},
    state: { lifecycle: { closing: false }, writesWhileAssistantWorks: createWritesWhileAssistantWorks() },
    workspacePreparation: workspacePreparation || { invalidateWorkspaceSetup, waitForRunningPreparation: async () => false },
    workspaceSetup: { isRunning: () => false }
  });
  return {
    destinationReview: { branch: "main", mode: "github", repository: "example/project", sessionId: SESSION_ID },
    inspection: createServiceSessionWorkInspection({ codexGitCommand, env: {}, project, sessionAccess, sessionWork: work }),
    own,
    runtime,
    work
  };
}

export {
  commitInCopy,
  copyPath,
  fixture,
  git,
  githubRepository,
  prepare,
  pushPeer,
  remoteMain,
  SESSION_ID,
  sessionService
};

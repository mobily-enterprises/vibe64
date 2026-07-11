import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";

import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  githubCredentialContext,
  normalizeGithubAccountMode,
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeRepositoryMode
} from "@local/vibe64-core/server/projectRepository";
import {
  resolveProjectGitCacheRoot
} from "@local/vibe64-core/server/projectState";

const PROJECT_TEMPLATE_SOURCE_REF = "refs/vibe64/template-source";
const PROJECT_TEMPLATE_MATERIALIZED_REF = "refs/vibe64/template-materialized";
const PROJECT_TEMPLATE_DESTINATION_REF = "refs/vibe64/template-destination";
const PROJECT_TEMPLATE_SCHEMA = "vibe64.seed";
const PROJECT_TEMPLATE_SCHEMA_VERSION = 1;
const PROJECT_TEMPLATE_SOURCE_FILE = "vibe64.seed.json";
const PROJECT_TEMPLATE_PROJECT_FILE = "vibe64.project.json";
const PROJECT_TEMPLATE_GIT_TIMEOUT_MS = 120_000;
const PROJECT_TEMPLATE_IGNORED_LOCAL_ENTRIES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini"
]);

const projectTemplateLocks = new Map();

const PROJECT_TEMPLATES = Object.freeze([
  projectTemplate({
    accent: "sky",
    capabilities: ["No sign-in", "No database"],
    description: "Visitors can open and use the app without creating an account. A natural fit for public tools, directories, content and landing experiences.",
    icon: "web",
    id: "jskit-public",
    name: "Public",
    order: 10,
    repository: "vibe64-dev/jskit-seed-public",
    tagline: "A public experience for everyone"
  }),
  projectTemplate({
    accent: "violet",
    capabilities: ["Personal accounts", "Private areas"],
    description: "People can sign up and sign in, then use their own private area. Choose this when the app needs accounts but does not need persistent application data yet.",
    icon: "account",
    id: "jskit-accounts",
    name: "Accounts",
    order: 20,
    repository: "vibe64-dev/jskit-seed-accounts",
    tagline: "A private space for every person"
  }),
  projectTemplate({
    accent: "amber",
    capabilities: ["Database accounts", "Persistent records"],
    description: "People sign in and work with records that stay safely in the database. Each person gets their own experience, without team or workspace sharing.",
    icon: "database",
    id: "jskit-database",
    name: "Database",
    order: 30,
    repository: "vibe64-dev/jskit-seed-database",
    tagline: "Personal accounts with lasting data"
  }),
  projectTemplate({
    accent: "emerald",
    capabilities: ["Team workspaces", "Shared database"],
    description: "People sign in, create or join workspaces, and collaborate on shared information. Choose this for team products and multi-organisation apps.",
    icon: "workspaces",
    id: "jskit-workspaces",
    name: "Workspaces",
    order: 40,
    repository: "vibe64-dev/jskit-seed-workspaces",
    tagline: "A shared place for teams to work"
  })
]);

function projectTemplate(value = {}) {
  const repository = normalizeText(value.repository);
  return Object.freeze({
    accent: normalizeText(value.accent),
    basedOn: value.basedOn || null,
    capabilities: Object.freeze((Array.isArray(value.capabilities) ? value.capabilities : [])
      .map(normalizeText)
      .filter(Boolean)),
    cloneUrl: normalizeText(value.cloneUrl) || `https://github.com/${repository}.git`,
    description: normalizeText(value.description),
    icon: normalizeText(value.icon),
    id: normalizeText(value.id),
    kind: normalizeText(value.kind) || "foundation",
    name: normalizeText(value.name),
    order: Number.isFinite(Number(value.order)) ? Number(value.order) : 0,
    ref: normalizeText(value.ref) || "refs/heads/main",
    repository,
    repositoryUrl: normalizeText(value.repositoryUrl) || `https://github.com/${repository}`,
    tagline: normalizeText(value.tagline)
  });
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function templateError(code, message, {
  details = null,
  statusCode = 400
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

function publicProjectTemplate(template = {}) {
  return {
    accent: template.accent,
    basedOn: template.basedOn,
    capabilities: [...template.capabilities],
    description: template.description,
    icon: template.icon,
    id: template.id,
    kind: template.kind,
    name: template.name,
    repository: template.repository,
    repositoryUrl: template.repositoryUrl,
    tagline: template.tagline
  };
}

function resolveProjectTemplate(templateId = "", templates = PROJECT_TEMPLATES) {
  const id = normalizeText(templateId);
  const template = (Array.isArray(templates) ? templates : [])
    .find((entry) => entry.id === id);
  if (!template) {
    throw templateError(
      "vibe64_project_template_invalid",
      "Choose one of the available project templates."
    );
  }
  return template;
}

function projectRepositoryMode(project = {}, sourceRoot = "") {
  return normalizeRepositoryMode(project.repositoryMode || project.repository?.mode) ||
    (sourceRoot ? PROJECT_REPOSITORY_MODE_LOCAL_SOURCE : "");
}

function projectDefaultBranch(project = {}) {
  return normalizeText(
    project.repository?.defaultBranch ||
    project.repository?.github?.defaultBranch ||
    project.githubRepository?.defaultBranch
  ) || "main";
}

function projectGithubRepository(project = {}) {
  return project.githubRepository || project.repository?.github || null;
}

function projectGithubCloneUrl(project = {}) {
  const repository = projectGithubRepository(project);
  const fullName = normalizeText(repository?.fullName);
  return normalizeText(repository?.cloneUrl) || (fullName ? `https://github.com/${fullName}.git` : "");
}

function projectGitCacheRepository(project = {}, targetRoot = "") {
  const explicitGitCacheRoot = normalizeText(project.gitCacheRoot);
  const gitCacheRoot = explicitGitCacheRoot || resolveProjectGitCacheRoot({
    projectRuntimeRoot: targetRoot
  });
  return gitCacheRoot ? path.join(gitCacheRoot, "repository.git") : "";
}

async function pathIsDirectory(value = "") {
  try {
    return (await stat(value)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

async function directoryEntries(value = "") {
  try {
    return await readdir(value, {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
}

async function activeProjectSessionExists(projectRuntimeRoot = "") {
  const activeRoot = projectRuntimeRoot
    ? path.join(projectRuntimeRoot, "sessions", "active")
    : "";
  if (!activeRoot) {
    return false;
  }
  return (await directoryEntries(activeRoot)).some((entry) => entry.isDirectory());
}

function commandOutput(result = {}) {
  return normalizeText(result.stdout || result.output);
}

function commandFailure(result = {}, fallbackMessage = "Git command failed.") {
  return templateError(
    result.code || "vibe64_project_template_git_failed",
    normalizeText(result.stderr || result.stdout || result.output || result.error) || fallbackMessage
  );
}

async function runGit(args = [], {
  actor = "daemon",
  allowedRoots = [],
  credentialHome = null,
  cwd = "",
  gitTransport = "none",
  runCommand = runVibe64Command,
  timeout = PROJECT_TEMPLATE_GIT_TIMEOUT_MS,
  userKey = ""
} = {}) {
  const result = await runCommand({
    actor,
    allowedRoots,
    args,
    command: "git",
    ...(credentialHome ? { credentialHome } : {}),
    cwd,
    envPolicy: "project",
    gitSafeDirectories: allowedRoots,
    gitTransport,
    mode: "capture",
    purpose: gitTransport === "github-https" ? "github" : "setup",
    runtimes: gitTransport === "github-https" ? ["git", "gh"] : ["git"],
    timeout,
    ...(userKey ? { userKey } : {})
  });
  if (!result.ok) {
    throw commandFailure(result);
  }
  return commandOutput(result);
}

async function gitOutputOrEmpty(args = [], options = {}) {
  try {
    return await runGit(args, options);
  } catch {
    return "";
  }
}

function githubCommandOptions(input = {}, {
  env = process.env
} = {}) {
  const accountMode = normalizeGithubAccountMode(
    env?.[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  const context = githubCredentialContext(input, {
    accountMode
  });
  if (context?.ok === false) {
    throw templateError(
      context.code || "vibe64_project_template_github_credentials_required",
      context.error || "Connect GitHub before applying this project template."
    );
  }
  const actor = accountMode === GITHUB_ACCOUNT_MODE_LOCAL ? "daemon" : "named-user";
  return {
    actor,
    credentialHome: {
      gid: context.gid,
      home: context.home,
      scope: context.scope,
      uid: context.uid,
      username: context.username
    },
    gitTransport: "github-https",
    userKey: actor === "named-user" ? context.username : ""
  };
}

function eligibility(eligible, code = "", message = "") {
  return {
    code,
    eligible,
    message
  };
}

async function localSourceEligibility({
  runCommand,
  sourceRoot
} = {}) {
  if (!sourceRoot || !await pathIsDirectory(sourceRoot)) {
    return eligibility(false, "vibe64_project_template_source_missing", "The project source directory is not available.");
  }
  const entries = await directoryEntries(sourceRoot);
  const meaningfulEntries = entries
    .map((entry) => entry.name)
    .filter((name) => name !== ".git" && !PROJECT_TEMPLATE_IGNORED_LOCAL_ENTRIES.has(name));
  if (meaningfulEntries.length > 0) {
    return eligibility(false, "vibe64_project_template_destination_not_empty", "This project already contains source files.");
  }
  if (!entries.some((entry) => entry.name === ".git")) {
    return eligibility(true);
  }
  const refs = await runGit(["for-each-ref", "--format=%(refname)"], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
  return refs
    ? eligibility(false, "vibe64_project_template_destination_not_empty", "This project already has Git history.")
    : eligibility(true);
}

async function canonicalGitEligibility({
  project,
  runCommand,
  targetRoot
} = {}) {
  const repositoryPath = projectGitCacheRepository(project, targetRoot);
  if (!repositoryPath || !await pathIsDirectory(repositoryPath)) {
    return eligibility(true);
  }
  const refs = await runGit(["--git-dir", repositoryPath, "for-each-ref", "--format=%(refname)"], {
    allowedRoots: [targetRoot, path.dirname(repositoryPath), repositoryPath],
    cwd: targetRoot,
    runCommand
  });
  return refs
    ? eligibility(false, "vibe64_project_template_destination_not_empty", "This project already has Git history.")
    : eligibility(true);
}

async function remoteGithubRefs(project = {}, input = {}, {
  env = process.env,
  runCommand = runVibe64Command,
  targetRoot = ""
} = {}) {
  const cloneUrl = projectGithubCloneUrl(project);
  if (!cloneUrl) {
    throw templateError(
      "vibe64_project_template_github_repository_missing",
      "This project is not connected to a GitHub repository."
    );
  }
  return runGit(["ls-remote", "--heads", "--tags", cloneUrl], {
    ...githubCommandOptions(input, {
      env
    }),
    allowedRoots: [targetRoot],
    cwd: targetRoot,
    runCommand
  });
}

async function projectTemplateEligibility({
  checkGithubRemote = false,
  env = process.env,
  input = {},
  project = null,
  projectRuntimeRoot = "",
  runCommand = runVibe64Command,
  sourceRoot = "",
  targetRoot = ""
} = {}) {
  if (!project || !targetRoot) {
    return eligibility(false, "vibe64_project_not_selected", "Choose a project before selecting a template.");
  }
  if (await activeProjectSessionExists(projectRuntimeRoot)) {
    return eligibility(false, "vibe64_project_template_active_sessions", "This project already has an active session.");
  }

  const mode = projectRepositoryMode(project, sourceRoot);
  if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return localSourceEligibility({
      runCommand,
      sourceRoot: sourceRoot || targetRoot
    });
  }
  if (mode !== PROJECT_REPOSITORY_MODE_MANAGED_GIT && mode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return eligibility(false, "vibe64_project_template_repository_unsupported", "This project repository cannot use ready-made templates.");
  }

  const canonicalEligibility = await canonicalGitEligibility({
    project,
    runCommand,
    targetRoot
  });
  if (!canonicalEligibility.eligible) {
    return canonicalEligibility;
  }
  if (mode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return canonicalEligibility;
  }

  const github = projectGithubRepository(project);
  if (normalizeText(github?.defaultBranch)) {
    return eligibility(false, "vibe64_project_template_destination_not_empty", "This GitHub repository already contains source.");
  }
  if (!checkGithubRemote) {
    return eligibility(true);
  }
  const refs = await remoteGithubRefs(project, input, {
    env,
    runCommand,
    targetRoot
  });
  return refs
    ? eligibility(false, "vibe64_project_template_destination_not_empty", "This GitHub repository already contains source.")
    : eligibility(true);
}

async function readProjectTemplates(options = {}) {
  const state = await projectTemplateEligibility(options);
  const templates = (Array.isArray(options.templates) ? options.templates : PROJECT_TEMPLATES)
    .slice()
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
    .map(publicProjectTemplate);
  return {
    eligibility: state,
    ok: true,
    templates
  };
}

async function createTemplateSourceRepository(template, {
  runCommand,
  temporaryRoot
} = {}) {
  const repositoryPath = path.join(temporaryRoot, "source.git");
  await runGit(["init", "--bare", repositoryPath], {
    allowedRoots: [temporaryRoot, repositoryPath],
    cwd: temporaryRoot,
    runCommand
  });
  await runGit([
    "--git-dir",
    repositoryPath,
    "fetch",
    "--depth=1",
    "--no-tags",
    template.cloneUrl,
    `${template.ref}:${PROJECT_TEMPLATE_SOURCE_REF}`
  ], {
    allowedRoots: [temporaryRoot, repositoryPath],
    cwd: temporaryRoot,
    runCommand
  });
  return repositoryPath;
}

async function readTemplateGitFile(repositoryPath = "", relativePath = "", {
  runCommand,
  temporaryRoot
} = {}) {
  return runGit([
    "--git-dir",
    repositoryPath,
    "show",
    `${PROJECT_TEMPLATE_SOURCE_REF}:${relativePath}`
  ], {
    allowedRoots: [temporaryRoot, repositoryPath],
    cwd: temporaryRoot,
    runCommand
  });
}

function parseTemplateJson(text = "", fileName = "") {
  try {
    return JSON.parse(text);
  } catch {
    throw templateError(
      "vibe64_project_template_metadata_invalid",
      `${fileName} is not valid JSON.`
    );
  }
}

async function validateTemplateSource(template, repositoryPath, options = {}) {
  const [seedText, projectText, sourceRevision] = await Promise.all([
    readTemplateGitFile(repositoryPath, PROJECT_TEMPLATE_SOURCE_FILE, options),
    readTemplateGitFile(repositoryPath, PROJECT_TEMPLATE_PROJECT_FILE, options),
    runGit(["--git-dir", repositoryPath, "rev-parse", `${PROJECT_TEMPLATE_SOURCE_REF}^{commit}`], {
      allowedRoots: [options.temporaryRoot, repositoryPath],
      cwd: options.temporaryRoot,
      runCommand: options.runCommand
    })
  ]);
  const seed = parseTemplateJson(seedText, PROJECT_TEMPLATE_SOURCE_FILE);
  const project = parseTemplateJson(projectText, PROJECT_TEMPLATE_PROJECT_FILE);
  if (
    seed.schema !== PROJECT_TEMPLATE_SCHEMA ||
    seed.schemaVersion !== PROJECT_TEMPLATE_SCHEMA_VERSION ||
    normalizeText(seed.id) !== template.id ||
    normalizeText(seed.repository) !== template.repository
  ) {
    throw templateError(
      "vibe64_project_template_metadata_mismatch",
      `${template.name} has seed metadata that does not match the trusted template registry.`
    );
  }
  if (
    project.schema !== "vibe64.project" ||
    project.schemaVersion !== 1 ||
    normalizeText(project.projectType) !== "jskit"
  ) {
    throw templateError(
      "vibe64_project_template_project_config_invalid",
      `${template.name} does not contain a valid committed JSKIT project configuration.`
    );
  }
  return {
    seed,
    sourceRevision
  };
}

async function createMaterializedCommit(template, repositoryPath, sourceRevision, options = {}) {
  const tree = await runGit([
    "--git-dir",
    repositoryPath,
    "rev-parse",
    `${PROJECT_TEMPLATE_SOURCE_REF}^{tree}`
  ], {
    allowedRoots: [options.temporaryRoot, repositoryPath],
    cwd: options.temporaryRoot,
    runCommand: options.runCommand
  });
  const trailers = [
    `Vibe64-Seed: ${template.id}`,
    `Vibe64-Seed-Repository: ${template.repository}`,
    `Vibe64-Seed-Revision: ${sourceRevision}`
  ].join("\n");
  const commit = await runGit([
    "--git-dir",
    repositoryPath,
    "commit-tree",
    tree,
    "-m",
    `Start from Vibe64 seed: ${template.name}`,
    "-m",
    trailers
  ], {
    allowedRoots: [options.temporaryRoot, repositoryPath],
    cwd: options.temporaryRoot,
    runCommand: options.runCommand
  });
  await runGit([
    "--git-dir",
    repositoryPath,
    "update-ref",
    PROJECT_TEMPLATE_MATERIALIZED_REF,
    commit
  ], {
    allowedRoots: [options.temporaryRoot, repositoryPath],
    cwd: options.temporaryRoot,
    runCommand: options.runCommand
  });
  return commit;
}

async function materializeLocalSource({
  branch,
  commit,
  runCommand,
  sourceRepositoryPath,
  sourceRoot,
  temporaryRoot
} = {}) {
  const gitEntry = path.join(sourceRoot, ".git");
  if (!await pathIsDirectory(gitEntry) && !(await directoryEntries(sourceRoot)).some((entry) => entry.name === ".git")) {
    await runGit(["init", `--initial-branch=${branch}`], {
      allowedRoots: [sourceRoot],
      cwd: sourceRoot,
      runCommand
    });
  }
  await runGit(["symbolic-ref", "HEAD", `refs/heads/${branch}`], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
  await runGit([
    "fetch",
    "--no-tags",
    sourceRepositoryPath,
    `${PROJECT_TEMPLATE_MATERIALIZED_REF}:${PROJECT_TEMPLATE_DESTINATION_REF}`
  ], {
    allowedRoots: [sourceRoot, temporaryRoot, sourceRepositoryPath],
    cwd: sourceRoot,
    runCommand
  });
  await runGit(["update-ref", `refs/heads/${branch}`, commit], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
  await runGit(["reset", "--hard", commit], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
  await runGit(["update-ref", "-d", PROJECT_TEMPLATE_DESTINATION_REF], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
}

async function ensureCanonicalRepository(repositoryPath = "", branch = "main", {
  runCommand,
  targetRoot
} = {}) {
  const repositoryRoot = path.dirname(repositoryPath);
  await mkdir(repositoryRoot, {
    recursive: true
  });
  if (!await pathIsDirectory(repositoryPath)) {
    await runGit(["init", "--bare", repositoryPath], {
      allowedRoots: [targetRoot, repositoryRoot, repositoryPath],
      cwd: repositoryRoot,
      runCommand
    });
  }
  await runGit(["--git-dir", repositoryPath, "symbolic-ref", "HEAD", `refs/heads/${branch}`], {
    allowedRoots: [targetRoot, repositoryRoot, repositoryPath],
    cwd: targetRoot,
    runCommand
  });
}

async function materializeCanonicalGit({
  branch,
  commit,
  project,
  runCommand,
  sourceRepositoryPath,
  targetRoot,
  temporaryRoot
} = {}) {
  const repositoryPath = projectGitCacheRepository(project, targetRoot);
  await ensureCanonicalRepository(repositoryPath, branch, {
    runCommand,
    targetRoot
  });
  await runGit([
    "--git-dir",
    repositoryPath,
    "fetch",
    "--no-tags",
    sourceRepositoryPath,
    `${PROJECT_TEMPLATE_MATERIALIZED_REF}:${PROJECT_TEMPLATE_DESTINATION_REF}`
  ], {
    allowedRoots: [targetRoot, path.dirname(repositoryPath), repositoryPath, temporaryRoot, sourceRepositoryPath],
    cwd: targetRoot,
    runCommand
  });
  await runGit(["--git-dir", repositoryPath, "update-ref", `refs/heads/${branch}`, commit], {
    allowedRoots: [targetRoot, path.dirname(repositoryPath), repositoryPath],
    cwd: targetRoot,
    runCommand
  });
  await runGit(["--git-dir", repositoryPath, "update-ref", "-d", PROJECT_TEMPLATE_DESTINATION_REF], {
    allowedRoots: [targetRoot, path.dirname(repositoryPath), repositoryPath],
    cwd: targetRoot,
    runCommand
  });
  return repositoryPath;
}

async function removeCanonicalBranch(repositoryPath = "", branch = "main", {
  runCommand,
  targetRoot
} = {}) {
  await gitOutputOrEmpty(["--git-dir", repositoryPath, "update-ref", "-d", `refs/heads/${branch}`], {
    allowedRoots: [targetRoot, path.dirname(repositoryPath), repositoryPath],
    cwd: targetRoot,
    runCommand
  });
}

async function pushGithubDestination({
  branch,
  commit,
  env,
  input,
  project,
  repositoryPath,
  runCommand,
  targetRoot
} = {}) {
  const cloneUrl = projectGithubCloneUrl(project);
  const githubOptions = githubCommandOptions(input, {
    env
  });
  try {
    await runGit([
      "--git-dir",
      repositoryPath,
      "push",
      cloneUrl,
      `refs/heads/${branch}:refs/heads/${branch}`
    ], {
      ...githubOptions,
      allowedRoots: [targetRoot, path.dirname(repositoryPath), repositoryPath],
      cwd: targetRoot,
      runCommand
    });
  } catch (error) {
    const remoteRef = await gitOutputOrEmpty(["ls-remote", "--heads", cloneUrl, `refs/heads/${branch}`], {
      ...githubOptions,
      allowedRoots: [targetRoot],
      cwd: targetRoot,
      runCommand
    });
    const remoteCommit = normalizeText(remoteRef.split(/\s+/u)[0]);
    if (remoteCommit !== commit) {
      throw error;
    }
  }
}

async function verifyMaterializedCommit({
  branch,
  mode,
  project,
  runCommand,
  sourceRoot,
  targetRoot
} = {}) {
  const repositoryPath = mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    ? ""
    : projectGitCacheRepository(project, targetRoot);
  const gitPrefix = repositoryPath ? ["--git-dir", repositoryPath] : [];
  const cwd = repositoryPath ? targetRoot : sourceRoot;
  const allowedRoots = repositoryPath
    ? [targetRoot, path.dirname(repositoryPath), repositoryPath]
    : [sourceRoot];
  const [count, parents] = await Promise.all([
    runGit([...gitPrefix, "rev-list", "--count", `refs/heads/${branch}`], {
      allowedRoots,
      cwd,
      runCommand
    }),
    runGit([...gitPrefix, "rev-list", "--parents", "-n", "1", `refs/heads/${branch}`], {
      allowedRoots,
      cwd,
      runCommand
    })
  ]);
  if (count !== "1" || parents.split(/\s+/u).filter(Boolean).length !== 1) {
    throw templateError(
      "vibe64_project_template_commit_invalid",
      "The project template did not produce exactly one initial commit."
    );
  }
}

async function createTemporaryRoot(projectRuntimeRoot = "", targetRoot = "") {
  const runtimeRoot = projectRuntimeRoot || path.join(targetRoot, ".vibe64-local");
  const temporaryParent = path.join(runtimeRoot, "tmp");
  await mkdir(temporaryParent, {
    recursive: true
  });
  return mkdtemp(path.join(temporaryParent, "project-template-"));
}

async function withProjectTemplateLock(key = "", operation) {
  const previous = projectTemplateLocks.get(key) || Promise.resolve();
  let release;
  const lock = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => lock);
  projectTemplateLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (projectTemplateLocks.get(key) === queued) {
      projectTemplateLocks.delete(key);
    }
  }
}

async function applyProjectTemplate({
  env = process.env,
  input = {},
  project = null,
  projectRuntimeRoot = "",
  runCommand = runVibe64Command,
  sourceRoot = "",
  targetRoot = "",
  templateId = "",
  templates = PROJECT_TEMPLATES
} = {}) {
  const template = resolveProjectTemplate(templateId, templates);
  const lockKey = path.resolve(targetRoot || sourceRoot || projectRuntimeRoot);
  return withProjectTemplateLock(lockKey, async () => {
    const currentEligibility = await projectTemplateEligibility({
      checkGithubRemote: true,
      env,
      input,
      project,
      projectRuntimeRoot,
      runCommand,
      sourceRoot,
      targetRoot
    });
    if (!currentEligibility.eligible) {
      throw templateError(
        currentEligibility.code || "vibe64_project_template_unavailable",
        currentEligibility.message || "This project can no longer use a ready-made template.",
        {
          statusCode: 409
        }
      );
    }

    const mode = projectRepositoryMode(project, sourceRoot);
    const branch = projectDefaultBranch(project);
    const temporaryRoot = await createTemporaryRoot(projectRuntimeRoot, targetRoot);
    let canonicalRepositoryPath = "";
    try {
      const sourceRepositoryPath = await createTemplateSourceRepository(template, {
        runCommand,
        temporaryRoot
      });
      const { sourceRevision } = await validateTemplateSource(template, sourceRepositoryPath, {
        runCommand,
        temporaryRoot
      });
      const commit = await createMaterializedCommit(template, sourceRepositoryPath, sourceRevision, {
        runCommand,
        temporaryRoot
      });

      if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
        await materializeLocalSource({
          branch,
          commit,
          runCommand,
          sourceRepositoryPath,
          sourceRoot: sourceRoot || targetRoot,
          temporaryRoot
        });
      } else {
        canonicalRepositoryPath = await materializeCanonicalGit({
          branch,
          commit,
          project,
          runCommand,
          sourceRepositoryPath,
          targetRoot,
          temporaryRoot
        });
        if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
          try {
            await pushGithubDestination({
              branch,
              commit,
              env,
              input,
              project,
              repositoryPath: canonicalRepositoryPath,
              runCommand,
              targetRoot
            });
          } catch (error) {
            await removeCanonicalBranch(canonicalRepositoryPath, branch, {
              runCommand,
              targetRoot
            });
            throw error;
          }
        }
      }

      await verifyMaterializedCommit({
        branch,
        mode,
        project,
        runCommand,
        sourceRoot: sourceRoot || targetRoot,
        targetRoot
      });
      return {
        materialization: {
          branch,
          commit,
          repositoryMode: mode,
          sourceRevision
        },
        ok: true,
        template: publicProjectTemplate(template)
      };
    } finally {
      await rm(temporaryRoot, {
        force: true,
        recursive: true
      });
    }
  });
}

export {
  PROJECT_TEMPLATES,
  PROJECT_TEMPLATE_PROJECT_FILE,
  PROJECT_TEMPLATE_SCHEMA,
  PROJECT_TEMPLATE_SCHEMA_VERSION,
  PROJECT_TEMPLATE_SOURCE_FILE,
  applyProjectTemplate,
  projectTemplate,
  projectTemplateEligibility,
  publicProjectTemplate,
  readProjectTemplates,
  resolveProjectTemplate
};

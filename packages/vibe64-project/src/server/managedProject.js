import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm
} from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  resolveProjectCanonicalRepositoryPath
} from "@local/vibe64-core/server/projectState";
import {
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript,
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  initializeGenesisProject
} from "@local/vibe64-genesis/server";

function initialProjectError(result = {}, fallback = "Initial project materialization failed.") {
  return vibe64Error(
    normalizeText(result.stderr || result.output || result.error) || fallback,
    normalizeText(result.code) || "vibe64_initial_project_materialization_failed"
  );
}

async function runGit(args = [], {
  allowedRoots = [],
  cwd = "",
  input,
  maxBuffer,
  outputEncoding,
  runCommand = runVibe64Command
} = {}) {
  const result = await runCommand({
    actor: "daemon",
    allowedRoots,
    args,
    command: "git",
    cwd,
    envPolicy: "project",
    gitSafeDirectories: allowedRoots,
    ...(input === undefined ? {} : { input }),
    ...(maxBuffer === undefined ? {} : { maxBuffer }),
    ...(outputEncoding === undefined ? {} : { outputEncoding }),
    mode: "capture",
    purpose: "source",
    runtimes: ["git"],
    timeout: 60_000
  });
  if (result?.ok !== true) {
    throw initialProjectError(result, "Git failed while materializing the initial project.");
  }
  return normalizeText(result.stdout || result.output);
}

async function initializeCanonicalRepository(repositoryPath, branch, {
  allowedRoots,
  repositoryRoot,
  runCommand
} = {}) {
  const result = await runCommand({
    actor: "daemon",
    allowedRoots,
    args: ["-lc", canonicalRepositoryInitializeScript({
      defaultBranch: branch,
      repositoryPath
    })],
    command: "bash",
    cwd: repositoryRoot,
    envPolicy: "project",
    gitSafeDirectories: allowedRoots,
    mode: "capture",
    purpose: "source",
    runtimes: ["git"],
    timeout: 60_000
  });
  if (result?.ok !== true) {
    throw initialProjectError(result, "Canonical repository initialization failed.");
  }
}

async function installCanonicalCommit(repositoryPath, sourceRoot, branch, {
  allowedRoots,
  repositoryRoot,
  runCommand
} = {}) {
  const result = await runCommand({
    actor: "daemon",
    allowedRoots,
    args: ["-lc", canonicalRepositoryInstallRefScript({
      repositoryPath,
      sourceRef: `refs/heads/${branch}`,
      sourceRepository: sourceRoot,
      targetRef: `refs/heads/${branch}`
    })],
    command: "bash",
    cwd: repositoryRoot,
    envPolicy: "project",
    gitSafeDirectories: allowedRoots,
    mode: "capture",
    purpose: "source",
    runtimes: ["git"],
    timeout: 60_000
  });
  if (result?.ok !== true) {
    throw initialProjectError(result, "The initial project commit could not be installed in canonical Git storage.");
  }
}

function absoluteRuntimeRoot(projectRuntimeRoot = "") {
  const input = normalizeText(projectRuntimeRoot);
  if (!input || !path.isAbsolute(input)) {
    throw vibe64Error(
      "Initial project materialization requires an absolute runtime root.",
      "vibe64_initial_project_runtime_root_invalid"
    );
  }
  return path.resolve(input);
}

async function materializeInitialProject({
  afterAuthorityVerification = null,
  beforeAuthorityMutation = null,
  defaultBranch = "main",
  initializeProject = initializeGenesisProject,
  projectName = "",
  projectRuntimeRoot = "",
  publish,
  runCommand = runVibe64Command
} = {}) {
  if (typeof publish !== "function") {
    throw new TypeError("materializeInitialProject requires publish.");
  }
  const runtimeRoot = absoluteRuntimeRoot(projectRuntimeRoot);
  const branch = normalizeText(defaultBranch) || "main";
  const temporaryRoot = path.join(runtimeRoot, "tmp");
  await mkdir(temporaryRoot, {
    recursive: true
  });
  const sourceRoot = await mkdtemp(path.join(temporaryRoot, "initial-project-"));
  const allowedRoots = [sourceRoot, runtimeRoot];
  try {
    await runGit(["init", `--initial-branch=${branch}`], {
      allowedRoots,
      cwd: sourceRoot,
      runCommand
    });
    await initializeProject({
      projectName,
      projectRoot: sourceRoot
    });
    await runGit(["add", "-A"], {
      allowedRoots,
      cwd: sourceRoot,
      runCommand
    });
    await runGit([
      "-c", "user.name=Vibe64",
      "-c", "user.email=vibe64@localhost",
      "commit", "-m", "Initialize Vibe64 project"
    ], {
      allowedRoots,
      cwd: sourceRoot,
      runCommand
    });
    const [commit, commitCount, rootCommit] = await Promise.all([
      runGit(["rev-parse", "HEAD^{commit}"], {
        allowedRoots,
        cwd: sourceRoot,
        runCommand
      }),
      runGit(["rev-list", "--count", "HEAD"], {
        allowedRoots,
        cwd: sourceRoot,
        runCommand
      }),
      runGit(["rev-list", "--parents", "-n", "1", "HEAD"], {
        allowedRoots,
        cwd: sourceRoot,
        runCommand
      })
    ]);
    if (commitCount !== "1" || rootCommit.split(/\s+/u).filter(Boolean).length !== 1) {
      throw vibe64Error(
        "The initial project did not produce exactly one root commit.",
        "vibe64_initial_project_commit_invalid"
      );
    }

    const materialization = {
      branch,
      commit
    };
    if (typeof beforeAuthorityMutation === "function") {
      await beforeAuthorityMutation(materialization);
    }
    const publication = await publish({
      ...materialization,
      sourceRoot
    });
    if (typeof afterAuthorityVerification === "function") {
      await afterAuthorityVerification(materialization);
    }
    return {
      materialization: {
        ...(publication && typeof publication === "object" && !Array.isArray(publication)
          ? publication
          : {}),
        ...materialization
      },
      ok: true
    };
  } finally {
    await rm(sourceRoot, {
      force: true,
      recursive: true
    });
  }
}

async function initializeManagedProject({
  defaultBranch = "main",
  initializeProject = initializeGenesisProject,
  projectContextRoot = "",
  projectName = "",
  projectRuntimeRoot = "",
  runCommand = runVibe64Command
} = {}) {
  const namespaceInput = normalizeText(projectContextRoot);
  const runtimeInput = normalizeText(projectRuntimeRoot);
  if (
    !namespaceInput ||
    !runtimeInput ||
    !path.isAbsolute(namespaceInput) ||
    !path.isAbsolute(runtimeInput)
  ) {
    throw vibe64Error(
      "Managed project initialization requires absolute namespace and runtime roots.",
      "vibe64_managed_project_root_invalid"
    );
  }
  const namespaceRoot = path.resolve(namespaceInput);
  const runtimeRoot = path.resolve(runtimeInput);
  if ((await readdir(namespaceRoot)).length > 0) {
    throw vibe64Error(
      "A new managed project must start from an empty hosted namespace.",
      "vibe64_managed_project_namespace_not_empty"
    );
  }

  const repositoryPath = resolveProjectCanonicalRepositoryPath({
    projectRuntimeRoot: runtimeRoot
  });
  const repositoryRoot = path.dirname(repositoryPath);
  const result = await materializeInitialProject({
    defaultBranch,
    initializeProject,
    projectName,
    projectRuntimeRoot: runtimeRoot,
    publish: async ({ branch, commit, sourceRoot }) => {
      const allowedRoots = [sourceRoot, runtimeRoot, repositoryRoot, repositoryPath];
      await mkdir(repositoryRoot, {
        recursive: true
      });
      await initializeCanonicalRepository(repositoryPath, branch, {
        allowedRoots,
        repositoryRoot,
        runCommand
      });
      await installCanonicalCommit(repositoryPath, sourceRoot, branch, {
        allowedRoots,
        repositoryRoot,
        runCommand
      });
      const canonicalCommit = await runGit([
        "--git-dir", repositoryPath,
        "rev-parse", "--verify", `refs/heads/${branch}^{commit}`
      ], {
        allowedRoots,
        cwd: repositoryRoot,
        runCommand
      });
      if (canonicalCommit !== commit) {
        throw vibe64Error(
          "The canonical repository did not retain the exact initial project commit.",
          "vibe64_managed_project_canonical_verification_failed"
        );
      }
      return {
        repositoryPath
      };
    },
    runCommand
  });
  return result.materialization;
}

// Caller holds the existing project source lock, rereads project identity, and
// has established that its initial session is absent. This does not create or
// recover a session; existing session source must retain the learner's edits.
async function verifyManagedProjectSource({
  branch = "",
  files,
  projectRuntimeRoot = "",
  runCommand = runVibe64Command
} = {}) {
  const runtimeRoot = absoluteRuntimeRoot(projectRuntimeRoot);
  const maxFileBytes = 1024 * 1024;
  const maxSourceBytes = 32 * maxFileBytes;
  if (
    projectRuntimeRoot !== runtimeRoot ||
    typeof branch !== "string" || !branch || branch !== branch.trim() ||
    !Array.isArray(files) || files.length > 512
  ) {
    throw vibe64Error(
      "Source verification requires a normalized runtime root, an exact branch and at most 512 pinned files.",
      "vibe64_managed_project_source_invalid"
    );
  }

  const expected = new Map();
  const expectedDirectories = new Set();
  let sourceBytes = 0;
  for (const file of files) {
    const filename = file?.path;
    if (
      typeof filename !== "string" || !filename ||
      filename.includes("\\") || filename.includes("\0") ||
      path.posix.isAbsolute(filename) ||
      filename.split("/").some(part => !part || part === "." || part === "..") ||
      !Buffer.isBuffer(file.bytes) || file.bytes.length > maxFileBytes ||
      expected.has(filename)
    ) {
      throw vibe64Error(
        "Pinned source files require unique relative paths and Buffer bytes of at most 1 MiB.",
        "vibe64_managed_project_source_invalid"
      );
    }
    sourceBytes += file.bytes.length;
    expected.set(filename, file.bytes);
    const parts = filename.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      expectedDirectories.add(parts.slice(0, index).join("/"));
    }
  }
  if (sourceBytes > maxSourceBytes) {
    throw vibe64Error("Pinned source exceeds 32 MiB.", "vibe64_managed_project_source_invalid");
  }

  const repositoryPath = resolveProjectCanonicalRepositoryPath({ projectRuntimeRoot: runtimeRoot });
  const repositoryRoot = path.dirname(repositoryPath);
  for (const directory of [runtimeRoot, repositoryRoot, repositoryPath]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || await realpath(directory) !== directory) {
      throw vibe64Error(
        "Source verification refuses aliased canonical repository storage.",
        "vibe64_managed_project_source_unsafe"
      );
    }
  }
  const commandOptions = {
    allowedRoots: [runtimeRoot, repositoryRoot, repositoryPath],
    cwd: repositoryRoot,
    runCommand
  };
  await runGit(["check-ref-format", `refs/heads/${branch}`], commandOptions);
  const gitArgs = ["--no-replace-objects", "--git-dir", repositoryPath];
  const bare = await runGit([...gitArgs, "rev-parse", "--is-bare-repository"], commandOptions);
  if (bare !== "true") {
    throw vibe64Error(
      "Source verification requires the canonical bare repository.",
      "vibe64_managed_project_source_unsafe"
    );
  }
  const commit = await runGit([
    ...gitArgs, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`
  ], commandOptions);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commit)) {
    throw vibe64Error("Canonical branch did not resolve to an exact commit.", "vibe64_managed_project_source_unsafe");
  }

  // Inspect the resolved immutable object, never a branch that can move between
  // inventory and byte checks. Do not exclude unexpected canonical files.
  const encodedListing = await runGit([...gitArgs, "ls-tree", "-r", "-t", "-z", "--long", commit], {
    ...commandOptions,
    maxBuffer: maxSourceBytes,
    outputEncoding: "base64"
  });
  const listingBytes = Buffer.from(encodedListing, "base64");
  const listing = listingBytes.toString("utf8");
  const records = listing ? listing.split("\0") : [];
  if (listing) records.pop();
  if (
    !listingBytes.equals(Buffer.from(listing, "utf8")) ||
    (listing && !listing.endsWith("\0")) ||
    records.length !== expected.size + expectedDirectories.size
  ) {
    throw vibe64Error(
      "Canonical source inventory differs from the pinned exercise; inspect the project before retrying.",
      "vibe64_managed_project_source_mismatch"
    );
  }
  const seen = new Set();
  for (const record of records) {
    const directory = /^040000 tree ([a-f0-9]{40}|[a-f0-9]{64})\s+-\t([\s\S]+)$/u.exec(record);
    if (directory) {
      if (!expectedDirectories.delete(directory[2])) {
        throw vibe64Error(
          "Canonical source contains a directory outside the pinned exercise.",
          "vibe64_managed_project_source_mismatch"
        );
      }
      continue;
    }
    const match = /^100644 blob ([a-f0-9]{40}|[a-f0-9]{64})\s+(\d+)\t([\s\S]+)$/u.exec(record);
    const bytes = match ? expected.get(match[3]) : undefined;
    if (!match || !bytes || seen.has(match[3]) || Number(match[2]) !== bytes.length) {
      throw vibe64Error(
        "Canonical source must contain exactly the pinned ordinary nonexecutable files.",
        "vibe64_managed_project_source_mismatch"
      );
    }
    seen.add(match[3]);
    const objectId = await runGit([...gitArgs, "hash-object", "--stdin", "--no-filters"], {
      ...commandOptions,
      input: bytes
    });
    if (objectId !== match[1]) {
      throw vibe64Error(
        `Canonical source bytes differ from the pinned exercise at ${match[3]}; inspect the project before retrying.`,
        "vibe64_managed_project_source_mismatch"
      );
    }
  }
  return { branch, commit };
}

export {
  initializeManagedProject,
  materializeInitialProject,
  verifyManagedProjectSource
};

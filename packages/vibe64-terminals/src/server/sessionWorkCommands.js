// Runs session work commands: Git in the session's repository and save operations scoped to its project.

import crypto from "node:crypto";
import path from "node:path";
import { PROJECT_REPOSITORY_MODE_LOCAL_SOURCE } from "@local/vibe64-core/server/projectRepository";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const SAVE_TIMEOUT_MS = 120_000;
const SESSION_WORK_COMMAND_SCOPE = Symbol("vibe64-session-work-command-scope");

function saveError(message, code = "vibe64_session_save_failed", details = {}) {
  const error = new Error(message || "Vibe64 could not save this session.");
  error.code = code;
  error.details = details && typeof details === "object" && !Array.isArray(details)
    ? { ...details }
    : {};
  Object.assign(error, details);
  return error;
}

function commandProject(context = {}, project = {}) {
  return {
    ownerUserKey: normalizeText(project.ownerUserKey || project.githubRepository?.owner),
    projectRoot: context.worktreePath,
    repositoryMode: context.mode,
    sessionId: context.sessionId
  };
}

function scopedSessionWorkCommand(runCommand, context = {}, project = {}, options = {}) {
  const {
    label = "Session repository work",
    operationId = crypto.randomUUID()
  } = options;
  if (runCommand?.[SESSION_WORK_COMMAND_SCOPE]) {
    return runCommand;
  }
  const projectSlug = normalizeText(project.slug || project.projectSlug);
  let commandTail = Promise.resolve();
  const scoped = (request = {}) => {
    const command = commandTail.then(() => runCommand({
      ...request,
      execution: {
        ...(request.execution || {}),
        kind: "job",
        label,
        lifecycle: "finite",
        operationId: normalizeText(operationId),
        ownerId: context.sessionId,
        projectSlug,
        sessionId: context.sessionId
      },
      project: {
        ...(request.project || {}),
        ...(projectSlug ? { slug: projectSlug } : {})
      },
      session: {
        ...(request.session || {}),
        sessionId: context.sessionId
      }
    }));
    commandTail = command.then(() => undefined, () => undefined);
    return command;
  };
  Object.defineProperty(scoped, SESSION_WORK_COMMAND_SCOPE, { value: true });
  return scoped;
}

async function saveCommand(runCommand, context, command, args, options = {}) {
  const {
    additionalAllowedRoots = [],
    commandOptions = {},
    cwd = context.worktreePath,
    env = {},
    input,
    project = {}
  } = options;
  const allowedRoots = [
    context.worktreePath,
    path.dirname(context.worktreePath),
    ...(context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      ? [context.standaloneSourceRoot, path.dirname(context.standaloneSourceRoot)]
      : []),
    ...(path.isAbsolute(context.remoteUrl) ? [context.remoteUrl, path.dirname(context.remoteUrl)] : []),
    ...additionalAllowedRoots.flatMap((root) => {
      const normalized = normalizeText(root);
      return normalized ? [normalized, path.dirname(normalized)] : [];
    })
  ];
  return runCommand({
    actor: "daemon",
    allowedRoots,
    args,
    command,
    cwd,
    env,
    envPolicy: "session",
    gitSafeDirectories: allowedRoots,
    input,
    mode: "capture",
    project: commandProject(context, project),
    purpose: commandOptions.gitTransport?.startsWith("github") ? "github" : "source",
    runtimes: commandOptions.gitTransport === "github-https" ? ["git", "gh"] : ["git"],
    timeout: SAVE_TIMEOUT_MS,
    ...commandOptions
  });
}

async function git(runCommand, context, args, {
  required = true,
  ...options
} = {}) {
  const result = await saveCommand(runCommand, context, "git", args, options);
  if (required && result?.ok !== true) {
    throw saveError(
      normalizeText(result?.stderr || result?.stdout || result?.output || result?.error) || "Git Save command failed.",
      normalizeText(result?.code) || "vibe64_session_save_git_failed",
      { gitArgs: args }
    );
  }
  return result;
}

function output(result = {}) {
  return normalizeText(result.stdout || result.output);
}

async function gitOutput(runCommand, context, args, options = {}) {
  return output(await git(runCommand, context, args, options));
}

async function optionalGitOutput(runCommand, context, args, options = {}) {
  const result = await git(runCommand, context, args, {
    ...options,
    required: false
  });
  return result?.ok === true ? output(result) : "";
}

export {
  commandProject,
  git,
  gitOutput,
  optionalGitOutput,
  output,
  SAVE_TIMEOUT_MS,
  saveCommand,
  saveError,
  scopedSessionWorkCommand
};

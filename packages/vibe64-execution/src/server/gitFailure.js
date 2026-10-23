import { accessSync, constants } from "node:fs";
import path from "node:path";
import process from "node:process";

import { DEFAULT_SYSTEM_PATH } from "./runtime/resolveRuntimePath.js";

// Plain words for the Git failures a person can fix on their own computer.
// Anything else keeps git's own message.

// Git runs with the system folders after the person's PATH, so the package
// manager is looked up the same way.
function commandOnPath(command, env = process.env, systemPath = DEFAULT_SYSTEM_PATH) {
  return `${env.PATH || ""}:${systemPath}`.split(":").filter(Boolean).some((directory) => {
    try {
      accessSync(path.join(directory, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function gitInstallCommand({ env = process.env, platform = process.platform, systemPath } = {}) {
  if (platform === "darwin") return "xcode-select --install";
  return commandOnPath("apt-get", env, systemPath) ? "sudo apt install git" : "";
}

function failureText(result = {}) {
  return [result.error, result.stderr, result.output].filter(Boolean).join("\n");
}

function describeGitFailure(result = {}, options = {}) {
  const text = failureText(result);
  if (/spawn(?:Sync)? git ENOENT|(?:^|\s)git: (?:command )?not found/mu.test(text)) {
    const installCommand = gitInstallCommand(options);
    return {
      code: "vibe64_git_missing",
      installCommand,
      message: installCommand
        ? `Git isn't installed on this computer. Install it with: ${installCommand}`
        : "Git isn't installed on this computer. Install Git, then try again."
    };
  }
  if (/unknown option [`']initial-branch/u.test(text)) {
    return {
      code: "vibe64_git_too_old",
      installCommand: gitInstallCommand(options),
      message: "This Git is too old for Vibe64. Update Git to version 2.28 or newer, then try again."
    };
  }
  if (/gpg failed to sign|failed to sign the data|signing failed|couldn't (?:load|find) (?:public )?key|incorrect passphrase/iu.test(text)) {
    return {
      code: "vibe64_git_signing_failed",
      installCommand: "",
      message: "Your Git is set to sign every commit, and signing didn't work here. Vibe64 can't type a key passphrase for you. " +
        "Make one signed commit in a terminal to check your key works and is unlocked, then try again."
    };
  }
  return null;
}

// The same failure as an error a route can return; the install command travels
// in details so a screen can offer it with a copy button.
function gitFailureError(result = {}, options = {}) {
  const failure = describeGitFailure(result, options);
  if (!failure) return null;
  return Object.assign(new Error(failure.message), {
    code: failure.code,
    ...(failure.installCommand ? { details: { installCommand: failure.installCommand } } : {})
  });
}

export {
  describeGitFailure,
  gitFailureError,
  gitInstallCommand
};

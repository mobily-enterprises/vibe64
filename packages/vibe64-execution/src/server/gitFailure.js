import { localToolInstall, thisComputerToolFamily } from "./runtime/localTools.js";

// Plain words for the Git failures a person can fix on their own computer.
// Anything else keeps git's own message.

/**
 * The install line is the same one Health shows for Git.
 * @param {Parameters<typeof thisComputerToolFamily>[0]} machine
 */
function gitInstallCommand({ env, platform, systemPath }) {
  return localToolInstall("git", { family: thisComputerToolFamily({ env, platform, systemPath }) })?.command || "";
}

function failureText(result = {}) {
  return [result.error, result.stderr, result.output].filter(Boolean).join("\n");
}

/**
 * @param {object} result a git command's result
 * @param {Parameters<typeof thisComputerToolFamily>[0]} machine the computer git ran on
 */
function describeGitFailure(result, machine) {
  const text = failureText(result);
  if (/spawn(?:Sync)? git ENOENT|(?:^|\s)git: (?:command )?not found/mu.test(text)) {
    const installCommand = gitInstallCommand(machine);
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
      installCommand: gitInstallCommand(machine),
      message: "This Git is too old for Vibe64. Update Git to version 2.28 or newer, then try again."
    };
  }
  if (/gpg failed to sign|failed to sign the data|signing failed|couldn't (?:load|find) (?:public )?key|incorrect passphrase/iu.test(
    text
  )) {
    return {
      code: "vibe64_git_signing_failed",
      installCommand: "",
      message: "Your Git is set to sign every commit, and signing didn't work here. Vibe64 can't type a key passphrase for you. " +
        "Make one signed commit in a terminal to check your key works and is unlocked, then try again."
    };
  }
  return null;
}

/**
 * The same failure as an error a route can return; the install command travels
 * in details so a screen can offer it with a copy button. Git ran on this
 * computer with the server's own environment, so its install line reads the same.
 * @param {object} result a git command's result
 */
function gitFailureError(result) {
  const failure = describeGitFailure(result, { env: process.env });
  if (!failure) return null;
  return Object.assign(new Error(failure.message), {
    code: failure.code,
    ...(failure.installCommand ? { details: { installCommand: failure.installCommand } } : {})
  });
}

const __testables = Object.freeze({ describeGitFailure });

export {
  gitFailureError,
  __testables
};

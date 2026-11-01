import { createLaunchPreviewProxyRegistry } from "./launchPreviewProxy.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

/**
 * The state one controller's concerns share: its Preview proxies, the launch
 * readiness and result writes still running, and the browser test run that
 * owns each session's Preview.
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env
 */
function createOutputTargetTerminalState({ env }) {
  const launchPreviewProxies = createLaunchPreviewProxyRegistry({
    env
  });
  const launchReadyWrites = new Map();
  const previewTestRuns = new Map();
  const outputResultWrites = new Map();

  return Object.freeze({
    launchPreviewProxies,
    launchReadyWrites,
    previewTestRuns,
    outputResultWrites
  });
}

export {
  createOutputTargetTerminalState
};

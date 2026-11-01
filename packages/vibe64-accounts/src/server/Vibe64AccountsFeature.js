import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createAccountsActions } from "./accountsActions.js";
import { ACCOUNTS_RUNTIME_TOKEN } from "./accountsRuntime.js";
import { setupAccounts } from "./accountsSetup.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {import("./types.js").AccountsService} AccountsService */
/** @typedef {import("@jskit-ai/kernel/server/types").FeatureSetupContext} FeatureSetupContext */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

// Each runtime's team AI readiness registration, released at its shutdown. A feature's outputs hold only its
// declared capabilities, so the release is kept beside the accounts service it belongs to.
const slotReleases = new WeakMap();

const Vibe64AccountsFeature = defineFeature({
  id: "vibe64.accounts",
  domain: "vibe64-accounts",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    fastify: "runtime.fastify",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    terminals: "vibe64.terminals"
  },
  optional: {
    accountRuntime: ACCOUNTS_RUNTIME_TOKEN
  },
  provides: {
    accounts: "vibe64.accounts",
    connections: "vibe64.connections"
  },
  /**
   * @param {object} capabilities
   * @param {AccountsRuntime} [capabilities.accountRuntime]
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeFastify} capabilities.fastify
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {TerminalsService} capabilities.terminals
   * @param {FeatureSetupContext} context
   */
  setup({
    accountRuntime,
    env,
    events,
    fastify,
    http,
    logger,
    project,
    terminals
  }, { actionCatalogue }) {
    const { outputs, releaseTeamAiReadiness } = setupAccounts({
      accountRuntime,
      actionCatalogue,
      env,
      events,
      fastify,
      http,
      logger,
      project,
      terminals
    });
    slotReleases.set(outputs.accounts, releaseTeamAiReadiness);
    return outputs;
  },
  /**
   * @param {object} capabilities
   * @param {AccountsService} capabilities.accounts
   */
  actions({ accounts }) {
    return createAccountsActions({ accounts });
  },
  /**
   * @param {object} _capabilities
   * @param {{ outputs: { accounts: AccountsService } }} context
   */
  shutdown(_capabilities, { outputs }) {
    slotReleases.get(outputs.accounts)();
  }
});

export {
  Vibe64AccountsFeature
};

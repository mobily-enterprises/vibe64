import { PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";

import { publishingTool } from "./assistantContracts.js";
import {
  publishingAccountAddInput,
  publishingAccountInput,
  publishingConfirmInput,
  publishingHistoryInput,
  publishingLicenceAcceptInput,
  publishingPassphraseInput,
  publishingPlanHashInput,
  publishingPlanInput,
  publishingPrepareInput,
  publishingRecoveryRestoreInput,
  publishingReleaseInput,
  publishingShareInput,
  publishingStateInput,
  publishingTargetAddInput,
  publishingTargetInput,
  publishingTargetUpdateInput
} from "./inputSchemas.js";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

/** @typedef {import("./types.js").PublishingService} PublishingService */

const PUBLISHING_ACTIONS = Object.freeze({
  STATE_READ: "vibe64.publication.state.read",
  RELEASE_SUGGEST: "vibe64.publication.release.suggest",
  RELEASE_PREPARE: "vibe64.publication.release.prepare",
  TARGET_ADD: "vibe64.publication.target.add",
  TARGET_UPDATE: "vibe64.publication.target.update",
  TARGET_REMOVE: "vibe64.publication.target.remove",
  PLAN_READ: "vibe64.publication.plan.read",
  CHECKS_RUN: "vibe64.publication.checks.run",
  BASELINE_PUSH: "vibe64.publication.baseline.push",
  DRYRUN_RUN: "vibe64.publication.dryrun.run",
  PUBLISH_RUN: "vibe64.publication.publish.run",
  CONFIRMATION_DISMISS: "vibe64.publication.confirmation.dismiss",
  CONFIRMATION_OPEN: "vibe64.publication.confirmation.open",
  RELEASE_CONFIRM: "vibe64.publication.release.confirm",
  HISTORY_LIST: "vibe64.publication.history.list",
  RELEASE_READ: "vibe64.publication.release.read",
  LOGS_READ: "vibe64.publication.logs.read",
  KEYS_CREATE: "vibe64.publication.keys.create",
  KEYS_UNLOCK: "vibe64.publication.keys.unlock",
  KEYS_LOCK: "vibe64.publication.keys.lock",
  ACCOUNT_ADD: "vibe64.publication.account.add",
  ACCOUNT_REMOVE: "vibe64.publication.account.remove",
  RECOVERY_KIT_CREATE: "vibe64.publication.recovery-kit.create",
  RECOVERY_KIT_RESTORE: "vibe64.publication.recovery-kit.restore",
  INSTALL_KEY_CREATE: "vibe64.publication.install-key.create",
  LICENCE_READ: "vibe64.publication.toolchain.licence.read",
  LICENCE_ACCEPT: "vibe64.publication.toolchain.licence.accept",
  ANDROID_INSTALL: "vibe64.publication.toolchain.android.install",
  PYTHON_INSTALL: "vibe64.publication.toolchain.python.install",
  SHARE_START: "vibe64.publication.share.start",
  SHARE_STOP: "vibe64.publication.share.stop"
});

// Person-only operations: the person's own page requests ("api"), never an
// assistant, automation or internal caller. Secrets and irreversible steps
// live here.
const PERSON_ONLY = Object.freeze(["api"]);

/**
 * @param {object} dependencies
 * @param {PublishingService} dependencies.publishing
 */
function createPublishingActions({ publishing }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: PUBLISHING_ACTIONS.STATE_READ,
      input: publishingStateInput,
      extensions: { assistant: publishingTool("state.read"), vibe64: PROJECT_OPERATION },
      execute: () => publishing.readState()
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: PUBLISHING_ACTIONS.RELEASE_SUGGEST,
      input: publishingStateInput,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: () => publishing.suggestRelease()
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.RELEASE_PREPARE,
      input: publishingPrepareInput,
      extensions: { assistant: publishingTool("release.prepare"), vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.prepareRelease(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.TARGET_ADD,
      input: publishingTargetAddInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.addTarget(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.TARGET_UPDATE,
      input: publishingTargetUpdateInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.updateTarget(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.TARGET_REMOVE,
      input: publishingTargetInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.removeTarget(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: PUBLISHING_ACTIONS.PLAN_READ,
      input: publishingPlanInput,
      extensions: { assistant: publishingTool("plan.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.plan(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.CHECKS_RUN,
      input: publishingStateInput,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: () => publishing.runChecks()
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.BASELINE_PUSH,
      input: publishingStateInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: () => publishing.pushSavedWork()
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.DRYRUN_RUN,
      input: publishingPlanHashInput,
      extensions: { assistant: publishingTool("dryrun.run"), vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.dryRun(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.PUBLISH_RUN,
      input: publishingPlanHashInput,
      extensions: { assistant: publishingTool("publish.run"), vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.requestPublish(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.CONFIRMATION_DISMISS,
      input: publishingStateInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: () => publishing.dismissRequest()
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.CONFIRMATION_OPEN,
      input: publishingPlanHashInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input, context) => publishing.openConfirmation(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.RELEASE_CONFIRM,
      input: publishingConfirmInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input, context) => publishing.confirmRelease(input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: PUBLISHING_ACTIONS.HISTORY_LIST,
      input: publishingHistoryInput,
      extensions: { assistant: publishingTool("history.list"), vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.listHistory(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: PUBLISHING_ACTIONS.RELEASE_READ,
      input: publishingReleaseInput,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.readRelease(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: PUBLISHING_ACTIONS.LOGS_READ,
      input: publishingReleaseInput,
      extensions: { assistant: publishingTool("logs.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.readLogs(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.KEYS_CREATE,
      input: publishingPassphraseInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.createKeys(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.KEYS_UNLOCK,
      input: publishingPassphraseInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.unlockKeys(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.KEYS_LOCK,
      input: publishingStateInput,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: () => publishing.lockKeys()
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.ACCOUNT_ADD,
      input: publishingAccountAddInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.addAccount(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.ACCOUNT_REMOVE,
      input: publishingAccountInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.removeAccount(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.RECOVERY_KIT_CREATE,
      input: publishingPassphraseInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.recoveryKit(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.RECOVERY_KIT_RESTORE,
      input: publishingRecoveryRestoreInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.restoreRecoveryKit(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.INSTALL_KEY_CREATE,
      input: publishingTargetInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.createInstallKey(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: PUBLISHING_ACTIONS.LICENCE_READ,
      input: publishingStateInput,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: () => publishing.toolchainLicence()
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.LICENCE_ACCEPT,
      input: publishingLicenceAcceptInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.acceptToolchainLicence(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.ANDROID_INSTALL,
      input: publishingStateInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: () => publishing.installAndroidToolchain()
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.PYTHON_INSTALL,
      input: publishingStateInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: () => publishing.installPythonTools()
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.SHARE_START,
      input: publishingShareInput,
      channels: PERSON_ONLY,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: (input) => publishing.shareInstall(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PUBLISHING_ACTIONS.SHARE_STOP,
      input: publishingStateInput,
      extensions: { vibe64: PROJECT_OPERATION },
      execute: () => publishing.stopShare()
    })
  ]);
}

export { PUBLISHING_ACTIONS, createPublishingActions };

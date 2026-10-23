import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

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

const ACTIONS = Object.freeze({
  STATE_READ: "vibe64.publication.state.read",
  RELEASE_SUGGEST: "vibe64.publication.release.suggest",
  RELEASE_PREPARE: "vibe64.publication.release.prepare",
  TARGET_ADD: "vibe64.publication.target.add",
  TARGET_UPDATE: "vibe64.publication.target.update",
  TARGET_REMOVE: "vibe64.publication.target.remove",
  PLAN_READ: "vibe64.publication.plan.read",
  CHECKS_RUN: "vibe64.publication.checks.run",
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

function action({ id, input, execute, kind = "command", assistant = null, channels = null }) {
  return withVibe64ActionContext({
    audit: { actionName: id },
    events: [],
    execute,
    extensions: assistant ? { assistant } : {},
    id,
    idempotency: kind === "query" ? "none" : "optional",
    input,
    kind,
    observability: {},
    output: null,
    version: 1,
    ...(channels ? { channels } : {})
  });
}

function createPublishingActions({ publishing } = {}) {
  if (!publishing) throw new TypeError("createPublishingActions requires the publishing service.");
  return Object.freeze([
    action({ id: ACTIONS.STATE_READ, input: publishingStateInput, kind: "query", execute: () => publishing.readState(), assistant: publishingTool("state.read") }),
    action({ id: ACTIONS.RELEASE_SUGGEST, input: publishingStateInput, kind: "query", execute: () => publishing.suggestRelease() }),
    action({ id: ACTIONS.RELEASE_PREPARE, input: publishingPrepareInput, execute: (input) => publishing.prepareRelease(input), assistant: publishingTool("release.prepare") }),
    action({ id: ACTIONS.TARGET_ADD, input: publishingTargetAddInput, execute: (input) => publishing.addTarget(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.TARGET_UPDATE, input: publishingTargetUpdateInput, execute: (input) => publishing.updateTarget(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.TARGET_REMOVE, input: publishingTargetInput, execute: (input) => publishing.removeTarget(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.PLAN_READ, input: publishingPlanInput, kind: "query", execute: (input) => publishing.plan(input), assistant: publishingTool("plan.read") }),
    action({ id: ACTIONS.CHECKS_RUN, input: publishingStateInput, execute: () => publishing.runChecks() }),
    action({ id: ACTIONS.DRYRUN_RUN, input: publishingPlanHashInput, execute: (input) => publishing.dryRun(input), assistant: publishingTool("dryrun.run") }),
    action({ id: ACTIONS.PUBLISH_RUN, input: publishingPlanHashInput, execute: (input) => publishing.requestPublish(input), assistant: publishingTool("publish.run") }),
    action({ id: ACTIONS.CONFIRMATION_DISMISS, input: publishingStateInput, execute: () => publishing.dismissRequest(), channels: PERSON_ONLY }),
    action({ id: ACTIONS.CONFIRMATION_OPEN, input: publishingPlanHashInput, execute: (input, context) => publishing.openConfirmation(input, context), channels: PERSON_ONLY }),
    action({ id: ACTIONS.RELEASE_CONFIRM, input: publishingConfirmInput, execute: (input, context) => publishing.confirmRelease(input, context), channels: PERSON_ONLY }),
    action({ id: ACTIONS.HISTORY_LIST, input: publishingHistoryInput, kind: "query", execute: (input) => publishing.listHistory(input), assistant: publishingTool("history.list") }),
    action({ id: ACTIONS.RELEASE_READ, input: publishingReleaseInput, kind: "query", execute: (input) => publishing.readRelease(input) }),
    action({ id: ACTIONS.LOGS_READ, input: publishingReleaseInput, kind: "query", execute: (input) => publishing.readLogs(input), assistant: publishingTool("logs.read") }),
    action({ id: ACTIONS.KEYS_CREATE, input: publishingPassphraseInput, execute: (input) => publishing.createKeys(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.KEYS_UNLOCK, input: publishingPassphraseInput, execute: (input) => publishing.unlockKeys(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.KEYS_LOCK, input: publishingStateInput, execute: () => publishing.lockKeys() }),
    action({ id: ACTIONS.ACCOUNT_ADD, input: publishingAccountAddInput, execute: (input) => publishing.addAccount(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.ACCOUNT_REMOVE, input: publishingAccountInput, execute: (input) => publishing.removeAccount(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.RECOVERY_KIT_CREATE, input: publishingPassphraseInput, execute: (input) => publishing.recoveryKit(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.RECOVERY_KIT_RESTORE, input: publishingRecoveryRestoreInput, execute: (input) => publishing.restoreRecoveryKit(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.INSTALL_KEY_CREATE, input: publishingTargetInput, execute: (input) => publishing.createInstallKey(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.LICENCE_READ, input: publishingStateInput, kind: "query", execute: () => publishing.toolchainLicence() }),
    action({ id: ACTIONS.LICENCE_ACCEPT, input: publishingLicenceAcceptInput, execute: (input) => publishing.acceptToolchainLicence(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.ANDROID_INSTALL, input: publishingStateInput, execute: () => publishing.installAndroidToolchain(), channels: PERSON_ONLY }),
    action({ id: ACTIONS.PYTHON_INSTALL, input: publishingStateInput, execute: () => publishing.installPythonTools(), channels: PERSON_ONLY }),
    action({ id: ACTIONS.SHARE_START, input: publishingShareInput, execute: (input) => publishing.shareInstall(input), channels: PERSON_ONLY }),
    action({ id: ACTIONS.SHARE_STOP, input: publishingStateInput, execute: () => publishing.stopShare() })
  ]);
}

export { ACTIONS as PUBLISHING_ACTIONS, PERSON_ONLY, createPublishingActions };

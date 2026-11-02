// Codex app-server operations that tests drive directly, composed from the
// runtime host, thread preparations and helper isolation the runtime exports,
// the same way the session conversation hosts compose them.
import {
  ensureCodexAppServerThread,
  resumeExactCodexAppServerThread,
  sendCodexAppServerPrompt,
  startFreshCodexAppServerThread
} from "@jskit-ai/assistant-core/server/codex-provider";
import { sendPreparedCodexAppServerHelperTurn } from "@jskit-ai/assistant-core/server/codex-turn";
import {
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexAppServerRuntimeHost
} from "@local/vibe64-runtime/server/codexAppServerAgent";
import {
  codexAppServerHelperIsolation,
  codexAppServerHelperThreadResumePreparation,
  codexAppServerHelperThreadStartPreparation,
  codexAppServerRenewalResumePreparation,
  codexAppServerRenewalSeedPreparation,
  codexAppServerThreadPreparationForSession,
  codexAppServerTurnSettings,
  prepareCodexAppServerHelperTurn
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";

/**
 * A test's runtime runs in this process's env unless it names its own, as the server's runtimes run in the server's;
 * the test guard names the attachment root there.
 */
function inTestProcessEnv(options) {
  return { env: process.env, ...options };
}

// The agent runtime root a test's runtime sits below: its env's, as the server's runtimes sit below the server's.
function testRuntimeRoot(options) {
  return codexAppServerRuntimeBaseDir(inTestProcessEnv(options));
}

async function ensureCodexAppServerRuntime(options = {}) {
  const { runtime, parameters } = codexAppServerRuntimeHost(inTestProcessEnv(options));
  return runtime.ensure({ ...parameters, runtimeDir: options.runtimeDir || codexAppServerRuntimeDir({ runtimeRoot: testRuntimeRoot(options), ...options }) });
}

async function startCodexAppServerProcess(options = {}) {
  const { runtime, parameters } = codexAppServerRuntimeHost(inTestProcessEnv(options));
  return runtime.start({
    ...parameters,
    runtimeDir: options.runtimeDir === undefined ? codexAppServerRuntimeDir({
      executionRoot: options.executionRoot,
      runtimeRoot: testRuntimeRoot(options),
      runtimeInstanceId: options.runtimeInstanceId,
      workdir: options.workdir
    }) : options.runtimeDir
  });
}

async function stopCodexAppServerRuntime(options = {}) {
  const { runtime, parameters } = codexAppServerRuntimeHost(inTestProcessEnv(options));
  return runtime.stop(parameters);
}

async function codexAppServerMetadataIsLive(metadata = {}, options = {}) {
  const { runtime, parameters } = codexAppServerRuntimeHost(inTestProcessEnv(options));
  return runtime.isLive(metadata, parameters);
}

async function currentCodexAccountIdentitySignature(providerOptions = {}, options = {}) {
  return codexAppServerRuntimeHost(inTestProcessEnv(providerOptions)).credentials.identity({}, options);
}

async function ensureCodexAppServerThreadForSession(options = {}) {
  return ensureCodexAppServerThread(codexAppServerThreadPreparationForSession(options));
}

async function resumeExactCodexAppServerThreadForSession(options = {}) {
  return resumeExactCodexAppServerThread(codexAppServerRenewalResumePreparation(options));
}

async function startFreshCodexAppServerThreadForSession(options = {}) {
  return startFreshCodexAppServerThread(codexAppServerRenewalSeedPreparation(options));
}

async function sendCodexAppServerPromptForSession({
  agentSettings = {},
  attachments = [],
  clientUserMessageId = "",
  outputSchema = null,
  provider,
  prompt = "",
  threadId = "",
  readOnly = false,
  workdir = ""
} = {}) {
  return sendCodexAppServerPrompt({
    attachments,
    clientUserMessageId,
    outputSchema,
    provider,
    prompt,
    threadId,
    readOnly
  }, {
    get turnSettings() {
      return codexAppServerTurnSettings({ agentSettings, cwd: workdir });
    }
  });
}

async function prepareCodexAppServerHelperThreadStartSettings({
  systemPrompt = "",
  ephemeral = false,
  executionProfile = null,
  provider = null
} = {}) {
  const preparation = codexAppServerHelperThreadStartPreparation({ systemPrompt, ephemeral, executionProfile });
  const enforcement = await codexAppServerHelperIsolation.inspect(provider, preparation.inspection);
  return preparation.prepared(enforcement);
}

async function startCodexAppServerHelperThread(options = {}) {
  let executionProfile;
  const result = await codexAppServerHelperIsolation.start(options.provider, async () => {
    const prepared = await prepareCodexAppServerHelperThreadStartSettings(options);
    executionProfile = prepared.executionProfile;
    return prepared;
  });
  return Object.freeze({
    enforcement: result.enforcement,
    executionProfile,
    thread: result.thread,
    threadId: result.threadId
  });
}

async function prepareCodexAppServerHelperThreadResumeSettings({
  systemPrompt = "",
  executionProfile = null,
  provider = null
} = {}) {
  const preparation = codexAppServerHelperThreadResumePreparation({ systemPrompt, executionProfile });
  const enforcement = await codexAppServerHelperIsolation.inspect(provider, preparation.inspection);
  return preparation.prepared(enforcement);
}

async function resumeCodexAppServerHelperThread({
  systemPrompt = "",
  executionProfile = null,
  provider = null,
  threadId = ""
} = {}) {
  let profile;
  const result = await codexAppServerHelperIsolation.resume(provider, threadId, async () => {
    const prepared = await prepareCodexAppServerHelperThreadResumeSettings({ systemPrompt, executionProfile, provider });
    profile = prepared.executionProfile;
    return prepared;
  });
  return Object.freeze({
    enforcement: result.enforcement,
    executionProfile: profile,
    thread: result.thread,
    threadId: result.threadId
  });
}

async function sendCodexAppServerHelperTurn({
  executionProfile = null,
  outputSchema = null,
  prompt = "",
  provider = null,
  threadId = ""
} = {}) {
  const prepared = prepareCodexAppServerHelperTurn({ executionProfile, outputSchema, prompt, provider, threadId });
  return sendPreparedCodexAppServerHelperTurn(provider, prepared, codexAppServerHelperIsolation);
}

export {
  codexAppServerMetadataIsLive,
  currentCodexAccountIdentitySignature,
  ensureCodexAppServerRuntime,
  ensureCodexAppServerThreadForSession,
  prepareCodexAppServerHelperThreadStartSettings,
  resumeCodexAppServerHelperThread,
  resumeExactCodexAppServerThreadForSession,
  sendCodexAppServerHelperTurn,
  sendCodexAppServerPromptForSession,
  startCodexAppServerHelperThread,
  startCodexAppServerProcess,
  startFreshCodexAppServerThreadForSession,
  stopCodexAppServerRuntime
};

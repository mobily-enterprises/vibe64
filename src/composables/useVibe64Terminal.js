import { computed, nextTick, ref, unref, watch } from "vue";
import { isDynamicImportError } from "@jskit-ai/kernel/client/asyncModuleRecovery";
import {
  useShellAsyncModuleRecoveryRuntime
} from "@jskit-ai/shell-web/client/asyncModuleRecovery";
import {
  STUDIO_TERMINAL_SCROLLBACK_ROWS,
  reportableTerminalSize,
  terminalResizeErrorMessage
} from "@/lib/studioTerminalSize.js";
import { stripTerminalControlSequences } from "@/lib/codexOutput.js";
import { validateTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import { createTerminalMatcherEngine } from "@/lib/vibe64TerminalMatchers.js";
import { createTerminalPolicyEngine } from "@/lib/vibe64TerminalPolicies.js";
import { loadXtermModules } from "@/lib/xtermModuleLoader.js";

function resolveCallback(callback, fallback) {
  return typeof callback === "function" ? callback : fallback;
}

function useVibe64Terminal({
  driver,
  fitOnResize = null,
  initiallyExpanded = true,
  initiallyVisible = true,
  liveResize = true,
  matchers = [],
  onEvent = null,
  onMatch = null,
  onOutput = null,
  onSessionUpdate = null,
  onStatusUpdate = null,
  onUserData = null,
  policies = [],
  presentation = "inline",
  readOnly = false,
  resizeReportDelayMs = 0
} = {}) {
  const terminalDriver = validateTerminalDriver(driver);
  const terminalHost = ref(null);
  const terminalSessionId = ref("");
  const terminalStatus = ref("");
  const terminalCommandPreview = ref("");
  const terminalCloseError = ref("");
  const terminalError = ref("");
  const terminalExitCode = ref(null);
  const terminalFocused = ref(false);
  const terminalMetadata = ref({});
  const terminalOutput = ref("");
  const terminalSelectedText = ref("");
  const terminalStarting = ref(false);
  const terminalConnectionStatus = ref("detached");
  const terminalAttention = ref(null);
  const terminalExpanded = ref(Boolean(initiallyExpanded));
  const terminalOwnership = ref("none");
  const terminalPresentation = ref(String(presentation || "inline"));
  const terminalVisible = ref(Boolean(initiallyVisible));

  let terminalInstance = null;
  let terminalFitAddon = null;
  let terminalConnection = null;
  let terminalConnectionGeneration = 0;
  let terminalConnectionSessionId = "";
  let terminalConnectionOpenPromise = null;
  let terminalConnectionOpenSessionId = "";
  let terminalDataDisposable = null;
  let terminalSelectionDisposable = null;
  let terminalScrollDisposable = null;
  let terminalFocusInHandler = null;
  let terminalFocusOutHandler = null;
  let terminalWindowBlurHandler = null;
  let terminalResizeHandler = null;
  let terminalResizeReportTimer = null;
  let terminalResizeObserver = null;
  let terminalReportedCols = 0;
  let terminalReportedRows = 0;
  let terminalInitialResizeReported = false;
  let terminalLatestOutput = "";
  let terminalOutputOffset = 0;
  let terminalOutputVersion = 0;
  let terminalFollowOutput = true;
  let terminalSetupPromise = null;
  let terminalMountedHost = null;
  let terminalExitNotifiedSessionId = "";
  let terminalSettledNotifiedSessionId = "";
  let terminalLastStartInput = {};
  const terminalExitWaiters = new Map();
  const terminalSettlementWaiters = new Map();

  const notifyOutput = resolveCallback(onOutput, () => null);
  const notifyEvent = resolveCallback(onEvent, () => null);
  const notifyMatch = resolveCallback(onMatch, () => null);
  const notifySessionUpdate = resolveCallback(onSessionUpdate, () => null);
  const notifyStatusUpdate = resolveCallback(onStatusUpdate, () => null);
  const notifyUserData = resolveCallback(onUserData, () => null);
  const asyncModuleRecoveryRuntime = useShellAsyncModuleRecoveryRuntime();
  const terminalExited = computed(() => terminalStatus.value === "exited");
  const terminalPlainOutput = computed(() => stripTerminalControlSequences(terminalOutput.value));

  function currentSessionId() {
    return String(terminalSessionId.value || "");
  }

  function emitTerminalEvent(type, payload = {}) {
    const event = {
      ...payload,
      sessionId: String(payload.sessionId || currentSessionId()),
      type: String(type || payload.type || "")
    };
    notifyEvent(event);
    terminalPolicyEngine.handle(event);
    return event;
  }

  function showTerminal({ manual = false } = {}) {
    if (terminalVisible.value) {
      return false;
    }
    terminalVisible.value = true;
    emitTerminalEvent("visibility-change", {
      manual,
      visible: true
    });
    return true;
  }

  function hideTerminal({ manual = false } = {}) {
    if (!terminalVisible.value) {
      return false;
    }
    terminalVisible.value = false;
    emitTerminalEvent("visibility-change", {
      manual,
      visible: false
    });
    return true;
  }

  function expandTerminal({ manual = false } = {}) {
    showTerminal({ manual });
    if (terminalExpanded.value) {
      return false;
    }
    terminalExpanded.value = true;
    emitTerminalEvent("expanded-change", {
      expanded: true,
      manual
    });
    return true;
  }

  function collapseTerminal({ manual = false } = {}) {
    if (!terminalExpanded.value) {
      return false;
    }
    terminalExpanded.value = false;
    emitTerminalEvent("expanded-change", {
      expanded: false,
      manual
    });
    return true;
  }

  function minimizeTerminal({ manual = false } = {}) {
    terminalPresentation.value = "minimized";
    collapseTerminal({ manual });
    showTerminal({ manual });
    return true;
  }

  const terminalPolicyEngine = createTerminalPolicyEngine({
    actions: {
      collapse: collapseTerminal,
      close: closeTerminal,
      detach: detachTerminal,
      emit(action) {
        return emitTerminalEvent(action.eventType || action.name || "policy-event", {
          policyEvent: action.event
        });
      },
      expand: expandTerminal,
      focus: focusTerminal,
      hide: hideTerminal,
      interrupt: interruptTerminal,
      minimize: minimizeTerminal,
      send(action) {
        return sendTerminalData(action.data, {
          source: "policy"
        });
      },
      show: showTerminal
    },
    currentSessionId,
    policies
  });

  const terminalMatcherEngine = createTerminalMatcherEngine({
    matchers,
    onMatch(payload) {
      terminalAttention.value = {
        kind: "match",
        matcher: payload.matcher
      };
      notifyMatch(payload);
      emitTerminalEvent("match", payload);
      emitTerminalEvent(`match:${payload.matcher}`, payload);
    }
  });

  function inspectTerminalMatchers(source) {
    return terminalMatcherEngine.inspect({
      error: terminalError.value,
      exitCode: terminalExitCode.value,
      metadata: terminalMetadata.value,
      output: terminalOutput.value,
      outputVersion: terminalOutputVersion,
      plainOutput: terminalPlainOutput.value,
      sessionId: currentSessionId(),
      source,
      status: terminalStatus.value
    });
  }

  function setTerminalHost(element) {
    terminalHost.value = element || null;
  }

  function terminalReadOnly() {
    return Boolean(typeof readOnly === "function" ? readOnly() : unref(readOnly));
  }

  function terminalLiveResize() {
    return Boolean(typeof liveResize === "function" ? liveResize() : unref(liveResize));
  }

  function terminalFitOnResize() {
    if (fitOnResize === null || typeof fitOnResize === "undefined") {
      return terminalLiveResize();
    }
    return Boolean(typeof fitOnResize === "function" ? fitOnResize() : unref(fitOnResize));
  }

  function terminalResizeReportDelay() {
    const delay = Number(typeof resizeReportDelayMs === "function"
      ? resizeReportDelayMs()
      : unref(resizeReportDelayMs));
    return Number.isFinite(delay) && delay > 0 ? delay : 0;
  }

  function normalizedOutputVersion(value) {
    const version = Number(value || 0);
    return Number.isFinite(version) && version > 0 ? version : 0;
  }

  function resetReportedTerminalSize() {
    terminalReportedCols = 0;
    terminalReportedRows = 0;
  }

  function resetInitialTerminalResize() {
    terminalInitialResizeReported = false;
  }

  function updateTerminalSelection() {
    terminalSelectedText.value = terminalInstance?.hasSelection?.()
      ? terminalInstance.getSelection()
      : "";
  }

  function terminalViewportAtBottom() {
    const buffer = terminalInstance?.buffer?.active;
    if (!buffer) {
      return true;
    }
    const viewportY = Number(buffer.viewportY);
    const baseY = Number(buffer.baseY);
    if (!Number.isFinite(viewportY) || !Number.isFinite(baseY)) {
      return true;
    }
    return viewportY >= baseY;
  }

  function updateTerminalFollowOutput() {
    terminalFollowOutput = terminalViewportAtBottom();
  }

  function syncTerminalFocus() {
    const host = terminalHost.value;
    const activeElement = document.activeElement;
    terminalFocused.value = Boolean(host && activeElement && host.contains(activeElement));
  }

  function terminalCurrentSize() {
    return reportableTerminalSize({
      cols: terminalInstance?.cols,
      rows: terminalInstance?.rows
    });
  }

  function terminalSizeAlreadyReported(size = {}) {
    return size.cols === terminalReportedCols && size.rows === terminalReportedRows;
  }

  function fitTerminalUi() {
    if (!terminalFitAddon || !terminalInstance) {
      return false;
    }
    terminalFitAddon.fit();
    terminalInstance.refresh?.(0, Math.max(0, terminalInstance.rows - 1));
    const size = terminalCurrentSize();
    scheduleTerminalResizeReport();
    return Boolean(size);
  }

  async function setupTerminalUi() {
    if (terminalInstance) {
      await nextTick();
      fitTerminalUi();
      return true;
    }
    if (terminalSetupPromise) {
      return terminalSetupPromise;
    }

    terminalSetupPromise = (async () => {
      await nextTick();
      if (terminalInstance) {
        fitTerminalUi();
        return true;
      }
      if (!terminalHost.value) {
        return false;
      }
      const host = terminalHost.value;
      let terminalLibrary;
      try {
        terminalLibrary = await loadXtermModules();
      } catch (error) {
        terminalError.value = "Terminal module could not load. Check your connection and retry.";
        asyncModuleRecoveryRuntime?.notify?.(error, {
          label: "Terminal",
          stale: isDynamicImportError(error)
        });
        return false;
      }
      if (!terminalHost.value || terminalHost.value !== host) {
        return false;
      }
      host.replaceChildren();
      terminalInstance = new terminalLibrary.Terminal({
        cursorBlink: false,
        disableStdin: false,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        scrollback: STUDIO_TERMINAL_SCROLLBACK_ROWS,
        theme: {
          background: "#101216",
          foreground: "#f5f7fb"
        }
      });
      terminalFitAddon = new terminalLibrary.FitAddon();
      terminalInstance.loadAddon(terminalFitAddon);
      terminalInstance.open(host);
      terminalMountedHost = host;
      fitTerminalUi();
      terminalDataDisposable = terminalInstance.onData((data) => {
        if (terminalReadOnly()) {
          return;
        }
        void sendTerminalData(data, {
          source: "user"
        });
      });
      terminalSelectionDisposable = terminalInstance.onSelectionChange(updateTerminalSelection);
      terminalScrollDisposable = terminalInstance.onScroll?.(updateTerminalFollowOutput) || null;
      terminalFocusInHandler = () => {
        terminalFocused.value = true;
      };
      terminalFocusOutHandler = () => {
        window.setTimeout(syncTerminalFocus, 0);
      };
      terminalWindowBlurHandler = () => {
        terminalFocused.value = false;
      };
      host.addEventListener("focusin", terminalFocusInHandler);
      host.addEventListener("focusout", terminalFocusOutHandler);
      window.addEventListener("blur", terminalWindowBlurHandler);
      terminalResizeHandler = () => {
        fitTerminalUi();
      };
      if (terminalFitOnResize()) {
        window.addEventListener("resize", terminalResizeHandler);
      }
      if (terminalFitOnResize() && typeof ResizeObserver !== "undefined") {
        terminalResizeObserver = new ResizeObserver(() => {
          fitTerminalUi();
        });
        terminalResizeObserver.observe(host);
      }
      writeTerminalOutput(terminalLatestOutput);
      return true;
    })();

    try {
      return await terminalSetupPromise;
    } finally {
      terminalSetupPromise = null;
    }
  }

  function closeTerminalSocket() {
    const connection = terminalConnection;
    const disconnectedSessionId = terminalConnectionSessionId || currentSessionId();
    terminalConnectionGeneration += 1;
    terminalConnection = null;
    terminalConnectionSessionId = "";
    terminalConnectionOpenPromise = null;
    terminalConnectionOpenSessionId = "";
    terminalConnectionStatus.value = "detached";
    resetReportedTerminalSize();
    connection?.close?.();
    if (connection) {
      emitTerminalEvent("disconnected", {
        intentional: true,
        sessionId: disconnectedSessionId
      });
    }
  }

  function disposeTerminalDisplay() {
    terminalDataDisposable?.dispose?.();
    terminalDataDisposable = null;
    terminalSelectionDisposable?.dispose?.();
    terminalSelectionDisposable = null;
    terminalScrollDisposable?.dispose?.();
    terminalScrollDisposable = null;
    const mountedHost = terminalMountedHost || terminalHost.value;
    if (terminalFocusInHandler) {
      mountedHost?.removeEventListener("focusin", terminalFocusInHandler);
      terminalFocusInHandler = null;
    }
    if (terminalFocusOutHandler) {
      mountedHost?.removeEventListener("focusout", terminalFocusOutHandler);
      terminalFocusOutHandler = null;
    }
    terminalMountedHost = null;
    if (terminalWindowBlurHandler) {
      window.removeEventListener("blur", terminalWindowBlurHandler);
      terminalWindowBlurHandler = null;
    }
    if (terminalResizeHandler) {
      window.removeEventListener("resize", terminalResizeHandler);
      terminalResizeHandler = null;
    }
    terminalResizeObserver?.disconnect?.();
    terminalResizeObserver = null;
    if (terminalResizeReportTimer) {
      window.clearTimeout(terminalResizeReportTimer);
      terminalResizeReportTimer = null;
    }
    terminalInstance?.dispose?.();
    terminalInstance = null;
    terminalFitAddon = null;
    terminalSetupPromise = null;
    terminalOutputOffset = 0;
    terminalFollowOutput = true;
    terminalFocused.value = false;
    terminalSelectedText.value = "";
    resetReportedTerminalSize();
  }

  function disposeTerminalUi() {
    closeTerminalSocket();
    disposeTerminalDisplay();
  }

  function resetTerminalDisplay() {
    terminalLatestOutput = "";
    terminalOutputOffset = 0;
    terminalOutputVersion = 0;
    terminalOutput.value = "";
    terminalFollowOutput = true;
    resetReportedTerminalSize();
    resetInitialTerminalResize();
    terminalInstance?.reset?.();
  }

  function resetTerminalSessionState() {
    terminalSessionId.value = "";
    terminalStatus.value = "";
    terminalCommandPreview.value = "";
    terminalCloseError.value = "";
    terminalExitCode.value = null;
    terminalError.value = "";
    terminalMetadata.value = {};
    terminalOwnership.value = "none";
  }

  function terminalSnapshot() {
    return {
      commandPreview: terminalCommandPreview.value,
      closeError: terminalCloseError.value,
      error: terminalError.value,
      exitCode: terminalExitCode.value,
      id: terminalSessionId.value,
      metadata: terminalMetadata.value,
      output: terminalOutput.value,
      status: terminalStatus.value
    };
  }

  async function attachTerminal(session = {}, {
    connect = true,
    fallbackStatus = "running",
    ownership = "attached",
    preserveOutput = false,
    resize = true,
    show = false
  } = {}) {
    const sessionId = String(session.id || session.terminalSessionId || "").trim();
    if (!sessionId) {
      throw new Error("Terminal session id is required.");
    }
    terminalOwnership.value = ownership === "owned" ? "owned" : "attached";
    applyTerminalSession({
      ...session,
      id: sessionId
    }, {
      fallbackStatus,
      preserveOutput,
      resize
    });
    if (show) {
      showTerminal();
    }
    emitTerminalEvent("attached", {
      ownership: terminalOwnership.value
    });
    if (connect && terminalStatus.value !== "exited") {
      await connectTerminalSocket();
    }
    return terminalSnapshot();
  }

  async function startTerminal(input = {}, {
    connect = true,
    show = true
  } = {}) {
    if (terminalStarting.value) {
      return false;
    }
    if (typeof terminalDriver.startSession !== "function") {
      throw new Error("This terminal driver cannot start sessions.");
    }
    terminalStarting.value = true;
    terminalLastStartInput = input && typeof input === "object" ? input : {};
    terminalError.value = "";
    if (show) {
      showTerminal();
      expandTerminal();
    }
    emitTerminalEvent("start-requested", {
      input
    });
    emitTerminalEvent("starting", {
      input
    });
    try {
      const session = await terminalDriver.startSession(input);
      if (!session || session.ok === false) {
        throw new Error(session?.error || "Terminal could not start.");
      }
      await attachTerminal(session, {
        connect,
        ownership: "owned",
        show: false
      });
      emitTerminalEvent("started", {
        session: terminalSnapshot()
      });
      return terminalSnapshot();
    } catch (error) {
      terminalError.value = String(error?.message || error || "Terminal could not start.");
      return false;
    } finally {
      terminalStarting.value = false;
    }
  }

  async function closeTerminal({
    deleteSession = terminalOwnership.value === "owned",
    preserveOutput = false
  } = {}) {
    const sessionId = currentSessionId();
    const ownership = terminalOwnership.value;
    closeTerminalSocket();
    if (deleteSession && sessionId && typeof terminalDriver.closeSession === "function") {
      try {
        await terminalDriver.closeSession(sessionId);
      } catch (error) {
        terminalError.value = String(error?.message || error || "Terminal could not close.");
        return false;
      }
    }
    emitTerminalEvent("close", {
      deleted: Boolean(deleteSession),
      ownership
    });
    resetTerminalSessionState();
    if (!preserveOutput) {
      resetTerminalDisplay();
    }
    return true;
  }

  function detachTerminal({
    preserveOutput = true
  } = {}) {
    const ownership = terminalOwnership.value;
    const sessionId = currentSessionId();
    closeTerminalSocket();
    emitTerminalEvent("detached", {
      ownership,
      sessionId
    });
    resetTerminalSessionState();
    if (!preserveOutput) {
      resetTerminalDisplay();
    }
    return true;
  }

  async function restartTerminal(input = terminalLastStartInput, {
    deleteSession = terminalOwnership.value === "owned",
    show = true
  } = {}) {
    const previousSessionId = currentSessionId();
    if (previousSessionId && !(await closeTerminal({
      deleteSession
    }))) {
      return false;
    }
    const session = await startTerminal(input, {
      show
    });
    if (session) {
      emitTerminalEvent("restart", {
        previousSessionId
      });
    }
    return session;
  }

  function waitForExit(sessionId = currentSessionId()) {
    const normalizedSessionId = String(sessionId || "");
    if (!normalizedSessionId) {
      return Promise.reject(new Error("Terminal session id is required."));
    }
    if (
      normalizedSessionId === currentSessionId() &&
      terminalStatus.value === "exited"
    ) {
      return Promise.resolve(terminalSnapshot());
    }
    return new Promise((resolve) => {
      const waiters = terminalExitWaiters.get(normalizedSessionId) || [];
      waiters.push(resolve);
      terminalExitWaiters.set(normalizedSessionId, waiters);
    });
  }

  function waitForSettlement(sessionId = currentSessionId()) {
    const normalizedSessionId = String(sessionId || "");
    if (!normalizedSessionId) {
      return Promise.reject(new Error("Terminal session id is required."));
    }
    if (
      normalizedSessionId === currentSessionId() &&
      (terminalStatus.value === "exited" || terminalError.value)
    ) {
      return Promise.resolve(terminalSnapshot());
    }
    return new Promise((resolve) => {
      const waiters = terminalSettlementWaiters.get(normalizedSessionId) || [];
      waiters.push(resolve);
      terminalSettlementWaiters.set(normalizedSessionId, waiters);
    });
  }

  function resolveExitWaiters(sessionId) {
    const waiters = terminalExitWaiters.get(sessionId) || [];
    terminalExitWaiters.delete(sessionId);
    const snapshot = terminalSnapshot();
    for (const resolve of waiters) {
      resolve(snapshot);
    }
    resolveSettlementWaiters(sessionId);
  }

  function resolveSettlementWaiters(sessionId) {
    const waiters = terminalSettlementWaiters.get(sessionId) || [];
    terminalSettlementWaiters.delete(sessionId);
    const snapshot = terminalSnapshot();
    for (const resolve of waiters) {
      resolve(snapshot);
    }
  }

  function scrollTerminalToBottom() {
    terminalInstance?.scrollToBottom?.();
    terminalFollowOutput = true;
  }

  function scrollTerminalToBottomIfFollowing() {
    if (terminalFollowOutput) {
      scrollTerminalToBottom();
    }
  }

  function writeTerminalOutput(output, {
    outputVersion = 0,
    replace = false
  } = {}) {
    const previousOutput = terminalLatestOutput;
    const nextOutput = String(output || "");
    const nextOutputVersion = normalizedOutputVersion(outputVersion);
    if (
      nextOutputVersion &&
      terminalOutputVersion &&
      nextOutputVersion < terminalOutputVersion
    ) {
      return false;
    }
    if (replace) {
      terminalInstance?.reset?.();
      terminalOutputOffset = 0;
    } else if (previousOutput && !nextOutput.startsWith(previousOutput)) {
      if (!nextOutputVersion || nextOutputVersion <= terminalOutputVersion) {
        return false;
      }
      terminalInstance?.reset?.();
      terminalOutputOffset = 0;
    }
    terminalLatestOutput = nextOutput;
    terminalOutputVersion = Math.max(terminalOutputVersion, nextOutputVersion);
    terminalOutput.value = terminalLatestOutput;
    if (terminalLatestOutput !== previousOutput) {
      const source = replace ? "replacement" : "snapshot";
      const outputEvent = {
        outputVersion: terminalOutputVersion,
        output: terminalLatestOutput,
        source
      };
      notifyOutput(outputEvent);
      emitTerminalEvent("output", outputEvent);
      inspectTerminalMatchers(source);
    }
    if (!terminalInstance) {
      return;
    }
    if (terminalLatestOutput.length < terminalOutputOffset) {
      terminalInstance.reset();
      terminalOutputOffset = 0;
    }
    const outputChunk = terminalLatestOutput.slice(terminalOutputOffset);
    if (outputChunk) {
      terminalInstance.write(outputChunk, scrollTerminalToBottomIfFollowing);
    }
    terminalOutputOffset = terminalLatestOutput.length;
    return true;
  }

  function appendTerminalOutput(chunk, {
    outputVersion = 0
  } = {}) {
    const outputChunk = String(chunk || "");
    if (!outputChunk) {
      return false;
    }
    const nextOutputVersion = normalizedOutputVersion(outputVersion);
    if (
      nextOutputVersion &&
      terminalOutputVersion &&
      nextOutputVersion <= terminalOutputVersion
    ) {
      return false;
    }
    terminalLatestOutput += outputChunk;
    terminalOutputVersion = Math.max(terminalOutputVersion, nextOutputVersion);
    terminalOutput.value = terminalLatestOutput;
    const outputEvent = {
      chunk: outputChunk,
      output: terminalLatestOutput,
      outputVersion: terminalOutputVersion,
      source: "append"
    };
    notifyOutput(outputEvent);
    emitTerminalEvent("output", outputEvent);
    inspectTerminalMatchers("append");
    if (!terminalInstance) {
      return true;
    }
    terminalInstance.write(outputChunk, scrollTerminalToBottomIfFollowing);
    terminalOutputOffset = terminalLatestOutput.length;
    return true;
  }

  function setTerminalOutput(output, options = {}) {
    return writeTerminalOutput(output, options);
  }

  function applyTerminalSession(session = {}, {
    fallbackStatus = "",
    preserveOutput = false,
    replaceOutput = false,
    resize = true
  } = {}) {
    const terminalSession = session && typeof session === "object" && !Array.isArray(session) ? session : {};
    const nextTerminalSessionId = String(terminalSession.id || "");
    const terminalSessionChanged = Boolean(
      nextTerminalSessionId &&
      terminalSessionId.value &&
      nextTerminalSessionId !== terminalSessionId.value
    );
    if (terminalSessionChanged) {
      closeTerminalSocket();
      resetTerminalDisplay();
    }
    terminalSessionId.value = nextTerminalSessionId;
    const nextStatus = String(terminalSession.status || fallbackStatus || "");
    terminalExitCode.value = nextStatus === "exited" ? terminalSession.exitCode ?? null : null;
    terminalStatus.value = nextStatus;
    terminalCommandPreview.value = String(terminalSession.commandPreview || "");
    terminalCloseError.value = String(terminalSession.closeError || "");
    terminalMetadata.value = terminalSession.metadata &&
      typeof terminalSession.metadata === "object" &&
      !Array.isArray(terminalSession.metadata)
      ? terminalSession.metadata
      : {};
    if (!preserveOutput || Object.hasOwn(terminalSession, "output")) {
      writeTerminalOutput(terminalSession.output || "", {
        outputVersion: terminalSession.outputVersion,
        replace: replaceOutput
      });
    }
    if (resize) {
      void sendTerminalResize();
    }
    notifySessionUpdate(terminalSession);
    notifyStatusUpdate({
      closeError: String(terminalSession.closeError || ""),
      exitCode: terminalExitCode.value,
      id: terminalSessionId.value,
      status: terminalStatus.value
    });
  }

  function handleTerminalConnectionEvent(message, {
    generation,
    sessionId
  } = {}) {
    if (
      generation !== terminalConnectionGeneration ||
      sessionId !== terminalConnectionSessionId
    ) {
      return;
    }

    if (message?.type === "connected") {
      terminalConnectionStatus.value = "connected";
      terminalError.value = "";
      emitTerminalEvent("connected");
      return;
    }

    if (message?.type === "disconnected") {
      terminalConnectionStatus.value = "disconnected";
      emitTerminalEvent("disconnected", {
        intentional: message.intentional === true
      });
      return;
    }

    if (message?.type === "snapshot") {
      applyTerminalSession(message.session || {}, {
        replaceOutput: message.replaceOutput === true
      });
      return;
    }

    if (message?.type === "output") {
      appendTerminalOutput(message.chunk, {
        outputVersion: message.outputVersion
      });
      return;
    }

    if (message?.type === "metadata") {
      terminalMetadata.value = message.metadata &&
        typeof message.metadata === "object" &&
        !Array.isArray(message.metadata)
        ? message.metadata
        : {};
      notifySessionUpdate({
        id: terminalSessionId.value,
        metadata: terminalMetadata.value,
        status: terminalStatus.value
      });
      emitTerminalEvent("metadata", {
        metadata: terminalMetadata.value
      });
      return;
    }

    if (message?.type === "status") {
      const nextStatus = String(message.status || terminalStatus.value || "");
      terminalExitCode.value = nextStatus === "exited" ? message.exitCode ?? null : null;
      terminalCloseError.value = String(message.closeError || "");
      terminalStatus.value = nextStatus;
      notifyStatusUpdate({
        closeError: String(message.closeError || ""),
        exitCode: terminalExitCode.value,
        id: terminalSessionId.value,
        status: terminalStatus.value
      });
      return;
    }

    if (message?.type === "resize.error") {
      return;
    }

    if (message?.type === "error") {
      const error = String(message.error || "Terminal stream failed.");
      if (terminalResizeErrorMessage(error)) {
        return;
      }
      terminalError.value = error;
    }
  }

  async function connectTerminalSocket() {
    if (!terminalSessionId.value) {
      return false;
    }
    if (terminalConnectionSessionId && terminalConnectionSessionId !== terminalSessionId.value) {
      closeTerminalSocket();
    }
    if (terminalConnection?.isOpen?.() && terminalConnectionSessionId === terminalSessionId.value) {
      return true;
    }
    if (terminalConnectionOpenPromise && terminalConnectionOpenSessionId === terminalSessionId.value) {
      return terminalConnectionOpenPromise;
    }
    if (terminalConnectionOpenPromise) {
      closeTerminalSocket();
    }

    const connectionSessionId = terminalSessionId.value;
    const generation = terminalConnectionGeneration + 1;
    terminalConnectionGeneration = generation;
    terminalConnectionSessionId = connectionSessionId;
    terminalConnectionOpenSessionId = connectionSessionId;
    terminalConnectionStatus.value = "connecting";
    try {
      terminalConnection = terminalDriver.openConnection({
        onEvent(message) {
          handleTerminalConnectionEvent(message, {
            generation,
            sessionId: connectionSessionId
          });
        },
        sessionId: connectionSessionId
      });
    } catch (error) {
      terminalConnectionStatus.value = "disconnected";
      terminalError.value = String(error?.message || error || "Terminal stream failed.");
      return false;
    }
    const connection = terminalConnection;
    terminalConnectionOpenPromise = Promise.resolve(connection?.ready).then((ready) => {
      if (
        generation === terminalConnectionGeneration &&
        connectionSessionId === terminalConnectionSessionId
      ) {
        terminalConnectionStatus.value = ready ? "connected" : "disconnected";
        if (ready) {
          terminalError.value = "";
        }
      }
      return Boolean(ready);
    }).catch((error) => {
      if (generation === terminalConnectionGeneration) {
        terminalConnectionStatus.value = "disconnected";
        terminalError.value = String(error?.message || error || "Terminal stream failed.");
      }
      return false;
    }).finally(() => {
      if (generation === terminalConnectionGeneration) {
        terminalConnectionOpenPromise = null;
        terminalConnectionOpenSessionId = "";
      }
    });

    return terminalConnectionOpenPromise;
  }

  async function sendTerminalData(data, {
    source = "program"
  } = {}) {
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return false;
    }
    const input = String(data || "");
    if (source === "user") {
      notifyUserData(input);
    }
    emitTerminalEvent("input", {
      data: input,
      source
    });
    if (!(await connectTerminalSocket()) || !terminalConnection?.isOpen?.()) {
      terminalError.value = "Terminal stream is not connected.";
      return false;
    }
    try {
      return Boolean(await terminalConnection.sendInput(input));
    } catch (error) {
      terminalError.value = String(error?.message || error || "Terminal input failed.");
      return false;
    }
  }

  async function sendTerminalResize() {
    if (terminalResizeReportTimer) {
      window.clearTimeout(terminalResizeReportTimer);
      terminalResizeReportTimer = null;
    }
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return false;
    }
    if (!terminalLiveResize() && terminalInitialResizeReported) {
      return false;
    }
    const size = terminalCurrentSize();
    if (!size || terminalSizeAlreadyReported(size)) {
      return false;
    }
    if (!(await connectTerminalSocket()) || !terminalConnection?.isOpen?.()) {
      return false;
    }
    terminalReportedCols = size.cols;
    terminalReportedRows = size.rows;
    if (!await terminalConnection.sendResize(size)) {
      return false;
    }
    emitTerminalEvent("resize", size);
    if (!terminalLiveResize()) {
      terminalInitialResizeReported = true;
    }
    return true;
  }

  function scheduleTerminalResizeReport() {
    if (!terminalReportedCols || !terminalReportedRows) {
      void sendTerminalResize();
      return;
    }
    const delay = terminalResizeReportDelay();
    if (!delay) {
      void sendTerminalResize();
      return;
    }
    if (terminalResizeReportTimer) {
      window.clearTimeout(terminalResizeReportTimer);
    }
    terminalResizeReportTimer = window.setTimeout(() => {
      terminalResizeReportTimer = null;
      void sendTerminalResize();
    }, delay);
  }

  function terminalKeyData(key) {
    const normalizedKey = String(key || "").trim().toLowerCase();
    const keys = {
      "ctrl-c": "\u0003",
      enter: "\r",
      escape: "\u001b",
      tab: "\t"
    };
    if (!Object.hasOwn(keys, normalizedKey)) {
      throw new TypeError(`Unsupported terminal key: ${String(key || "")}`);
    }
    return keys[normalizedKey];
  }

  function sendTerminalKey(key, options = {}) {
    return sendTerminalData(terminalKeyData(key), {
      source: "control",
      ...options
    });
  }

  async function interruptTerminal() {
    const interrupted = await sendTerminalKey("ctrl-c");
    if (interrupted) {
      emitTerminalEvent("interrupt");
    }
    return interrupted;
  }

  function sendCtrlC() {
    return interruptTerminal();
  }

  async function focusTerminal() {
    if (!(await setupTerminalUi())) {
      return false;
    }
    try {
      terminalInstance?.focus?.();
    } catch (error) {
      terminalError.value = String(error?.message || error || "Terminal focus failed.");
      return false;
    }
    syncTerminalFocus();
    return true;
  }

  watch(terminalSessionId, (nextSessionId, previousSessionId) => {
    if (nextSessionId === previousSessionId) {
      return;
    }
    terminalExitNotifiedSessionId = "";
    terminalSettledNotifiedSessionId = "";
    terminalAttention.value = null;
    terminalMatcherEngine.reset(nextSessionId);
    terminalPolicyEngine.reset();
    emitTerminalEvent("session-change", {
      previousSessionId: String(previousSessionId || "")
    });
  }, {
    flush: "sync"
  });

  watch(terminalStatus, (status, previousStatus) => {
    if (status === previousStatus) {
      return;
    }
    inspectTerminalMatchers("status");
    emitTerminalEvent("status", {
      exitCode: terminalExitCode.value,
      previousStatus: String(previousStatus || ""),
      status: String(status || "")
    });
    if (
      status === "exited" &&
      currentSessionId() &&
      terminalExitNotifiedSessionId !== currentSessionId()
    ) {
      terminalExitNotifiedSessionId = currentSessionId();
      resolveExitWaiters(currentSessionId());
      emitTerminalEvent("exit", {
        exitCode: terminalExitCode.value,
        status
      });
      if (terminalSettledNotifiedSessionId !== currentSessionId()) {
        terminalSettledNotifiedSessionId = currentSessionId();
        emitTerminalEvent("settled", {
          error: "",
          exitCode: terminalExitCode.value,
          status
        });
      }
    }
  }, {
    flush: "sync"
  });

  watch(terminalError, (error, previousError) => {
    if (!error || error === previousError) {
      return;
    }
    terminalAttention.value = {
      error: String(error),
      kind: "error"
    };
    inspectTerminalMatchers("error");
    resolveSettlementWaiters(currentSessionId());
    emitTerminalEvent("error", {
      error: String(error)
    });
    if (currentSessionId() && terminalSettledNotifiedSessionId !== currentSessionId()) {
      terminalSettledNotifiedSessionId = currentSessionId();
      emitTerminalEvent("settled", {
        error: String(error),
        exitCode: terminalExitCode.value,
        status: terminalStatus.value
      });
    }
  }, {
    flush: "sync"
  });

  return {
    attachTerminal,
    applyTerminalSession,
    closeTerminalSocket,
    closeTerminal,
    connectTerminalSocket,
    detachTerminal,
    disposeTerminalDisplay,
    disposeTerminalUi,
    collapseTerminal,
    expandTerminal,
    focusTerminal,
    hideTerminal,
    interruptTerminal,
    minimizeTerminal,
    resetTerminalDisplay,
    resetTerminalSessionState,
    restartTerminal,
    sendCtrlC,
    sendTerminalData,
    sendTerminalKey,
    setTerminalHost,
    setTerminalOutput,
    showTerminal,
    setupTerminalUi,
    startTerminal,
    terminalCommandPreview,
    terminalCloseError,
    terminalConnectionStatus,
    terminalAttention,
    terminalError,
    terminalExpanded,
    terminalExited,
    terminalExitCode,
    terminalFocused,
    terminalHost,
    terminalMetadata,
    terminalOwnership,
    terminalOutput,
    terminalPlainOutput,
    terminalPresentation,
    terminalSelectedText,
    terminalSessionId,
    terminalStarting,
    terminalStatus,
    terminalVisible,
    waitForExit,
    waitForSettlement
  };
}

export {
  useVibe64Terminal
};

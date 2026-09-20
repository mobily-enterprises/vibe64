import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const codexTerminalConsumerPath = path.resolve("src/components/studio/Vibe64CodexSession.vue");
const interactiveTerminalPath = path.resolve(
  "src/components/studio/Vibe64InteractiveTerminal.vue"
);
const launchTerminalConsumerPath = path.resolve("src/components/studio/Vibe64OutputControls.vue");
const launchTerminalStatePath = path.resolve("src/composables/useVibe64OutputControls.js");
const launchTerminalSurfaceStatePath = path.resolve(
  "src/composables/useVibe64OutputControlsSurface.js"
);
const longRunningTerminalPath = path.resolve(
  "src/components/studio/Vibe64LongRunningTerminal.vue"
);
const openCodeTerminalConsumerPath = path.resolve(
  "src/components/studio/Vibe64OpenCodeSession.vue"
);
const temporaryActionTerminalPath = path.resolve(
  "src/components/studio/Vibe64TemporaryActionTerminal.vue"
);
const runtimeHostPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue"
);
const autopilotStatePath = path.resolve("src/composables/useVibe64AutopilotView.js");
const providerTerminalConsumerPath = path.resolve(
  "packages/vibe64-accounts/src/client/studio/ProviderAccountsSetup.vue"
);

describe("Vibe64 terminal consumers", () => {
  it("uses the three terminal lifecycles without changing a session's assistant", () => {
    const codex = readFileSync(codexTerminalConsumerPath, "utf8");
    const interactive = readFileSync(interactiveTerminalPath, "utf8");
    const launch = readFileSync(launchTerminalConsumerPath, "utf8");
    const launchState = readFileSync(launchTerminalStatePath, "utf8");
    const launchSurfaceState = readFileSync(launchTerminalSurfaceStatePath, "utf8");
    const longRunning = readFileSync(longRunningTerminalPath, "utf8");
    const openCode = readFileSync(openCodeTerminalConsumerPath, "utf8");
    const runtimeHost = readFileSync(runtimeHostPath, "utf8");
    const autopilotState = readFileSync(autopilotStatePath, "utf8");
    const temporaryAction = readFileSync(temporaryActionTerminalPath, "utf8");
    const provider = readFileSync(providerTerminalConsumerPath, "utf8");

    expect(codex).toContain("<Vibe64InteractiveTerminal");
    expect(codex).toContain("mobile-takeover");
    expect(codex).toContain(":stage=\"terminalSubtitle\"");
    expect(codex).toContain("show-copy");
    expect(codex).toContain('@clean-exit="closeTerminal"');
    expect(codex).not.toContain(':loading="terminalStarting"');
    expect(codex).toContain(':aria-busy="terminalStarting ? \'true\' : undefined"');
    expect(codex).toContain('return "Starting Codex…";');
    expect(codex).not.toContain(":collapsible");
    expect(interactive).toContain(':collapsible="false"');
    expect(interactive).toContain('emit("clean-exit"');

    expect(openCode).toContain("<Vibe64InteractiveTerminal");
    expect(openCode).toContain("useVibe64TerminalCommands");
    expect(openCode).toContain("startAgentTerminal(sessionId.value)");
    expect(openCode).toContain('@clean-exit="closeTerminal"');
    expect(openCode).not.toContain('@interrupt="terminalController.sendCtrlC"');

    expect(launch).toContain('v-if="embeddedTerminalSurfaceVisible"');
    expect(launch).toContain('v-if="!embeddedPreview && terminalWindowVisible"');
    const toolbarTeleport = launch.match(/<Teleport\b[^>]*>/u)?.[0] || "";
    expect(toolbarTeleport).toContain(":disabled=\"!toolbarTeleportTarget\"");
    expect(toolbarTeleport).toContain(":to=\"toolbarTeleportTarget || 'body'\"");
    expect(toolbarTeleport).not.toContain("v-if=");
    expect(launch.match(/<Vibe64LongRunningTerminal/gu)).toHaveLength(2);
    expect(launch.match(/show-copy/gu)).toHaveLength(2);
    expect(launch.match(/@update:open="setTerminalExpanded"/gu)).toHaveLength(2);
    expect(launch).toContain('aria-label="Show run output"');
    expect(launch).toContain(":icon=\"mdiConsoleLine\"");
    expect(launchState).toContain("terminalExpanded.value = false;");
    expect(launchState).not.toContain('launchTarget.defaultDisplay !== "minimized"');
    expect(launchSurfaceState).toMatch(
      /function showLaunchLog\(\) \{\s+collapsePreviewToolbar\(\);\s+previewLogVisible\.value = true;/u
    );
    expect(longRunning).toContain("mobile-takeover");
    expect(longRunning).toContain('v-if="open"');
    expect(longRunning).toContain("props.terminal?.closeTerminalSocket?.()");

    expect(temporaryAction).toContain("props.active || props.error || detailsViewed.value");
    expect(temporaryAction).toContain('v-if="visible"');
    expect(temporaryAction).toContain(':expanded="detailsOpen"');
    expect(temporaryAction).toContain(":show-close=\"canDismiss\"");
    expect(temporaryAction).toContain("if (active && !previousActive)");

    expect(runtimeHost).toContain("selectedAssistantEngineId === 'codex'");
    expect(runtimeHost).toContain("selectedAssistantEngineId === 'opencode'");
    expect(runtimeHost).not.toContain('engineId || "codex"');
    expect(runtimeHost).not.toMatch(/<Vibe64OpenCodeSession\s+v-else(?:\s|>)/u);
    expect(autopilotState).not.toContain("assistantEngineId === 'codex'");
    expect(autopilotState).not.toContain("assistantEngineId.value");

    // Provider authentication remains its own interactive-login surface.
    expect(provider).toContain(":expanded=\"authTerminalExpanded\"");
    expect(provider).toContain("mobile-takeover");
    expect(provider).toContain("show-copy");
    expect(provider).toContain(":stage=\"authTerminalStage\"");
    expect(provider).not.toContain(":loading=");
    expect(provider).not.toContain("<details");
    expect(provider).not.toContain("Show login output");
    expect(provider).not.toContain("View terminal");
    expect(provider).toContain('accountsLoading ? "Refreshing…" : "Refresh"');
    expect(provider).toContain('logoutAccountId === account.id ? "Disconnecting…" : "Disconnect"');
    expect(provider).toContain("logoutAccountId === account.id || !account.connected");
    expect(provider).toContain("Use this only if the login asks for terminal input.");
  });
});

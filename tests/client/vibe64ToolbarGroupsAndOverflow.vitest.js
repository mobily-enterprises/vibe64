import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SESSION_HEADER_ACTION_PRIORITY,
  splitVibe64SessionHeaderActions,
  vibe64SessionNameStripWidth
} from "../../src/lib/vibe64SessionToolbarVisibility.js";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ALL = ["prepare-workspace", "pull-request", "pin", "renew", "temporary-ai"];

describe("session header priority overflow", () => {
  it("keeps Save out of the list so it never moves into Session actions", () => {
    expect(SESSION_HEADER_ACTION_PRIORITY).toEqual(["temporary-ai", "renew", "pin", "pull-request", "prepare-workspace"]);
    expect(SESSION_HEADER_ACTION_PRIORITY).not.toContain("save");
  });

  it("moves Prepare workspace first and Temporary AI last", () => {
    expect(splitVibe64SessionHeaderActions(ALL, Infinity)).toEqual({ inline: SESSION_HEADER_ACTION_PRIORITY, overflow: [] });
    expect(splitVibe64SessionHeaderActions(ALL, 4)).toEqual({
      inline: ["temporary-ai", "renew", "pin", "pull-request"], overflow: ["prepare-workspace"]
    });
    expect(splitVibe64SessionHeaderActions(ALL, 2)).toEqual({
      inline: ["temporary-ai", "renew"], overflow: ["pin", "pull-request", "prepare-workspace"]
    });
    expect(splitVibe64SessionHeaderActions(ALL, 0)).toEqual({ inline: [], overflow: SESSION_HEADER_ACTION_PRIORITY });
    expect(splitVibe64SessionHeaderActions(ALL, -3).inline).toEqual([]);
  });

  it("skips unavailable actions without changing the order", () => {
    expect(splitVibe64SessionHeaderActions(["prepare-workspace", "temporary-ai", "pin"], 2)).toEqual({
      inline: ["temporary-ai", "pin"], overflow: ["prepare-workspace"]
    });
  });

  it("renders Save outside the overflowing actions and each action once per place", () => {
    const view = read("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
    const header = view.slice(view.indexOf('<header ref="sessionHeader"'), view.indexOf("</header>"));
    const menu = header.slice(header.indexOf("<v-menu"), header.indexOf("</v-menu>"));
    expect(header.indexOf('data-vibe64-guide="save"')).toBeLessThan(header.indexOf("studio-autopilot__header-actions"));
    expect(menu).not.toContain('data-vibe64-guide="save"');
    for (const id of SESSION_HEADER_ACTION_PRIORITY) {
      expect(header).toContain(`headerActions.inline.includes('${id}')`);
      expect(menu).toContain(`headerActions.overflow.includes('${id}')`);
    }
    expect(view).not.toContain("header-actions--compact");
    expect(view).not.toContain('variant="tonal"\n              width="var(--session-action-size');
  });
});

describe("session name strip room", () => {
  const element = (classes, offsetWidth, label) => ({
    classList: { contains: (name) => classes.includes(name) },
    offsetWidth,
    querySelector: () => label
  });

  it("counts chips at their full label width up to the max and every other strip element", () => {
    const chip = element(["studio-ai-sessions__tab"], 100, { clientWidth: 40, scrollWidth: 90 });
    const longChip = element(["studio-ai-sessions__tab"], 200, { clientWidth: 150, scrollWidth: 400 });
    const newSession = element(["studio-ai-sessions__create-button"], 28, null);
    expect(vibe64SessionNameStripWidth([chip, longChip, newSession], 240)).toBe((150 + 6) + (240 + 6) + (28 + 6));
    expect(vibe64SessionNameStripWidth(undefined, 240)).toBe(0);
  });

  it("measures the whole strip and leaves Save its state colour", () => {
    const view = read("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
    expect(view).toContain('vibe64SessionNameStripWidth(header.querySelector(".studio-ai-sessions__tabs")?.children');
    expect(view).not.toContain(".studio-autopilot__save-work {\n  border-radius: 8px;\n  color:");
    expect(view).toContain(".studio-autopilot__save-work:not(.text-error):not(.text-warning) {");
  });
});

describe("Preview address bar groups", () => {
  const controls = read("src/components/studio/Vibe64OutputControls.vue");
  const client = controls.slice(controls.indexOf('aria-label="Preview page"'), controls.indexOf("</form>"));
  const serverStart = controls.indexOf('aria-label="Preview server"');
  const server = controls.slice(serverStart, controls.indexOf("embeddedManualStartButtonVisible", serverStart));

  it("keeps back, address, reload, pause, copy and open in a new tab in the client group", () => {
    for (const marker of ["Go back in preview", 'aria-label="Preview URL"', "Reload preview", "Suspend preview", "Copy preview URL", "mdiOpenInNew"]) {
      expect(client).toContain(marker);
    }
    for (const marker of ["status-dot", "Show run output", "Stop preview", "Restart"]) {
      expect(client).not.toContain(marker);
    }
  });

  it("keeps the status dot, run output, stop and restart in the server group", () => {
    expect(server).toContain('role="group"');
    const order = ["vibe64-launch-controls__status-dot", "Show run output", "Stop preview", "Restart preview"].map((marker) => server.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(server).toContain('v-for="action in previewNavVisible ? [] : launchActions"');
  });

  it("uses light outline icons in the address bar", () => {
    expect(controls).not.toMatch(/mdiPauseCircleOutline|mdiPowerCycle|:icon="mdiStop"/u);
    expect(controls).toContain(":icon=\"previewSuspended ? mdiPlay : mdiPause\"");
    expect(controls).toContain(':icon="mdiStopCircleOutline"');
  });
});

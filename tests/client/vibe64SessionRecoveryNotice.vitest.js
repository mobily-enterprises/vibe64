import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const noticePath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64SessionRecoveryNotice.vue"
);
const viewPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64AutopilotView.vue"
);
const composablePath = path.resolve("src/composables/useVibe64AutopilotView.js");

describe("session recovery Codex repair action", () => {
  it("presents one explicit repair action and distinguishes user decisions", () => {
    const source = fs.readFileSync(noticePath, "utf8");

    expect(source).toContain("Ask Codex to repair");
    expect(source).toContain("Ask Codex for guidance");
    expect(source).toContain("Codex repair requested");
    expect(source).toContain("only you can choose");
    expect(source).toContain('emit("repair")');
  });

  it("sends structured recovery diagnostics through the existing agent message path", () => {
    const viewSource = fs.readFileSync(viewPath, "utf8");
    const composableSource = fs.readFileSync(composablePath, "utf8");

    expect(viewSource).toContain('@repair="requestSessionRecoveryRepair"');
    expect(viewSource).toContain(':repairing="sessionRecoveryRepairSending"');
    expect(composableSource).toContain("vibe64SessionRecoveryAgentPrompt(recovery)");
    expect(composableSource).toContain("await props.sendAgentMessage({");
    expect(composableSource).toContain("sessionRecoveryRepairRequestedSignature");
  });
});

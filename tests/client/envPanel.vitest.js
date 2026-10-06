import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "@vue/compiler-sfc";

function componentSource(file) {
  const source = readFileSync(file, "utf8");
  const parsed = parse(source, { filename: file });
  expect(parsed.errors).toEqual([]);
  return source;
}

describe("Env panel", () => {
  it("confirms before removing a user-owned Env value", () => {
    const source = componentSource("src/components/studio/EnvPanel.vue");

    expect(source).toContain("Remove Env value?");
    expect(source).toContain('@remove-record="requestRemoveRecord"');
    expect(source).toContain("async function confirmRemoveRecord()");
    expect(source).toMatch(/\[record\.key\]:\s*\{\s*remove:\s*true/u);
  });

  it("keeps Online database lifetime separate from application Env", () => {
    const envSource = componentSource("src/components/studio/EnvPanel.vue");
    const settingsSource = componentSource("src/components/studio/ProjectSettingsPanel.vue");

    expect(envSource).not.toContain("Development database");
    expect(settingsSource).toContain("A separate database for each session");
    expect(settingsSource).toContain("One database shared by this project");
    expect(settingsSource).toContain("Data and schema changes will be visible to every project session and remain");
    expect(settingsSource).toContain("after a session is archived.");
    expect(settingsSource).toContain("path: DEVELOPMENT_DATABASE_ENDPOINT");
    expect(settingsSource).toContain("scope: context.scope");
    expect(settingsSource).toContain("event: VIBE64_SESSION_CHANGED_EVENT");
    expect(settingsSource).toContain("matches: sessionListRealtimeShouldRefresh");
    expect(settingsSource).toContain("void resource.reload()");
    expect(settingsSource).not.toContain("NO_WORKTREE_DB");
  });

  it("keeps personal identity, source collaboration, and prompt suggestions in their correct scopes", () => {
    const source = componentSource("src/components/studio/ProjectSettingsPanel.vue");

    expect(source).toContain("genesis/collaboration.md");
    expect(source).toContain("Set your Vibe64 name");
    expect(source).toContain('section: "profile"');
    expect(source).toContain('label="Tone"');
    expect(source).toContain('label="Response length"');
    expect(source).toContain('label="Experience level"');
    expect(source).toContain('label="Explanation style"');
    expect(source).toContain('label="Suggest useful next prompts"');
    expect(source).toContain("Anyone who can");
    expect(source).toContain("instructions in an active Codex conversation stay as they are.");
    expect(source).toContain("This Vibe64 setting does not change your AI's instructions.");
    expect(source).toContain('{{ collaborationSaving ? "Saving…" : "Save collaboration" }}');
    expect(source).toContain('{{ promptHintsSaving ? "Saving…" : "Save prompt suggestions" }}');
    expect(source).not.toContain(':loading="collaborationSaving"');
  });

  it("uses a compact table without redundant source and status columns", () => {
    const source = componentSource("src/components/studio/RuntimeConfigRecordsTable.vue");

    expect(source).not.toContain("<th>Source</th>");
    expect(source).not.toContain("<th>Status</th>");
    expect(source).toMatch(/table-layout:\s*fixed/u);
    expect(source).toMatch(/grid-template-columns:\s*minmax\(7rem, 1fr\) auto auto/u);
  });

  it("reveals every present secret through the shared record view with row loading", () => {
    const panel = componentSource("src/components/studio/EnvPanel.vue");
    const table = componentSource("src/components/studio/RuntimeConfigRecordsTable.vue");

    expect(panel).toContain("secret-reveal-enabled");
    expect(panel).toContain(':secret-reveal-busy-key="secretRevealBusyKey"');
    expect(panel).toContain('@reveal-secret="revealSecret"');
    expect(table).toContain("v-if=\"secretRevealEnabled && record.valuePresent\"");
    expect(table).toContain(':loading="secretRevealBusyKey === record.key"');
  });

  it("keeps the dashboard rail compact", () => {
    const source = componentSource("src/components/SectionContainerShell.vue");

    expect(source).toContain("grid-template-columns: minmax(10rem, 11.5rem) minmax(0, 1fr)");
    expect(source).toContain("padding-left: 0.75rem");
  });
});

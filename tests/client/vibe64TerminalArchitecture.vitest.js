import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve("src");
const packageRoot = path.resolve("packages");
const terminalRuntimePath = path.resolve("src/composables/useVibe64Terminal.js");
const terminalElementPath = path.resolve("src/components/studio/Vibe64Terminal.vue");
const terminalSurfacePath = path.resolve("src/components/studio/Vibe64TerminalSurface.vue");

function clientSourceFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(root, {
    withFileTypes: true
  })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...clientSourceFiles(entryPath));
    } else if (/\.(?:js|vue)$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

describe("Vibe64 terminal architecture", () => {
  it("keeps direct xterm construction inside the canonical runtime", () => {
    const owners = [
      ...clientSourceFiles(sourceRoot),
      ...clientSourceFiles(packageRoot)
    ].filter((filePath) => /new\s+terminalLibrary\.Terminal\s*\(/u.test(readFileSync(filePath, "utf8")));

    expect(owners).toEqual([terminalRuntimePath]);
  });

  it("has one public terminal element and no superseded terminal shells", () => {
    expect(existsSync(terminalElementPath)).toBe(true);
    for (const legacyPath of [
      "src/components/studio/CodexSessionTerminal.vue",
      "src/components/studio/Vibe64CommandTerminal.vue",
      "src/components/studio/Vibe64FixCodexTerminal.vue",
      "src/components/studio/Vibe64FloatingTerminalWindow.vue",
      "src/components/studio/Vibe64TerminalFrame.vue",
      "src/components/studio/doctor/DoctorTerminalDialog.vue",
      "src/components/studio/vibe64-session/Vibe64HeadlessCommandOutput.vue",
      "src/composables/useCodexTerminalElement.js",
      "src/composables/useStudioTerminal.js"
    ]) {
      expect(existsSync(path.resolve(legacyPath)), legacyPath).toBe(false);
    }
  });

  it("keeps terminal failures behind an accessible inline disclosure", () => {
    const source = readFileSync(terminalSurfacePath, "utf8");
    const errorToggle = source.match(/<v-btn\n\s+v-if="error"[\s\S]*?\/>/u)?.[0] || "";
    const errorDetails = source.match(/<div\n\s+v-if="error"\n\s+v-show="errorDetailsOpen"[\s\S]*?<\/div>/u)?.[0] || "";
    const terminalStage = source.match(/<div class="vibe64-terminal-surface__stage">[\s\S]*?<footer/u)?.[0] || "";

    expect(errorToggle).toContain(":aria-controls=\"errorDetailsId\"");
    expect(errorToggle).toContain(":aria-expanded=\"String(errorDetailsOpen)\"");
    expect(errorToggle).toContain(":aria-label=\"errorDetailsToggleLabel\"");
    expect(errorToggle).toContain(":icon=\"mdiAlertCircleOutline\"");
    expect(errorToggle).toContain("color=\"error\"");
    expect(errorDetails).toContain(":id=\"errorDetailsId\"");
    expect(errorDetails).toContain("<StudioErrorNotice");
    expect(errorDetails).not.toContain("overlay");
    expect(terminalStage).not.toContain("<StudioErrorNotice");
    expect(source).toContain("class=\"d-sr-only\" role=\"alert\"");
    expect(source).toContain("const errorDetailsOpen = ref(false);");
    expect(source).toContain("errorDetailsOpen.value = false;\n  emit(\"retry\");");
  });
});

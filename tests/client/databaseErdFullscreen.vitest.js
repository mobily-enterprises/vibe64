import { readFileSync } from "node:fs";

import { compile } from "@vue/compiler-dom";
import { parse } from "@vue/compiler-sfc";
import { describe, expect, it } from "vitest";

const componentPath = new URL(
  "../../packages/vibe64-database-tools/src/client/components/DatabaseErd.vue",
  import.meta.url
);
const nodePath = new URL(
  "../../packages/vibe64-database-tools/src/client/components/DatabaseErdNode.vue",
  import.meta.url
);
const componentSource = readFileSync(componentPath, "utf8");
const nodeSource = readFileSync(nodePath, "utf8");
const { descriptor } = parse(componentSource, { filename: componentPath.pathname });

describe("Database ERD fullscreen controls", () => {
  it("compiles the diagram controls", () => {
    const template = descriptor.template.content;

    expect(() => compile(template, { mode: "module" })).not.toThrow();
    expect(template).not.toContain("Entity relationship diagram");
    expect(template).not.toContain("Arrows run 1 → N");
    expect(template).toContain('aria-label="ERD controls" class="database-erd__toolbar"');
    expect(template).toContain('aria-label="Fit"');
    expect(template).toContain('aria-label="Diagram options"');
    expect(template.indexOf("Fit")).toBeLessThan(template.indexOf("Reset positions"));
  });

  it("keeps exploration controls and their dialogs inside native fullscreen", () => {
    expect(componentSource).toContain("requestFullscreen()");
    expect(componentSource).toContain('addEventListener("fullscreenchange", onFullscreenChange)');
    expect(componentSource).toContain('removeEventListener("fullscreenchange", onFullscreenChange)');
    expect(componentSource).toContain("globalThis.requestAnimationFrame(fitDiagram)");
    expect(componentSource).toContain('v-model="viewDialog" :attach="erdRoot"');
    expect(componentSource).toContain('v-model="groupDialog" :attach="erdRoot"');
    expect(nodeSource).toContain('v-if="controlsVisible"');
    expect(nodeSource).toContain(':position="port.position"');
    expect(nodeSource).toContain(':type="port.type"');
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Vibe64LocalAppIndex", () => {
  it("uses the shared project selection gate instead of auto-selecting a project", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "src/components/studio/Vibe64LocalAppIndex.vue"),
      "utf8"
    );

    expect(source).toContain("ProjectSelectionGate");
    expect(source).toContain("force-picker");
    expect(source).toContain("navigate-on-select");
    expect(source).not.toContain("useVibe64ProjectsResource");
    expect(source).not.toContain("router.replace");
    expect(source).not.toContain("targetProjectSlug");
    expect(source).not.toContain("watch(");
    expect(source).not.toContain("v-for=\"project");
  });
});

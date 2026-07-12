import { describe, expect, it } from "vitest";

import {
  DIRECTORY_ELEVATION_STEP,
  isVisuallyLargeFile,
  layoutFileCity,
  layoutSubsystemSky,
  SUBSYSTEM_SKY_ELEVATION,
  topLevelPrecincts
} from "../../packages/vibe64-system-graph/src/client/world/worldLayout.js";

function file(path, lines, options = {}) {
  return {
    executionSide: options.executionSide || "unknown",
    id: `file:${path}`,
    key: `key:${path}`,
    lines,
    path,
    subsystemDescription: options.subsystemDescription || "",
    subsystemId: options.subsystemId || "",
    subsystemTitle: options.subsystemTitle || ""
  };
}

describe("File City layout", () => {
  it("deterministically turns nested directories into fenced rectangular precincts", () => {
    const overview = {
      files: [
        file("packages/terminal/src/server/largeTerminalService.js", 1_800),
        file("packages/terminal/src/server/helper.js", 40),
        file("src/client/App.vue", 220),
        file("README.md", 90)
      ]
    };
    const first = layoutFileCity(overview);
    const second = layoutFileCity(overview);
    expect(second).toEqual(first);
    expect(first.campuses.map((campus) => campus.id)).toEqual(["repository"]);
    expect(first.directories.map((directory) => directory.path)).toEqual(expect.arrayContaining([
      "packages",
      "packages/terminal",
      "packages/terminal/src",
      "packages/terminal/src/server",
      "src/client"
    ]));
    expect(first.directories.every((directory) => directory.width > 0 && directory.depth > 0)).toBe(true);
    expect(first.files).toHaveLength(4);
    const packageDirectory = first.directories.find((directory) => directory.path === "packages");
    const serverDirectory = first.directories.find((directory) => directory.path === "packages/terminal/src/server");
    const largeService = first.files.find((entry) => entry.path.endsWith("largeTerminalService.js"));
    expect(serverDirectory.elevation - packageDirectory.elevation).toBe(DIRECTORY_ELEVATION_STEP * 3);
    expect(largeService.elevation).toBe(serverDirectory.elevation);
  });

  it("uses physical line count for both building footprint and exceptional height signalling", () => {
    const city = layoutFileCity({
      files: [
        file("src/tiny.js", 8),
        file("src/enormous.js", 1_800),
        file("src/helper.js", 55)
      ]
    });
    const tiny = city.files.find((entry) => entry.id === "file:src/tiny.js");
    const enormous = city.files.find((entry) => entry.id === "file:src/enormous.js");
    expect(enormous.cityWidth * enormous.cityDepth).toBeGreaterThan(tiny.cityWidth * tiny.cityDepth * 5);
    expect(isVisuallyLargeFile(enormous.lines, city.lineStats.largest)).toBe(true);
  });

  it("promotes adapter-defined directories to campuses and leaves everything else on the main campus", () => {
    const subsystem = {
      subsystemDescription: "Owns terminal commands.",
      subsystemId: "subsystem:terminal",
      subsystemTitle: "Terminal"
    };
    const campuses = topLevelPrecincts({
      adapter: {
        fileCity: {
          campuses: [
            { id: "application", roots: ["src"], title: "Application" },
            { id: "packages", roots: ["packages"], title: "Packages" }
          ]
        }
      },
      files: [
        file("packages/terminal/server.js", 500, subsystem),
        file("packages/terminal/client.js", 200, subsystem),
        file("src/main.js", 100),
        file("README.md", 20)
      ]
    });
    expect(campuses.map((campus) => campus.id)).toEqual(["main", "application", "packages"]);
    const packages = campuses.find((campus) => campus.id === "packages");
    expect(packages.fileCount).toBe(2);
    expect(packages.lines).toBe(700);
    expect(packages.subsystems).toEqual([expect.objectContaining({ title: "Terminal" })]);
    expect(campuses.find((campus) => campus.id === "main").largestFile.path).toBe("README.md");
  });

  it("keeps promoted campus slabs close while preserving a visible void", () => {
    const city = layoutFileCity({
      adapter: {
        fileCity: {
          campuses: [
            { id: "application", roots: ["src"], title: "Application" },
            { id: "packages", roots: ["packages"], title: "Packages" }
          ]
        }
      },
      files: [
        file("README.md", 20),
        file("src/main.js", 100),
        file("packages/terminal/server.js", 500)
      ]
    });
    for (let index = 1; index < city.campuses.length; index += 1) {
      const previous = city.campuses[index - 1];
      const current = city.campuses[index];
      const gap = current.x - current.width / 2 - (previous.x + previous.width / 2);
      expect(gap).toBeCloseTo(72, 8);
    }
  });

  it("makes genuinely large files visually exceptional even in a repository with larger outliers", () => {
    expect(isVisuallyLargeFile(1611, 5000)).toBe(true);
    expect(isVisuallyLargeFile(520, 700)).toBe(true);
    expect(isVisuallyLargeFile(420, 700)).toBe(false);
  });

  it("places deterministic subsystem islands above their physical anchors without overlap", () => {
    const city = layoutFileCity({
      files: [
        file("src/pages/index.vue", 120),
        file("src/pages/projects/[slug].vue", 80),
        file("packages/terminal/src/server/service.js", 500)
      ]
    });
    const subsystems = [
      {
        id: "subsystem:web-site",
        title: "Web site app",
        lines: 200,
        fileCount: 2,
        capabilities: [{ id: "web-page:/" }],
        anchors: [{ kind: "directory", path: "src/pages", relation: "owns" }]
      },
      {
        id: "subsystem:terminal",
        title: "Terminal",
        lines: 500,
        fileCount: 1,
        capabilities: [],
        anchors: [{ kind: "file", path: "packages/terminal/src/server/service.js", relation: "implements" }]
      }
    ];
    const first = layoutSubsystemSky(city, subsystems);
    const second = layoutSubsystemSky(city, subsystems);

    expect(second).toEqual(first);
    expect(first.elevation).toBe(SUBSYSTEM_SKY_ELEVATION);
    expect(first.subsystems.every((subsystem) => subsystem.y === SUBSYSTEM_SKY_ELEVATION)).toBe(true);
    expect(first.subsystems.find((subsystem) => subsystem.id === "subsystem:web-site").targets).toEqual([
      expect.objectContaining({ kind: "directory", path: "src/pages", relation: "owns" })
    ]);
    const [left, right] = first.subsystems;
    expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeGreaterThanOrEqual(
      left.radius + right.radius + 34
    );
  });
});

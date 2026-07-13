import { describe, expect, it } from "vitest";

import {
  DIRECTORY_ELEVATION_STEP,
  FILE_BUILDING_HEIGHT_MAX,
  fileBuildingHeight,
  isVisuallyLargeFile,
  layoutFileCity,
  layoutSubsystemConnectionBundles,
  layoutSubsystemSky,
  SUBSYSTEM_STRATUM_HEIGHT_MULTIPLIER,
  SUBSYSTEM_STRATUM_MIN_SEPARATION,
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

  it("lowers every owned physical piece while preserving nested directory support", () => {
    const core = {
      subsystemDescription: "Shared primitives.",
      subsystemId: "subsystem:core",
      subsystemTitle: "Core"
    };
    const feature = {
      subsystemDescription: "A nested feature.",
      subsystemId: "subsystem:feature",
      subsystemTitle: "Feature"
    };
    const city = layoutFileCity({
      files: [
        file("packages/core/src/deepFreeze.js", 1_800, core),
        file("packages/core/src/feature/service.js", 120, feature),
        file("src/shared/client.js", 80, core)
      ],
      subsystems: [{
        anchors: [
          { kind: "directory", path: "packages/core", relation: "owns" },
          { kind: "directory", path: "src/shared", relation: "owns" }
        ],
        depth: 2,
        id: "subsystem:core"
      }, {
        anchors: [{ kind: "directory", path: "packages/core/src/feature", relation: "owns" }],
        depth: 0,
        id: "subsystem:feature"
      }]
    });

    const coreBase = city.directories.find((directory) => directory.path === "packages/core");
    const coreDirectory = city.directories.find((directory) => directory.path === "packages/core/src");
    const scatteredDirectory = city.directories.find((directory) => directory.path === "src/shared");
    const nestedFeature = city.directories.find((directory) => directory.path === "packages/core/src/feature");
    const coreFile = city.files.find((entry) => entry.path.endsWith("deepFreeze.js"));
    const featureFile = city.files.find((entry) => entry.path.endsWith("feature/service.js"));

    const secondLayer = city.subsystemStrata[1];
    const thirdLayer = city.subsystemStrata[2];

    expect(city.subsystemStrata).toHaveLength(5);
    expect(thirdLayer.separationFromAbove).toBeGreaterThanOrEqual(
      thirdLayer.contentHeight * SUBSYSTEM_STRATUM_HEIGHT_MULTIPLIER
    );
    expect(thirdLayer.separationFromAbove).toBeGreaterThan(SUBSYSTEM_STRATUM_MIN_SEPARATION);
    expect(thirdLayer.offset).toBe(secondLayer.offset + thirdLayer.separationFromAbove);
    expect(coreDirectory.generatedElevation - coreDirectory.elevation).toBe(thirdLayer.offset);
    expect(scatteredDirectory.generatedElevation - scatteredDirectory.elevation).toBe(thirdLayer.offset);
    expect(coreFile.elevation).toBe(coreDirectory.elevation);
    expect(coreFile.buildingHeight).toBe(fileBuildingHeight(coreFile.lines, city.lineStats.largest));
    expect(featureFile.elevation).toBe(nestedFeature.elevation);
    expect(nestedFeature.supportElevation).toBe(nestedFeature.elevation - DIRECTORY_ELEVATION_STEP);
    expect(nestedFeature.terraceHeight).toBe(DIRECTORY_ELEVATION_STEP);
    expect(secondLayer.separationFromAbove).toBe(SUBSYSTEM_STRATUM_MIN_SEPARATION);
    expect(FILE_BUILDING_HEIGHT_MAX).toBeGreaterThan(300);
    expect(city.directories.every((directory) => directory.terraceHeight === DIRECTORY_ELEVATION_STEP)).toBe(true);
    expect(city.campuses[0].subsystemDepths).toEqual([0, 2]);
    expect(city.campuses[0].subsystemStrata.map((stratum) => stratum.depth)).toEqual([0, 2]);
    expect(coreBase.subsystemBase).toBe(true);
    expect(coreDirectory.subsystemBase).toBe(false);
    expect(scatteredDirectory.subsystemBase).toBe(true);
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
        dependencies: {
          external: [{
            fileCount: 2,
            importCount: 3,
            kind: "package",
            packageId: "vue",
            sourceFileIds: ["file:src/pages/index.vue"],
            title: "vue"
          }],
          incoming: [],
          outgoing: [{
            declared: true,
            fileCount: 1,
            importCount: 2,
            sourceFileIds: ["file:src/pages/index.vue"],
            subsystemId: "subsystem:terminal",
            title: "Terminal"
          }]
        },
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
    expect(first.dependencyEdges).toEqual([
      expect.objectContaining({
        fromSubsystemId: "subsystem:web-site",
        importCount: 2,
        sourceFileIds: ["file:src/pages/index.vue"],
        toSubsystemId: "subsystem:terminal"
      })
    ]);
    expect(first.externalSatellites).toEqual([
      expect.objectContaining({
        kind: "package",
        ownerSubsystemId: "subsystem:web-site",
        packageId: "vue",
        sourceFileIds: ["file:src/pages/index.vue"]
      })
    ]);
    const [left, right] = first.subsystems;
    expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeGreaterThanOrEqual(
      left.radius + right.radius + 34
    );
  });

  it("collects repeated subsystem usage at one owned directory before the exact last mile", () => {
    const city = layoutFileCity({
      files: [
        file("packages/core/src/deepFreeze.js", 30),
        file("packages/terminals/src/client/session.js", 80),
        file("packages/terminals/src/server/service.js", 120)
      ]
    });
    const providerFileId = "file:packages/core/src/deepFreeze.js";
    const consumerFileIds = [
      "file:packages/terminals/src/client/session.js",
      "file:packages/terminals/src/server/service.js"
    ];
    const subsystemLayout = {
      dependencyEdges: [{
        fileConnections: consumerFileIds.map((fromFileId) => ({
          connectionCount: 1,
          fromFileId,
          kinds: ["import"],
          symbols: ["deepFreeze"],
          toFileId: providerFileId
        })),
        fromSubsystemId: "subsystem:terminals",
        id: "subsystem:terminals->subsystem:core",
        toSubsystemId: "subsystem:core"
      }],
      subsystems: [
        {
          anchors: [{ kind: "directory", path: "packages/terminals", relation: "owns" }],
          id: "subsystem:terminals",
          title: "Vibe64 terminals"
        },
        {
          anchors: [{ kind: "directory", path: "packages/core", relation: "owns" }],
          id: "subsystem:core",
          title: "Vibe64 core"
        }
      ]
    };

    expect(layoutSubsystemConnectionBundles(city, subsystemLayout, "subsystem:core")).toEqual([
      expect.objectContaining({
        collectionKind: "directory",
        collectionPath: "packages/terminals/src",
        consumerFileIds,
        consumerSubsystemId: "subsystem:terminals",
        providerFileIds: [providerFileId],
        providerSubsystemId: "subsystem:core",
        reference: "deepFreeze",
        usageCount: 2
      })
    ]);
  });

  it("draws separate collection points for disconnected owned pieces and unanchored files", () => {
    const city = layoutFileCity({
      files: [
        file("packages/core/src/helper.js", 30),
        file("src/feature-a/client.js", 80),
        file("src/feature-b/server.js", 120),
        file("strays/legacy.js", 60)
      ]
    });
    const providerFileId = "file:packages/core/src/helper.js";
    const consumerFileIds = [
      "file:src/feature-a/client.js",
      "file:src/feature-b/server.js",
      "file:strays/legacy.js"
    ];
    const subsystemLayout = {
      dependencyEdges: [{
        fileConnections: consumerFileIds.map((fromFileId) => ({
          connectionCount: 1,
          fromFileId,
          kinds: ["import"],
          symbols: ["sharedHelper"],
          toFileId: providerFileId
        })),
        fromSubsystemId: "subsystem:scattered",
        id: "subsystem:scattered->subsystem:core",
        toSubsystemId: "subsystem:core"
      }],
      subsystems: [
        {
          anchors: [
            { kind: "directory", path: "src/feature-a", relation: "owns" },
            { kind: "directory", path: "src/feature-b", relation: "owns" }
          ],
          id: "subsystem:scattered",
          title: "Scattered feature"
        },
        {
          anchors: [{ kind: "directory", path: "packages/core", relation: "owns" }],
          id: "subsystem:core",
          title: "Vibe64 core"
        }
      ]
    };

    const bundles = layoutSubsystemConnectionBundles(city, subsystemLayout, "subsystem:core");
    expect(bundles).toHaveLength(3);
    expect(bundles).toEqual(expect.arrayContaining([
      expect.objectContaining({ collectionKind: "directory", collectionPath: "src/feature-a" }),
      expect.objectContaining({ collectionKind: "directory", collectionPath: "src/feature-b" }),
      expect.objectContaining({
        collectionFileId: "file:strays/legacy.js",
        collectionKind: "file",
        collectionPath: "strays/legacy.js"
      })
    ]));
    expect(bundles.every((bundle) => bundle.usageCount === 1)).toBe(true);
  });
});

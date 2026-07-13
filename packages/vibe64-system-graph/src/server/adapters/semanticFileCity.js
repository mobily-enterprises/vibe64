import path from "node:path";

import {
  normalizeFileCityPath
} from "../../shared/fileCityContract.js";

const WEB_ROUTE_EXTENSIONS = Object.freeze([
  ".astro",
  ".cjs",
  ".html",
  ".js",
  ".jsx",
  ".mdx",
  ".mjs",
  ".svelte",
  ".ts",
  ".tsx",
  ".vue"
]);

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => String(selector(left)).localeCompare(String(selector(right))));
}

function pathInside(rootPath = "", candidatePath = "") {
  const root = normalizeFileCityPath(rootPath);
  const candidate = normalizeFileCityPath(candidatePath);
  return Boolean(root && candidate) && (candidate === root || candidate.startsWith(`${root}/`));
}

function parentDirectory(filePath = "") {
  const directory = path.posix.dirname(normalizeFileCityPath(filePath));
  return directory === "." ? "" : directory;
}

function fileName(filePath = "") {
  return path.posix.basename(normalizeFileCityPath(filePath));
}

function fileStem(filePath = "") {
  const name = fileName(filePath);
  if (name.endsWith(".blade.php")) {
    return name.slice(0, -".blade.php".length);
  }
  const extension = path.posix.extname(name);
  return extension ? name.slice(0, -extension.length) : name;
}

function hasExtension(filePath = "", extensions = []) {
  const normalized = String(filePath || "").toLowerCase();
  return extensions.some((extension) => normalized.endsWith(String(extension).toLowerCase()));
}

function directoryPaths(files = []) {
  const directories = new Set();
  for (const file of files) {
    let current = parentDirectory(file.path);
    while (current) {
      directories.add(current);
      const parent = parentDirectory(current);
      if (!parent || parent === current) {
        break;
      }
      current = parent;
    }
  }
  return directories;
}

function routeTitle(rootPath = "", groupPath = "") {
  const root = normalizeFileCityPath(rootPath);
  const group = normalizeFileCityPath(groupPath);
  const relative = pathInside(root, group) ? group.slice(root.length).replace(/^\//u, "") : group;
  const segments = relative
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\(.+\)$/u.test(segment) && !segment.startsWith("@"));
  return `/${segments.join("/")}`;
}

function groupTitle(groupPath = "") {
  return fileName(groupPath) || groupPath || "Root";
}

function createTopologyCollector(adapterId = "") {
  const groupsByPath = new Map();
  const placementsByFileId = new Map();

  function ensureGroup(groupPath, {
    kind = "semantic-container",
    title = ""
  } = {}) {
    const normalizedPath = normalizeFileCityPath(groupPath);
    const existing = groupsByPath.get(normalizedPath);
    if (existing) {
      return existing;
    }
    const group = {
      id: `${adapterId}:file-city:${kind}:${normalizedPath}`,
      kind,
      origin: "derived",
      parentId: "",
      path: normalizedPath,
      title: String(title || groupTitle(normalizedPath))
    };
    groupsByPath.set(normalizedPath, group);
    return group;
  }

  function place(file, groupPath, {
    frameworkRole = "member",
    kind = "semantic-container",
    role = "supporting",
    title = ""
  } = {}) {
    if (!file?.id || placementsByFileId.has(file.id) || !normalizeFileCityPath(groupPath)) {
      return;
    }
    const group = ensureGroup(groupPath, { kind, title });
    placementsByFileId.set(file.id, {
      fileId: file.id,
      frameworkRole,
      groupId: group.id,
      origin: "derived",
      role,
      visualParentPath: group.path
    });
  }

  function finish() {
    for (const group of groupsByPath.values()) {
      let candidatePath = parentDirectory(group.path);
      while (candidatePath) {
        const parent = groupsByPath.get(candidatePath);
        if (parent) {
          group.parentId = parent.id;
          break;
        }
        const nextPath = parentDirectory(candidatePath);
        if (!nextPath || nextPath === candidatePath) {
          break;
        }
        candidatePath = nextPath;
      }
    }
    return {
      groups: stableSort(groupsByPath.values(), (group) => group.path),
      placements: stableSort(placementsByFileId.values(), (placement) => placement.fileId)
    };
  }

  return {
    finish,
    place
  };
}

function activeFileCityCampuses(campuses = [], files = []) {
  return campuses.map((campus) => ({
    ...campus,
    roots: (campus.roots || []).filter((root) => (
      files.some((file) => pathInside(root, file.path))
    ))
  })).filter((campus) => campus.roots.length > 0);
}

function addCompanionRouteTopology(collector, files, {
  extensions = WEB_ROUTE_EXTENSIONS,
  roots = []
} = {}) {
  const knownDirectories = directoryPaths(files);
  for (const file of stableSort(files, (entry) => entry.path)) {
    const root = roots.find((candidate) => pathInside(candidate, file.path));
    if (!root || !hasExtension(file.path, extensions)) {
      continue;
    }
    const physicalParent = parentDirectory(file.path);
    const stem = fileStem(file.path);
    const companionPath = normalizeFileCityPath(`${physicalParent}/${stem}`);
    const hasCompanionDirectory = stem !== "index" && knownDirectories.has(companionPath);
    const visualParentPath = hasCompanionDirectory ? companionPath : physicalParent;
    const privateBoundary = stem === "_app" || stem === "_document" || stem === "_middleware";
    const role = hasCompanionDirectory || privateBoundary
      ? "boundary"
      : stem === "index" || !stem.startsWith("_")
        ? "primary"
        : "supporting";
    collector.place(file, visualParentPath, {
      frameworkRole: hasCompanionDirectory
        ? "route-shell"
        : stem === "index"
          ? "route-index"
          : privateBoundary
            ? "router-boundary"
            : "route-page",
      kind: "route",
      role,
      title: routeTitle(root, visualParentPath)
    });
  }
}

function addNextAppRouterTopology(collector, files, roots = []) {
  const roles = new Map([
    ["layout", ["boundary", "route-layout"]],
    ["template", ["boundary", "route-template"]],
    ["page", ["primary", "route-page"]],
    ["route", ["primary", "route-handler"]],
    ["default", ["primary", "parallel-route-default"]],
    ["loading", ["supporting", "loading-state"]],
    ["error", ["supporting", "error-boundary"]],
    ["global-error", ["supporting", "global-error-boundary"]],
    ["not-found", ["supporting", "not-found-state"]]
  ]);
  for (const file of stableSort(files, (entry) => entry.path)) {
    const root = roots.find((candidate) => pathInside(candidate, file.path));
    const role = roles.get(fileStem(file.path));
    if (!root || !role || !hasExtension(file.path, WEB_ROUTE_EXTENSIONS)) {
      continue;
    }
    const groupPath = parentDirectory(file.path);
    collector.place(file, groupPath, {
      frameworkRole: role[1],
      kind: "route",
      role: role[0],
      title: routeTitle(root, groupPath)
    });
  }
}

function addLaravelTopology(collector, files) {
  for (const file of stableSort(files, (entry) => entry.path)) {
    const filePath = normalizeFileCityPath(file.path);
    let role = "supporting";
    let frameworkRole = "implementation";
    let kind = "framework-layer";
    if (pathInside("routes", filePath)) {
      role = "primary";
      frameworkRole = "route-registration";
      kind = "route";
    } else if (pathInside("app/Http/Middleware", filePath)) {
      role = "boundary";
      frameworkRole = "http-middleware";
    } else if (pathInside("app/Http/Controllers", filePath) && /Controller\.php$/u.test(filePath)) {
      role = "primary";
      frameworkRole = "controller";
    } else if (pathInside("app/Http/Requests", filePath)) {
      frameworkRole = "request-validator";
    } else if (pathInside("app/Http/Resources", filePath)) {
      frameworkRole = "response-resource";
    } else if (pathInside("app/Models", filePath)) {
      role = "primary";
      frameworkRole = "model";
      kind = "domain";
    } else if (pathInside("resources/views/layouts", filePath)) {
      role = "boundary";
      frameworkRole = "view-layout";
      kind = "view";
    } else if (pathInside("resources/views", filePath)) {
      role = "primary";
      frameworkRole = "view";
      kind = "view";
    } else if (pathInside("database/migrations", filePath)) {
      role = "primary";
      frameworkRole = "migration";
      kind = "data";
    } else if (pathInside("database", filePath)) {
      frameworkRole = "database-support";
      kind = "data";
    } else {
      continue;
    }
    const groupPath = parentDirectory(filePath);
    collector.place(file, groupPath, {
      frameworkRole,
      kind,
      role,
      title: groupTitle(groupPath)
    });
  }
}

function addNodeWebTopology(collector, files) {
  addCompanionRouteTopology(collector, files, {
    roots: ["src/pages", "pages", "src/routes", "routes", "src/views", "views"]
  });
  for (const file of stableSort(files, (entry) => entry.path)) {
    const filePath = normalizeFileCityPath(file.path);
    if (!pathInside("src/controllers", filePath) && !pathInside("controllers", filePath)) {
      continue;
    }
    collector.place(file, parentDirectory(filePath), {
      frameworkRole: "controller",
      kind: "http-controller",
      role: "primary",
      title: groupTitle(parentDirectory(filePath))
    });
  }
}

function addCppTopology(collector, files) {
  const headerExtensions = [".h", ".hh", ".hpp", ".hxx"];
  const sourceExtensions = [".c", ".cc", ".cpp", ".cxx", ".m", ".mm"];
  for (const file of stableSort(files, (entry) => entry.path)) {
    const filePath = normalizeFileCityPath(file.path);
    const isHeader = hasExtension(filePath, headerExtensions);
    const isSource = hasExtension(filePath, sourceExtensions);
    if (!isHeader && !isSource) {
      continue;
    }
    const groupPath = parentDirectory(filePath);
    collector.place(file, groupPath, {
      frameworkRole: isHeader ? "public-contract" : "implementation-unit",
      kind: "native-module",
      role: isHeader ? "boundary" : "primary",
      title: groupTitle(groupPath)
    });
  }
}

function buildSemanticFileCity({
  adapterId,
  campuses = [],
  files = []
} = {}) {
  const collector = createTopologyCollector(adapterId);
  if (adapterId === "jskit") {
    addCompanionRouteTopology(collector, files, {
      roots: ["src/pages"]
    });
  } else if (adapterId === "nextjs" || adapterId === "vinext") {
    addNextAppRouterTopology(collector, files, ["app", "src/app"]);
    addCompanionRouteTopology(collector, files, {
      roots: ["pages", "src/pages"]
    });
  } else if (adapterId === "laravel") {
    addLaravelTopology(collector, files);
  } else if (adapterId === "node-web") {
    addNodeWebTopology(collector, files);
  } else if (adapterId === "cpp") {
    addCppTopology(collector, files);
  }
  return {
    campuses,
    ...collector.finish()
  };
}

export {
  WEB_ROUTE_EXTENSIONS,
  activeFileCityCampuses,
  buildSemanticFileCity
};

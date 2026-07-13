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

function routeSegmentDetails(segment = "", { root = false } = {}) {
  const sourceSegment = String(segment || "").trim();
  if (root || !sourceSegment || sourceSegment === "__root") {
    return {
      routeSegment: sourceSegment,
      segmentKind: "root",
      urlEffect: "root",
      urlSegment: ""
    };
  }
  if (sourceSegment === "index" || sourceSegment === "_index") {
    return {
      routeSegment: sourceSegment,
      segmentKind: "index",
      urlEffect: "transparent",
      urlSegment: ""
    };
  }
  if (sourceSegment.startsWith("@")) {
    return {
      routeSegment: sourceSegment,
      segmentKind: "parallel",
      urlEffect: "parallel",
      urlSegment: ""
    };
  }
  const intercepted = sourceSegment.match(/^(?:\(\.\)|\(\.\.\)|\(\.\.\.\))+(.*)$/u);
  if (intercepted) {
    return {
      routeSegment: sourceSegment,
      segmentKind: "intercepted",
      urlEffect: "intercepted",
      urlSegment: intercepted[1] || sourceSegment
    };
  }
  const optionalCatchAll = sourceSegment.match(/^\[\[\.\.\.([^\]]+)\]\]$/u);
  if (optionalCatchAll) {
    return {
      routeSegment: sourceSegment,
      segmentKind: "optional-catch-all",
      urlEffect: "segment",
      urlSegment: `*${optionalCatchAll[1]}?`
    };
  }
  const catchAll = sourceSegment.match(/^\[\.\.\.([^\]]+)\]$/u);
  if (catchAll) {
    return {
      routeSegment: sourceSegment,
      segmentKind: "catch-all",
      urlEffect: "segment",
      urlSegment: `*${catchAll[1]}`
    };
  }
  const optionalBracket = sourceSegment.match(/^\[\[([^\]]+)\]\]$/u);
  const optionalDollar = sourceSegment.match(/^\(\$([^\)]+)\)$/u);
  if (optionalBracket || optionalDollar) {
    return {
      routeSegment: sourceSegment,
      segmentKind: "optional",
      urlEffect: "segment",
      urlSegment: `:${(optionalBracket || optionalDollar)[1]}?`
    };
  }
  const dynamicBracket = sourceSegment.match(/^\[([^\]]+)\]$/u);
  const dynamicDollar = sourceSegment.match(/^\$([^$].*)$/u);
  if (sourceSegment === "$" || dynamicBracket || dynamicDollar) {
    const parameter = dynamicBracket?.[1] || dynamicDollar?.[1] || "";
    return {
      routeSegment: sourceSegment,
      segmentKind: sourceSegment === "$" ? "catch-all" : "dynamic",
      urlEffect: "segment",
      urlSegment: sourceSegment === "$" ? "*" : `:${parameter}`
    };
  }
  if (/^\(.+\)$/u.test(sourceSegment) || /^_[^_]/u.test(sourceSegment)) {
    return {
      routeSegment: sourceSegment,
      segmentKind: "pathless",
      urlEffect: "transparent",
      urlSegment: ""
    };
  }
  return {
    routeSegment: sourceSegment,
    segmentKind: "static",
    urlEffect: "segment",
    urlSegment: sourceSegment.replace(/_$/u, "")
  };
}

function routeGroupDetails(rootPath = "", groupPath = "") {
  const root = normalizeFileCityPath(rootPath);
  const group = normalizeFileCityPath(groupPath);
  const relative = pathInside(root, group) ? group.slice(root.length).replace(/^\//u, "") : group;
  const sourceSegments = relative.split("/").filter(Boolean);
  const segmentDetails = sourceSegments.map((segment) => routeSegmentDetails(segment));
  const routePath = `/${segmentDetails.map((segment) => segment.urlSegment).filter(Boolean).join("/")}`;
  const leaf = segmentDetails.at(-1) || routeSegmentDetails("", { root: true });
  const title = ["parallel", "transparent"].includes(leaf.urlEffect) && leaf.routeSegment
    ? `${routePath} · ${leaf.routeSegment}`
    : routePath;
  return {
    routePath,
    routeSegment: leaf.routeSegment,
    segmentKind: leaf.segmentKind,
    title,
    urlEffect: leaf.urlEffect
  };
}

function routeTitle(rootPath = "", groupPath = "") {
  return routeGroupDetails(rootPath, groupPath).title;
}

function groupTitle(groupPath = "") {
  return fileName(groupPath) || groupPath || "Root";
}

function createTopologyCollector(adapterId = "") {
  const groupsByPath = new Map();
  const placementsByFileId = new Map();

  function ensureGroup(groupPath, {
    kind = "semantic-container",
    title = "",
    ...metadata
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
      title: String(title || groupTitle(normalizedPath)),
      ...metadata
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
    ensureGroup,
    finish,
    place
  };
}

function ensureRouteHierarchy(collector, rootPath = "", groupPath = "") {
  const root = normalizeFileCityPath(rootPath);
  const group = normalizeFileCityPath(groupPath);
  if (!pathInside(root, group)) {
    return;
  }
  const relativeSegments = group.slice(root.length).replace(/^\//u, "").split("/").filter(Boolean);
  const hierarchyPaths = [root];
  for (let index = 1; index <= relativeSegments.length; index += 1) {
    hierarchyPaths.push([root, ...relativeSegments.slice(0, index)].filter(Boolean).join("/"));
  }
  for (const hierarchyPath of hierarchyPaths) {
    collector.ensureGroup(hierarchyPath, {
      kind: "route",
      ...routeGroupDetails(root, hierarchyPath)
    });
  }
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
    const privateBoundary = ["_app", "_document", "_error", "_middleware"].includes(stem);
    const visualParentPath = hasCompanionDirectory
      ? companionPath
      : stem === "index" || privateBoundary
        ? physicalParent
        : companionPath;
    const role = hasCompanionDirectory || privateBoundary
      ? "boundary"
      : stem === "index" || !stem.startsWith("_")
        ? "primary"
        : "supporting";
    ensureRouteHierarchy(collector, root, visualParentPath);
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
    ["default", ["supporting", "parallel-route-default"]],
    ["loading", ["supporting", "loading-state"]],
    ["error", ["supporting", "error-boundary"]],
    ["forbidden", ["supporting", "forbidden-state"]],
    ["global-error", ["supporting", "global-error-boundary"]],
    ["not-found", ["supporting", "not-found-state"]],
    ["unauthorized", ["supporting", "unauthorized-state"]]
  ]);
  for (const file of stableSort(files, (entry) => entry.path)) {
    const root = roots.find((candidate) => pathInside(candidate, file.path));
    const role = roles.get(fileStem(file.path));
    if (!root || !role || !hasExtension(file.path, WEB_ROUTE_EXTENSIONS)) {
      continue;
    }
    const groupPath = parentDirectory(file.path);
    ensureRouteHierarchy(collector, root, groupPath);
    collector.place(file, groupPath, {
      frameworkRole: role[1],
      kind: "route",
      role: role[0],
      title: routeTitle(root, groupPath)
    });
  }
}

function addSvelteKitTopology(collector, files, roots = []) {
  for (const file of stableSort(files, (entry) => entry.path)) {
    const root = roots.find((candidate) => pathInside(candidate, file.path));
    const stem = fileStem(file.path);
    if (!root || !stem.startsWith("+") || !hasExtension(file.path, WEB_ROUTE_EXTENSIONS)) {
      continue;
    }
    const groupPath = parentDirectory(file.path);
    let frameworkRole = "route-support";
    let role = "supporting";
    if (stem.startsWith("+layout")) {
      frameworkRole = "route-layout";
      role = "boundary";
    } else if (stem.startsWith("+page")) {
      frameworkRole = "route-page";
      role = "primary";
    } else if (stem === "+server") {
      frameworkRole = "route-handler";
      role = "primary";
    } else if (stem === "+error") {
      frameworkRole = "error-boundary";
    } else {
      continue;
    }
    ensureRouteHierarchy(collector, root, groupPath);
    collector.place(file, groupPath, {
      frameworkRole,
      kind: "route",
      role,
      title: routeTitle(root, groupPath)
    });
  }
}

function tokenizedRouteCandidate(file, rootPath, {
  folderFilesAreRoutes = true
} = {}) {
  const root = normalizeFileCityPath(rootPath);
  const filePath = normalizeFileCityPath(file.path);
  if (!pathInside(root, filePath) || !hasExtension(filePath, WEB_ROUTE_EXTENSIONS)) {
    return null;
  }
  const relativePath = filePath.slice(root.length).replace(/^\//u, "");
  const relativeParts = relativePath.split("/").filter(Boolean);
  const stem = fileStem(filePath);
  if (!stem || stem.startsWith("+") || (
    relativeParts.length > 1 && !folderFilesAreRoutes && stem !== "route"
  )) {
    return null;
  }
  const directorySegments = relativeParts.slice(0, -1).flatMap((segment) => segment.split(".").filter(Boolean));
  const routeSegments = stem === "route"
    ? directorySegments
    : [...directorySegments, ...stem.split(".").filter(Boolean)];
  const terminal = routeSegments.at(-1) || "";
  const index = terminal === "index" || terminal === "_index";
  const rootRoute = terminal === "__root";
  if (index || rootRoute) {
    routeSegments.pop();
  }
  return {
    file,
    groupPath: [root, ...routeSegments].filter(Boolean).join("/"),
    index,
    rootRoute
  };
}

function addTokenizedFileRouterTopology(collector, files, {
  folderFilesAreRoutes = true,
  root
} = {}) {
  const candidates = stableSort(files, (entry) => entry.path)
    .map((file) => tokenizedRouteCandidate(file, root, { folderFilesAreRoutes }))
    .filter(Boolean);
  const groupPaths = new Set(candidates.map((candidate) => candidate.groupPath));
  for (const candidate of candidates) {
    const hasChildren = [...groupPaths].some((groupPath) => (
      groupPath !== candidate.groupPath && groupPath.startsWith(`${candidate.groupPath}/`)
    ));
    const role = candidate.rootRoute || hasChildren ? "boundary" : "primary";
    ensureRouteHierarchy(collector, root, candidate.groupPath);
    collector.place(candidate.file, candidate.groupPath, {
      frameworkRole: candidate.rootRoute
        ? "root-layout"
        : candidate.index
          ? "route-index"
          : role === "boundary"
            ? "route-shell"
            : "route-page",
      kind: "route",
      role: candidate.index ? "primary" : role,
      title: routeTitle(root, candidate.groupPath)
    });
  }
}

function addRemixTopology(collector, files) {
  const root = "app/routes";
  const rootFile = stableSort(files, (entry) => entry.path).find((file) => (
    parentDirectory(file.path) === "app" && fileStem(file.path) === "root" &&
    hasExtension(file.path, WEB_ROUTE_EXTENSIONS)
  ));
  if (rootFile) {
    ensureRouteHierarchy(collector, root, root);
    collector.place(rootFile, root, {
      frameworkRole: "root-layout",
      kind: "route",
      role: "boundary",
      title: "/"
    });
  }
  addTokenizedFileRouterTopology(collector, files, {
    folderFilesAreRoutes: false,
    root
  });
}

function addTanStackRouterTopology(collector, files, roots = []) {
  for (const root of roots) {
    addTokenizedFileRouterTopology(collector, files, {
      folderFilesAreRoutes: true,
      root
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
      kind = "route-registration";
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
  const svelteRoots = ["src/routes"].filter((root) => files.some((file) => (
    pathInside(root, file.path) && fileName(file.path).startsWith("+")
  )));
  const tanStackRoots = ["src/routes", "routes"].filter((root) => files.some((file) => (
    parentDirectory(file.path) === root && fileStem(file.path) === "__root"
  )));
  const hasRemixRoutes = files.some((file) => pathInside("app/routes", file.path)) &&
    files.some((file) => parentDirectory(file.path) === "app" && fileStem(file.path) === "root");

  addSvelteKitTopology(collector, files, svelteRoots);
  if (hasRemixRoutes) {
    addRemixTopology(collector, files);
  }
  addTanStackRouterTopology(collector, files, tanStackRoots);

  const specializedRoots = new Set([
    ...svelteRoots,
    ...tanStackRoots,
    ...(hasRemixRoutes ? ["app/routes"] : [])
  ]);
  addCompanionRouteTopology(collector, files, {
    roots: [
      "app/pages",
      "src/pages",
      "pages",
      "src/routes",
      "routes",
      "src/views",
      "views"
    ].filter((root) => !specializedRoots.has(root))
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

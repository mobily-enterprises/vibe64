import {
  hierarchy,
  treemap,
  treemapSquarify
} from "d3-hierarchy";

const DIRECTORY_ELEVATION_STEP = 40;

function stableHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => String(selector(left)).localeCompare(String(selector(right))));
}

function isVisuallyLargeFile(lines = 0, largestDocumentLines = 0) {
  const lineCount = Math.max(0, Number(lines) || 0);
  const largest = Math.max(0, Number(largestDocumentLines) || 0);
  return lineCount >= 900 || lineCount >= Math.max(500, largest * 0.62);
}

function cityLineStats(files = []) {
  const lineCounts = files.map((file) => Math.max(0, Number(file.lines) || 0));
  return {
    files: files.length,
    largest: Math.max(0, ...lineCounts),
    smallest: lineCounts.length > 0 ? Math.min(...lineCounts) : 0,
    total: lineCounts.reduce((sum, value) => sum + value, 0)
  };
}

function createDirectory(name, directoryPath) {
  return {
    children: new Map(),
    files: [],
    name,
    path: directoryPath,
    type: "directory"
  };
}

function fileCityTree(files = [], { rootPath = "" } = {}) {
  const root = createDirectory("project", rootPath);
  for (const file of stableSort(files, (entry) => entry.path)) {
    const filePath = String(file.path || "");
    const relativePath = rootPath && filePath.startsWith(`${rootPath}/`)
      ? filePath.slice(rootPath.length + 1)
      : filePath;
    const segments = relativePath.split("/").filter(Boolean);
    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      if (!directory.children.has(segment)) {
        directory.children.set(
          segment,
          createDirectory(segment, [directory.path, segment].filter(Boolean).join("/"))
        );
      }
      directory = directory.children.get(segment);
    }
    directory.files.push(file);
  }

  function plainDirectory(directory) {
    return {
      name: directory.name,
      path: directory.path,
      type: directory.type,
      children: [
        ...stableSort(directory.children.values(), (entry) => entry.name).map(plainDirectory),
        ...stableSort(directory.files, (entry) => entry.path).map((file) => ({
          file,
          name: file.path.split("/").pop(),
          path: file.path,
          type: "file",
          weight: Math.max(8, Number(file.lines) || 0)
        }))
      ]
    };
  }

  return plainDirectory(root);
}

function directoryDetails(node) {
  const files = node.leaves().map((leaf) => leaf.data.file).filter(Boolean);
  return fileGroupDetails(files);
}

function fileGroupDetails(files = []) {
  const subsystems = new Map();
  for (const file of files) {
    if (!file.subsystemId) {
      continue;
    }
    subsystems.set(file.subsystemId, {
      description: file.subsystemDescription || "",
      id: file.subsystemId,
      title: file.subsystemTitle || file.packageId || "Unnamed subsystem"
    });
  }
  const largestFile = [...files].sort((left, right) => (
    (Number(right.lines) || 0) - (Number(left.lines) || 0) || left.path.localeCompare(right.path)
  ))[0] || null;
  return {
    fileCount: files.length,
    largestFile,
    lines: files.reduce((sum, file) => sum + (Number(file.lines) || 0), 0),
    subsystems: stableSort(subsystems.values(), (subsystem) => subsystem.title)
  };
}

function normalizedCampusDefinitions(overview = {}) {
  const declarations = Array.isArray(overview.adapter?.fileCity?.campuses)
    ? overview.adapter.fileCity.campuses
    : [];
  return declarations.map((campus, index) => ({
    description: String(campus.description || ""),
    id: String(campus.id || `campus-${index + 1}`),
    roots: stableSort(
      (Array.isArray(campus.roots) ? campus.roots : [])
        .map((root) => String(root || "").replace(/^\.\//u, "").replace(/\/+$/u, ""))
        .filter(Boolean)
    ),
    title: String(campus.title || campus.id || `Campus ${index + 1}`)
  }));
}

function campusForFile(file, declarations) {
  return declarations.find((campus) => campus.roots.some((root) => (
    file.path === root || file.path.startsWith(`${root}/`)
  ))) || null;
}

function fileCampuses(overview = {}) {
  const files = overview.files || [];
  const declarations = normalizedCampusDefinitions(overview);
  if (declarations.length === 0) {
    return [{
      description: "The complete repository tree.",
      files,
      id: "repository",
      implicit: true,
      roots: [],
      title: "Repository"
    }];
  }
  const filesByCampus = new Map(declarations.map((campus) => [campus.id, []]));
  const mainFiles = [];
  for (const file of files) {
    const campus = campusForFile(file, declarations);
    if (campus) {
      filesByCampus.get(campus.id).push(file);
    } else {
      mainFiles.push(file);
    }
  }
  return [{
    description: "Everything outside the adapter-defined campuses.",
    files: mainFiles,
    id: "main",
    implicit: true,
    roots: [],
    title: "Main Campus"
  }, ...declarations.map((campus) => ({
    ...campus,
    files: filesByCampus.get(campus.id) || [],
    implicit: false
  }))].filter((campus) => campus.files.length > 0);
}

function campusWidths(campuses, totalWidth, gap) {
  if (campuses.length <= 1) {
    return [totalWidth];
  }
  const available = Math.max(1, totalWidth - gap * (campuses.length - 1));
  const minimum = Math.min(220, available / campuses.length * 0.72);
  const distributable = Math.max(0, available - minimum * campuses.length);
  const weights = campuses.map((campus) => Math.sqrt(Math.max(1, fileGroupDetails(campus.files).lines)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  return weights.map((weight) => minimum + distributable * (weight / totalWeight));
}

function pathBelowCampusRoot(path, rootPath) {
  return rootPath && path.startsWith(`${rootPath}/`)
    ? path.slice(rootPath.length + 1)
    : path;
}

function layoutCampus(campus, {
  campusDepth,
  campusWidth,
  offsetX
} = {}) {
  const rootPath = campus.roots.length === 1 ? campus.roots[0] : "";
  const root = hierarchy(fileCityTree(campus.files, { rootPath }))
    .sum((node) => node.type === "file" ? node.weight : 0)
    .sort((left, right) => (
      (right.value || 0) - (left.value || 0) || left.data.path.localeCompare(right.data.path)
    ));

  treemap()
    .tile(treemapSquarify.ratio(1.25))
    .size([campusWidth, campusDepth])
    .paddingLeft((node) => node.depth === 0 ? 38 : 26)
    .paddingRight((node) => node.depth === 0 ? 38 : 26)
    .paddingBottom((node) => node.depth === 0 ? 38 : 26)
    .paddingInner(18)
    .paddingTop((node) => node.depth === 0 ? 38 : 32)
    .round(true)(root);

  const centerX = campusWidth / 2;
  const centerZ = campusDepth / 2;
  const directories = root.descendants()
    .filter((node) => node.children && node.depth > 0)
    .map((node) => {
      const relativePath = pathBelowCampusRoot(node.data.path, rootPath);
      return {
        ...directoryDetails(node),
        campusId: campus.id,
        campusTitle: campus.title,
        depth: Math.max(8, node.y1 - node.y0),
        district: relativePath.split("/")[0] || campus.title,
        elevation: node.depth * DIRECTORY_ELEVATION_STEP,
        hierarchyDepth: node.depth,
        name: node.data.name,
        path: node.data.path,
        width: Math.max(8, node.x1 - node.x0),
        x: offsetX + (node.x0 + node.x1) / 2 - centerX,
        z: (node.y0 + node.y1) / 2 - centerZ
      };
    });
  const files = root.leaves().map((node) => {
    const file = node.data.file;
    const relativePath = pathBelowCampusRoot(file.path, rootPath);
    const relativeSegments = relativePath.split("/").filter(Boolean);
    return {
      ...file,
      campusId: campus.id,
      campusTitle: campus.title,
      cityDepth: Math.max(5, node.y1 - node.y0 - 4),
      cityWidth: Math.max(5, node.x1 - node.x0 - 4),
      directoryDepth: node.parent?.depth || 0,
      directoryPath: node.parent?.data.path || rootPath,
      district: relativeSegments.length > 1 ? relativeSegments[0] : campus.title,
      elevation: (node.parent?.depth || 0) * DIRECTORY_ELEVATION_STEP,
      x: offsetX + (node.x0 + node.x1) / 2 - centerX,
      z: (node.y0 + node.y1) / 2 - centerZ
    };
  });
  return {
    campus: {
      ...fileGroupDetails(campus.files),
      depth: campusDepth,
      description: campus.description,
      id: campus.id,
      implicit: campus.implicit,
      kind: "campus",
      name: campus.title,
      path: campus.roots.join(", "),
      roots: campus.roots,
      title: campus.title,
      width: campusWidth,
      x: offsetX,
      z: 0
    },
    directories,
    files
  };
}

function layoutFileCity(overview = {}, {
  depth = 1_180,
  width = 3_800
} = {}) {
  const files = overview.files || [];
  const campuses = fileCampuses(overview);
  const gap = campuses.length > 1 ? 72 : 0;
  const widths = campusWidths(campuses, width, gap);
  const largestCampusFileCount = Math.max(1, ...campuses.map((campus) => campus.files.length));
  let cursorX = -width / 2;
  const layouts = campuses.map((campus, index) => {
    const campusWidth = widths[index];
    const campusDepth = campuses.length === 1
      ? depth
      : Math.max(460, depth * (0.58 + Math.sqrt(campus.files.length / largestCampusFileCount) * 0.42));
    const offsetX = cursorX + campusWidth / 2;
    cursorX += campusWidth + gap;
    return layoutCampus(campus, {
      campusDepth,
      campusWidth,
      offsetX
    });
  });

  return {
    bounds: { depth, width },
    campuses: layouts.map((layout) => layout.campus),
    directories: layouts.flatMap((layout) => layout.directories),
    files: layouts.flatMap((layout) => layout.files),
    lineStats: overview.lineStats || cityLineStats(files)
  };
}

function topLevelPrecincts(overview = {}) {
  return layoutFileCity(overview).campuses;
}

export {
  cityLineStats,
  DIRECTORY_ELEVATION_STEP,
  isVisuallyLargeFile,
  layoutFileCity,
  stableHash,
  topLevelPrecincts
};

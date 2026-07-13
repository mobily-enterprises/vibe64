import {
  hierarchy,
  treemap,
  treemapSquarify
} from "d3-hierarchy";
import {
  SUBSYSTEM_DEPTH_MAX
} from "../../shared/subsystemPresentationContract.js";

const DIRECTORY_ELEVATION_STEP = 40;
const FILE_BUILDING_HEIGHT_MAX = 322;
const SUBSYSTEM_STRATUM_HEIGHT_MULTIPLIER = 2;
const SUBSYSTEM_STRATUM_MIN_SEPARATION = 520;
const SUBSYSTEM_SKY_ELEVATION = 720;

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

function fileBuildingHeight(lines = 0, largestDocumentLines = 0) {
  const lineCount = Math.max(0, Number(lines) || 0);
  const height = 12 + Math.min(FILE_BUILDING_HEIGHT_MAX - 12, Math.pow(lineCount, 0.62) * 1.75);
  return isVisuallyLargeFile(lineCount, largestDocumentLines) ? Math.max(145, height) : height;
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

function subsystemDepth(subsystem = {}) {
  return Math.min(
    SUBSYSTEM_DEPTH_MAX,
    Math.max(0, Math.trunc(Number(subsystem.depth) || 0))
  );
}

function directoryOwnershipAnchors(subsystems = []) {
  return subsystems.flatMap((subsystem) => (
    (subsystem.anchors || [])
      .filter((anchor) => anchor.kind === "directory" && anchor.relation === "owns")
      .map((anchor) => ({
        depth: subsystemDepth(subsystem),
        path: String(anchor.path || ""),
        subsystemId: subsystem.id
      }))
  )).filter((anchor) => anchor.path).sort((left, right) => (
    right.path.length - left.path.length ||
    left.path.localeCompare(right.path) ||
    left.subsystemId.localeCompare(right.subsystemId)
  ));
}

function ownerForDirectory(directoryPath = "", ownershipAnchors = []) {
  return ownershipAnchors.find((anchor) => (
    directoryPath === anchor.path || directoryPath.startsWith(`${anchor.path}/`)
  )) || null;
}

function layoutSubsystemStrata(layouts = [], lineStats = {}) {
  const contentHeightByDepth = Array.from({ length: SUBSYSTEM_DEPTH_MAX + 1 }, () => 0);
  for (const directory of layouts.flatMap((layout) => layout.directories)) {
    if (!directory.subsystemId) {
      continue;
    }
    contentHeightByDepth[directory.subsystemDepth] = Math.max(
      contentHeightByDepth[directory.subsystemDepth],
      directory.generatedElevation
    );
  }
  for (const file of layouts.flatMap((layout) => layout.files)) {
    file.buildingHeight = fileBuildingHeight(file.lines, lineStats.largest);
    if (!file.subsystemId) {
      continue;
    }
    contentHeightByDepth[file.subsystemDepth] = Math.max(
      contentHeightByDepth[file.subsystemDepth],
      file.generatedElevation + file.buildingHeight
    );
  }

  let offset = 0;
  return contentHeightByDepth.map((contentHeight, depth) => {
    const separationFromAbove = depth === 0
      ? 0
      : Math.max(
        SUBSYSTEM_STRATUM_MIN_SEPARATION,
        contentHeight * SUBSYSTEM_STRATUM_HEIGHT_MULTIPLIER
      );
    offset += separationFromAbove;
    return {
      contentHeight,
      depth,
      elevation: -offset,
      offset,
      separationFromAbove
    };
  });
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
        generatedElevation: node.depth * DIRECTORY_ELEVATION_STEP,
        hierarchyDepth: node.depth,
        name: node.data.name,
        parentPath: node.parent?.depth > 0 ? node.parent.data.path : "",
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
      generatedElevation: (node.parent?.depth || 0) * DIRECTORY_ELEVATION_STEP,
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

function applySubsystemDepth(layouts = [], subsystems = [], lineStats = {}) {
  const depthsBySubsystemId = new Map(
    subsystems.map((subsystem) => [subsystem.id, subsystemDepth(subsystem)])
  );
  const ownershipAnchors = directoryOwnershipAnchors(subsystems);
  const directories = layouts.flatMap((layout) => layout.directories);
  const directoriesByPath = new Map(directories.map((directory) => [directory.path, directory]));

  for (const directory of directories) {
    const owner = ownerForDirectory(directory.path, ownershipAnchors);
    directory.subsystemAnchorPath = owner?.path || "";
    directory.subsystemBase = Boolean(owner && directory.path === owner.path);
    directory.subsystemDepth = owner?.depth || 0;
    directory.subsystemId = owner?.subsystemId || "";
  }
  for (const layout of layouts) {
    for (const file of layout.files) {
      file.subsystemDepth = depthsBySubsystemId.get(file.subsystemId) || 0;
    }
  }

  const strata = layoutSubsystemStrata(layouts, lineStats);
  for (const directory of [...directories].sort((left, right) => (
    left.hierarchyDepth - right.hierarchyDepth || left.path.localeCompare(right.path)
  ))) {
    const parentDirectory = directoriesByPath.get(directory.parentPath);
    directory.elevation = directory.generatedElevation + strata[directory.subsystemDepth].elevation;
    directory.supportElevation = parentDirectory?.subsystemDepth === directory.subsystemDepth
      ? parentDirectory.elevation
      : directory.elevation - DIRECTORY_ELEVATION_STEP;
    directory.terraceHeight = directory.elevation - directory.supportElevation;
  }

  for (const layout of layouts) {
    const occupiedDepths = new Set([0]);
    for (const directory of layout.directories) {
      if (directory.subsystemId) {
        occupiedDepths.add(directory.subsystemDepth);
      }
    }
    for (const file of layout.files) {
      file.supportElevation = directoriesByPath.get(file.directoryPath)?.elevation || 0;
      file.elevation = file.generatedElevation + strata[file.subsystemDepth].elevation;
      if (file.subsystemId) {
        occupiedDepths.add(file.subsystemDepth);
      }
    }
    layout.campus.subsystemDepths = [...occupiedDepths].sort((left, right) => left - right);
    layout.campus.subsystemStrata = layout.campus.subsystemDepths.map((depth) => strata[depth]);
  }
  return strata;
}

function layoutFileCity(overview = {}, {
  depth = 1_180,
  width = 3_800
} = {}) {
  const files = overview.files || [];
  const campuses = fileCampuses(overview);
  const lineStats = overview.lineStats || cityLineStats(files);
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
  const subsystemStrata = applySubsystemDepth(layouts, overview.subsystems || [], lineStats);

  return {
    bounds: { depth, width },
    campuses: layouts.map((layout) => layout.campus),
    directories: layouts.flatMap((layout) => layout.directories),
    files: layouts.flatMap((layout) => layout.files),
    lineStats,
    subsystemStrata
  };
}

function topLevelPrecincts(overview = {}) {
  return layoutFileCity(overview).campuses;
}

function commonDirectoryPath(directoryPaths = []) {
  const paths = directoryPaths.map((directoryPath) => String(directoryPath || "")).filter(Boolean);
  if (paths.length === 0) {
    return "";
  }
  const segments = paths.map((directoryPath) => directoryPath.split("/").filter(Boolean));
  const shared = [];
  for (let index = 0; index < Math.min(...segments.map((parts) => parts.length)); index += 1) {
    const segment = segments[0][index];
    if (!segments.every((parts) => parts[index] === segment)) {
      break;
    }
    shared.push(segment);
  }
  return shared.join("/");
}

function subsystemConnectionInterfaces(fileConnection = {}) {
  const interfaces = [];
  const injectionTokens = new Set(fileConnection.injectionTokens || []);
  for (const symbol of fileConnection.symbols || []) {
    interfaces.push({
      kind: "import",
      reference: symbol
    });
  }
  for (const token of injectionTokens) {
    interfaces.push({
      kind: "injection",
      reference: token
    });
  }
  if ((fileConnection.kinds || []).includes("import") && !(fileConnection.symbols || []).length) {
    const moduleReference = (fileConnection.references || []).find((reference) => (
      !injectionTokens.has(reference)
    )) || fileConnection.toPath || fileConnection.toFileId;
    interfaces.push({
      kind: "import",
      reference: moduleReference
    });
  }
  return interfaces.filter((entry) => entry.reference);
}

function subsystemOwnedAnchor(subsystem = {}, file = {}) {
  return [...(subsystem.anchors || [])]
    .filter((anchor) => anchor.relation === "owns")
    .sort((left, right) => (
      String(right.path || "").length - String(left.path || "").length ||
      String(left.path || "").localeCompare(String(right.path || ""))
    ))
    .find((anchor) => (
    anchor.kind === "file"
      ? file.path === anchor.path
      : file.path === anchor.path || file.path.startsWith(`${anchor.path}/`)
  )) || null;
}

function layoutSubsystemConnectionBundles(cityLayout = {}, subsystemLayout = {}, selectedSubsystemId = "") {
  const filesById = new Map((cityLayout.files || []).map((file) => [file.id, file]));
  const directoriesByPath = new Map((cityLayout.directories || []).map((directory) => [directory.path, directory]));
  const subsystemsById = new Map((subsystemLayout.subsystems || []).map((subsystem) => [subsystem.id, subsystem]));
  const selectedId = String(selectedSubsystemId || "");
  const bundles = [];

  for (const edge of subsystemLayout.dependencyEdges || []) {
    if (edge.fromSubsystemId !== selectedId && edge.toSubsystemId !== selectedId) {
      continue;
    }
    const consumerSubsystem = subsystemsById.get(edge.fromSubsystemId);
    const providerSubsystem = subsystemsById.get(edge.toSubsystemId);
    if (!consumerSubsystem || !providerSubsystem) {
      continue;
    }
    const interactions = new Map();
    for (const fileConnection of edge.fileConnections || []) {
      for (const connectionInterface of subsystemConnectionInterfaces(fileConnection)) {
        const key = `${connectionInterface.kind}\u0000${connectionInterface.reference}`;
        const interaction = interactions.get(key) || {
          connectionCount: 0,
          connectionCountsByConsumerFileId: new Map(),
          consumerFileIds: new Set(),
          kind: connectionInterface.kind,
          providerFileIds: new Set(),
          reference: connectionInterface.reference
        };
        const connectionCount = Math.max(1, Number(fileConnection.connectionCount) || 0);
        interaction.connectionCount += connectionCount;
        interaction.connectionCountsByConsumerFileId.set(
          fileConnection.fromFileId,
          (interaction.connectionCountsByConsumerFileId.get(fileConnection.fromFileId) || 0) + connectionCount
        );
        interaction.consumerFileIds.add(fileConnection.fromFileId);
        interaction.providerFileIds.add(fileConnection.toFileId);
        interactions.set(key, interaction);
      }
    }

    for (const interaction of interactions.values()) {
      const partitions = new Map();
      for (const fileId of interaction.consumerFileIds) {
        const file = filesById.get(fileId);
        const anchor = file ? subsystemOwnedAnchor(consumerSubsystem, file) : null;
        const partitionKey = anchor ? `${anchor.kind}:${anchor.path}` : `file:${fileId}`;
        const partition = partitions.get(partitionKey) || {
          anchor,
          consumerFileIds: []
        };
        partition.consumerFileIds.push(fileId);
        partitions.set(partitionKey, partition);
      }

      for (const [partitionKey, partition] of partitions) {
        const consumerFiles = partition.consumerFileIds.map((fileId) => filesById.get(fileId)).filter(Boolean);
        let collection = {
          collectionKind: "subsystem",
          collectionPath: ""
        };
        if (partition.anchor?.kind === "file" && consumerFiles.length === 1) {
          collection = {
            collectionFileId: consumerFiles[0].id,
            collectionKind: "file",
            collectionPath: consumerFiles[0].path
          };
        } else if (!partition.anchor && consumerFiles.length === 1) {
          collection = {
            collectionFileId: consumerFiles[0].id,
            collectionKind: "file",
            collectionPath: consumerFiles[0].path
          };
        } else if (partition.anchor?.kind === "directory") {
          const directoryPath = commonDirectoryPath(consumerFiles.map((file) => file.directoryPath));
          const ownedDirectoryPath = directoryPath === partition.anchor.path || directoryPath.startsWith(`${partition.anchor.path}/`)
            ? directoryPath
            : partition.anchor.path;
          if (directoriesByPath.has(ownedDirectoryPath)) {
            collection = {
              collectionKind: "directory",
              collectionPath: ownedDirectoryPath
            };
          }
        }
        const id = [
          edge.id,
          interaction.kind,
          interaction.reference,
          partitionKey,
          collection.collectionKind,
          collection.collectionPath
        ].join("\u0000");
        bundles.push({
          ...collection,
          connectionCount: partition.consumerFileIds.reduce((total, fileId) => (
            total + (interaction.connectionCountsByConsumerFileId.get(fileId) || 0)
          ), 0),
          consumerFileIds: stableSort(partition.consumerFileIds),
          consumerSubsystemId: consumerSubsystem.id,
          consumerSubsystemTitle: consumerSubsystem.title,
          edgeId: edge.id,
          id,
          kind: interaction.kind,
          providerFileIds: stableSort(interaction.providerFileIds),
          providerSubsystemId: providerSubsystem.id,
          providerSubsystemTitle: providerSubsystem.title,
          reference: interaction.reference,
          usageCount: new Set(partition.consumerFileIds).size
        });
      }
    }
  }

  return stableSort(bundles, (bundle) => bundle.id);
}

function layoutSubsystemSky(cityLayout = {}, subsystems = []) {
  const directoriesByPath = new Map((cityLayout.directories || []).map((directory) => [directory.path, directory]));
  const filesByPath = new Map((cityLayout.files || []).map((file) => [file.path, file]));
  const placed = [];

  function targetForAnchor(anchor) {
    const target = anchor.kind === "file"
      ? filesByPath.get(anchor.path)
      : directoriesByPath.get(anchor.path);
    return target
      ? {
          campusId: target.campusId,
          elevation: target.elevation,
          fileId: anchor.kind === "file" ? target.id : "",
          depth: anchor.kind === "file" ? target.cityDepth : target.depth,
          kind: anchor.kind,
          path: anchor.path,
          relation: anchor.relation,
          width: anchor.kind === "file" ? target.cityWidth : target.width,
          x: target.x,
          z: target.z
        }
      : null;
  }

  function freePosition(record) {
    const minimumGap = 34;
    const baseAngle = (stableHash(record.id) % 360) * (Math.PI / 180);
    for (let attempt = 0; attempt < 96; attempt += 1) {
      const ring = attempt === 0 ? 0 : Math.ceil(attempt / 12);
      const angle = baseAngle + attempt * 2.399963229728653;
      const distance = ring * (record.radius * 0.82 + 54);
      const candidate = {
        x: record.anchorX + Math.cos(angle) * distance,
        z: record.anchorZ + Math.sin(angle) * distance
      };
      const overlaps = placed.some((other) => (
        Math.hypot(candidate.x - other.x, candidate.z - other.z) < record.radius + other.radius + minimumGap
      ));
      if (!overlaps) {
        return candidate;
      }
    }
    return {
      x: record.anchorX + placed.length * (record.radius * 2 + minimumGap),
      z: record.anchorZ
    };
  }

  const records = stableSort(subsystems, (subsystem) => subsystem.id).map((subsystem) => {
    const targets = (subsystem.anchors || []).map(targetForAnchor).filter(Boolean);
    const anchorX = targets.length > 0
      ? targets.reduce((sum, target) => sum + target.x, 0) / targets.length
      : 0;
    const anchorZ = targets.length > 0
      ? targets.reduce((sum, target) => sum + target.z, 0) / targets.length
      : 0;
    const radius = Math.max(
      54,
      Math.min(112, 48 + Math.log2(Math.max(1, Number(subsystem.lines) || 0) + 1) * 4)
    );
    const record = {
      ...subsystem,
      anchorX,
      anchorZ,
      radius,
      targets,
      y: SUBSYSTEM_SKY_ELEVATION
    };
    const position = freePosition(record);
    record.x = position.x;
    record.z = position.z;
    placed.push(record);
    return record;
  });
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const dependencyEdges = [];
  const externalSatellites = [];
  for (const record of records) {
    for (const dependency of record.dependencies?.outgoing || []) {
      if (!recordsById.has(dependency.subsystemId)) {
        continue;
      }
      dependencyEdges.push({
        ...dependency,
        fromSubsystemId: record.id,
        id: `${record.id}->${dependency.subsystemId}`,
        toSubsystemId: dependency.subsystemId
      });
    }
    const externalDependencies = stableSort(
      record.dependencies?.external || [],
      (dependency) => `${dependency.kind}:${dependency.packageId}`
    );
    externalDependencies.forEach((dependency, index) => {
      const ring = Math.floor(index / 8);
      const ringOffset = ring * 8;
      const ringSize = Math.min(8, externalDependencies.length - ringOffset);
      const positionInRing = index - ringOffset;
      const angle = (
        (stableHash(record.id) % 360) * (Math.PI / 180) +
        positionInRing * ((Math.PI * 2) / ringSize)
      );
      const distance = record.radius + 125 + ring * 85;
      externalSatellites.push({
        ...dependency,
        id: `external:${record.id}:${dependency.kind}:${dependency.packageId}`,
        ownerSubsystemId: record.id,
        radius: Math.max(14, Math.min(24, 13 + Math.log2(Math.max(1, dependency.importCount) + 1) * 2.4)),
        x: record.x + Math.cos(angle) * distance,
        y: record.y + 96 + ring * 36,
        z: record.z + Math.sin(angle) * distance
      });
    });
  }

  return {
    dependencyEdges,
    elevation: SUBSYSTEM_SKY_ELEVATION,
    externalSatellites,
    subsystems: records
  };
}

export {
  cityLineStats,
  DIRECTORY_ELEVATION_STEP,
  FILE_BUILDING_HEIGHT_MAX,
  fileBuildingHeight,
  isVisuallyLargeFile,
  layoutFileCity,
  layoutSubsystemConnectionBundles,
  layoutSubsystemSky,
  stableHash,
  SUBSYSTEM_STRATUM_HEIGHT_MULTIPLIER,
  SUBSYSTEM_STRATUM_MIN_SEPARATION,
  SUBSYSTEM_SKY_ELEVATION,
  topLevelPrecincts
};

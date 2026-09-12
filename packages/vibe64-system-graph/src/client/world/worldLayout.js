import {
  hierarchy,
  treemap,
  treemapSquarify
} from "d3-hierarchy";

// Keep the mature File City canvas proportions. Real repositories routinely
// contain hundreds of buildings; the short-lived compact 1,240×920 world
// crushed small top-level precincts into the large monorepo areas and left no
// physical room for directory labels or navigable streets.
const CITY_DEPTH = 1_180;
const CITY_WIDTH = 3_800;
const DISTRICT_ELEVATION_STEP = 8;
const DISTRICT_INSET = 5;
const DISTRICT_TERRACE_HEIGHT = 4;
const SHALLOW_DISTRICT_ELEVATION_STEP = 64;
const SHALLOW_DISTRICT_PADDING = 38;
const PRECINCT_GAP = 72;
const PRECINCT_MINIMUM_WIDTH = 220;
const PRECINCT_WORLD_WIDTH = 760;
const PRESENTATION_REGION_TERRACE_HEIGHT = 4;
const PRESENTATION_CAMPUS_TERRACE_HEIGHT = 5;
const BUILDING_HEIGHT_MAX = 290;
const SEMANTIC_SKY_GAP = 180;

function stableHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => (
    String(selector(left)).localeCompare(String(selector(right)))
  ));
}

// Genesis already supplies the directory hierarchy. A physical precinct is
// therefore a presentation of an explicit top-level district, never an
// inferred client/server role. When Genesis has one Project root, its direct
// children are the mature City's compact precincts; with multiple roots, the
// roots themselves are the precincts.
function topLevelPrecincts(city = {}) {
  const districts = Array.isArray(city.districts) ? city.districts : [];
  const roots = districts.filter((district) => district.parentId === null);
  const rootIds = new Set(roots.map((district) => district.id));
  const precincts = roots.length === 1
    ? districts.filter((district) => rootIds.has(district.parentId))
    : roots;
  return stableSort(precincts.length > 0 ? precincts : roots, (district) => district.id);
}

// The mature City used its directory hierarchy as physical architecture:
// first-level directories were widely separated high-rise precincts and each
// nested level became a smaller retaining floor. Keep that visual grammar,
// but taper it progressively so deeply nested package trees remain readable
// instead of becoming a stack of equally tall slabs.
function districtPadding(hierarchyDepth = 0) {
  return Math.max(
    DISTRICT_INSET,
    SHALLOW_DISTRICT_PADDING * Math.pow(0.7, Math.max(0, hierarchyDepth))
  );
}

function districtElevationStep(hierarchyDepth = 1) {
  return Math.max(
    DISTRICT_ELEVATION_STEP,
    SHALLOW_DISTRICT_ELEVATION_STEP * Math.pow(0.68, Math.max(0, hierarchyDepth - 1))
  );
}

function districtSurfaceElevation(hierarchyDepth = 0) {
  let elevation = DISTRICT_TERRACE_HEIGHT;
  for (let depth = 1; depth <= hierarchyDepth; depth += 1) {
    elevation += districtElevationStep(depth);
  }
  return elevation;
}

function machineBuildingHeight(lines = 0) {
  const lineCount = Math.max(0, Number(lines) || 0);
  return 12 + Math.min(BUILDING_HEIGHT_MAX - 12, Math.pow(lineCount, 0.62) * 1.75);
}

function buildingHeight(building = {}, cityKind = "machine") {
  return cityKind === "program" ? (building.kind === "table" ? 20 : 38) : machineBuildingHeight(building.lines);
}

function buildingWeight(building = {}, cityKind = "machine") {
  if (cityKind === "program") {
    return 1;
  }
  return Math.max(8, Number(building.lines) || 0);
}

function districtTree(districts = [], buildings = [], {
  presentationCampuses = [],
  presentationRegions = []
} = {}) {
  const nodes = new Map(stableSort(districts, (district) => district.id).map((district) => [
    district.id,
    {
      children: [],
      district,
      type: "district",
      weight: 8
    }
  ]));

  for (const building of stableSort(buildings, (entry) => entry.id)) {
    nodes.get(building.districtId).children.push({
      building,
      children: [],
      type: "building",
      weight: 0
    });
  }

  if (presentationRegions.length > 0 && presentationCampuses.length > 0) {
    const campusNodes = new Map(presentationCampuses.map((campus) => [campus.id, {
      campus,
      children: [],
      type: "campus",
      weight: 12
    }]));
    const regionNodes = new Map(presentationRegions.map((region) => [region.id, {
      children: [],
      region,
      type: "region",
      weight: 18
    }]));
    for (const district of districts) {
      const node = nodes.get(district.id);
      const parent = district.parentId === null ? null : nodes.get(district.parentId);
      if (parent?.district.presentationCampusId === district.presentationCampusId) {
        parent.children.push(node);
      } else {
        campusNodes.get(district.presentationCampusId)?.children.push(node);
      }
    }
    for (const campusNode of campusNodes.values()) {
      if (campusNode.children.length > 0) {
        regionNodes.get(campusNode.campus.regionId)?.children.push(campusNode);
      }
    }
    return {
      children: [...regionNodes.values()].filter((region) => region.children.length > 0),
      type: "city",
      weight: 0
    };
  }

  for (const district of districts) {
    if (district.parentId !== null) {
      nodes.get(district.parentId).children.push(nodes.get(district.id));
    }
  }

  const roots = stableSort(
    districts.filter((district) => district.parentId === null).map((district) => nodes.get(district.id)),
    (node) => node.district.id
  );
  return {
    children: roots,
    type: "city",
    weight: 0
  };
}

function assertAcyclicDistricts(districts = []) {
  const districtsById = new Map(districts.map((district) => [district.id, district]));
  for (const district of districts) {
    const ancestry = new Set();
    let current = district;
    while (current) {
      if (ancestry.has(current.id)) {
        throw new TypeError(`Genesis City district hierarchy contains a cycle at ${current.id}.`);
      }
      ancestry.add(current.id);
      current = current.parentId === null ? null : districtsById.get(current.parentId);
    }
  }
}

function descendantBuildings(node) {
  return node.leaves().map((leaf) => leaf.data.building).filter(Boolean);
}

function hierarchyDistrictDepth(node) {
  return Math.max(
    0,
    node.ancestors().filter((ancestor) => ancestor.data.type === "district").length - 1
  );
}

const defaultGenesisCityTile = treemapSquarify.ratio(1.25);

function layoutHorizontalPrecincts(children = [], x0, y0, x1, y1) {
  if (children.length === 0) {
    return;
  }
  const availableWidth = Math.max(1, x1 - x0 - PRECINCT_GAP * (children.length - 1));
  const minimumWidth = children.length === 1
    ? availableWidth
    : Math.min(PRECINCT_MINIMUM_WIDTH, availableWidth / children.length * 0.72);
  const distributableWidth = Math.max(0, availableWidth - minimumWidth * children.length);
  const weights = children.map((child) => Math.sqrt(Math.max(1, Number(child.value) || 0)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursorX = x0;
  children.forEach((child, index) => {
    const width = index === children.length - 1
      ? x1 - cursorX
      : minimumWidth + distributableWidth * (weights[index] / totalWeight);
    child.x0 = cursorX;
    child.x1 = cursorX + width;
    child.y0 = y0;
    child.y1 = y1;
    cursorX += width + PRECINCT_GAP;
  });
}

// The mature renderer gave every declared campus enough ground to remain a
// navigable place even when another campus contained most of the repository.
// Genesis now provides the hierarchy directly, so its root districts become
// those physical precincts without adapter classification. Project-root files
// retain a compact strip of their own above the precincts.
function genesisCityTile(parent, x0, y0, x1, y1) {
  const children = parent.children || [];
  const regionChildren = children.filter((child) => child.data.type === "region");
  const districtChildren = children.filter((child) => child.data.type === "district");
  const directBuildings = children.filter((child) => child.data.type === "building");
  const isCityRoot = parent.data.type === "city";
  const isProjectRoot = parent.data.type === "district" && parent.data.district.parentId === null;
  if (isCityRoot && regionChildren.length > 0) {
    layoutHorizontalPrecincts(regionChildren, x0, y0, x1, y1);
    return;
  }
  if ((!isCityRoot && !isProjectRoot) || districtChildren.length === 0) {
    defaultGenesisCityTile(parent, x0, y0, x1, y1);
    return;
  }
  if (directBuildings.length === 0) {
    layoutHorizontalPrecincts(districtChildren, x0, y0, x1, y1);
    return;
  }

  const directDepth = Math.min(150, Math.max(82, (y1 - y0) * 0.16));
  const precinctY0 = Math.min(y1, y0 + directDepth + PRECINCT_GAP / 2);
  const originalChildren = parent.children;
  const originalValue = parent.value;
  parent.children = directBuildings;
  parent.value = directBuildings.reduce((sum, child) => sum + (Number(child.value) || 0), 0);
  defaultGenesisCityTile(parent, x0, y0, x1, y0 + directDepth);
  parent.children = originalChildren;
  parent.value = originalValue;
  layoutHorizontalPrecincts(districtChildren, x0, precinctY0, x1, y1);
}

function layoutGenesisSemanticSky(cityLayout = {}, semantic = null) {
  if (!semantic || !Array.isArray(semantic.subsystems)) {
    return null;
  }
  const buildingsById = new Map((cityLayout.buildings || []).map((building) => [building.id, building]));
  const placed = [];
  const elevation = Math.max(360, (Number(cityLayout.bounds?.height) || 0) + SEMANTIC_SKY_GAP);

  function freePosition(record) {
    const minimumGap = 32;
    const baseAngle = (stableHash(record.id) % 360) * (Math.PI / 180);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const ring = attempt === 0 ? 0 : Math.ceil(attempt / 12);
      const angle = baseAngle + attempt * 2.399963229728653;
      const distance = ring * (record.radius * 0.82 + 52);
      const candidate = {
        x: record.anchorX + Math.cos(angle) * distance,
        z: record.anchorZ + Math.sin(angle) * distance
      };
      if (!placed.some((other) => (
        Math.hypot(candidate.x - other.x, candidate.z - other.z) < record.radius + other.radius + minimumGap
      ))) {
        return candidate;
      }
    }
    return {
      x: record.anchorX + placed.length * (record.radius * 2 + minimumGap),
      z: record.anchorZ
    };
  }

  const subsystems = stableSort(semantic.subsystems, (subsystem) => subsystem.id).map((subsystem) => {
    const targets = stableSort(
      (subsystem.files || []).map((file) => buildingsById.get(file.id)).filter(Boolean),
      (building) => building.id
    );
    const anchorX = targets.length
      ? targets.reduce((total, building) => total + building.x, 0) / targets.length
      : 0;
    const anchorZ = targets.length
      ? targets.reduce((total, building) => total + building.z, 0) / targets.length
      : 0;
    const radius = Math.max(58, Math.min(
      118,
      54 + Math.log2(Math.max(1, subsystem.operations.length) + 1) * 12 +
        Math.log2(Math.max(1, targets.length) + 1) * 5
    ));
    const record = {
      ...subsystem,
      anchorX,
      anchorZ,
      radius,
      targets,
      y: elevation
    };
    const position = freePosition(record);
    record.x = position.x;
    record.z = position.z;
    placed.push(record);
    return record;
  });
  const subsystemsById = new Map(subsystems.map((subsystem) => [subsystem.id, subsystem]));
  const operations = [];
  const implementationLinks = [];

  for (const subsystem of subsystems) {
    const subsystemOperations = stableSort(subsystem.operations, (operation) => operation.id);
    subsystemOperations.forEach((operation, index) => {
      const angle = -Math.PI / 2 + index * ((Math.PI * 2) / Math.max(1, subsystemOperations.length));
      const distance = subsystemOperations.length === 1 ? 0 : subsystem.radius * 0.52;
      operations.push({
        ...operation,
        radius: Math.max(5, Math.min(9, subsystem.radius / Math.max(8, subsystemOperations.length + 4))),
        subsystemId: subsystem.id,
        x: subsystem.x + Math.cos(angle) * distance,
        y: subsystem.y + 10,
        z: subsystem.z + Math.sin(angle) * distance
      });
    });
  }
  const operationsById = new Map(operations.map((operation) => [operation.id, operation]));
  for (const link of semantic.implementationLinks || []) {
    const operation = operationsById.get(link.operationId);
    const target = buildingsById.get(link.fileId);
    const subsystem = subsystemsById.get(link.subsystemId);
    if (!operation || !target || !subsystem) {
      continue;
    }
    implementationLinks.push({
      ...link,
      from: {
        x: operation.x,
        y: operation.y,
        z: operation.z
      },
      to: {
        x: target.x,
        y: target.elevation + target.buildingHeight + 3,
        z: target.z
      },
      target
    });
  }

  const bundleGroups = new Map();
  for (const link of implementationLinks) {
    const precinctId = link.target.precinctId || link.target.districtId;
    const key = `${link.subsystemId}\u0000${precinctId}`;
    const group = bundleGroups.get(key) || {
      fileIds: new Set(),
      id: `implementation-bundle:${key}`,
      links: [],
      operationIds: new Set(),
      precinctId,
      subsystemId: link.subsystemId,
      targets: new Map()
    };
    group.fileIds.add(link.fileId);
    group.links.push(link);
    group.operationIds.add(link.operationId);
    group.targets.set(link.fileId, link.target);
    bundleGroups.set(key, group);
  }
  const implementationBundles = stableSort(
    [...bundleGroups.values()].map((group) => {
      const subsystem = subsystemsById.get(group.subsystemId);
      const targets = stableSort([...group.targets.values()], (target) => target.id);
      const targetX = targets.reduce((sum, target) => sum + target.x, 0) / targets.length;
      const targetZ = targets.reduce((sum, target) => sum + target.z, 0) / targets.length;
      const targetY = Math.max(...targets.map((target) => (
        target.elevation + target.buildingHeight + 3
      ))) + 22;
      return {
        fileIds: stableSort([...group.fileIds]),
        from: {
          x: subsystem.x,
          y: subsystem.y - 6,
          z: subsystem.z
        },
        id: group.id,
        linkIds: stableSort(group.links.map((link) => link.id)),
        operationIds: stableSort([...group.operationIds]),
        precinctId: group.precinctId,
        subsystemId: group.subsystemId,
        targets,
        to: {
          x: targetX,
          y: targetY,
          z: targetZ
        },
        weight: group.links.length
      };
    }),
    (bundle) => bundle.id
  );

  return {
    elevation,
    implementationBundles,
    implementationLinks: stableSort(implementationLinks, (link) => link.id),
    operations: stableSort(operations, (operation) => operation.id),
    subsystems
  };
}

function layoutGenesisCity(city = {}) {
  const cityKind = city.cityKind === "program" ? "program" : "machine";
  const districts = Array.isArray(city.districts) ? city.districts : [];
  const buildings = Array.isArray(city.buildings) ? city.buildings : [];
  const presentationRegions = Array.isArray(city.presentationRegions) ? city.presentationRegions : [];
  const presentationCampuses = Array.isArray(city.presentationCampuses) ? city.presentationCampuses : [];
  const usesPresentation = presentationRegions.length > 0 && presentationCampuses.length > 0;
  const precincts = usesPresentation ? [] : topLevelPrecincts({ buildings, districts });
  const presentationPrecinctCount = usesPresentation ? presentationRegions.length : precincts.length;
  const cityWidth = Math.max(CITY_WIDTH, presentationPrecinctCount * PRECINCT_WORLD_WIDTH);
  if (districts.length === 0) {
    return {
      bounds: {
        depth: CITY_DEPTH,
        height: 0,
        width: cityWidth
      },
      buildings: [],
      campuses: [],
      cityKind,
      cityLabel: city.cityLabel || "GENESIS CITY",
      districts: [],
      regions: []
    };
  }

  assertAcyclicDistricts(districts);
  const tree = districtTree(districts, buildings, {
    presentationCampuses,
    presentationRegions
  });
  const root = hierarchy(tree, (node) => node.children)
    .sum((node) => node.type === "building"
      ? buildingWeight(node.building, cityKind)
      : node.weight)
    .sort((left, right) => (
      right.value - left.value || String(left.data.district?.id || left.data.building?.id || "")
        .localeCompare(String(right.data.district?.id || right.data.building?.id || ""))
    ));

  treemap()
    .tile(genesisCityTile)
    .size([cityWidth, CITY_DEPTH])
    .paddingOuter(DISTRICT_INSET)
    .paddingInner((node) => {
      if (node.data.type === "region") return 24;
      if (node.data.type === "campus") return 12;
      return node.data.type === "district"
        ? Math.max(2, districtPadding(hierarchyDistrictDepth(node)) * 0.46)
        : DISTRICT_INSET;
    })
    .paddingLeft((node) => node.data.type === "district"
      ? districtPadding(hierarchyDistrictDepth(node))
      : DISTRICT_INSET)
    .paddingRight((node) => node.data.type === "district"
      ? districtPadding(hierarchyDistrictDepth(node))
      : DISTRICT_INSET)
    .paddingBottom((node) => node.data.type === "district"
      ? districtPadding(hierarchyDistrictDepth(node))
      : DISTRICT_INSET)
    .paddingTop((node) => node.data.type === "district"
      ? districtPadding(hierarchyDistrictDepth(node)) * 1.15
      : DISTRICT_INSET)
    .round(true)(root);

  const districtLayouts = [];
  const buildingLayouts = [];
  const districtAncestors = new Map();
  const regionLayouts = [];
  const campusLayouts = [];

  for (const node of root.descendants()) {
    if (node.data.type === "region") {
      const descendants = descendantBuildings(node);
      regionLayouts.push({
        ...node.data.region,
        buildingCount: descendants.length,
        kind: "presentation-region",
        elevation: 0,
        footprintDepth: Math.max(3, node.y1 - node.y0),
        lines: cityKind === "machine"
          ? descendants.reduce((total, building) => total + Math.max(0, Number(building.lines) || 0), 0)
          : 0,
        surfaceElevation: PRESENTATION_REGION_TERRACE_HEIGHT,
        supportElevation: 0,
        terraceHeight: PRESENTATION_REGION_TERRACE_HEIGHT,
        width: Math.max(3, node.x1 - node.x0),
        x: (node.x0 + node.x1) / 2 - cityWidth / 2,
        z: (node.y0 + node.y1) / 2 - CITY_DEPTH / 2
      });
    }
    if (node.data.type === "campus") {
      const descendants = descendantBuildings(node);
      campusLayouts.push({
        ...node.data.campus,
        buildingCount: descendants.length,
        kind: "presentation-campus",
        elevation: PRESENTATION_REGION_TERRACE_HEIGHT,
        footprintDepth: Math.max(3, node.y1 - node.y0),
        lines: cityKind === "machine"
          ? descendants.reduce((total, building) => total + Math.max(0, Number(building.lines) || 0), 0)
          : 0,
        surfaceElevation: PRESENTATION_REGION_TERRACE_HEIGHT + PRESENTATION_CAMPUS_TERRACE_HEIGHT,
        supportElevation: PRESENTATION_REGION_TERRACE_HEIGHT,
        terraceHeight: PRESENTATION_CAMPUS_TERRACE_HEIGHT,
        width: Math.max(3, node.x1 - node.x0),
        x: (node.x0 + node.x1) / 2 - cityWidth / 2,
        z: (node.y0 + node.y1) / 2 - CITY_DEPTH / 2
      });
    }
  }

  for (const node of root.descendants()) {
    if (node.data.type !== "district") {
      continue;
    }
    const district = node.data.district;
    const localDistrictAncestors = node.ancestors()
      .filter((ancestor) => ancestor.data.type === "district")
      .reverse();
    const hierarchyDepth = Math.max(0, localDistrictAncestors.length - 1);
    const presentationBase = usesPresentation
      ? PRESENTATION_REGION_TERRACE_HEIGHT + PRESENTATION_CAMPUS_TERRACE_HEIGHT
      : 0;
    const surfaceElevation = presentationBase + districtSurfaceElevation(hierarchyDepth);
    const supportElevation = hierarchyDepth === 0
      ? presentationBase
      : presentationBase + districtSurfaceElevation(hierarchyDepth - 1);
    const descendants = descendantBuildings(node);
    const ancestorIds = localDistrictAncestors.map((ancestor) => ancestor.data.district.id);
    const campus = node.ancestors().find((ancestor) => ancestor.data.type === "campus")?.data.campus;
    districtAncestors.set(district.id, ancestorIds);
    districtLayouts.push({
      ...district,
      ancestorIds,
      buildingCount: descendants.length,
      directBuildingCount: node.children?.filter((child) => child.data.type === "building").length || 0,
      elevation: supportElevation,
      footprintDepth: Math.max(3, node.y1 - node.y0),
      hierarchyDepth,
      layoutPadding: districtPadding(hierarchyDepth),
      precinctId: campus?.id || precincts.find((precinct) => ancestorIds.includes(precinct.id))?.id || district.id,
      lines: cityKind === "machine"
        ? descendants.reduce((total, building) => total + Math.max(0, Number(building.lines) || 0), 0)
        : 0,
      surfaceElevation,
      supportElevation,
      terraceHeight: surfaceElevation - supportElevation,
      width: Math.max(3, node.x1 - node.x0),
      x: (node.x0 + node.x1) / 2 - cityWidth / 2,
      z: (node.y0 + node.y1) / 2 - CITY_DEPTH / 2
    });
  }

  const districtsById = new Map(districtLayouts.map((district) => [district.id, district]));
  for (const leaf of root.leaves()) {
    if (leaf.data.type !== "building") {
      continue;
    }
    const building = leaf.data.building;
    const district = districtsById.get(building.districtId);
    const height = buildingHeight(building, cityKind);
    buildingLayouts.push({
      ...building,
      ancestorDistrictIds: districtAncestors.get(building.districtId) || [building.districtId],
      buildingHeight: height,
      elevation: district.surfaceElevation,
      footprintDepth: Math.max(4, leaf.y1 - leaf.y0 - 2),
      precinctId: district.precinctId,
      width: Math.max(4, leaf.x1 - leaf.x0 - 2),
      x: (leaf.x0 + leaf.x1) / 2 - cityWidth / 2,
      z: (leaf.y0 + leaf.y1) / 2 - CITY_DEPTH / 2
    });
  }

  const maximumHeight = Math.max(
    ...regionLayouts.map((region) => region.surfaceElevation),
    ...campusLayouts.map((campus) => campus.surfaceElevation),
    ...districtLayouts.map((district) => district.surfaceElevation),
    ...buildingLayouts.map((building) => building.elevation + building.buildingHeight),
    0
  );
  const districtLayoutsById = new Map(districtLayouts.map((district) => [district.id, district]));
  const campuses = usesPresentation
    ? stableSort(campusLayouts, (campus) => campus.id)
    : precincts.map((precinct) => districtLayoutsById.get(precinct.id)).filter(Boolean);

  return {
    bounds: {
      depth: CITY_DEPTH,
      height: maximumHeight,
      width: cityWidth
    },
    buildings: stableSort(buildingLayouts, (building) => building.id),
    campuses,
    cityKind,
    cityLabel: city.cityLabel || "GENESIS CITY",
    districts: stableSort(districtLayouts, (district) => district.id),
    regions: stableSort(regionLayouts, (region) => region.id)
  };
}

export {
  BUILDING_HEIGHT_MAX,
  CITY_DEPTH,
  CITY_WIDTH,
  DISTRICT_ELEVATION_STEP,
  DISTRICT_TERRACE_HEIGHT,
  PRESENTATION_CAMPUS_TERRACE_HEIGHT,
  PRESENTATION_REGION_TERRACE_HEIGHT,
  buildingHeight,
  districtElevationStep,
  districtPadding,
  districtSurfaceElevation,
  layoutGenesisSemanticSky,
  layoutGenesisCity,
  topLevelPrecincts,
  stableHash
};

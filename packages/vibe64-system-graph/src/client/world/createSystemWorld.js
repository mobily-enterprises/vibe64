import * as THREE from "three";
import CameraControls from "camera-controls";
import { Text } from "troika-three-text";

import {
  fileBuildingHeight,
  layoutFileCity,
  layoutSubsystemConnectionBundles,
  layoutSubsystemSky,
  stableHash
} from "./worldLayout.js";

CameraControls.install({ THREE });

const WHEEL_GESTURE_IDLE_MS = 180;
const FILE_DOUBLE_TAP_WINDOW_MS = 360;
const FILE_PORTAL_DURATION_MS = 260;
const FILE_TRAVEL_DURATION_MS = 460;

const SIDE_COLORS = Object.freeze({
  client: 0x35d0ff,
  external: 0xb0b7c3,
  server: 0xff4fa3,
  shared: 0x9d7bff,
  unknown: 0x6f7b8f
});
const SELECTED_FILE_COLOR = 0x75f3ff;
const DIMMED_BUILDING_COLOR = 0x303640;
const DIMMED_ROOF_COLOR = 0x474e59;
const DIMMED_TERRACE_COLOR = 0x252b33;
const DIMMED_CAMPUS_COLOR = 0x1c222a;
const DIMMED_EDGE_COLOR = 0x4a535f;
const SUBSYSTEM_CIRCLE_CAMERA_CEILING_CLEARANCE = 74;
const SUBSYSTEM_TETHER_COLORS = Object.freeze({
  owns: 0x59e3ff,
  implements: 0x70e8ad,
  supports: 0xb49aff,
  configures: 0xffc86b
});
const SUBSYSTEM_DEPENDENCY_COLORS = Object.freeze({
  external: 0xc69cff,
  incoming: 0x70e8ad,
  outgoing: 0xffc86b
});
const SYSTEM_CONNECTION_COLORS = Object.freeze({
  declaration: 0xffc86b,
  import: 0x59e3ff,
  injection: 0xc69cff
});
const SUBSYSTEM_LAST_MILE_COLOR = 0xffe08a;
const BOX_EDGE_PAIRS = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
]);

function appendBoxEdges(positions, corners) {
  for (const [from, to] of BOX_EDGE_PAIRS) {
    positions.push(...corners[from], ...corners[to]);
  }
}

function sideColor(side = "unknown") {
  return SIDE_COLORS[side] || SIDE_COLORS.unknown;
}

function systemConnectionColor(kinds = []) {
  if (kinds.includes("injection")) {
    return SYSTEM_CONNECTION_COLORS.injection;
  }
  if (kinds.includes("import")) {
    return SYSTEM_CONNECTION_COLORS.import;
  }
  return SYSTEM_CONNECTION_COLORS.declaration;
}

function hashedColor(value = "", {
  lightness = 0.46,
  saturation = 0.58
} = {}) {
  const hue = (stableHash(value) % 360) / 360;
  return new THREE.Color().setHSL(hue, saturation, lightness).getHex();
}

function campusSurfaceColor(campusId = "") {
  return hashedColor(campusId || "repository", { lightness: 0.24, saturation: 0.54 });
}

function directorySurfaceColor(directoryPath = "", hierarchyDepth = 1) {
  const color = hashedColor(directoryPath || "Project root", {
    lightness: hierarchyDepth === 1 ? 0.54 : 0.47,
    saturation: 0.5
  });
  return new THREE.Color(color).offsetHSL(
    0,
    -0.08,
    -0.2 + Math.min(0.1, (hierarchyDepth - 1) * 0.025)
  ).getHex();
}

function fileColor(file = {}, colorMode = "folders") {
  if (colorMode === "runtime") {
    return sideColor(file.executionSide);
  }
  if (colorMode === "subsystems") {
    const identity = file.subsystemId || file.packageId;
    return identity ? hashedColor(identity, { lightness: 0.5, saturation: 0.68 }) : 0x69758a;
  }
  return file.directoryDepth > 0
    ? directorySurfaceColor(file.directoryPath, file.directoryDepth)
    : campusSurfaceColor(file.campusId);
}

function boxGeometryWithFaceShading() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const normals = geometry.getAttribute("normal");
  const colors = [];
  for (let index = 0; index < normals.count; index += 1) {
    const normalX = normals.getX(index);
    const normalY = normals.getY(index);
    const shade = normalY > 0.5
      ? 1
      : normalY < -0.5
        ? 0.38
        : Math.abs(normalX) > 0.5
          ? 0.78
          : 0.62;
    colors.push(shade, shade, shade);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function createLabelAtlas(namesInput = [], maxAnisotropy = 1, {
  cellHeight = 64,
  cellWidth = 256,
  drawLabel = () => {},
  font = "700 24px ui-monospace, SFMono-Regular, Menlo, monospace"
} = {}) {
  const names = [...new Set(namesInput.map((name) => String(name || "")).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const columns = Math.max(1, Math.ceil(Math.sqrt(names.length * cellHeight / cellWidth)));
  const rows = Math.max(1, Math.ceil(names.length / columns));
  const canvas = document.createElement("canvas");
  canvas.width = nextPowerOfTwo(columns * cellWidth);
  canvas.height = nextPowerOfTwo(rows * cellHeight);
  const context = canvas.getContext("2d");
  const regions = new Map();
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";

  names.forEach((name, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    drawLabel({ cellHeight, cellWidth, context, name, x, y });
    regions.set(name, {
      u0: x / canvas.width,
      u1: (x + cellWidth) / canvas.width,
      v0: 1 - (y + cellHeight) / canvas.height,
      v1: 1 - y / canvas.height
    });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { regions, texture };
}

function createDirectoryLabelAtlas(directories = [], maxAnisotropy = 1) {
  return createLabelAtlas(
    directories.map((directory) => directory.name),
    maxAnisotropy,
    {
      drawLabel({ cellHeight, cellWidth, context, name, x, y }) {
        context.fillStyle = "rgba(4, 9, 18, 0.86)";
        context.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
        context.strokeStyle = "rgba(151, 213, 239, 0.72)";
        context.lineWidth = 2;
        context.strokeRect(x + 3, y + 3, cellWidth - 6, cellHeight - 6);
        context.fillStyle = "#f5f8ff";
        context.fillText(name, x + cellWidth / 2, y + cellHeight / 2, cellWidth - 24);
      }
    }
  );
}

function fileName(file = {}) {
  return String(file.path || "").split("/").filter(Boolean).pop() || "unnamed file";
}

function fileBuildingLabel(file = {}) {
  const name = fileName(file);
  if (file.semanticGroupKind !== "route") {
    return name;
  }
  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
}

function createFileLabelAtlas(buildings = [], maxAnisotropy = 1) {
  return createLabelAtlas(
    buildings.map(({ file }) => fileBuildingLabel(file)),
    maxAnisotropy,
    {
      cellHeight: 32,
      cellWidth: 160,
      drawLabel({ cellHeight, cellWidth, context, name, x, y }) {
        const centerX = x + cellWidth / 2;
        const centerY = y + cellHeight / 2;
        context.lineJoin = "round";
        context.lineWidth = 5;
        context.strokeStyle = "rgba(3, 7, 13, 0.96)";
        context.strokeText(name, centerX, centerY, cellWidth - 12);
        context.fillStyle = "#f8fbff";
        context.fillText(name, centerX, centerY, cellWidth - 12);
      },
      font: "700 16px ui-monospace, SFMono-Regular, Menlo, monospace"
    }
  );
}

function appendAtlasQuad(positions, uvs, corners, region) {
  const indices = [0, 1, 2, 0, 2, 3];
  const textureCoordinates = [
    [region.u0, region.v0],
    [region.u1, region.v0],
    [region.u1, region.v1],
    [region.u0, region.v1]
  ];
  for (const index of indices) {
    positions.push(...corners[index]);
    uvs.push(...textureCoordinates[index]);
  }
}

function createDirectorySurfaceLabels(directories = [], maxAnisotropy = 1) {
  if (directories.length === 0) {
    return null;
  }
  const { regions, texture } = createDirectoryLabelAtlas(directories, maxAnisotropy);
  const positions = [];
  const uvs = [];

  function plaqueDimensions(availableWidth, name) {
    const width = Math.max(5, Math.min(availableWidth - 3, Math.max(30, name.length * 8 + 18)));
    return {
      height: Math.max(5, Math.min(20, width * 0.24)),
      width
    };
  }

  for (const directory of directories) {
    const region = regions.get(directory.name);
    const halfWidth = directory.width / 2;
    const halfDepth = directory.depth / 2;
    const front = directory.z + directory.depth / 2 + 1;
    const back = directory.z - directory.depth / 2 - 1;
    const right = directory.x + directory.width / 2 + 1;
    const left = directory.x - directory.width / 2 - 1;
    const horizontal = plaqueDimensions(directory.width, directory.name);
    const vertical = plaqueDimensions(directory.depth, directory.name);
    const horizontalY1 = directory.elevation - 2;
    const horizontalY0 = horizontalY1 - horizontal.height;
    const horizontalX0 = directory.x - horizontal.width / 2;
    const horizontalX1 = directory.x + horizontal.width / 2;
    const verticalY1 = directory.elevation - 2;
    const verticalY0 = verticalY1 - vertical.height;
    const verticalZ0 = directory.z - vertical.width / 2;
    const verticalZ1 = directory.z + vertical.width / 2;

    appendAtlasQuad(positions, uvs, [
      [horizontalX0, horizontalY0, front],
      [horizontalX1, horizontalY0, front],
      [horizontalX1, horizontalY1, front],
      [horizontalX0, horizontalY1, front]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [horizontalX1, horizontalY0, back],
      [horizontalX0, horizontalY0, back],
      [horizontalX0, horizontalY1, back],
      [horizontalX1, horizontalY1, back]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [right, verticalY0, verticalZ1],
      [right, verticalY0, verticalZ0],
      [right, verticalY1, verticalZ0],
      [right, verticalY1, verticalZ1]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [left, verticalY0, verticalZ0],
      [left, verticalY0, verticalZ1],
      [left, verticalY1, verticalZ1],
      [left, verticalY1, verticalZ0]
    ], region);

    const topY = directory.elevation + 0.65;
    const topInset = 2;
    const horizontalTopDepth = Math.max(2, Math.min(horizontal.height, halfDepth - topInset));
    const verticalTopDepth = Math.max(2, Math.min(vertical.height, halfWidth - topInset));
    const frontTop = directory.z + halfDepth - horizontalTopDepth / 2 - topInset;
    const backTop = directory.z - halfDepth + horizontalTopDepth / 2 + topInset;
    const rightTop = directory.x + halfWidth - verticalTopDepth / 2 - topInset;
    const leftTop = directory.x - halfWidth + verticalTopDepth / 2 + topInset;

    appendAtlasQuad(positions, uvs, [
      [horizontalX0, topY, frontTop + horizontalTopDepth / 2],
      [horizontalX1, topY, frontTop + horizontalTopDepth / 2],
      [horizontalX1, topY, frontTop - horizontalTopDepth / 2],
      [horizontalX0, topY, frontTop - horizontalTopDepth / 2]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [horizontalX1, topY, backTop - horizontalTopDepth / 2],
      [horizontalX0, topY, backTop - horizontalTopDepth / 2],
      [horizontalX0, topY, backTop + horizontalTopDepth / 2],
      [horizontalX1, topY, backTop + horizontalTopDepth / 2]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [rightTop + verticalTopDepth / 2, topY, verticalZ1],
      [rightTop + verticalTopDepth / 2, topY, verticalZ0],
      [rightTop - verticalTopDepth / 2, topY, verticalZ0],
      [rightTop - verticalTopDepth / 2, topY, verticalZ1]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [leftTop - verticalTopDepth / 2, topY, verticalZ0],
      [leftTop - verticalTopDepth / 2, topY, verticalZ1],
      [leftTop + verticalTopDepth / 2, topY, verticalZ1],
      [leftTop + verticalTopDepth / 2, topY, verticalZ0]
    ], region);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  const labels = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      alphaTest: 0.06,
      depthWrite: false,
      map: texture,
      side: THREE.DoubleSide,
      transparent: true
    })
  );
  labels.renderOrder = 4;
  labels.userData.disposables = [texture];
  return labels;
}

function createFileSurfaceLabels(buildings = [], maxAnisotropy = 1) {
  if (buildings.length === 0) {
    return null;
  }
  const { regions, texture } = createFileLabelAtlas(buildings, maxAnisotropy);
  const positions = [];
  const uvs = [];

  for (const { elevation, file, height } of buildings) {
    const region = regions.get(fileBuildingLabel(file));
    const roofHeight = Math.max(1.2, Math.min(3, height * 0.025));
    const roofWidth = Math.max(3, file.cityWidth * 0.86);
    const roofDepth = Math.max(3, file.cityDepth * 0.86);
    const roofY = elevation + height + 1.6 + roofHeight / 2 + 0.15;

    if (roofWidth >= roofDepth) {
      const labelWidth = Math.max(2, roofWidth * 0.88);
      const labelDepth = Math.max(0.9, Math.min(roofDepth * 0.7, labelWidth * 0.2));
      appendAtlasQuad(positions, uvs, [
        [file.x - labelWidth / 2, roofY, file.z + labelDepth / 2],
        [file.x + labelWidth / 2, roofY, file.z + labelDepth / 2],
        [file.x + labelWidth / 2, roofY, file.z - labelDepth / 2],
        [file.x - labelWidth / 2, roofY, file.z - labelDepth / 2]
      ], region);
    } else {
      const labelDepth = Math.max(2, roofDepth * 0.88);
      const labelWidth = Math.max(0.9, Math.min(roofWidth * 0.7, labelDepth * 0.2));
      appendAtlasQuad(positions, uvs, [
        [file.x - labelWidth / 2, roofY, file.z - labelDepth / 2],
        [file.x - labelWidth / 2, roofY, file.z + labelDepth / 2],
        [file.x + labelWidth / 2, roofY, file.z + labelDepth / 2],
        [file.x + labelWidth / 2, roofY, file.z - labelDepth / 2]
      ], region);
    }

    const labelHeight = Math.max(3, height * 0.78);
    const y0 = elevation + 1 + (height - labelHeight) / 2;
    const y1 = y0 + labelHeight;
    const front = file.z + file.cityDepth / 2 + 0.42;
    const back = file.z - file.cityDepth / 2 - 0.42;
    const frontWidth = Math.max(1.1, Math.min(file.cityWidth * 0.7, labelHeight * 0.2));
    const frontX0 = file.x - frontWidth / 2;
    const frontX1 = file.x + frontWidth / 2;
    appendAtlasQuad(positions, uvs, [
      [frontX1, y0, front],
      [frontX1, y1, front],
      [frontX0, y1, front],
      [frontX0, y0, front]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [frontX0, y0, back],
      [frontX0, y1, back],
      [frontX1, y1, back],
      [frontX1, y0, back]
    ], region);

    const right = file.x + file.cityWidth / 2 + 0.42;
    const left = file.x - file.cityWidth / 2 - 0.42;
    const sideDepth = Math.max(1.1, Math.min(file.cityDepth * 0.7, labelHeight * 0.2));
    const sideZ0 = file.z - sideDepth / 2;
    const sideZ1 = file.z + sideDepth / 2;
    appendAtlasQuad(positions, uvs, [
      [right, y0, sideZ0],
      [right, y1, sideZ0],
      [right, y1, sideZ1],
      [right, y0, sideZ1]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [left, y0, sideZ1],
      [left, y1, sideZ1],
      [left, y1, sideZ0],
      [left, y0, sideZ0]
    ], region);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  const labels = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      alphaTest: 0.12,
      depthWrite: false,
      map: texture,
      side: THREE.DoubleSide,
      transparent: true
    })
  );
  labels.renderOrder = 3;
  labels.userData.disposables = [texture];
  return labels;
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  material?.dispose?.();
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    disposeMaterial(child.material);
    for (const disposable of child.userData.disposables || []) {
      disposable.dispose?.();
    }
    child.dispose?.();
  });
}

function textObject(text, {
  anchorX = "center",
  anchorY = "middle",
  color = 0xffffff,
  fontSize = 16,
  maxWidth = 220,
  onSync = () => {},
  position = new THREE.Vector3()
} = {}) {
  const label = new Text();
  label.text = String(text || "");
  label.color = color;
  label.fontSize = fontSize;
  label.maxWidth = maxWidth;
  label.anchorX = anchorX;
  label.anchorY = anchorY;
  label.outlineColor = 0x06101c;
  label.outlineWidth = Math.max(0.5, fontSize * 0.045);
  label.position.copy(position);
  label.userData.billboard = true;
  label.sync(onSync);
  return label;
}

function fileContextConnector(from, to, {
  color = 0xffffff,
  dashed = false,
  elevation = 70,
  opacity = 0.7
} = {}) {
  const middle = from.clone().lerp(to, 0.5);
  middle.y = Math.max(from.y, to.y) + elevation;
  const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
  const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(36));
  const material = dashed
    ? new THREE.LineDashedMaterial({
      color,
      dashSize: 12,
      gapSize: 7,
      depthTest: false,
      depthWrite: false,
      opacity,
      transparent: true
    })
    : new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      opacity,
      transparent: true
    });
  const line = new THREE.Line(geometry, material);
  if (dashed) {
    line.computeLineDistances();
  }
  line.renderOrder = 11;
  const arrowSize = 4.8;
  const direction = curve.getTangent(1).normalize();
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(arrowSize, arrowSize * 2.5, 8),
    new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      opacity,
      transparent: true
    })
  );
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  arrow.position.copy(to).addScaledVector(direction, -arrowSize * 0.9);
  arrow.renderOrder = 11;
  const sourceMarker = new THREE.Mesh(
    new THREE.SphereGeometry(2.8, 8, 6),
    new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      opacity,
      transparent: true
    })
  );
  sourceMarker.position.copy(from);
  sourceMarker.renderOrder = 11;
  const group = new THREE.Group();
  group.userData.kind = "file-context-connection";
  group.add(line, arrow, sourceMarker);
  return group;
}

function subsystemTether(from, to, relation = "supports") {
  const midpoint = from.clone().lerp(to, 0.5);
  midpoint.y = from.y * 0.56 + to.y * 0.44;
  const curve = new THREE.QuadraticBezierCurve3(from, midpoint, to);
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(curve.getPoints(28)),
    new THREE.LineBasicMaterial({
      color: SUBSYSTEM_TETHER_COLORS[relation] || SUBSYSTEM_TETHER_COLORS.supports,
      opacity: 0.88,
      transparent: true
    })
  );
}

function dependencyEvidenceTether(from, to, color) {
  const midpoint = from.clone().lerp(to, 0.5);
  midpoint.y = from.y * 0.58 + to.y * 0.42;
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      new THREE.QuadraticBezierCurve3(from, midpoint, to).getPoints(24)
    ),
    new THREE.LineBasicMaterial({
      color,
      opacity: 0.5,
      transparent: true
    })
  );
}

function fileDependencyConnector(from, to, color, weight = 1) {
  const midpoint = from.clone().lerp(to, 0.5);
  midpoint.y = Math.max(from.y, to.y) + 18 + Math.min(70, from.distanceTo(to) * 0.08);
  const curve = new THREE.QuadraticBezierCurve3(from, midpoint, to);
  const points = curve.getPoints(24);
  const material = new THREE.LineBasicMaterial({
    color,
    depthTest: true,
    depthWrite: false,
    opacity: 0.94,
    transparent: true
  });
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    material
  );
  line.renderOrder = 7;
  const arrowSize = 3 + Math.min(2.5, Math.log2(Math.max(1, weight) + 1) * 0.75);
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(arrowSize, arrowSize * 2.5, 7),
    new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: false })
  );
  const direction = points.at(-1).clone().sub(points.at(-2)).normalize();
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  arrow.position.copy(points.at(-1)).addScaledVector(direction, -arrowSize * 0.8);
  arrow.renderOrder = 7;
  const sourceMarker = new THREE.Mesh(
    new THREE.SphereGeometry(arrowSize * 0.58, 8, 6),
    new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: false })
  );
  sourceMarker.position.copy(points[0]);
  sourceMarker.renderOrder = 7;
  const group = new THREE.Group();
  group.add(line, arrow, sourceMarker);
  return group;
}

function subsystemBundleConnector(from, to, color) {
  const middle = from.clone().lerp(to, 0.5);
  middle.y = Math.max(from.y, to.y) + 52 + Math.min(120, from.distanceTo(to) * 0.1);
  const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
  const points = curve.getPoints(32);
  const material = new THREE.LineBasicMaterial({
    color,
    depthTest: true,
    depthWrite: false,
    opacity: 0.94,
    transparent: true
  });
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    material
  );
  line.renderOrder = 8;
  const arrowSize = 3.8;
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(arrowSize, arrowSize * 2.5, 8),
    new THREE.MeshBasicMaterial({
      color,
      depthTest: true,
      depthWrite: false,
      opacity: 0.94,
      transparent: true
    })
  );
  const direction = points.at(-1).clone().sub(points.at(-2)).normalize();
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  arrow.position.copy(points.at(-1)).addScaledVector(direction, -arrowSize * 0.8);
  arrow.renderOrder = 8;
  const object = new THREE.Group();
  object.add(line, arrow);
  return {
    object,
    pickables: [line, arrow]
  };
}

function subsystemBundleColor(weight = 1) {
  const density = Math.min(1, Math.log2(Math.max(1, weight)) / 4);
  return new THREE.Color(0xd4d7dc)
    .lerp(new THREE.Color(0x171a1f), density)
    .getHex();
}

function subsystemLastMileConnector(from, to) {
  const middle = from.clone().lerp(to, 0.5);
  middle.y = Math.max(from.y, to.y) + 14 + Math.min(46, from.distanceTo(to) * 0.08);
  const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(curve.getPoints(20)),
    new THREE.LineBasicMaterial({
      color: SUBSYSTEM_LAST_MILE_COLOR,
      depthTest: true,
      depthWrite: false,
      opacity: 0.9,
      transparent: true
    })
  );
  line.renderOrder = 9;
  return line;
}

function subsystemDependencyConnector(from, to, weight = 1, kinds = []) {
  const middle = from.clone().lerp(to, 0.5);
  middle.y += 34 + Math.min(72, Math.log2(Math.max(1, weight) + 1) * 13);
  const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
  const points = curve.getPoints(32);
  const color = systemConnectionColor(kinds);
  const declarationOnly = kinds.length === 1 && kinds[0] === "declaration";
  const lineMaterial = declarationOnly
    ? new THREE.LineDashedMaterial({
        color,
        dashSize: 10,
        gapSize: 7,
        opacity: 0.82,
        transparent: true
      })
    : new THREE.LineBasicMaterial({ color, opacity: 0.94, transparent: true });
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    lineMaterial
  );
  if (declarationOnly) {
    line.computeLineDistances();
  }
  const arrowSize = 4 + Math.min(5, Math.log2(Math.max(1, weight) + 1));
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color
  });
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(arrowSize, arrowSize * 2.4, 8),
    arrowMaterial
  );
  const direction = points.at(-1).clone().sub(points.at(-2)).normalize();
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  arrow.position.copy(points.at(-1)).addScaledVector(direction, -arrowSize * 0.85);
  const object = new THREE.Group();
  object.add(line, arrow);
  object.visible = false;
  return {
    arrowMaterial,
    lineMaterial,
    object,
    setColor(color) {
      lineMaterial.color.setHex(color);
      arrowMaterial.color.setHex(color);
    }
  };
}

function createSystemWorld({
  canvas,
  onClearSelection = () => {},
  onEditSubsystemDepth = () => {},
  onHoverSubsystemConnection = () => {},
  onOpenFile = () => {},
  onSelectDirectory = () => {},
  onSelectFile = () => {},
  onSelectPrecinct = () => {},
  onSelectSubsystem = () => {},
  onSelectSubsystemConnection = () => {},
  reducedMotion = false
} = {}) {
  if (!canvas) {
    throw new TypeError("createSystemWorld requires a canvas.");
  }

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    powerPreference: "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(1.15, globalThis.devicePixelRatio || 1));
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050914);
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 16_000);
  camera.position.set(0, 980, 1_150);
  const controls = new CameraControls(camera, canvas);
  controls.dollyToCursor = true;
  controls.infinityDolly = false;
  controls.draggingSmoothTime = 0;
  controls.smoothTime = reducedMotion ? 0 : 0.18;
  controls.azimuthRotateSpeed = 0.32;
  controls.polarRotateSpeed = 0.28;
  controls.dollySpeed = 1.15;
  controls.truckSpeed = 2.2;
  controls.minDistance = 55;
  controls.maxDistance = 12_000;
  controls.minPolarAngle = Math.PI * 0.02;
  controls.maxPolarAngle = Math.PI * 0.98;
  controls.mouseButtons.left = CameraControls.ACTION.NONE;
  controls.mouseButtons.middle = CameraControls.ACTION.TRUCK;
  controls.mouseButtons.right = CameraControls.ACTION.ROTATE;
  controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
  controls.touches.one = CameraControls.ACTION.TOUCH_TRUCK;
  controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_ROTATE;
  controls.setLookAt(0, 980, 1_150, 0, 0, 0, false);

  const worldRoot = new THREE.Group();
  const subsystemRoot = new THREE.Group();
  const contextRoot = new THREE.Group();
  const subsystemOwnershipRoot = new THREE.Group();
  const filePortalRoot = new THREE.Group();
  const fileTravelRoot = new THREE.Group();
  scene.add(
    worldRoot,
    subsystemRoot,
    contextRoot,
    subsystemOwnershipRoot,
    fileTravelRoot,
    filePortalRoot
  );

  const pickables = [];
  const campusObjects = new Map();
  const dependencyObjects = [];
  const externalSatelliteObjects = [];
  const fileObjects = new Map();
  const directoryObjects = new Map();
  const subsystemObjects = new Map();
  const subsystemConnectionObjects = new Map();
  const subsystemConnectionPickables = [];
  const raycaster = new THREE.Raycaster();
  const navigationPointer = new THREE.Vector2();
  const pointer = new THREE.Vector2();
  let active = true;
  let buildingEdgeLines = null;
  let buildingInstances = null;
  let cityLayout = null;
  let subsystemLayout = null;
  let viewMode = "folders";
  let directoryTerraceInstances = null;
  let dependencyEvidenceFileIds = new Set();
  let dependencyEvidenceRoot = null;
  let dirty = true;
  let externalContextRoot = null;
  let filePortal = null;
  let fileTravel = null;
  let grabState = null;
  let hoveredSubsystemConnectionId = "";
  let lastTouchFileTap = { at: -Infinity, fileId: "" };
  let lastFrame = performance.now();
  let pointerDown = null;
  let roofInstances = null;
  let selectedCampusId = null;
  let selectedDirectoryPath = null;
  let selectedFileId = "";
  let selectedSubsystemId = "";
  let subsystemConnectionsVisible = false;
  let subsystemConnectionRoot = null;
  let selectedSubsystemConnectionId = "";
  let subsystemBundledEdgeIds = new Set();
  let subsystemBundleRelevantDirectoryPaths = new Set();
  let subsystemBundleRelevantFileIds = new Set();
  let subsystemFileEvidenceVisible = false;
  let subsystemLibrariesVisible = false;
  let neighborFileIds = new Set();
  let wheelGestureAction = CameraControls.ACTION.DOLLY;
  let wheelGestureAt = -Infinity;
  let suppressSyntheticDoubleClickUntil = -Infinity;

  function markDirty() {
    dirty = true;
  }

  function clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children.pop();
      disposeObject(child);
    }
  }

  function clearWorld() {
    clearSubsystemConnectionHover();
    clearGroup(worldRoot);
    clearGroup(subsystemRoot);
    clearGroup(contextRoot);
    clearGroup(subsystemOwnershipRoot);
    clearGroup(filePortalRoot);
    clearGroup(fileTravelRoot);
    pickables.splice(0);
    campusObjects.clear();
    dependencyObjects.splice(0);
    externalSatelliteObjects.splice(0);
    fileObjects.clear();
    directoryObjects.clear();
    subsystemObjects.clear();
    subsystemConnectionObjects.clear();
    subsystemConnectionPickables.splice(0);
    selectedDirectoryPath = null;
    selectedFileId = "";
    selectedSubsystemId = "";
    selectedSubsystemConnectionId = "";
    subsystemBundledEdgeIds = new Set();
    subsystemBundleRelevantDirectoryPaths = new Set();
    subsystemBundleRelevantFileIds = new Set();
    neighborFileIds = new Set();
    buildingEdgeLines = null;
    buildingInstances = null;
    directoryTerraceInstances = null;
    dependencyEvidenceFileIds = new Set();
    dependencyEvidenceRoot = null;
    externalContextRoot = null;
    filePortal = null;
    fileTravel = null;
    subsystemConnectionRoot = null;
    roofInstances = null;
    selectedCampusId = null;
    subsystemLayout = null;
    markDirty();
  }

  function clearContext() {
    clearGroup(contextRoot);
    neighborFileIds = new Set();
  }

  function addLabel(group, value, options = {}) {
    const label = textObject(value, { ...options, onSync: markDirty });
    group.add(label);
    return label;
  }

  function addGround(layout) {
    addLabel(worldRoot, "CURRENT SESSION · FILE CITY", {
      color: 0x8edfff,
      fontSize: 30,
      maxWidth: 620,
      position: new THREE.Vector3(0, 48, -layout.bounds.depth / 2 - 35)
    });
    for (const campus of layout.campuses) {
      const color = campusSurfaceColor(campus.id);
      const rimColor = new THREE.Color(color).offsetHSL(0, 0.16, 0.28).getHex();
      const floors = [];
      const rims = [];
      for (const stratum of campus.subsystemStrata || [{ depth: 0, elevation: 0 }]) {
        const subsystemDepth = stratum.depth;
        const floor = new THREE.Mesh(
          new THREE.BoxGeometry(campus.width + 24, 28, campus.depth + 24),
          new THREE.MeshBasicMaterial({ color })
        );
        floor.position.set(campus.x, stratum.elevation - 16, campus.z);
        floor.userData.campusId = campus.id;
        floor.userData.kind = "campus";
        floor.userData.subsystemDepth = subsystemDepth;
        worldRoot.add(floor);
        const rim = new THREE.LineSegments(
          new THREE.EdgesGeometry(floor.geometry),
          new THREE.LineBasicMaterial({ color: rimColor })
        );
        rim.position.copy(floor.position);
        worldRoot.add(rim);
        pickables.push(floor);
        floors.push(floor);
        rims.push(rim);
        addLabel(worldRoot, subsystemDepth
          ? `${campus.title.toUpperCase()} · LAYER −${subsystemDepth}`
          : campus.title.toUpperCase(), {
          color: 0xd9f3ff,
          fontSize: campus.implicit ? 18 : 22,
          maxWidth: Math.max(140, campus.width - 20),
          position: new THREE.Vector3(
            campus.x,
            stratum.elevation + 24,
            campus.z - campus.depth / 2 + 22
          )
        });
      }
      campusObjects.set(campus.id, { baseColor: color, campus, floors, rims, rimColor });
    }
  }

  function addDirectoryPrecincts(layout) {
    const directories = [...layout.directories].sort((left, right) => (
      left.hierarchyDepth - right.hierarchyDepth || left.path.localeCompare(right.path)
    ));
    const terraceEntries = [];
    directories.forEach((directory, directoryIndex) => {
      const terraceColor = new THREE.Color(directorySurfaceColor(
        directory.path,
        directory.hierarchyDepth
      ));
      terraceEntries.push({
        color: terraceColor,
        directoryPath: directory.path,
        position: [
          directory.x,
          directory.supportElevation + directory.terraceHeight / 2,
          directory.z
        ],
        scale: [directory.width, directory.terraceHeight, directory.depth]
      });
      directoryObjects.set(directory.path, {
        baseColor: terraceColor.getHex(),
        directory,
        index: directoryIndex
      });

    });

    if (terraceEntries.length > 0) {
      directoryTerraceInstances = new THREE.InstancedMesh(
        boxGeometryWithFaceShading(),
        new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
        terraceEntries.length
      );
      directoryTerraceInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      directoryTerraceInstances.userData.directoryPaths = [];
      directoryTerraceInstances.userData.kind = "directory-terraces";
      const transform = new THREE.Object3D();
      terraceEntries.forEach((entry, index) => {
        transform.position.set(...entry.position);
        transform.scale.set(...entry.scale);
        transform.updateMatrix();
        directoryTerraceInstances.setMatrixAt(index, transform.matrix);
        directoryTerraceInstances.setColorAt(index, entry.color);
        directoryTerraceInstances.userData.directoryPaths[index] = entry.directoryPath;
      });
      directoryTerraceInstances.instanceColor.needsUpdate = true;
      directoryTerraceInstances.computeBoundingBox();
      directoryTerraceInstances.computeBoundingSphere();
      worldRoot.add(directoryTerraceInstances);
      pickables.push(directoryTerraceInstances);
    }

    const surfaceLabels = createDirectorySurfaceLabels(
      directories,
      renderer.capabilities.getMaxAnisotropy()
    );
    if (surfaceLabels) {
      worldRoot.add(surfaceLabels);
    }
  }

  function addFileBuildings(layout) {
    if (layout.files.length === 0) {
      return;
    }
    const largest = Math.max(1, Number(layout.lineStats.largest) || 1);
    const buildingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true
    });
    const roofMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true
    });
    buildingInstances = new THREE.InstancedMesh(
      boxGeometryWithFaceShading(),
      buildingMaterial,
      layout.files.length
    );
    roofInstances = new THREE.InstancedMesh(
      boxGeometryWithFaceShading(),
      roofMaterial,
      layout.files.length
    );
    buildingInstances.userData.fileIds = [];
    buildingInstances.userData.kind = "file-buildings";
    buildingInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    roofInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const edgePositions = [];
    const fileLabelBuildings = [];
    const transform = new THREE.Object3D();

    layout.files.forEach((file, index) => {
      const height = Number(file.buildingHeight) || fileBuildingHeight(file.lines, largest);
      const baseColor = fileColor(file, viewMode);
      const elevation = Number(file.elevation) || 0;
      transform.position.set(file.x, elevation + height / 2 + 1, file.z);
      transform.scale.set(file.cityWidth, height, file.cityDepth);
      transform.updateMatrix();
      buildingInstances.setMatrixAt(index, transform.matrix);
      buildingInstances.setColorAt(index, new THREE.Color(baseColor));

      const roofHeight = Math.max(1.2, Math.min(3, height * 0.025));
      transform.position.set(file.x, elevation + height + 1.6, file.z);
      transform.scale.set(
        Math.max(3, file.cityWidth * 0.86),
        roofHeight,
        Math.max(3, file.cityDepth * 0.86)
      );
      transform.updateMatrix();
      roofInstances.setMatrixAt(index, transform.matrix);
      const roofColor = new THREE.Color(baseColor).offsetHSL(0, -0.08, 0.16).getHex();
      roofInstances.setColorAt(index, new THREE.Color(roofColor));
      buildingInstances.userData.fileIds[index] = file.id;

      const halfWidth = file.cityWidth / 2 + 0.35;
      const halfDepth = file.cityDepth / 2 + 0.35;
      const edgeBottom = elevation + 0.8;
      const edgeTop = elevation + height + 1.4;
      const corners = [
        [file.x - halfWidth, edgeBottom, file.z - halfDepth],
        [file.x + halfWidth, edgeBottom, file.z - halfDepth],
        [file.x + halfWidth, edgeBottom, file.z + halfDepth],
        [file.x - halfWidth, edgeBottom, file.z + halfDepth],
        [file.x - halfWidth, edgeTop, file.z - halfDepth],
        [file.x + halfWidth, edgeTop, file.z - halfDepth],
        [file.x + halfWidth, edgeTop, file.z + halfDepth],
        [file.x - halfWidth, edgeTop, file.z + halfDepth]
      ];
      appendBoxEdges(edgePositions, corners);

      const record = {
        baseColor,
        file,
        height,
        index,
        roofColor
      };
      fileObjects.set(file.id, record);
      fileLabelBuildings.push({ elevation, file, height });
    });
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    buildingEdgeLines = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: 0x6b7280,
        depthWrite: false
      })
    );
    buildingEdgeLines.renderOrder = 2;
    buildingInstances.instanceColor.needsUpdate = true;
    roofInstances.instanceColor.needsUpdate = true;
    buildingInstances.computeBoundingBox();
    buildingInstances.computeBoundingSphere();
    roofInstances.computeBoundingBox();
    roofInstances.computeBoundingSphere();
    worldRoot.add(buildingInstances, roofInstances, buildingEdgeLines);
    const surfaceLabels = createFileSurfaceLabels(
      fileLabelBuildings,
      renderer.capabilities.getMaxAnisotropy()
    );
    if (surfaceLabels) {
      worldRoot.add(surfaceLabels);
    }
    pickables.push(buildingInstances);
  }

  function addSubsystemSky(overview, layout) {
    subsystemLayout = layoutSubsystemSky(layout, overview.subsystems || []);
    if (subsystemLayout.subsystems.length === 0) {
      subsystemRoot.visible = false;
      return;
    }
    addLabel(subsystemRoot, "SUBSYSTEM SKY · WHY THE CODE EXISTS", {
      color: 0xc8f4ff,
      fontSize: 24,
      maxWidth: 620,
      position: new THREE.Vector3(0, subsystemLayout.elevation + 36, -layout.bounds.depth / 2 - 60)
    });
    for (const subsystem of subsystemLayout.subsystems) {
      const baseColor = hashedColor(subsystem.id, { lightness: 0.48, saturation: 0.62 });
      const group = new THREE.Group();
      group.position.set(subsystem.x, subsystem.y, subsystem.z);
      const island = new THREE.Mesh(
        new THREE.CylinderGeometry(subsystem.radius, subsystem.radius * 0.9, 12, 40),
        new THREE.MeshBasicMaterial({
          color: baseColor,
          depthWrite: false,
          opacity: 0.8,
          transparent: true
        })
      );
      island.userData.kind = "subsystem";
      island.userData.subsystemId = subsystem.id;
      group.add(island);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(subsystem.radius * 0.78, subsystem.radius * 1.04, 48),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(baseColor).offsetHSL(0, -0.04, 0.2),
          depthWrite: false,
          opacity: 0.9,
          side: THREE.DoubleSide,
          transparent: true
        })
      );
      ring.position.y = 7;
      ring.rotation.x = -Math.PI / 2;
      group.add(ring);
      const fileLabel = `${subsystem.fileCount} ${subsystem.fileCount === 1 ? "file" : "files"}`;
      const capabilityLabel = `${subsystem.capabilities.length} ${subsystem.capabilities.length === 1 ? "capability" : "capabilities"}`;
      const layerLabel = subsystem.subsystemDepth
        ? `layer −${subsystem.subsystemDepth}`
        : "baseline";
      const dependencies = subsystem.dependencies || { external: [], incoming: [], outgoing: [] };
      const dependencyLabel = `out ${dependencies.outgoing.length} · in ${dependencies.incoming.length} · external ${dependencies.external.length}`;
      const label = addLabel(group, `${subsystem.title}\n${layerLabel} · ${fileLabel} · ${capabilityLabel}\n${dependencyLabel}`, {
        color: 0xffffff,
        fontSize: Math.max(12, Math.min(18, subsystem.radius * 0.16)),
        maxWidth: subsystem.radius * 1.65,
        position: new THREE.Vector3(0, 25, 0)
      });
      subsystemRoot.add(group);
      pickables.push(island);

      const tethers = subsystem.targets.map((target) => {
        const from = new THREE.Vector3(subsystem.x, subsystem.y - 6, subsystem.z);
        const to = target.fileId
          ? buildingTop(target.fileId) || new THREE.Vector3(target.x, target.elevation + 2, target.z)
          : new THREE.Vector3(target.x, target.elevation + 2, target.z);
        const line = subsystemTether(from, to, target.relation);
        line.visible = false;
        subsystemRoot.add(line);
        return line;
      });
      subsystemObjects.set(subsystem.id, {
        baseColor,
        group,
        island,
        label,
        ring,
        subsystem,
        tethers
      });
    }
    for (const dependency of subsystemLayout.dependencyEdges) {
      const fromRecord = subsystemObjects.get(dependency.fromSubsystemId);
      const toRecord = subsystemObjects.get(dependency.toSubsystemId);
      if (!fromRecord || !toRecord) {
        continue;
      }
      const direction = new THREE.Vector3(
        toRecord.subsystem.x - fromRecord.subsystem.x,
        0,
        toRecord.subsystem.z - fromRecord.subsystem.z
      ).normalize();
      const from = new THREE.Vector3(
        fromRecord.subsystem.x,
        fromRecord.subsystem.y + 8,
        fromRecord.subsystem.z
      ).addScaledVector(direction, fromRecord.subsystem.radius * 0.82);
      const to = new THREE.Vector3(
        toRecord.subsystem.x,
        toRecord.subsystem.y + 8,
        toRecord.subsystem.z
      ).addScaledVector(direction, -toRecord.subsystem.radius * 0.88);
      const connector = subsystemDependencyConnector(
        from,
        to,
        dependency.connectionCount,
        dependency.kinds
      );
      subsystemRoot.add(connector.object);
      dependencyObjects.push({
        ...dependency,
        connector
      });
    }
    externalContextRoot = new THREE.Group();
    dependencyEvidenceRoot = new THREE.Group();
    subsystemConnectionRoot = new THREE.Group();
    subsystemRoot.add(dependencyEvidenceRoot, subsystemConnectionRoot, externalContextRoot);
    subsystemRoot.visible = viewMode === "subsystems";
  }

  function clearDependencyEvidence() {
    if (dependencyEvidenceRoot) {
      clearGroup(dependencyEvidenceRoot);
    }
    dependencyEvidenceFileIds = new Set();
  }

  function clearSubsystemConnectionBundles() {
    clearSubsystemConnectionHover();
    if (subsystemConnectionRoot) {
      clearGroup(subsystemConnectionRoot);
    }
    subsystemConnectionObjects.clear();
    subsystemConnectionPickables.splice(0);
    subsystemBundledEdgeIds = new Set();
    subsystemBundleRelevantDirectoryPaths = new Set();
    subsystemBundleRelevantFileIds = new Set();
  }

  function clearSubsystemConnectionSelection({ notify = true } = {}) {
    const hadSelection = Boolean(selectedSubsystemConnectionId);
    selectedSubsystemConnectionId = "";
    if (hadSelection && notify) {
      onSelectSubsystemConnection(null);
    }
  }

  function directoryConnectionDockPosition(directory = {}, bundleId = "") {
    const hash = stableHash(bundleId);
    const side = hash % 4;
    const position = ((hash >>> 2) % 1_000) / 1_000;
    const xInset = Math.min(12, Math.max(5, directory.width * 0.08));
    const zInset = Math.min(12, Math.max(5, directory.depth * 0.08));
    const x = directory.x - directory.width / 2 + xInset + position * Math.max(0, directory.width - xInset * 2);
    const z = directory.z - directory.depth / 2 + zInset + position * Math.max(0, directory.depth - zInset * 2);
    if (side === 0) {
      return new THREE.Vector3(x, directory.elevation + 9, directory.z + directory.depth / 2 - zInset);
    }
    if (side === 1) {
      return new THREE.Vector3(directory.x + directory.width / 2 - xInset, directory.elevation + 9, z);
    }
    if (side === 2) {
      return new THREE.Vector3(x, directory.elevation + 9, directory.z - directory.depth / 2 + zInset);
    }
    return new THREE.Vector3(directory.x - directory.width / 2 + xInset, directory.elevation + 9, z);
  }

  function subsystemConnectionEndpoint(bundle = {}) {
    if (bundle.collectionKind === "directory") {
      const directory = directoryObjects.get(bundle.collectionPath)?.directory;
      if (directory) {
        return directoryConnectionDockPosition(directory, bundle.id);
      }
    }
    if (bundle.collectionKind === "file") {
      const position = buildingTop(bundle.collectionFileId);
      if (position) {
        const direction = stableHash(bundle.id) % 2 === 0 ? 1 : -1;
        return position.add(new THREE.Vector3(direction * 7, 22, direction * 5));
      }
    }
    const subsystem = subsystemObjects.get(bundle.consumerSubsystemId)?.subsystem;
    return subsystem
      ? new THREE.Vector3(subsystem.x, subsystem.y - 9, subsystem.z)
      : null;
  }

  function subsystemConnectionSource(bundle = {}) {
    if (bundle.providerFileIds.length === 1) {
      const position = buildingTop(bundle.providerFileIds[0]);
      if (position) {
        return position;
      }
    }
    const subsystem = subsystemObjects.get(bundle.providerSubsystemId)?.subsystem;
    return subsystem
      ? new THREE.Vector3(subsystem.x, subsystem.y - 9, subsystem.z)
      : null;
  }

  function showSubsystemConnectionBundles(subsystemId = "") {
    clearSubsystemConnectionBundles();
    if (!subsystemConnectionRoot || !subsystemConnectionsVisible || !subsystemId) {
      selectedSubsystemConnectionId = "";
      return;
    }
    const bundles = layoutSubsystemConnectionBundles(cityLayout, subsystemLayout, subsystemId);
    if (!bundles.some((bundle) => bundle.id === selectedSubsystemConnectionId)) {
      selectedSubsystemConnectionId = "";
    }
    for (const bundle of bundles) {
      const from = subsystemConnectionSource(bundle);
      const to = subsystemConnectionEndpoint(bundle);
      if (!from || !to) {
        continue;
      }
      const color = subsystemBundleColor(Math.max(bundle.connectionCount, bundle.usageCount));
      const connector = subsystemBundleConnector(from, to, color);
      for (const pickable of connector.pickables) {
        pickable.userData.kind = "subsystem-connection";
        pickable.userData.subsystemConnectionId = bundle.id;
        subsystemConnectionPickables.push(pickable);
      }
      subsystemConnectionRoot.add(connector.object);
      const expanded = bundle.id === selectedSubsystemConnectionId;
      const dockRadius = 8.5 + Math.min(3.5, Math.log2(bundle.usageCount + 1) * 0.55);
      const dock = new THREE.Mesh(
        new THREE.CylinderGeometry(dockRadius, dockRadius * 1.18, 16, 12),
        new THREE.MeshBasicMaterial({
          color: expanded ? SUBSYSTEM_LAST_MILE_COLOR : 0xf1f5f9,
          depthTest: false,
          depthWrite: false
        })
      );
      dock.position.copy(to);
      dock.renderOrder = 9;
      dock.userData.kind = "subsystem-connection";
      dock.userData.subsystemConnectionId = bundle.id;
      subsystemConnectionPickables.push(dock);
      subsystemConnectionRoot.add(dock);
      if (bundle.collectionKind === "directory") {
        subsystemBundleRelevantDirectoryPaths.add(bundle.collectionPath);
      }
      if (bundle.collectionKind === "file" && bundle.collectionFileId) {
        subsystemBundleRelevantFileIds.add(bundle.collectionFileId);
      }
      for (const fileId of bundle.providerFileIds) {
        subsystemBundleRelevantFileIds.add(fileId);
      }
      subsystemBundledEdgeIds.add(bundle.edgeId);
      if (expanded) {
        for (const fileId of bundle.providerFileIds) {
          subsystemBundleRelevantFileIds.add(fileId);
        }
        for (const fileId of bundle.consumerFileIds) {
          const building = buildingTop(fileId);
          if (!building) {
            continue;
          }
          subsystemBundleRelevantFileIds.add(fileId);
          subsystemConnectionRoot.add(subsystemLastMileConnector(to, building));
        }
      }
      subsystemConnectionObjects.set(bundle.id, {
        bundle,
        connector,
        dock,
        expanded
      });
    }
  }

  function selectSubsystemConnection(subsystemConnectionId = "") {
    const nextId = String(subsystemConnectionId || "");
    selectedSubsystemConnectionId = nextId === selectedSubsystemConnectionId ? "" : nextId;
    selectedFileId = "";
    showSubsystemConnectionBundles(selectedSubsystemId);
    applySelectionStyles();
    const selected = subsystemConnectionObjects.get(selectedSubsystemConnectionId);
    onSelectSubsystemConnection(selected
      ? { ...selected.bundle, expanded: true }
      : null);
  }

  function selectSubsystemConnectionFile(fileId = "") {
    const selected = subsystemConnectionObjects.get(selectedSubsystemConnectionId)?.bundle;
    const normalizedFileId = String(fileId || "");
    if (!selected?.consumerFileIds.includes(normalizedFileId)) {
      return false;
    }
    selectedFileId = normalizedFileId;
    applySelectionStyles();
    return true;
  }

  function showSubsystemOwnership(subsystemId = "") {
    clearGroup(subsystemOwnershipRoot);
    if (!subsystemId) {
      return;
    }
    const positions = [];
    for (const record of fileObjects.values()) {
      if (!(record.file.subsystemIds || []).includes(subsystemId)) {
        continue;
      }
      const halfWidth = record.file.cityWidth / 2 + 0.8;
      const halfDepth = record.file.cityDepth / 2 + 0.8;
      const edgeBottom = (Number(record.file.elevation) || 0) + 0.5;
      const edgeTop = edgeBottom + record.height + 2.2;
      appendBoxEdges(positions, [
        [record.file.x - halfWidth, edgeBottom, record.file.z - halfDepth],
        [record.file.x + halfWidth, edgeBottom, record.file.z - halfDepth],
        [record.file.x + halfWidth, edgeBottom, record.file.z + halfDepth],
        [record.file.x - halfWidth, edgeBottom, record.file.z + halfDepth],
        [record.file.x - halfWidth, edgeTop, record.file.z - halfDepth],
        [record.file.x + halfWidth, edgeTop, record.file.z - halfDepth],
        [record.file.x + halfWidth, edgeTop, record.file.z + halfDepth],
        [record.file.x - halfWidth, edgeTop, record.file.z + halfDepth]
      ]);
    }
    if (positions.length === 0) {
      return;
    }
    const outline = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3)
      ),
      new THREE.LineBasicMaterial({
        color: SELECTED_FILE_COLOR,
        depthTest: false,
        depthWrite: false,
        opacity: 0.95,
        transparent: true
      })
    );
    outline.renderOrder = 8;
    subsystemOwnershipRoot.add(outline);
  }

  function clearExternalSatellites() {
    if (externalContextRoot) {
      clearGroup(externalContextRoot);
    }
    externalSatelliteObjects.splice(0);
  }

  function showExternalSatellites(subsystemId = "") {
    clearExternalSatellites();
    if (!externalContextRoot || !subsystemId || !subsystemLibrariesVisible) {
      return;
    }
    for (const satellite of subsystemLayout?.externalSatellites || []) {
      if (satellite.ownerSubsystemId !== subsystemId) {
        continue;
      }
      const ownerRecord = subsystemObjects.get(satellite.ownerSubsystemId);
      if (!ownerRecord) {
        continue;
      }
      const color = SUBSYSTEM_DEPENDENCY_COLORS.external;
      const group = new THREE.Group();
      group.position.set(satellite.x, satellite.y, satellite.z);
      const body = new THREE.Mesh(
        new THREE.DodecahedronGeometry(satellite.radius, 0),
        new THREE.MeshBasicMaterial({ color, opacity: 0.92, transparent: true })
      );
      group.add(body);
      const importLabel = `${satellite.importCount} ${satellite.importCount === 1 ? "import" : "imports"}`;
      const label = addLabel(group, `${satellite.title}\n${importLabel}`, {
        color: 0xf7f1ff,
        fontSize: Math.max(9, satellite.radius * 0.62),
        maxWidth: 130,
        position: new THREE.Vector3(0, satellite.radius + 13, 0)
      });
      const fromCenter = new THREE.Vector3(
        ownerRecord.subsystem.x,
        ownerRecord.subsystem.y + 10,
        ownerRecord.subsystem.z
      );
      const toCenter = new THREE.Vector3(satellite.x, satellite.y, satellite.z);
      const direction = toCenter.clone().sub(fromCenter).normalize();
      const from = fromCenter.clone().addScaledVector(direction, ownerRecord.subsystem.radius * 0.82);
      const to = toCenter.clone().addScaledVector(direction, -satellite.radius * 0.9);
      const connector = subsystemDependencyConnector(from, to, satellite.importCount);
      connector.setColor(color);
      externalContextRoot.add(connector.object, group);
      externalSatelliteObjects.push({
        body,
        connector,
        group,
        label,
        satellite
      });
    }
  }

  function showDependencyEvidence(subsystemId = "") {
    clearDependencyEvidence();
    if (!dependencyEvidenceRoot || !subsystemId) {
      return;
    }

    const evidenceFileIds = new Set();
    const addEvidence = (from, sourceFileIds, color) => {
      for (const fileId of new Set(sourceFileIds || [])) {
        const to = buildingTop(fileId);
        if (!to) {
          continue;
        }
        dependencyEvidenceRoot.add(dependencyEvidenceTether(from, to, color));
        evidenceFileIds.add(fileId);
      }
    };
    const renderedFileConnections = new Set();
    const addFileConnections = (connections) => {
      for (const connection of connections || []) {
        const key = `${connection.fromFileId}\u0000${connection.toFileId}`;
        if (renderedFileConnections.has(key)) {
          continue;
        }
        const from = buildingTop(connection.fromFileId);
        const to = buildingTop(connection.toFileId);
        if (!from || !to) {
          continue;
        }
        renderedFileConnections.add(key);
        evidenceFileIds.add(connection.fromFileId);
        evidenceFileIds.add(connection.toFileId);
        dependencyEvidenceRoot.add(fileDependencyConnector(
          from,
          to,
          systemConnectionColor(connection.kinds),
          connection.connectionCount
        ));
      }
    };

    if (subsystemConnectionsVisible && subsystemFileEvidenceVisible) {
      for (const dependency of dependencyObjects) {
        if (dependency.fromSubsystemId === subsystemId) {
          addFileConnections(dependency.fileConnections);
          continue;
        }
        if (dependency.toSubsystemId !== subsystemId) {
          continue;
        }
        addFileConnections(dependency.fileConnections);
      }
    }

    if (subsystemLibrariesVisible) {
      for (const record of externalSatelliteObjects) {
        const { satellite } = record;
        addEvidence(
          new THREE.Vector3(satellite.x, satellite.y - satellite.radius, satellite.z),
          satellite.sourceFileIds,
          SUBSYSTEM_DEPENDENCY_COLORS.external
        );
      }
    }
    dependencyEvidenceFileIds = evidenceFileIds;
  }

  function applySelectionStyles() {
    const contextActive = Boolean(
      selectedFileId || selectedSubsystemId || selectedDirectoryPath != null || selectedCampusId != null
    );
    const relevantCampusIds = new Set();
    const dependencySubsystemIds = new Set(selectedSubsystemId ? [selectedSubsystemId] : []);
    const relevantDirectoryPaths = new Set();
    const selectedSubsystemDirectoryPaths = new Set();
    const relevantSubsystemIds = new Set();

    for (const dependency of dependencyObjects) {
      const outgoing = dependency.fromSubsystemId === selectedSubsystemId;
      const incoming = dependency.toSubsystemId === selectedSubsystemId;
      const visible = subsystemRoot.visible && subsystemConnectionsVisible && Boolean(selectedSubsystemId) && (
        outgoing || incoming
      ) && !subsystemBundledEdgeIds.has(dependency.id);
      dependency.connector.object.visible = visible;
      if (!visible) {
        continue;
      }
      dependencySubsystemIds.add(dependency.fromSubsystemId);
      dependencySubsystemIds.add(dependency.toSubsystemId);
      dependency.connector.setColor(systemConnectionColor(dependency.kinds));
    }
    for (const satellite of externalSatelliteObjects) {
      const visible = subsystemRoot.visible && subsystemLibrariesVisible && (
        satellite.satellite.ownerSubsystemId === selectedSubsystemId
      );
      satellite.group.visible = visible;
      satellite.connector.object.visible = visible;
    }

    function includeDirectoryAncestry(directoryPath = "", targetPaths = relevantDirectoryPaths) {
      let currentPath = String(directoryPath || "");
      while (currentPath) {
        if (directoryObjects.has(currentPath)) {
          targetPaths.add(currentPath);
        }
        const separatorIndex = currentPath.lastIndexOf("/");
        if (separatorIndex < 0) {
          break;
        }
        currentPath = currentPath.slice(0, separatorIndex);
      }
    }

    for (const directoryPath of subsystemBundleRelevantDirectoryPaths) {
      includeDirectoryAncestry(directoryPath);
    }

    for (const [fileId, record] of fileObjects) {
      const selected = fileId === selectedFileId;
      const neighbor = neighborFileIds.has(fileId);
      const insideDirectory = selectedDirectoryPath == null || selectedDirectoryPath === "" || (
        record.file.path === selectedDirectoryPath || record.file.path.startsWith(`${selectedDirectoryPath}/`)
      );
      const insideCampus = selectedCampusId == null || record.file.campusId === selectedCampusId;
      const baseColor = fileColor(record.file, viewMode);
      record.baseColor = baseColor;
      const inSelectedSubsystem = Boolean(
        selectedSubsystemId && (record.file.subsystemIds || []).includes(selectedSubsystemId)
      );
      const inSelectedScope = (
        selectedDirectoryPath != null && insideDirectory
      ) || (
        selectedCampusId != null && insideCampus
      ) || inSelectedSubsystem;
      const relevant = selected || neighbor || dependencyEvidenceFileIds.has(fileId) ||
        subsystemBundleRelevantFileIds.has(fileId) || inSelectedScope;
      const dimmed = contextActive && !relevant;
      if (relevant) {
        relevantCampusIds.add(record.file.campusId);
        includeDirectoryAncestry(record.file.directoryPath);
        for (const subsystemId of record.file.subsystemIds || []) {
          relevantSubsystemIds.add(subsystemId);
        }
      }
      if (inSelectedSubsystem) {
        includeDirectoryAncestry(record.file.directoryPath, selectedSubsystemDirectoryPaths);
      }
      const buildingColor = new THREE.Color(selected ? SELECTED_FILE_COLOR : baseColor);
      if (inSelectedSubsystem && !selected) {
        buildingColor.lerp(new THREE.Color(SELECTED_FILE_COLOR), 0.78);
      } else if (neighbor && !selected) {
        buildingColor.lerp(new THREE.Color(SELECTED_FILE_COLOR), 0.48);
      } else if (inSelectedScope) {
        buildingColor.offsetHSL(0, 0.06, 0.12);
      } else if (dimmed) {
        buildingColor.setHex(DIMMED_BUILDING_COLOR);
      }
      const roofColor = dimmed
        ? new THREE.Color(DIMMED_ROOF_COLOR)
        : buildingColor.clone().offsetHSL(0, -0.06, selected || inSelectedSubsystem ? 0.2 : 0.12);
      buildingInstances?.setColorAt(record.index, buildingColor);
      roofInstances?.setColorAt(record.index, roofColor);
    }
    if (buildingInstances?.instanceColor) {
      buildingInstances.instanceColor.needsUpdate = true;
    }
    if (roofInstances?.instanceColor) {
      roofInstances.instanceColor.needsUpdate = true;
    }

    for (const [campusId, record] of campusObjects) {
      const selected = selectedCampusId === campusId;
      const relevant = !contextActive || relevantCampusIds.has(campusId);
      for (const floor of record.floors) {
        floor.material.color.setHex(
          selected
            ? new THREE.Color(record.baseColor).offsetHSL(0, 0.08, 0.12).getHex()
            : relevant
              ? record.baseColor
              : DIMMED_CAMPUS_COLOR
        );
      }
      for (const rim of record.rims) {
        rim.material.color.setHex(
          selected ? SELECTED_FILE_COLOR : relevant ? record.rimColor : DIMMED_EDGE_COLOR
        );
      }
    }

    for (const [directoryPath, record] of directoryObjects) {
      const selected = selectedDirectoryPath === directoryPath;
      const insideSelectedSubsystem = selectedSubsystemDirectoryPaths.has(directoryPath);
      const relevant = !contextActive || relevantDirectoryPaths.has(directoryPath);
      const terraceColor = new THREE.Color(relevant ? record.baseColor : DIMMED_TERRACE_COLOR);
      if (selected || insideSelectedSubsystem) {
        terraceColor.lerp(new THREE.Color(SELECTED_FILE_COLOR), 0.55);
      }
      directoryTerraceInstances?.setColorAt(record.index, terraceColor);
    }
    if (directoryTerraceInstances?.instanceColor) {
      directoryTerraceInstances.instanceColor.needsUpdate = true;
    }

    for (const [subsystemId, record] of subsystemObjects) {
      const selected = selectedSubsystemId === subsystemId;
      const relevant = !contextActive || (
        selectedSubsystemId ? dependencySubsystemIds.has(subsystemId) : relevantSubsystemIds.has(subsystemId)
      );
      record.island.material.color.setHex(
        selected
          ? SELECTED_FILE_COLOR
          : relevant
            ? record.baseColor
            : DIMMED_BUILDING_COLOR
      );
      record.island.material.opacity = selected ? 0.82 : relevant ? 0.68 : 0.25;
      record.ring.material.color.setHex(
        selected
          ? 0xd9fbff
          : relevant
            ? new THREE.Color(record.baseColor).offsetHSL(0, -0.04, 0.2).getHex()
            : DIMMED_EDGE_COLOR
      );
      record.ring.material.opacity = selected ? 0.9 : relevant ? 0.76 : 0.22;
      record.group.scale.setScalar(selected ? 1.04 : relevant && selectedSubsystemId ? 1.02 : 1);
      record.label.fillOpacity = !contextActive ? 1 : selected ? 1 : relevant ? 0.88 : 0.22;
      for (const tether of record.tethers) {
        tether.visible = subsystemRoot.visible && selected;
      }
    }
    markDirty();
  }

  function selectFile(fileId = "") {
    clearSubsystemConnectionSelection();
    selectedFileId = String(fileId || "");
    selectedSubsystemId = "";
    selectedCampusId = null;
    selectedDirectoryPath = null;
    showSubsystemOwnership("");
    showExternalSatellites("");
    showDependencyEvidence("");
    showSubsystemConnectionBundles("");
    applySelectionStyles();
  }

  function selectDirectory(directoryPath = null) {
    clearSubsystemConnectionSelection();
    selectedCampusId = null;
    selectedSubsystemId = "";
    selectedDirectoryPath = directoryPath == null ? null : String(directoryPath);
    selectedFileId = "";
    clearContext();
    showSubsystemOwnership("");
    showExternalSatellites("");
    showDependencyEvidence("");
    showSubsystemConnectionBundles("");
    applySelectionStyles();
  }

  function selectPrecinct(campusId = null) {
    clearSubsystemConnectionSelection();
    selectedCampusId = campusId == null ? null : String(campusId);
    selectedSubsystemId = "";
    selectedDirectoryPath = null;
    selectedFileId = "";
    clearContext();
    showSubsystemOwnership("");
    showExternalSatellites("");
    showDependencyEvidence("");
    showSubsystemConnectionBundles("");
    applySelectionStyles();
  }

  function selectSubsystem(subsystemId = "") {
    const nextSubsystemId = String(subsystemId || "");
    clearSubsystemConnectionSelection();
    selectedSubsystemId = nextSubsystemId;
    selectedCampusId = null;
    selectedDirectoryPath = null;
    selectedFileId = "";
    clearContext();
    showSubsystemOwnership(selectedSubsystemId);
    showExternalSatellites(selectedSubsystemId);
    showDependencyEvidence(selectedSubsystemId);
    showSubsystemConnectionBundles(selectedSubsystemId);
    applySelectionStyles();
  }

  function setSubsystemLayers({ connections = false, fileEvidence = false, libraries = false } = {}) {
    subsystemConnectionsVisible = connections === true;
    subsystemFileEvidenceVisible = subsystemConnectionsVisible && fileEvidence === true;
    subsystemLibrariesVisible = libraries === true;
    showExternalSatellites(selectedSubsystemId);
    showDependencyEvidence(selectedSubsystemId);
    const previousConnectionId = selectedSubsystemConnectionId;
    showSubsystemConnectionBundles(selectedSubsystemId);
    if (previousConnectionId && !selectedSubsystemConnectionId) {
      onSelectSubsystemConnection(null);
    }
    applySelectionStyles();
  }

  function clearSelection() {
    clearSubsystemConnectionSelection();
    selectedCampusId = null;
    selectedDirectoryPath = null;
    selectedFileId = "";
    selectedSubsystemId = "";
    clearContext();
    showSubsystemOwnership("");
    showExternalSatellites("");
    showDependencyEvidence("");
    showSubsystemConnectionBundles("");
    applySelectionStyles();
  }

  function buildingTop(fileId = "") {
    const record = fileObjects.get(fileId);
    return record
      ? new THREE.Vector3(
        record.file.x,
        (Number(record.file.elevation) || 0) + record.height + 3,
        record.file.z
      )
      : null;
  }

  function captureView() {
    const target = controls.getTarget(new THREE.Vector3());
    return {
      position: camera.position.toArray(),
      target: target.toArray()
    };
  }

  function worldViewPose(view = {}) {
    if (!Array.isArray(view.position) || !Array.isArray(view.target)) {
      return null;
    }
    return {
      position: [
        Number(view.position[0]) || 0,
        Number(view.position[1]) || 0,
        Number(view.position[2]) || 0
      ],
      target: [
        Number(view.target[0]) || 0,
        Number(view.target[1]) || 0,
        Number(view.target[2]) || 0
      ]
    };
  }

  function restoreView(view = {}) {
    const pose = worldViewPose(view);
    if (!pose) {
      return false;
    }
    controls.setLookAt(
      ...pose.position,
      ...pose.target,
      false
    );
    markDirty();
    return true;
  }

  async function flyToView(view = {}) {
    const pose = worldViewPose(view);
    if (!pose) {
      return false;
    }
    await controls.setLookAt(
      ...pose.position,
      ...pose.target,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  function fileScreenRect(fileId = "") {
    const record = fileObjects.get(String(fileId || ""));
    if (!record) {
      return null;
    }
    const bounds = canvas.getBoundingClientRect();
    const elevation = Number(record.file.elevation) || 0;
    const halfWidth = Math.max(1, record.file.cityWidth / 2);
    const halfDepth = Math.max(1, record.file.cityDepth / 2);
    const projectPoint = (x, y, z) => {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      return {
        x: bounds.left + (projected.x + 1) * bounds.width / 2,
        y: bounds.top + (1 - projected.y) * bounds.height / 2
      };
    };
    const points = [];
    camera.updateMatrixWorld();
    for (const x of [record.file.x - halfWidth, record.file.x + halfWidth]) {
      for (const y of [elevation, elevation + record.height + 3]) {
        for (const z of [record.file.z - halfDepth, record.file.z + halfDepth]) {
          points.push(projectPoint(x, y, z));
        }
      }
    }
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const width = Math.max(20, maxX - minX);
    const height = Math.max(28, maxY - minY);
    const roofHeight = Math.max(1.2, Math.min(3, record.height * 0.025));
    const roofHalfWidth = Math.max(3, record.file.cityWidth * 0.86) / 2;
    const roofHalfDepth = Math.max(3, record.file.cityDepth * 0.86) / 2;
    const roofY = elevation + record.height + 1.6 + roofHeight / 2 + 0.12;
    const surfacePoints = [
      projectPoint(record.file.x - roofHalfWidth, roofY, record.file.z - roofHalfDepth),
      projectPoint(record.file.x + roofHalfWidth, roofY, record.file.z - roofHalfDepth),
      projectPoint(record.file.x + roofHalfWidth, roofY, record.file.z + roofHalfDepth),
      projectPoint(record.file.x - roofHalfWidth, roofY, record.file.z + roofHalfDepth)
    ];
    const surfaceMinX = Math.min(...surfacePoints.map((point) => point.x));
    const surfaceMaxX = Math.max(...surfacePoints.map((point) => point.x));
    const surfaceMinY = Math.min(...surfacePoints.map((point) => point.y));
    const surfaceMaxY = Math.max(...surfacePoints.map((point) => point.y));
    return {
      height,
      surface: {
        height: Math.max(2, surfaceMaxY - surfaceMinY),
        points: surfacePoints,
        width: Math.max(2, surfaceMaxX - surfaceMinX),
        x: surfaceMinX,
        y: surfaceMinY
      },
      width,
      x: (minX + maxX - width) / 2,
      y: (minY + maxY - height) / 2
    };
  }

  function clearFilePortal() {
    clearGroup(filePortalRoot);
    filePortal = null;
    markDirty();
  }

  function createFilePortalObject(record) {
    const file = record.file;
    const group = new THREE.Group();
    const shellMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: SELECTED_FILE_COLOR,
      depthWrite: false,
      opacity: 0.72,
      transparent: true
    });
    const shellGeometry = new THREE.BoxGeometry(
      Math.max(3, file.cityWidth * 1.035),
      record.height,
      Math.max(3, file.cityDepth * 1.035)
    );
    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    shell.position.y = record.height / 2 + 1;
    shell.renderOrder = 12;

    const outlineMaterial = new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xd8fbff,
      depthTest: false,
      depthWrite: false,
      opacity: 0.95,
      transparent: true
    });
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(shellGeometry),
      outlineMaterial
    );
    outline.position.copy(shell.position);
    outline.renderOrder = 13;

    const roofMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      opacity: 0.88,
      transparent: true
    });
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(3, file.cityWidth * 0.9),
        Math.max(1.4, Math.min(3.4, record.height * 0.03)),
        Math.max(3, file.cityDepth * 0.9)
      ),
      roofMaterial
    );
    roof.position.y = record.height + 2.2;
    roof.renderOrder = 14;

    const ringMaterials = [];
    const ringRadius = Math.max(8, Math.max(file.cityWidth, file.cityDepth) * 0.72);
    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index === 1 ? 0xb59cff : SELECTED_FILE_COLOR,
        depthTest: false,
        depthWrite: false,
        opacity: 0.72,
        side: THREE.DoubleSide,
        transparent: true
      });
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(ringRadius, ringRadius + 1.8, 48),
        material
      );
      ring.position.y = 1.2 + index * 1.5;
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 15;
      ring.userData.portalRingIndex = index;
      ringMaterials.push(material);
      group.add(ring);
    }

    group.add(shell, outline, roof);
    group.position.set(file.x, Number(file.elevation) || 0, file.z);
    return {
      group,
      outlineMaterial,
      ringMaterials,
      roofMaterial,
      shellMaterial
    };
  }

  function beginFilePortal(fileId = "") {
    const normalizedFileId = String(fileId || "");
    const record = fileObjects.get(normalizedFileId);
    if (!record) {
      return null;
    }
    clearFilePortal();
    const object = createFilePortalObject(record);
    filePortalRoot.add(object.group);
    filePortal = {
      ...object,
      amount: reducedMotion ? 1 : 0,
      baseY: Number(record.file.elevation) || 0,
      fileId: normalizedFileId,
      height: record.height,
      phase: reducedMotion ? "open" : "opening",
      phaseAt: performance.now(),
      phaseStartAmount: reducedMotion ? 1 : 0
    };
    markDirty();
    return fileScreenRect(normalizedFileId);
  }

  function endFilePortal({ immediate = false } = {}) {
    if (!filePortal) {
      return;
    }
    if (immediate || reducedMotion) {
      clearFilePortal();
      return;
    }
    filePortal.phase = "closing";
    filePortal.phaseAt = performance.now();
    filePortal.phaseStartAmount = filePortal.amount;
    markDirty();
  }

  function updateFilePortal(now) {
    if (!filePortal) {
      return;
    }
    const elapsed = now - filePortal.phaseAt;
    if (filePortal.phase === "opening") {
      const progress = Math.min(1, elapsed / FILE_PORTAL_DURATION_MS);
      filePortal.amount = 1 - (1 - progress) ** 3;
      if (progress >= 1) {
        filePortal.phase = "open";
        filePortal.phaseAt = now;
      }
    } else if (filePortal.phase === "closing") {
      const progress = Math.min(1, elapsed / (FILE_PORTAL_DURATION_MS * 0.72));
      filePortal.amount = filePortal.phaseStartAmount * (1 - progress ** 2);
      if (progress >= 1) {
        clearFilePortal();
        return;
      }
    }

    const pulse = (Math.sin(now * 0.0045) + 1) / 2;
    const amount = filePortal.amount;
    filePortal.group.position.y = filePortal.baseY + amount * (18 + filePortal.height * 0.13);
    filePortal.group.rotation.y = amount * (0.045 + pulse * 0.035);
    filePortal.group.scale.setScalar(1 + amount * (0.035 + pulse * 0.018));
    filePortal.shellMaterial.opacity = amount * (0.54 + pulse * 0.2);
    filePortal.outlineMaterial.opacity = amount * (0.72 + pulse * 0.28);
    filePortal.roofMaterial.opacity = amount * (0.7 + pulse * 0.25);
    filePortal.group.children.forEach((child) => {
      const index = child.userData.portalRingIndex;
      if (!Number.isInteger(index)) {
        return;
      }
      const cycle = (now * 0.0007 + index / 3) % 1;
      child.scale.setScalar(0.75 + cycle * 1.15);
      filePortal.ringMaterials[index].opacity = amount * (1 - cycle) * 0.7;
    });
    markDirty();
  }

  function clearFileTravel() {
    clearGroup(fileTravelRoot);
    fileTravel = null;
    markDirty();
  }

  function beginFileTravel(fromFileId = "", toFileId = "") {
    const from = buildingTop(String(fromFileId || ""));
    const to = buildingTop(String(toFileId || ""));
    if (!from || !to || from.equals(to)) {
      return;
    }
    clearFileTravel();
    const middle = from.clone().lerp(to, 0.5);
    middle.y = Math.max(from.y, to.y) + 70 + Math.min(180, from.distanceTo(to) * 0.16);
    const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
    const beamMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: SELECTED_FILE_COLOR,
      depthTest: false,
      depthWrite: false,
      opacity: 0.54,
      transparent: true
    });
    const beam = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 56, 1.5, 6, false),
      beamMaterial
    );
    beam.renderOrder = 16;
    const sparkMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      opacity: 1,
      transparent: true
    });
    const spark = new THREE.Mesh(new THREE.SphereGeometry(5.5, 12, 8), sparkMaterial);
    spark.renderOrder = 17;
    spark.position.copy(from);
    fileTravelRoot.add(beam, spark);
    fileTravel = {
      beamMaterial,
      curve,
      duration: reducedMotion ? 1 : FILE_TRAVEL_DURATION_MS,
      spark,
      sparkMaterial,
      startedAt: performance.now()
    };
    markDirty();
  }

  function updateFileTravel(now) {
    if (!fileTravel) {
      return;
    }
    const progress = Math.min(1, (now - fileTravel.startedAt) / fileTravel.duration);
    const eased = progress < 0.5
      ? 2 * progress ** 2
      : 1 - (-2 * progress + 2) ** 2 / 2;
    fileTravel.spark.position.copy(fileTravel.curve.getPoint(eased));
    fileTravel.spark.scale.setScalar(0.8 + Math.sin(progress * Math.PI) * 1.2);
    fileTravel.beamMaterial.opacity = 0.16 + Math.sin(progress * Math.PI) * 0.6;
    fileTravel.sparkMaterial.opacity = Math.min(1, (1 - progress) * 4);
    if (progress >= 1) {
      clearFileTravel();
      return;
    }
    markDirty();
  }

  function addExternalFileContext(edges = [], source = null) {
    if (!source) {
      return;
    }
    const dependencies = new Map();
    for (const edge of edges) {
      const packageId = String(edge.targetPackageId || "").trim();
      if (edge.fromFileId !== selectedFileId || edge.toFileId || !packageId) {
        continue;
      }
      const dependency = dependencies.get(packageId) || { importCount: 0, packageId };
      dependency.importCount += 1;
      dependencies.set(packageId, dependency);
    }
    const records = [...dependencies.values()].sort((left, right) => (
      left.packageId.localeCompare(right.packageId)
    ));
    if (records.length === 0) {
      return;
    }

    camera.updateMatrixWorld();
    const screenRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    screenRight.y = 0;
    if (screenRight.lengthSq() < 0.001) {
      screenRight.set(1, 0, 0);
    } else {
      screenRight.normalize();
    }
    const towardCamera = camera.position.clone().sub(source);
    towardCamera.y = 0;
    if (towardCamera.lengthSq() < 0.001) {
      towardCamera.set(0, 0, 1);
    } else {
      towardCamera.normalize();
    }

    const maximumColumns = 5;
    records.forEach((dependency, index) => {
      const row = Math.floor(index / maximumColumns);
      const rowStart = row * maximumColumns;
      const rowSize = Math.min(maximumColumns, records.length - rowStart);
      const column = index - rowStart;
      const horizontalOffset = (column - (rowSize - 1) / 2) * 156;
      const radius = Math.max(
        14,
        Math.min(23, 13 + Math.log2(dependency.importCount + 1) * 2.8)
      );
      const position = source.clone()
        .addScaledVector(screenRight, horizontalOffset)
        .addScaledVector(towardCamera, 112 + row * 86);
      position.y += 128 + row * 76;

      const group = new THREE.Group();
      group.position.copy(position);
      group.userData.kind = "file-external-dependency";
      group.userData.packageId = dependency.packageId;
      const body = new THREE.Mesh(
        new THREE.DodecahedronGeometry(radius, 0),
        new THREE.MeshBasicMaterial({
          color: SUBSYSTEM_DEPENDENCY_COLORS.external,
          depthTest: false,
          depthWrite: false,
          opacity: 0.94,
          transparent: true
        })
      );
      body.renderOrder = 12;
      const halo = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius * 1.34, 1),
        new THREE.MeshBasicMaterial({
          color: 0xf0d9ff,
          depthTest: false,
          depthWrite: false,
          opacity: 0.34,
          transparent: true,
          wireframe: true
        })
      );
      halo.renderOrder = 12;
      group.add(body, halo);
      const importLabel = dependency.importCount === 1
        ? "1 external import"
        : `${dependency.importCount} external imports`;
      const label = addLabel(group, `${dependency.packageId}\n${importLabel}`, {
        color: 0xf7f1ff,
        fontSize: 12,
        maxWidth: 180,
        position: new THREE.Vector3(0, radius + 18, 0)
      });
      label.material.depthTest = false;
      label.material.depthWrite = false;
      label.renderOrder = 12;

      const direction = position.clone().sub(source).normalize();
      const target = position.clone().addScaledVector(direction, -radius * 0.95);
      const connector = fileContextConnector(source, target, {
        color: SUBSYSTEM_DEPENDENCY_COLORS.external,
        dashed: true,
        elevation: 34 + row * 12,
        opacity: 0.94
      });
      contextRoot.add(connector, group);
    });
  }

  function setFileContext(constellation = {}) {
    clearSubsystemConnectionSelection();
    clearContext();
    selectedFileId = constellation.selectedFile?.id || "";
    selectedSubsystemId = "";
    selectedCampusId = null;
    selectedDirectoryPath = null;
    neighborFileIds = new Set([selectedFileId]);
    showSubsystemOwnership("");
    showExternalSatellites("");
    showDependencyEvidence("");
    showSubsystemConnectionBundles("");
    const selectedTop = buildingTop(selectedFileId);
    for (const edge of constellation.edges || []) {
      const from = buildingTop(edge.fromFileId);
      const to = buildingTop(edge.toFileId);
      if (!from || !to) {
        continue;
      }
      neighborFileIds.add(edge.fromFileId);
      neighborFileIds.add(edge.toFileId);
      const outgoing = edge.fromFileId === selectedFileId;
      const connector = fileContextConnector(from, to, {
        color: outgoing ? 0x53dcff : 0xc78cff,
        dashed: edge.classification !== "local-file",
        elevation: 42 + Math.min(100, from.distanceTo(to) * 0.12),
        opacity: 0.82
      });
      contextRoot.add(connector);
    }
    addExternalFileContext(constellation.edges || [], selectedTop);
    applySelectionStyles();
  }

  async function setOverview(overview = {}) {
    clearWorld();
    cityLayout = layoutFileCity(overview);
    addGround(cityLayout);
    addDirectoryPrecincts(cityLayout);
    addFileBuildings(cityLayout);
    addSubsystemSky(overview, cityLayout);
    await fitWorld(false);
  }

  function activePhysicalDepth() {
    const selectedDepths = [
      subsystemObjects.get(selectedSubsystemId)?.subsystem.subsystemDepth,
      fileObjects.get(selectedFileId)?.file.subsystemDepth,
      directoryObjects.get(selectedDirectoryPath)?.directory.subsystemDepth
    ];
    const selectedDepth = selectedDepths.find((depth) => Number.isFinite(depth));
    return Math.max(0, Math.floor(selectedDepth || 0));
  }

  function layerCeilingElevation(depth = 0) {
    const normalizedDepth = Math.max(0, Math.floor(Number(depth) || 0));
    if (normalizedDepth === 0) {
      return null;
    }
    const elevation = Number(cityLayout?.subsystemStrata?.[normalizedDepth - 1]?.elevation);
    return Number.isFinite(elevation) ? elevation : null;
  }

  function physicalLayerOrbitElevation(depth = 0) {
    const normalizedDepth = Math.max(0, Math.floor(Number(depth) || 0));
    const floorElevation = Number(cityLayout?.subsystemStrata?.[normalizedDepth]?.elevation) || 0;
    let skylineElevation = floorElevation;
    for (const directory of cityLayout?.directories || []) {
      if (directory.subsystemDepth === normalizedDepth) {
        skylineElevation = Math.max(skylineElevation, Number(directory.elevation) || floorElevation);
      }
    }
    for (const file of cityLayout?.files || []) {
      if (file.subsystemDepth !== normalizedDepth) {
        continue;
      }
      const height = fileObjects.get(file.id)?.height || fileBuildingHeight(
        file.lines,
        cityLayout?.lineStats?.largest
      );
      skylineElevation = Math.max(
        skylineElevation,
        (Number(file.elevation) || floorElevation) + height
      );
    }
    return floorElevation + (skylineElevation - floorElevation) * 0.38;
  }

  function currentLayerOrbitTarget() {
    const depth = activePhysicalDepth();
    const semanticRecords = (subsystemLayout?.subsystems || []).filter((record) => (
      record.subsystemDepth === depth
    ));
    const semanticElevation = semanticRecords.length > 0
      ? semanticRecords.reduce((sum, record) => sum + record.y, 0) / semanticRecords.length
      : subsystemLayout?.centerElevation || 0;
    return {
      ceilingElevation: layerCeilingElevation(depth),
      depth,
      x: 0,
      y: viewMode === "subsystems" ? semanticElevation : physicalLayerOrbitElevation(depth),
      z: 0
    };
  }

  function currentLayerSpan() {
    const target = currentLayerOrbitTarget();
    const width = Number(cityLayout?.bounds?.width) || 1_420;
    const depth = Number(cityLayout?.bounds?.depth) || 980;
    if (viewMode !== "subsystems") {
      return Math.max(width, depth);
    }
    const records = (subsystemLayout?.subsystems || []).filter((record) => (
      record.subsystemDepth === target.depth
    ));
    const subsystemSpan = records.reduce((span, record) => Math.max(
      span,
      Math.abs(record.x - target.x) * 2 + record.radius * 2,
      Math.abs(record.z - target.z) * 2 + record.radius * 2
    ), 0);
    return Math.max(width, depth, subsystemSpan);
  }

  function fileFocusPose(record) {
    const footprint = Math.max(record.file.cityWidth, record.file.cityDepth);
    const distance = Math.max(150, record.height * 2.5, footprint * 5.5);
    const elevation = Number(record.file.elevation) || 0;
    const proposedCameraY = elevation + record.height + distance * 0.72;
    const ceilingElevation = layerCeilingElevation(record.file.subsystemDepth);
    const cameraY = Number.isFinite(ceilingElevation)
      ? Math.min(
        proposedCameraY,
        ceilingElevation - SUBSYSTEM_CIRCLE_CAMERA_CEILING_CLEARANCE
      )
      : proposedCameraY;
    return {
      position: [
        record.file.x + distance * 0.42,
        cameraY,
        record.file.z + distance * 0.68
      ],
      target: [
        record.file.x,
        elevation + record.height * 0.38,
        record.file.z
      ]
    };
  }

  function focusFile(fileId = "") {
    const record = fileObjects.get(String(fileId || ""));
    if (!record) {
      return false;
    }
    const pose = fileFocusPose(record);
    void controls.setLookAt(
      ...pose.position,
      ...pose.target,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  async function flyToFile(fileId = "", { fromFileId = "" } = {}) {
    const normalizedFileId = String(fileId || "");
    const record = fileObjects.get(normalizedFileId);
    if (!record) {
      return null;
    }
    if (fromFileId) {
      beginFileTravel(fromFileId, normalizedFileId);
    }
    const pose = fileFocusPose(record);
    await controls.setLookAt(
      ...pose.position,
      ...pose.target,
      !reducedMotion
    );
    markDirty();
    return fileScreenRect(normalizedFileId);
  }

  function focusDirectory(directoryPath = "") {
    if (!directoryPath) {
      void fitWorld();
      return true;
    }
    const record = directoryObjects.get(String(directoryPath || ""));
    if (!record) {
      return false;
    }
    const directory = record.directory;
    const span = Math.max(directory.width, directory.depth);
    const distance = Math.max(180, span * 1.45);
    const proposedCameraY = directory.elevation + distance * 0.92;
    const ceilingElevation = layerCeilingElevation(directory.subsystemDepth);
    const cameraY = Number.isFinite(ceilingElevation)
      ? Math.min(
        proposedCameraY,
        ceilingElevation - SUBSYSTEM_CIRCLE_CAMERA_CEILING_CLEARANCE
      )
      : proposedCameraY;
    controls.setLookAt(
      directory.x + distance * 0.25,
      cameraY,
      directory.z + distance * 0.72,
      directory.x,
      directory.elevation,
      directory.z,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  function focusPrecinct(campusId = "") {
    const record = campusObjects.get(String(campusId || ""));
    if (!record) {
      return false;
    }
    const campus = record.campus;
    const deepestElevation = Math.min(0, ...(campus.subsystemStrata || []).map((stratum) => stratum.elevation));
    const verticalSpan = Math.abs(deepestElevation);
    const span = Math.max(campus.width, campus.depth, verticalSpan);
    const distance = Math.max(220, span * 1.25);
    const targetY = physicalLayerOrbitElevation(0);
    controls.setLookAt(
      campus.x + distance * 0.22,
      targetY + distance * 0.88,
      campus.z + distance * 0.72,
      campus.x,
      targetY,
      campus.z,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  function focusSubsystem(subsystemId = "") {
    const record = subsystemObjects.get(String(subsystemId || ""));
    if (!record) {
      return false;
    }
    const neighborhood = new Map([[record.subsystem.id, record.subsystem]]);
    const focusedDepth = record.subsystem.subsystemDepth;
    if (subsystemConnectionsVisible) {
      for (const dependency of dependencyObjects) {
        if (dependency.fromSubsystemId === record.subsystem.id) {
          const target = subsystemObjects.get(dependency.toSubsystemId)?.subsystem;
          if (target?.subsystemDepth === focusedDepth) {
            neighborhood.set(target.id, target);
          }
        } else if (dependency.toSubsystemId === record.subsystem.id) {
          const source = subsystemObjects.get(dependency.fromSubsystemId)?.subsystem;
          if (source?.subsystemDepth === focusedDepth) {
            neighborhood.set(source.id, source);
          }
        }
      }
    }
    const satellites = subsystemLibrariesVisible
      ? (subsystemLayout?.externalSatellites || []).filter((satellite) => (
        satellite.ownerSubsystemId === record.subsystem.id
      ))
      : [];
    const points = [
      ...neighborhood.values(),
      ...satellites
    ];
    const minX = Math.min(...points.map((point) => point.x - point.radius));
    const maxX = Math.max(...points.map((point) => point.x + point.radius));
    const minZ = Math.min(...points.map((point) => point.z - point.radius));
    const maxZ = Math.max(...points.map((point) => point.z + point.radius));
    const minY = Math.min(...points.map((point) => point.y - point.radius));
    const maxY = Math.max(...points.map((point) => point.y + point.radius));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const span = Math.max(540, maxX - minX, maxZ - minZ, (maxY - minY) * 2.4);
    const proposedCameraY = maxY + span * 0.58;
    const cameraY = Number.isFinite(record.subsystem.ceilingElevation)
      ? Math.min(
        proposedCameraY,
        record.subsystem.ceilingElevation - SUBSYSTEM_CIRCLE_CAMERA_CEILING_CLEARANCE
      )
      : proposedCameraY;
    controls.setLookAt(
      centerX + span * 0.18,
      cameraY,
      centerZ + span * 0.76,
      centerX,
      centerY,
      centerZ,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  function focusSubsystemDependency(fromSubsystemId = "", toSubsystemId = "") {
    const dependency = dependencyObjects.find((entry) => (
      entry.fromSubsystemId === fromSubsystemId && entry.toSubsystemId === toSubsystemId
    ));
    const fileRecords = new Map();
    for (const connection of dependency?.fileConnections || []) {
      for (const fileId of [connection.fromFileId, connection.toFileId]) {
        const record = fileObjects.get(fileId);
        if (record) {
          fileRecords.set(fileId, record);
        }
      }
    }
    if (fileRecords.size === 0) {
      return false;
    }
    const records = [...fileRecords.values()];
    const minX = Math.min(...records.map((record) => record.file.x - record.file.cityWidth / 2));
    const maxX = Math.max(...records.map((record) => record.file.x + record.file.cityWidth / 2));
    const minZ = Math.min(...records.map((record) => record.file.z - record.file.cityDepth / 2));
    const maxZ = Math.max(...records.map((record) => record.file.z + record.file.cityDepth / 2));
    const minY = Math.min(...records.map((record) => Number(record.file.elevation) || 0));
    const maxY = Math.max(...records.map((record) => (
      (Number(record.file.elevation) || 0) + record.height
    )));
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const span = Math.max(220, maxX - minX, maxZ - minZ, (maxY - minY) * 1.6);
    controls.setLookAt(
      centerX + span * 0.22,
      maxY + span * 0.78,
      centerZ + span * 0.78,
      centerX,
      minY + (maxY - minY) * 0.38,
      centerZ,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  function focusSubsystemGround(subsystemId = "") {
    const subsystem = subsystemObjects.get(String(subsystemId || ""))?.subsystem;
    const targets = subsystem?.targets || [];
    if (targets.length === 0) {
      return false;
    }
    const minX = Math.min(...targets.map((target) => target.x - (Number(target.width) || 0) / 2));
    const maxX = Math.max(...targets.map((target) => target.x + (Number(target.width) || 0) / 2));
    const minZ = Math.min(...targets.map((target) => target.z - (Number(target.depth) || 0) / 2));
    const maxZ = Math.max(...targets.map((target) => target.z + (Number(target.depth) || 0) / 2));
    const minY = Math.min(...targets.map((target) => Number(target.elevation) || 0));
    const maxY = Math.max(...targets.map((target) => (
      target.fileId ? buildingTop(target.fileId)?.y || target.elevation : target.elevation
    )));
    const centerX = (minX + maxX) / 2;
    const centerY = minY + (maxY - minY) * 0.38;
    const centerZ = (minZ + maxZ) / 2;
    const span = Math.max(440, maxX - minX, maxZ - minZ, (maxY - minY) * 1.6);
    const proposedCameraY = maxY + span * 0.76;
    const ceilingElevation = layerCeilingElevation(subsystem.subsystemDepth);
    const cameraY = Number.isFinite(ceilingElevation)
      ? Math.min(
        proposedCameraY,
        ceilingElevation - SUBSYSTEM_CIRCLE_CAMERA_CEILING_CLEARANCE
      )
      : proposedCameraY;
    controls.setLookAt(
      centerX + span * 0.28,
      cameraY,
      centerZ + span * 0.78,
      centerX,
      centerY,
      centerZ,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  function focusSubsystemLayer() {
    const selectedDepth = subsystemObjects.get(selectedSubsystemId)?.subsystem.subsystemDepth;
    const focusedDepth = Number.isFinite(selectedDepth) ? selectedDepth : 0;
    const records = (subsystemLayout?.subsystems || []).filter((record) => (
      record.subsystemDepth === focusedDepth
    ));
    if (records.length === 0) {
      return false;
    }
    const minX = Math.min(...records.map((record) => record.x - record.radius));
    const maxX = Math.max(...records.map((record) => record.x + record.radius));
    const minZ = Math.min(...records.map((record) => record.z - record.radius));
    const maxZ = Math.max(...records.map((record) => record.z + record.radius));
    const minY = Math.min(...records.map((record) => record.y - 18));
    const maxY = Math.max(...records.map((record) => record.y + 72));
    const orbitTarget = currentLayerOrbitTarget();
    const centerX = orbitTarget.x;
    const centerY = orbitTarget.y;
    const centerZ = orbitTarget.z;
    const span = Math.max(
      520,
      Math.abs(minX - centerX) * 2,
      Math.abs(maxX - centerX) * 2,
      Math.abs(minZ - centerZ) * 2,
      Math.abs(maxZ - centerZ) * 2,
      (maxY - minY) * 1.8
    );
    const ceilingElevation = records[0]?.ceilingElevation;
    const proposedCameraY = centerY + span * 0.62;
    const cameraY = Number.isFinite(ceilingElevation)
      ? Math.min(
        proposedCameraY,
        ceilingElevation - SUBSYSTEM_CIRCLE_CAMERA_CEILING_CLEARANCE
      )
      : proposedCameraY;
    controls.setLookAt(
      centerX + span * 0.16,
      cameraY,
      centerZ + span * 1.2,
      centerX,
      centerY,
      centerZ,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  async function fitWorld(smooth = true) {
    if (viewMode === "subsystems" && focusSubsystemLayer()) {
      return;
    }
    if (worldRoot.children.length === 0) {
      return;
    }
    const target = currentLayerOrbitTarget();
    const span = currentLayerSpan();
    const proposedCameraY = target.y + span * 0.72;
    const cameraY = Number.isFinite(target.ceilingElevation)
      ? Math.min(
        proposedCameraY,
        target.ceilingElevation - SUBSYSTEM_CIRCLE_CAMERA_CEILING_CLEARANCE
      )
      : proposedCameraY;
    controls.setLookAt(
      target.x + span * 0.18,
      cameraY,
      target.z + span * (Number.isFinite(target.ceilingElevation) ? 1.12 : 0.86),
      target.x,
      target.y,
      target.z,
      smooth && !reducedMotion
    );
    markDirty();
  }

  function setView(view = "perspective") {
    const target = currentLayerOrbitTarget();
    const span = currentLayerSpan();
    if (view === "top") {
      controls.setLookAt(
        target.x,
        target.y + span * 1.12,
        target.z + 0.01,
        target.x,
        target.y,
        target.z,
        !reducedMotion
      );
    } else {
      const proposedCameraY = target.y + span * 0.72;
      const cameraY = Number.isFinite(target.ceilingElevation)
        ? Math.min(
          proposedCameraY,
          target.ceilingElevation - SUBSYSTEM_CIRCLE_CAMERA_CEILING_CLEARANCE
        )
        : proposedCameraY;
      controls.setLookAt(
        target.x,
        cameraY,
        target.z + span * (Number.isFinite(target.ceilingElevation) ? 1.12 : 0.86),
        target.x,
        target.y,
        target.z,
        !reducedMotion
      );
    }
    markDirty();
  }

  function rotateView(azimuthDegrees = 0, polarDegrees = 0, smooth = true) {
    controls.rotate(
      THREE.MathUtils.degToRad(Number(azimuthDegrees) || 0),
      THREE.MathUtils.degToRad(Number(polarDegrees) || 0),
      smooth && !reducedMotion
    );
    markDirty();
  }

  function setViewMode(nextMode = "folders") {
    const previousMode = viewMode;
    viewMode = ["folders", "subsystems", "runtime"].includes(nextMode) ? nextMode : "folders";
    subsystemRoot.visible = viewMode === "subsystems";
    if (!subsystemRoot.visible) {
      clearSubsystemConnectionHover();
    }
    applySelectionStyles();
    if (viewMode === "subsystems") {
      if (!focusSubsystem(selectedSubsystemId)) {
        focusSubsystemLayer();
      }
    } else if (previousMode === "subsystems" && !focusSubsystemGround(selectedSubsystemId)) {
      void fitWorld();
    }
  }

  function resize(width, height) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    markDirty();
  }

  function updateBillboards() {
    for (const root of [worldRoot, subsystemRoot]) {
      root.traverse((object) => {
        if (object.userData.billboard) {
          object.quaternion.copy(camera.quaternion);
        }
      });
    }
  }

  function frame(now = performance.now()) {
    const delta = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    updateFilePortal(now);
    updateFileTravel(now);
    const controlsChanged = controls.update(delta);
    if (!active || (!dirty && !controlsChanged)) {
      return;
    }
    updateBillboards();
    renderer.render(scene, camera);
    dirty = false;
  }

  function pointerNdc(event, target = pointer) {
    const bounds = canvas.getBoundingClientRect();
    target.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    target.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    return target;
  }

  function pickedIntersection(event) {
    pointerNdc(event);
    raycaster.setFromCamera(pointer, camera);
    const activePickables = subsystemRoot.visible
      ? [...subsystemConnectionPickables, ...pickables]
      : pickables.filter((object) => object.userData.kind !== "subsystem");
    return raycaster.intersectObjects(activePickables, false)[0] || null;
  }

  function clearSubsystemConnectionHover() {
    if (!hoveredSubsystemConnectionId) {
      return;
    }
    hoveredSubsystemConnectionId = "";
    onHoverSubsystemConnection(null);
  }

  function updateSubsystemConnectionHover(event) {
    if (!subsystemRoot.visible || !subsystemConnectionsVisible) {
      clearSubsystemConnectionHover();
      return;
    }
    const intersection = pickedIntersection(event);
    const subsystemConnectionId = intersection?.object?.userData.kind === "subsystem-connection"
      ? intersection.object.userData.subsystemConnectionId
      : "";
    if (subsystemConnectionId === hoveredSubsystemConnectionId) {
      return;
    }
    hoveredSubsystemConnectionId = subsystemConnectionId;
    const record = subsystemConnectionObjects.get(subsystemConnectionId);
    if (!record) {
      onHoverSubsystemConnection(null);
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    onHoverSubsystemConnection({
      ...record.bundle,
      canvasX: Math.max(12, Math.min(bounds.width - 274, event.clientX - bounds.left + 14)),
      canvasY: Math.max(84, event.clientY - bounds.top - 12)
    });
  }

  function handlePointerDown(event) {
    clearSubsystemConnectionHover();
    if (document.activeElement !== canvas) {
      canvas.focus({ preventScroll: true });
    }
    if (event.button !== 0) {
      pointerDown = null;
      return;
    }
    pointerDown = { x: event.clientX, y: event.clientY };
    const target = controls.getTarget(new THREE.Vector3());
    const anchor = pickedIntersection(event)?.point?.clone() || target.clone();
    camera.updateMatrixWorld(true);
    const dragCamera = camera.clone();
    dragCamera.updateMatrixWorld(true);
    grabState = {
      anchor,
      camera: dragCamera,
      delta: new THREE.Vector3(),
      depth: anchor.clone().project(dragCamera).z,
      pointer: new THREE.Vector3(),
      pointerId: event.pointerId,
      position: camera.position.clone(),
      target
    };
    canvas.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    pointerNdc(event, navigationPointer);
    if (!grabState || event.pointerId !== grabState.pointerId) {
      updateSubsystemConnectionHover(event);
      return;
    }
    pointerNdc(event, grabState.pointer);
    grabState.pointer.z = grabState.depth;
    grabState.pointer.unproject(grabState.camera);
    grabState.delta.subVectors(grabState.anchor, grabState.pointer);
    controls.setLookAt(
      grabState.position.x + grabState.delta.x,
      grabState.position.y + grabState.delta.y,
      grabState.position.z + grabState.delta.z,
      grabState.target.x + grabState.delta.x,
      grabState.target.y + grabState.delta.y,
      grabState.target.z + grabState.delta.z,
      false
    );
    event.preventDefault();
    markDirty();
  }

  function walkTowardPointer(distance = 0, smooth = true) {
    const step = Number(distance) || 0;
    if (step === 0) {
      return;
    }
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(navigationPointer, camera);
    const offset = raycaster.ray.direction.clone().multiplyScalar(step);
    const position = controls.getPosition(new THREE.Vector3());
    const target = controls.getTarget(new THREE.Vector3());
    controls.setLookAt(
      position.x + offset.x,
      position.y + offset.y,
      position.z + offset.z,
      target.x + offset.x,
      target.y + offset.y,
      target.z + offset.z,
      smooth && !reducedMotion
    );
    markDirty();
  }

  function handleKeyDown(event) {
    if (event.defaultPrevented || event.altKey || event.metaKey) {
      return;
    }

    const distance = controls.distance;
    const dollyStep = Math.min(240, Math.max(16, distance * 0.08));
    const truckStep = Math.min(160, Math.max(12, distance * 0.05));
    const smooth = !reducedMotion;
    let handled = true;

    if (event.ctrlKey) {
      if (event.key === "ArrowUp") {
        walkTowardPointer(dollyStep, smooth);
      } else if (event.key === "ArrowDown") {
        walkTowardPointer(-dollyStep, smooth);
      } else {
        return;
      }
    } else {
      switch (event.key) {
        case "ArrowLeft":
          void controls.truck(-truckStep, 0, smooth);
          break;
        case "ArrowRight":
          void controls.truck(truckStep, 0, smooth);
          break;
        case "ArrowUp":
          void controls.truck(0, truckStep, smooth);
          break;
        case "ArrowDown":
          void controls.truck(0, -truckStep, smooth);
          break;
        case "w":
        case "W":
        case "+":
        case "=":
          walkTowardPointer(dollyStep, smooth);
          break;
        case "s":
        case "S":
        case "-":
        case "_":
          walkTowardPointer(-dollyStep, smooth);
          break;
        default:
          handled = false;
      }
    }

    if (!handled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pointerDown = null;
    markDirty();
  }

  function handleWheelMode(event) {
    const primaryButtonHeld = (event.buttons & 1) === 1;
    const eventTime = Number(event.timeStamp) || performance.now();
    if (!primaryButtonHeld && (event.ctrlKey || eventTime - wheelGestureAt > WHEEL_GESTURE_IDLE_MS)) {
      wheelGestureAction = !event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? CameraControls.ACTION.ROTATE
        : CameraControls.ACTION.DOLLY;
    }
    if (!primaryButtonHeld) {
      wheelGestureAt = eventTime;
    }
    const rotate = primaryButtonHeld || wheelGestureAction === CameraControls.ACTION.ROTATE;
    controls.mouseButtons.wheel = primaryButtonHeld
      ? CameraControls.ACTION.ROTATE
      : wheelGestureAction;
    if (!rotate) {
      controls.infinityDolly = event.deltaY < 0;
    }
    if (rotate) {
      grabState = null;
      pointerDown = null;
    }
  }

  function openFileImmersively(fileId, record, event = null) {
    event?.preventDefault?.();
    const returnView = captureView();
    const alreadySelected = selectedFileId === fileId;
    if (!alreadySelected) {
      selectFile(fileId);
      onSelectFile({
        fileId,
        fileKey: record.file.key,
        path: record.file.path
      });
    }
    const anchor = fileScreenRect(fileId);
    beginFilePortal(fileId);
    onOpenFile({
      anchor,
      fileId,
      fileKey: record.file.key,
      path: record.file.path,
      returnView
    });
  }

  function handlePointerUp(event) {
    grabState = null;
    if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) {
      pointerDown = null;
      if (event.pointerType === "touch") {
        lastTouchFileTap = { at: -Infinity, fileId: "" };
      }
      return;
    }
    pointerDown = null;
    const intersection = pickedIntersection(event);
    const object = intersection?.object;
    if (event.pointerType === "touch" && object?.userData.kind !== "file-buildings") {
      lastTouchFileTap = { at: -Infinity, fileId: "" };
    }
    if (object?.userData.kind === "subsystem-connection") {
      selectSubsystemConnection(object.userData.subsystemConnectionId);
      return;
    }
    if (object?.userData.kind === "subsystem") {
      const subsystemId = object.userData.subsystemId;
      const record = subsystemObjects.get(subsystemId);
      if (!record) {
        return;
      }
      selectSubsystem(subsystemId);
      onSelectSubsystem(record.subsystem);
      return;
    }
    if (object?.userData.kind === "file-buildings") {
      const fileId = object.userData.fileIds[intersection.instanceId];
      const record = fileObjects.get(fileId);
      if (!record) {
        return;
      }
      if (event.pointerType === "touch") {
        const tappedAt = Number(event.timeStamp) || performance.now();
        const doubleTap = lastTouchFileTap.fileId === fileId &&
          tappedAt - lastTouchFileTap.at <= FILE_DOUBLE_TAP_WINDOW_MS;
        lastTouchFileTap = doubleTap
          ? { at: -Infinity, fileId: "" }
          : { at: tappedAt, fileId };
        if (doubleTap) {
          suppressSyntheticDoubleClickUntil = tappedAt + FILE_DOUBLE_TAP_WINDOW_MS;
          openFileImmersively(fileId, record, event);
          return;
        }
      }
      const selectedConnection = subsystemConnectionObjects.get(selectedSubsystemConnectionId)?.bundle;
      if (selectedConnection?.consumerFileIds.includes(fileId)) {
        selectSubsystemConnectionFile(fileId);
        onSelectFile({
          fileId,
          fileKey: record.file.key,
          path: record.file.path,
          preserveSubsystemSelection: true,
          subsystemConnectionId: selectedSubsystemConnectionId
        });
        return;
      }
      selectFile(fileId);
      onSelectFile({
        fileId,
        fileKey: record.file.key,
        path: record.file.path
      });
      return;
    }
    const directoryPath = object?.userData.kind === "directory-terraces"
      ? object.userData.directoryPaths[intersection.instanceId]
      : object?.userData.directoryPath;
    if (directoryPath != null) {
      const record = directoryObjects.get(directoryPath)?.directory;
      if (viewMode === "subsystems" && record?.subsystemBase && record.subsystemId) {
        const subsystem = subsystemObjects.get(record.subsystemId)?.subsystem;
        if (subsystem) {
          selectSubsystem(subsystem.id);
          onSelectSubsystem(subsystem);
          return;
        }
      }
      selectDirectory(directoryPath);
      onSelectDirectory(record || { path: directoryPath });
      return;
    }
    if (object?.userData.campusId) {
      const record = campusObjects.get(object.userData.campusId)?.campus;
      selectPrecinct(object.userData.campusId);
      onSelectPrecinct(record || { id: object.userData.campusId });
      return;
    }
    clearSelection();
    onClearSelection();
  }

  function handleDoubleClick(event) {
    const eventTime = Number(event.timeStamp) || performance.now();
    if (eventTime <= suppressSyntheticDoubleClickUntil) {
      event.preventDefault();
      return;
    }
    const intersection = pickedIntersection(event);
    const object = intersection?.object;
    if (object?.userData.kind === "file-buildings") {
      const fileId = object.userData.fileIds[intersection.instanceId];
      const record = fileObjects.get(fileId);
      if (!record) {
        return;
      }
      openFileImmersively(fileId, record, event);
      return;
    }
    if (object?.userData.kind !== "subsystem") {
      return;
    }
    const record = subsystemObjects.get(object.userData.subsystemId);
    if (!record) {
      return;
    }
    event.preventDefault();
    selectSubsystem(record.subsystem.id);
    onSelectSubsystem(record.subsystem);
    onEditSubsystemDepth(record.subsystem);
  }

  function handlePointerCancel() {
    grabState = null;
    pointerDown = null;
    clearSubsystemConnectionHover();
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("dblclick", handleDoubleClick);
  canvas.addEventListener("pointerleave", clearSubsystemConnectionHover);
  canvas.addEventListener("lostpointercapture", handlePointerCancel);
  canvas.addEventListener("wheel", handleWheelMode, { capture: true, passive: true });
  canvas.addEventListener("keydown", handleKeyDown);

  return Object.freeze({
    beginFilePortal,
    captureView,
    clearSelection,
    dispose() {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      canvas.removeEventListener("pointerleave", clearSubsystemConnectionHover);
      canvas.removeEventListener("lostpointercapture", handlePointerCancel);
      canvas.removeEventListener("wheel", handleWheelMode, true);
      canvas.removeEventListener("keydown", handleKeyDown);
      clearWorld();
      controls.dispose();
      renderer.dispose();
    },
    endFilePortal,
    fitWorld,
    fileScreenRect,
    flyToFile,
    flyToView,
    focusDirectory,
    focusFile,
    focusPrecinct,
    focusSubsystem,
    focusSubsystemDependency,
    focusSubsystemLayer,
    frame,
    markDirty,
    resize,
    rotateView,
    restoreView,
    selectDirectory,
    selectFile,
    selectPrecinct,
    selectSubsystem,
    selectSubsystemConnection,
    selectSubsystemConnectionFile,
    setActive(value) {
      active = value === true;
      markDirty();
    },
    setSubsystemLayers,
    setViewMode,
    setFileContext,
    setOverview,
    setView
  });
}

export {
  createSystemWorld,
  fileBuildingHeight,
  fileColor,
  sideColor
};

import * as THREE from "three";
import CameraControls from "camera-controls";
import { Text } from "troika-three-text";

import {
  DIRECTORY_ELEVATION_STEP,
  isVisuallyLargeFile,
  layoutFileCity,
  stableHash
} from "./worldLayout.js";

CameraControls.install({ THREE });

const WHEEL_GESTURE_IDLE_MS = 180;

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

function sideColor(side = "unknown") {
  return SIDE_COLORS[side] || SIDE_COLORS.unknown;
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

function fileBuildingHeight(lines = 0, largest = 0) {
  const lineCount = Math.max(0, Number(lines) || 0);
  const height = 12 + Math.min(310, Math.pow(lineCount, 0.62) * 1.75);
  return isVisuallyLargeFile(lineCount, largest) ? Math.max(145, height) : height;
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

function createFileLabelAtlas(buildings = [], maxAnisotropy = 1) {
  return createLabelAtlas(
    buildings.map(({ file }) => fileName(file)),
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
    const region = regions.get(fileName(file));
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

function curveLine(from, to, {
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
      opacity,
      transparent: true
    })
    : new THREE.LineBasicMaterial({ color, opacity, transparent: true });
  const line = new THREE.Line(geometry, material);
  if (dashed) {
    line.computeLineDistances();
  }
  return line;
}

function createSystemWorld({
  canvas,
  onClearSelection = () => {},
  onSelectDirectory = () => {},
  onSelectFile = () => {},
  onSelectPrecinct = () => {},
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
  controls.dollyToCursor = false;
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
  const contextRoot = new THREE.Group();
  scene.add(worldRoot);
  scene.add(contextRoot);

  const pickables = [];
  const campusObjects = new Map();
  const fileObjects = new Map();
  const directoryObjects = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let active = true;
  let buildingEdgeLines = null;
  let buildingInstances = null;
  let cityLayout = null;
  let colorMode = "folders";
  let directoryTerraceInstances = null;
  let dirty = true;
  let grabState = null;
  let lastFrame = performance.now();
  let pointerDown = null;
  let roofInstances = null;
  let selectedCampusId = null;
  let selectedDirectoryPath = null;
  let selectedFileId = "";
  let neighborFileIds = new Set();
  let wheelGestureAction = CameraControls.ACTION.DOLLY;
  let wheelGestureAt = -Infinity;

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
    clearGroup(worldRoot);
    clearGroup(contextRoot);
    pickables.splice(0);
    campusObjects.clear();
    fileObjects.clear();
    directoryObjects.clear();
    selectedDirectoryPath = null;
    selectedFileId = "";
    neighborFileIds = new Set();
    buildingEdgeLines = null;
    buildingInstances = null;
    directoryTerraceInstances = null;
    roofInstances = null;
    selectedCampusId = null;
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
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(campus.width + 24, 28, campus.depth + 24),
        new THREE.MeshBasicMaterial({ color })
      );
      floor.position.set(campus.x, -16, campus.z);
      floor.userData.campusId = campus.id;
      floor.userData.kind = "campus";
      worldRoot.add(floor);
      const rimColor = new THREE.Color(color).offsetHSL(0, 0.16, 0.28).getHex();
      const rim = new THREE.LineSegments(
        new THREE.EdgesGeometry(floor.geometry),
        new THREE.LineBasicMaterial({ color: rimColor })
      );
      rim.position.copy(floor.position);
      worldRoot.add(rim);
      pickables.push(floor);
      campusObjects.set(campus.id, { baseColor: color, campus, floor, rim, rimColor });
      addLabel(worldRoot, campus.title.toUpperCase(), {
        color: 0xd9f3ff,
        fontSize: campus.implicit ? 18 : 22,
        maxWidth: Math.max(140, campus.width - 20),
        position: new THREE.Vector3(
          campus.x,
          24,
          campus.z - campus.depth / 2 + 22
        )
      });
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
          directory.elevation - DIRECTORY_ELEVATION_STEP / 2,
          directory.z
        ],
        scale: [directory.width, DIRECTORY_ELEVATION_STEP, directory.depth]
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
      const height = fileBuildingHeight(file.lines, largest);
      const baseColor = fileColor(file, colorMode);
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
      [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
      ].forEach(([from, to]) => {
        edgePositions.push(...corners[from], ...corners[to]);
      });

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

  function applySelectionStyles() {
    const contextActive = Boolean(selectedFileId || selectedDirectoryPath != null || selectedCampusId != null);
    const relevantCampusIds = new Set();
    const relevantDirectoryPaths = new Set();

    function includeDirectoryAncestry(directoryPath = "") {
      let currentPath = String(directoryPath || "");
      while (currentPath) {
        if (directoryObjects.has(currentPath)) {
          relevantDirectoryPaths.add(currentPath);
        }
        const separatorIndex = currentPath.lastIndexOf("/");
        if (separatorIndex < 0) {
          break;
        }
        currentPath = currentPath.slice(0, separatorIndex);
      }
    }

    for (const [fileId, record] of fileObjects) {
      const selected = fileId === selectedFileId;
      const neighbor = neighborFileIds.has(fileId);
      const insideDirectory = selectedDirectoryPath == null || selectedDirectoryPath === "" || (
        record.file.path === selectedDirectoryPath || record.file.path.startsWith(`${selectedDirectoryPath}/`)
      );
      const insideCampus = selectedCampusId == null || record.file.campusId === selectedCampusId;
      const baseColor = fileColor(record.file, colorMode);
      record.baseColor = baseColor;
      const inSelectedScope = (
        selectedDirectoryPath != null && insideDirectory
      ) || (
        selectedCampusId != null && insideCampus
      );
      const relevant = selected || neighbor || inSelectedScope;
      const dimmed = contextActive && !relevant;
      if (relevant) {
        relevantCampusIds.add(record.file.campusId);
        includeDirectoryAncestry(record.file.directoryPath);
      }
      const buildingColor = new THREE.Color(selected ? SELECTED_FILE_COLOR : baseColor);
      if (neighbor && !selected) {
        buildingColor.lerp(new THREE.Color(SELECTED_FILE_COLOR), 0.48);
      } else if (inSelectedScope) {
        buildingColor.offsetHSL(0, 0.06, 0.12);
      } else if (dimmed) {
        buildingColor.setHex(DIMMED_BUILDING_COLOR);
      }
      const roofColor = dimmed
        ? new THREE.Color(DIMMED_ROOF_COLOR)
        : buildingColor.clone().offsetHSL(0, -0.06, selected ? 0.2 : 0.12);
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
      record.floor.material.color.setHex(
        selected
          ? new THREE.Color(record.baseColor).offsetHSL(0, 0.08, 0.12).getHex()
          : relevant
            ? record.baseColor
            : DIMMED_CAMPUS_COLOR
      );
      record.rim.material.color.setHex(
        selected ? SELECTED_FILE_COLOR : relevant ? record.rimColor : DIMMED_EDGE_COLOR
      );
    }

    for (const [directoryPath, record] of directoryObjects) {
      const selected = selectedDirectoryPath === directoryPath;
      const relevant = !contextActive || relevantDirectoryPaths.has(directoryPath);
      const terraceColor = new THREE.Color(relevant ? record.baseColor : DIMMED_TERRACE_COLOR);
      if (selected) {
        terraceColor.lerp(new THREE.Color(SELECTED_FILE_COLOR), 0.55);
      }
      directoryTerraceInstances?.setColorAt(record.index, terraceColor);
    }
    if (directoryTerraceInstances?.instanceColor) {
      directoryTerraceInstances.instanceColor.needsUpdate = true;
    }
    markDirty();
  }

  function selectFile(fileId = "") {
    selectedFileId = String(fileId || "");
    selectedCampusId = null;
    selectedDirectoryPath = null;
    applySelectionStyles();
  }

  function selectDirectory(directoryPath = null) {
    selectedCampusId = null;
    selectedDirectoryPath = directoryPath == null ? null : String(directoryPath);
    selectedFileId = "";
    clearContext();
    applySelectionStyles();
  }

  function selectPrecinct(campusId = null) {
    selectedCampusId = campusId == null ? null : String(campusId);
    selectedDirectoryPath = null;
    selectedFileId = "";
    clearContext();
    applySelectionStyles();
  }

  function clearSelection() {
    selectedCampusId = null;
    selectedDirectoryPath = null;
    selectedFileId = "";
    clearContext();
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

  function setFileContext(constellation = {}) {
    clearContext();
    selectedFileId = constellation.selectedFile?.id || "";
    selectedCampusId = null;
    selectedDirectoryPath = null;
    neighborFileIds = new Set([selectedFileId]);
    for (const edge of constellation.edges || []) {
      const from = buildingTop(edge.fromFileId);
      const to = buildingTop(edge.toFileId);
      if (!from || !to) {
        continue;
      }
      neighborFileIds.add(edge.fromFileId);
      neighborFileIds.add(edge.toFileId);
      const outgoing = edge.fromFileId === selectedFileId;
      const line = curveLine(from, to, {
        color: outgoing ? 0x53dcff : 0xc78cff,
        dashed: edge.classification !== "local-file",
        elevation: 42 + Math.min(100, from.distanceTo(to) * 0.12),
        opacity: 0.82
      });
      contextRoot.add(line);
    }
    applySelectionStyles();
  }

  async function setOverview(overview = {}) {
    clearWorld();
    cityLayout = layoutFileCity(overview);
    addGround(cityLayout);
    addDirectoryPrecincts(cityLayout);
    addFileBuildings(cityLayout);
    markDirty();
    await fitWorld(false);
  }

  function focusFile(fileId = "") {
    const record = fileObjects.get(String(fileId || ""));
    if (!record) {
      return false;
    }
    const footprint = Math.max(record.file.cityWidth, record.file.cityDepth);
    const distance = Math.max(150, record.height * 2.5, footprint * 5.5);
    const elevation = Number(record.file.elevation) || 0;
    controls.setLookAt(
      record.file.x + distance * 0.42,
      elevation + record.height + distance * 0.72,
      record.file.z + distance * 0.68,
      record.file.x,
      elevation + record.height * 0.38,
      record.file.z,
      !reducedMotion
    );
    markDirty();
    return true;
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
    controls.setLookAt(
      directory.x + distance * 0.25,
      distance * 0.92,
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
    const span = Math.max(campus.width, campus.depth);
    const distance = Math.max(220, span * 1.25);
    controls.setLookAt(
      campus.x + distance * 0.22,
      distance * 0.88,
      campus.z + distance * 0.72,
      campus.x,
      0,
      campus.z,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  async function fitWorld(smooth = true) {
    if (worldRoot.children.length === 0) {
      return;
    }
    await controls.fitToBox(worldRoot, smooth && !reducedMotion, {
      paddingBottom: 72,
      paddingLeft: 84,
      paddingRight: 84,
      paddingTop: 105
    });
    markDirty();
  }

  function setView(view = "perspective") {
    const span = Math.max(cityLayout?.bounds.width || 1_420, cityLayout?.bounds.depth || 980);
    if (view === "top") {
      controls.setLookAt(0, span * 1.12, 0.01, 0, 0, 0, !reducedMotion);
    } else {
      controls.setLookAt(0, span * 0.72, span * 0.86, 0, 0, 0, !reducedMotion);
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

  function setColorMode(nextMode = "folders") {
    colorMode = ["folders", "subsystems", "runtime"].includes(nextMode) ? nextMode : "folders";
    applySelectionStyles();
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
    worldRoot.traverse((object) => {
      if (object.userData.billboard) {
        object.quaternion.copy(camera.quaternion);
      }
    });
  }

  function frame(now = performance.now()) {
    const delta = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
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
    return raycaster.intersectObjects(pickables, false)[0] || null;
  }

  function handlePointerDown(event) {
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
    if (!grabState || event.pointerId !== grabState.pointerId) {
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
        void controls.dolly(dollyStep, smooth);
      } else if (event.key === "ArrowDown") {
        void controls.dolly(-dollyStep, smooth);
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
          void controls.dolly(dollyStep, smooth);
          break;
        case "s":
        case "S":
        case "-":
        case "_":
          void controls.dolly(-dollyStep, smooth);
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

  function handlePointerUp(event) {
    grabState = null;
    if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) {
      pointerDown = null;
      return;
    }
    pointerDown = null;
    const intersection = pickedIntersection(event);
    const object = intersection?.object;
    if (object?.userData.kind === "file-buildings") {
      const fileId = object.userData.fileIds[intersection.instanceId];
      const record = fileObjects.get(fileId);
      if (!record) {
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

  function handlePointerCancel() {
    grabState = null;
    pointerDown = null;
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("lostpointercapture", handlePointerCancel);
  canvas.addEventListener("wheel", handleWheelMode, { capture: true, passive: true });
  canvas.addEventListener("keydown", handleKeyDown);

  return Object.freeze({
    captureView() {
      const target = controls.getTarget(new THREE.Vector3());
      return {
        position: camera.position.toArray(),
        target: target.toArray()
      };
    },
    clearSelection,
    dispose() {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("lostpointercapture", handlePointerCancel);
      canvas.removeEventListener("wheel", handleWheelMode, true);
      canvas.removeEventListener("keydown", handleKeyDown);
      clearWorld();
      controls.dispose();
      renderer.dispose();
    },
    fitWorld,
    focusDirectory,
    focusFile,
    focusPrecinct,
    frame,
    markDirty,
    resize,
    rotateView,
    restoreView(view = {}) {
      if (!Array.isArray(view.position) || !Array.isArray(view.target)) {
        return false;
      }
      controls.setLookAt(
        Number(view.position[0]) || 0,
        Number(view.position[1]) || 0,
        Number(view.position[2]) || 0,
        Number(view.target[0]) || 0,
        Number(view.target[1]) || 0,
        Number(view.target[2]) || 0,
        false
      );
      markDirty();
      return true;
    },
    selectDirectory,
    selectFile,
    selectPrecinct,
    setActive(value) {
      active = value === true;
      markDirty();
    },
    setColorMode,
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

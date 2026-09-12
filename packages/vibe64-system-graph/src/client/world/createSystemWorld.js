import * as THREE from "three";
import CameraControls from "camera-controls";
import { Text } from "troika-three-text";

import {
  createBuildingSurfaceLabels,
  createDistrictSurfaceLabels,
  createImplementationBundleConnector,
  createImplementationLastMileConnector,
  createImplementationTether,
  createSubsystemFileTether
} from "./cityPresentationObjects.js";
import {
  layoutGenesisCity,
  layoutGenesisSemanticSky,
  stableHash
} from "./worldLayout.js";
import {
  viewportCenterOrbitPivot
} from "./worldOrbitPivot.js";

CameraControls.install({ THREE });

const BUILDING_DOUBLE_TAP_WINDOW_MS = 360;
const BUILDING_PORTAL_DURATION_MS = 260;
const DIMMED_BUILDING_COLOR = 0x303640;
const DIMMED_DISTRICT_COLOR = 0x202730;
const DIMMED_ROOF_COLOR = 0x474e59;
const SELECTED_BUILDING_COLOR = 0x75f3ff;
const SELECTED_SUBSYSTEM_COLOR = 0x59e3ff;
const WHEEL_GESTURE_IDLE_MS = 180;

function hashedColor(value = "", {
  lightness = 0.46,
  saturation = 0.58
} = {}) {
  const hue = (stableHash(value) % 360) / 360;
  return new THREE.Color().setHSL(hue, saturation, lightness).getHex();
}

function districtColor(district = {}) {
  return hashedColor(district.id, {
    lightness: Math.max(0.2, 0.3 - district.hierarchyDepth * 0.018),
    saturation: 0.5
  });
}

function presentationSurfaceColor(surface = {}) {
  return hashedColor(surface.id, {
    lightness: surface.kind === "presentation-region" ? 0.18 : 0.24,
    saturation: surface.kind === "presentation-region" ? 0.64 : 0.54
  });
}

function buildingColor(building = {}, cityKind = "machine") {
  if (building.kind === "table") return 0x40bfae;
  const identity = cityKind === "program"
    ? building.districtId
    : building.language || building.districtId;
  return hashedColor(identity, {
    lightness: cityKind === "program" ? 0.53 : 0.48,
    saturation: cityKind === "program" ? 0.66 : 0.58
  });
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

function normalizedViewPose(view = {}) {
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

function createSystemWorld({
  canvas,
  onClearSelection = () => {},
  onHoverImplementationBundle = () => {},
  onInvalidate = () => {},
  onOpenBuilding = () => {},
  onSelectBuilding = () => {},
  onSelectDistrict = () => {},
  onSelectOperation = () => {},
  onSelectSubsystem = () => {},
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
  const portalRoot = new THREE.Group();
  scene.add(worldRoot, portalRoot);

  const buildingObjects = new Map();
  const districtObjects = new Map();
  const implementationBundleObjects = new Map();
  const operationObjects = new Map();
  const subsystemObjects = new Map();
  const pickables = [];
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 5;
  const navigationPointer = new THREE.Vector2();
  const pointer = new THREE.Vector2();
  let active = true;
  let buildingInstances = null;
  let cityLayout = null;
  let dirty = true;
  let districtInstances = null;
  let grabState = null;
  let hoveredImplementationBundleId = "";
  let lastFrame = performance.now();
  let lastTouchBuildingTap = { at: -Infinity, buildingId: "" };
  let pointerDown = null;
  let portal = null;
  let presentationSurfaceInstances = null;
  let roofInstances = null;
  let selectedBuildingId = "";
  let selectedDistrictId = "";
  let selectedOperationId = "";
  let selectedSubsystemId = "";
  let semanticLayout = null;
  let semanticRoot = null;
  let implementationRoot = null;
  let implementationBundleRoot = null;
  let implementationLastMileRoot = null;
  let orbitPivotMode = "viewport";
  let subsystemFileRoot = null;
  let semanticLayers = {
    implementations: false,
    subsystems: true
  };
  let suppressSyntheticDoubleClickUntil = -Infinity;
  let viewportHeight = 0;
  let viewportWidth = 0;
  let wheelGestureAction = CameraControls.ACTION.DOLLY;
  let wheelGestureAt = -Infinity;

  function markDirty() {
    const invalidated = !dirty;
    dirty = true;
    if (invalidated) {
      onInvalidate();
    }
  }

  function useExplicitOrbitPivot() {
    orbitPivotMode = "explicit";
  }

  function useViewportOrbitPivot() {
    orbitPivotMode = "viewport";
  }

  function activeVisualOrbitElevation() {
    if (!cityLayout) {
      return controls.getTarget(new THREE.Vector3()).y;
    }
    const physicalHeight = Math.max(0, Number(cityLayout.bounds?.height) || 0);
    const semanticHeight = semanticRoot?.visible
      ? Math.max(0, (Number(semanticLayout?.elevation) || 0) + 54)
      : 0;
    return Math.max(physicalHeight, semanticHeight) * 0.38;
  }

  function prepareViewportOrbitPivot() {
    if (orbitPivotMode === "explicit") {
      return controls.getTarget(new THREE.Vector3());
    }
    const position = controls.getPosition(new THREE.Vector3());
    const currentTarget = controls.getTarget(new THREE.Vector3());
    const pivot = viewportCenterOrbitPivot(
      camera,
      activeVisualOrbitElevation(),
      currentTarget
    );
    if (pivot.distanceToSquared(currentTarget) > 1e-8) {
      controls.setLookAt(
        position.x,
        position.y,
        position.z,
        pivot.x,
        pivot.y,
        pivot.z,
        false
      );
      markDirty();
    }
    return pivot;
  }

  // CameraControls owns right-drag and wheel gestures. Its wake event is the
  // renderer invalidation boundary that lets the mature City sleep completely
  // between interactions without missing the first frame of a gesture.
  controls.addEventListener("wake", markDirty);

  function clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObject(child);
    }
  }

  function clearPortal() {
    clearGroup(portalRoot);
    portal = null;
    markDirty();
  }

  function clearWorld() {
    clearGroup(worldRoot);
    clearPortal();
    buildingObjects.clear();
    districtObjects.clear();
    implementationBundleObjects.clear();
    operationObjects.clear();
    subsystemObjects.clear();
    pickables.splice(0);
    buildingInstances = null;
    cityLayout = null;
    districtInstances = null;
    presentationSurfaceInstances = null;
    hoveredImplementationBundleId = "";
    onHoverImplementationBundle(null);
    roofInstances = null;
    semanticLayout = null;
    semanticRoot = null;
    implementationRoot = null;
    implementationBundleRoot = null;
    implementationLastMileRoot = null;
    subsystemFileRoot = null;
    selectedBuildingId = "";
    selectedDistrictId = "";
    selectedOperationId = "";
    selectedSubsystemId = "";
    useViewportOrbitPivot();
    markDirty();
  }

  function addLabel(value, options = {}) {
    const label = textObject(value, { ...options, onSync: markDirty });
    worldRoot.add(label);
    return label;
  }

  function addCityLabel(layout) {
    addLabel(layout.cityLabel, {
      color: 0x8edfff,
      fontSize: 28,
      maxWidth: 680,
      position: new THREE.Vector3(0, 48, -layout.bounds.depth / 2 - 34)
    });
  }

  function addPresentationSurfaces(layout) {
    const surfaces = (layout.regions || []).length > 0
      ? [...layout.regions, ...(layout.campuses || [])]
      : [];
    if (surfaces.length === 0) {
      return;
    }
    presentationSurfaceInstances = new THREE.InstancedMesh(
      boxGeometryWithFaceShading(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      surfaces.length
    );
    presentationSurfaceInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    presentationSurfaceInstances.userData.kind = "presentation-surfaces";
    const transform = new THREE.Object3D();
    surfaces.forEach((surface, index) => {
      transform.position.set(
        surface.x,
        surface.elevation + surface.terraceHeight / 2,
        surface.z
      );
      transform.scale.set(surface.width, surface.terraceHeight, surface.footprintDepth);
      transform.updateMatrix();
      presentationSurfaceInstances.setMatrixAt(index, transform.matrix);
      presentationSurfaceInstances.setColorAt(index, new THREE.Color(presentationSurfaceColor(surface)));
    });
    presentationSurfaceInstances.instanceColor.needsUpdate = true;
    presentationSurfaceInstances.computeBoundingBox();
    presentationSurfaceInstances.computeBoundingSphere();
    worldRoot.add(presentationSurfaceInstances);
    const labels = createDistrictSurfaceLabels(
      surfaces,
      renderer.capabilities.getMaxAnisotropy()
    );
    if (labels) {
      labels.renderOrder = 1;
      worldRoot.add(labels);
    }
  }

  function addDistricts(layout) {
    if (layout.districts.length === 0) {
      return;
    }
    districtInstances = new THREE.InstancedMesh(
      boxGeometryWithFaceShading(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      layout.districts.length
    );
    districtInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    districtInstances.userData.districtIds = [];
    districtInstances.userData.kind = "districts";
    const transform = new THREE.Object3D();

    layout.districts.forEach((district, index) => {
      const baseColor = districtColor(district);
      transform.position.set(
        district.x,
        district.elevation + district.terraceHeight / 2,
        district.z
      );
      transform.scale.set(district.width, district.terraceHeight, district.footprintDepth);
      transform.updateMatrix();
      districtInstances.setMatrixAt(index, transform.matrix);
      districtInstances.setColorAt(index, new THREE.Color(baseColor));
      districtInstances.userData.districtIds[index] = district.id;
      districtObjects.set(district.id, { baseColor, district, index });

    });
    districtInstances.instanceColor.needsUpdate = true;
    districtInstances.computeBoundingBox();
    districtInstances.computeBoundingSphere();
    worldRoot.add(districtInstances);
    const surfaceLabels = createDistrictSurfaceLabels(
      layout.districts,
      renderer.capabilities.getMaxAnisotropy()
    );
    if (surfaceLabels) {
      worldRoot.add(surfaceLabels);
    }
    pickables.push(districtInstances);
  }

  function buildingEdges(buildings = []) {
    const positions = [];
    const edgePairs = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    for (const building of buildings) {
      const halfWidth = building.width / 2 + 0.35;
      const halfDepth = building.footprintDepth / 2 + 0.35;
      const bottom = building.elevation + 0.8;
      const top = building.elevation + building.buildingHeight + 1.4;
      const corners = [
        [building.x - halfWidth, bottom, building.z - halfDepth],
        [building.x + halfWidth, bottom, building.z - halfDepth],
        [building.x + halfWidth, bottom, building.z + halfDepth],
        [building.x - halfWidth, bottom, building.z + halfDepth],
        [building.x - halfWidth, top, building.z - halfDepth],
        [building.x + halfWidth, top, building.z - halfDepth],
        [building.x + halfWidth, top, building.z + halfDepth],
        [building.x - halfWidth, top, building.z + halfDepth]
      ];
      for (const [from, to] of edgePairs) {
        positions.push(...corners[from], ...corners[to]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const edges = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x6b7280, depthWrite: false })
    );
    edges.renderOrder = 2;
    return edges;
  }

  function addBuildings(layout) {
    if (layout.buildings.length === 0) {
      return;
    }
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    buildingInstances = new THREE.InstancedMesh(
      boxGeometryWithFaceShading(),
      material,
      layout.buildings.length
    );
    roofInstances = new THREE.InstancedMesh(
      boxGeometryWithFaceShading(),
      material.clone(),
      layout.buildings.length
    );
    buildingInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    buildingInstances.userData.buildingIds = [];
    buildingInstances.userData.kind = "buildings";
    roofInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const transform = new THREE.Object3D();

    layout.buildings.forEach((building, index) => {
      const height = building.buildingHeight;
      const baseColor = buildingColor(building, layout.cityKind);
      transform.position.set(building.x, building.elevation + height / 2 + 1, building.z);
      transform.scale.set(building.width, height, building.footprintDepth);
      transform.updateMatrix();
      buildingInstances.setMatrixAt(index, transform.matrix);
      buildingInstances.setColorAt(index, new THREE.Color(baseColor));

      const roofHeight = Math.max(1.2, Math.min(3, height * 0.025));
      transform.position.set(building.x, building.elevation + height + 1.6, building.z);
      transform.scale.set(
        Math.max(3, building.width * 0.86),
        roofHeight,
        Math.max(3, building.footprintDepth * 0.86)
      );
      transform.updateMatrix();
      roofInstances.setMatrixAt(index, transform.matrix);
      const roofColor = new THREE.Color(baseColor).offsetHSL(0, -0.08, 0.16).getHex();
      roofInstances.setColorAt(index, new THREE.Color(roofColor));

      buildingInstances.userData.buildingIds[index] = building.id;
      buildingObjects.set(building.id, {
        baseColor,
        building,
        index,
        roofColor
      });
    });
    buildingInstances.instanceColor.needsUpdate = true;
    roofInstances.instanceColor.needsUpdate = true;
    buildingInstances.computeBoundingBox();
    buildingInstances.computeBoundingSphere();
    roofInstances.computeBoundingBox();
    roofInstances.computeBoundingSphere();
    worldRoot.add(buildingInstances, roofInstances, buildingEdges(layout.buildings));
    const surfaceLabels = createBuildingSurfaceLabels(
      layout.buildings,
      renderer.capabilities.getMaxAnisotropy()
    );
    if (surfaceLabels) {
      worldRoot.add(surfaceLabels);
    }
    pickables.push(buildingInstances);
  }

  function semanticIslandColor(subsystem = {}) {
    return hashedColor(subsystem.id, { lightness: 0.48, saturation: 0.62 });
  }

  function addSemanticSky(layout, semantic = null) {
    semanticLayout = layoutGenesisSemanticSky(layout, semantic);
    if (!semanticLayout || semanticLayout.subsystems.length === 0) {
      return;
    }
    semanticRoot = new THREE.Group();
    implementationRoot = new THREE.Group();
    implementationBundleRoot = new THREE.Group();
    implementationLastMileRoot = new THREE.Group();
    subsystemFileRoot = new THREE.Group();
    semanticRoot.userData.kind = "semantic-sky";
    implementationRoot.userData.kind = "implementation-links";
    implementationBundleRoot.userData.kind = "implementation-bundles";
    implementationLastMileRoot.userData.kind = "implementation-last-mile";
    subsystemFileRoot.userData.kind = "subsystem-file-links";
    const skyLabel = textObject("SUBSYSTEM SKY · WHY THE CODE EXISTS", {
      color: 0xc8f4ff,
      fontSize: 24,
      maxWidth: 620,
      onSync: markDirty,
      position: new THREE.Vector3(
        0,
        semanticLayout.elevation + 54,
        -layout.bounds.depth / 2 - 60
      )
    });
    semanticRoot.add(skyLabel);

    for (const subsystem of semanticLayout.subsystems) {
      const baseColor = semanticIslandColor(subsystem);
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
      const label = textObject(
        `${subsystem.title}\n${subsystem.operations.length} operations · ${subsystem.files.length} files`,
        {
          color: 0xffffff,
          fontSize: Math.max(12, Math.min(18, subsystem.radius * 0.16)),
          maxWidth: subsystem.radius * 1.7,
          onSync: markDirty,
          position: new THREE.Vector3(0, 26, 0)
        }
      );
      group.add(island, ring, label);
      semanticRoot.add(group);
      pickables.push(island);
      subsystemObjects.set(subsystem.id, {
        baseColor,
        group,
        island,
        label,
        ring,
        subsystem
      });
      for (const target of subsystem.targets) {
        const tether = createSubsystemFileTether(
          new THREE.Vector3(subsystem.x, subsystem.y - 6, subsystem.z),
          new THREE.Vector3(
            target.x,
            target.elevation + target.buildingHeight + 3,
            target.z
          )
        );
        tether.userData.fileId = target.id;
        tether.userData.subsystemId = subsystem.id;
        subsystemFileRoot.add(tether);
      }
    }

    for (const operation of semanticLayout.operations) {
      const subsystem = subsystemObjects.get(operation.subsystemId)?.subsystem;
      if (!subsystem) {
        continue;
      }
      const baseColor = new THREE.Color(semanticIslandColor(subsystem))
        .offsetHSL(0.02, 0.08, 0.2)
        .getHex();
      const node = new THREE.Mesh(
        new THREE.SphereGeometry(operation.radius, 16, 10),
        new THREE.MeshBasicMaterial({ color: baseColor })
      );
      node.position.set(operation.x, operation.y, operation.z);
      node.userData.kind = "operation";
      node.userData.operationId = operation.id;
      semanticRoot.add(node);
      pickables.push(node);
      operationObjects.set(operation.id, { baseColor, node, operation });
    }

    for (const link of semanticLayout.implementationLinks) {
      const tether = createImplementationTether(
        new THREE.Vector3(link.from.x, link.from.y, link.from.z),
        new THREE.Vector3(link.to.x, link.to.y, link.to.z)
      );
      tether.userData.fileId = link.fileId;
      tether.userData.operationId = link.operationId;
      tether.userData.subsystemId = link.subsystemId;
      implementationRoot.add(tether);
    }
    for (const bundle of semanticLayout.implementationBundles || []) {
      const connector = createImplementationBundleConnector(
        new THREE.Vector3(bundle.from.x, bundle.from.y, bundle.from.z),
        new THREE.Vector3(bundle.to.x, bundle.to.y, bundle.to.z),
        bundle.weight
      );
      for (const pickable of connector.pickables) {
        pickable.userData.implementationBundleId = bundle.id;
        pickable.userData.kind = "implementation-bundle";
        pickables.push(pickable);
      }
      connector.object.userData.subsystemId = bundle.subsystemId;
      implementationBundleObjects.set(bundle.id, { bundle, connector });
      implementationBundleRoot.add(connector.object);
      for (const target of bundle.targets) {
        const tether = createImplementationLastMileConnector(
          new THREE.Vector3(bundle.to.x, bundle.to.y, bundle.to.z),
          new THREE.Vector3(
            target.x,
            target.elevation + target.buildingHeight + 3,
            target.z
          )
        );
        tether.userData.fileId = target.id;
        tether.userData.subsystemId = bundle.subsystemId;
        implementationLastMileRoot.add(tether);
      }
    }
    semanticRoot.add(
      subsystemFileRoot,
      implementationRoot,
      implementationBundleRoot,
      implementationLastMileRoot
    );
    worldRoot.add(semanticRoot);
    syncSemanticVisibility();
  }

  function setHoveredImplementationBundle(bundleId = "", event = null) {
    const normalizedId = String(bundleId || "");
    if (normalizedId !== hoveredImplementationBundleId) {
      implementationBundleObjects.get(hoveredImplementationBundleId)?.connector.setHighlighted(false);
      hoveredImplementationBundleId = normalizedId;
      implementationBundleObjects.get(hoveredImplementationBundleId)?.connector.setHighlighted(true);
      markDirty();
    }
    const record = implementationBundleObjects.get(normalizedId);
    if (!record) {
      onHoverImplementationBundle(null);
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    onHoverImplementationBundle({
      ...record.bundle,
      canvasX: Math.max(0, (Number(event?.clientX) || bounds.left) - bounds.left),
      canvasY: Math.max(0, (Number(event?.clientY) || bounds.top) - bounds.top)
    });
  }

  function syncSemanticVisibility() {
    if (!semanticRoot) {
      return;
    }
    semanticRoot.visible = semanticLayers.subsystems;
    if (subsystemFileRoot) {
      subsystemFileRoot.visible = semanticLayers.subsystems;
      for (const tether of subsystemFileRoot.children) {
        tether.visible = Boolean(
          selectedSubsystemId && tether.userData.subsystemId === selectedSubsystemId
        );
      }
    }
    if (implementationRoot) {
      implementationRoot.visible = Boolean(
        semanticLayers.subsystems && semanticLayers.implementations && selectedOperationId
      );
      for (const tether of implementationRoot.children) {
        tether.visible = tether.userData.operationId === selectedOperationId;
      }
    }
    const bundlesVisible = Boolean(
      semanticLayers.subsystems && semanticLayers.implementations &&
      selectedSubsystemId && !selectedOperationId
    );
    if (implementationBundleRoot) {
      implementationBundleRoot.visible = bundlesVisible;
      for (const connector of implementationBundleRoot.children) {
        connector.visible = connector.userData.subsystemId === selectedSubsystemId;
      }
    }
    if (implementationLastMileRoot) {
      implementationLastMileRoot.visible = bundlesVisible;
      for (const tether of implementationLastMileRoot.children) {
        tether.visible = tether.userData.subsystemId === selectedSubsystemId;
      }
    }
    if (!bundlesVisible) {
      setHoveredImplementationBundle();
    }
  }

  function selectedDistrictRelated(district = {}) {
    if (!selectedDistrictId) {
      return false;
    }
    const selected = districtObjects.get(selectedDistrictId)?.district;
    return district.id === selectedDistrictId ||
      district.ancestorIds.includes(selectedDistrictId) ||
      selected?.ancestorIds.includes(district.id);
  }

  function applySelectionStyles() {
    const contextActive = Boolean(
      selectedBuildingId || selectedDistrictId || selectedOperationId || selectedSubsystemId
    );
    const selectedBuilding = buildingObjects.get(selectedBuildingId)?.building;
    const selectedOperation = operationObjects.get(selectedOperationId)?.operation;
    const selectedSubsystem = subsystemObjects.get(selectedSubsystemId)?.subsystem;
    const semanticFileIds = new Set(
      selectedOperation
        ? selectedOperation.implementationLinks.map((link) => link.fileId)
        : selectedSubsystem?.fileIds || []
    );

    for (const [buildingId, record] of buildingObjects) {
      const selected = buildingId === selectedBuildingId;
      const inDistrict = selectedDistrictId && record.building.ancestorDistrictIds.includes(selectedDistrictId);
      const inSemanticSelection = semanticFileIds.has(buildingId);
      const dimmed = contextActive && !selected && !inDistrict && !inSemanticSelection;
      const color = new THREE.Color(
        selected
          ? SELECTED_BUILDING_COLOR
          : dimmed
            ? DIMMED_BUILDING_COLOR
            : record.baseColor
      );
      if ((inDistrict || inSemanticSelection) && !selected) {
        color.offsetHSL(0, 0.05, 0.12);
      }
      buildingInstances?.setColorAt(record.index, color);
      roofInstances?.setColorAt(
        record.index,
        dimmed
          ? new THREE.Color(DIMMED_ROOF_COLOR)
          : color.clone().offsetHSL(0, -0.06, selected ? 0.2 : 0.12)
      );
    }
    if (buildingInstances?.instanceColor) {
      buildingInstances.instanceColor.needsUpdate = true;
    }
    if (roofInstances?.instanceColor) {
      roofInstances.instanceColor.needsUpdate = true;
    }

    for (const [districtId, record] of districtObjects) {
      const selected = districtId === selectedDistrictId;
      const containsBuilding = selectedBuilding?.ancestorDistrictIds.includes(districtId);
      const related = selectedDistrictRelated(record.district);
      const dimmed = contextActive && !selected && !containsBuilding && !related;
      const color = new THREE.Color(dimmed ? DIMMED_DISTRICT_COLOR : record.baseColor);
      if (selected || containsBuilding) {
        color.lerp(new THREE.Color(SELECTED_BUILDING_COLOR), selected ? 0.62 : 0.28);
      }
      districtInstances?.setColorAt(record.index, color);
    }
    if (districtInstances?.instanceColor) {
      districtInstances.instanceColor.needsUpdate = true;
    }

    for (const [subsystemId, record] of subsystemObjects) {
      const selected = subsystemId === selectedSubsystemId ||
        selectedOperation?.subsystemId === subsystemId;
      record.island.material.color.setHex(selected ? SELECTED_SUBSYSTEM_COLOR : record.baseColor);
      record.island.material.opacity = contextActive && !selected ? 0.34 : 0.8;
      record.ring.material.opacity = contextActive && !selected ? 0.28 : 0.9;
      record.label.visible = !contextActive || selected;
    }
    for (const [operationId, record] of operationObjects) {
      const selected = operationId === selectedOperationId;
      const inSubsystem = selectedSubsystemId && record.operation.subsystemId === selectedSubsystemId;
      record.node.material.color.setHex(selected ? SELECTED_BUILDING_COLOR : record.baseColor);
      record.node.material.opacity = contextActive && !selected && !inSubsystem ? 0.28 : 1;
      record.node.material.transparent = record.node.material.opacity < 1;
    }
    syncSemanticVisibility();
    markDirty();
  }

  function selectBuilding(buildingId = "") {
    const normalizedId = String(buildingId || "");
    if (normalizedId && !buildingObjects.has(normalizedId)) {
      return false;
    }
    selectedBuildingId = normalizedId;
    selectedDistrictId = "";
    selectedOperationId = "";
    selectedSubsystemId = "";
    applySelectionStyles();
    return true;
  }

  function selectDistrict(districtId = "") {
    const normalizedId = String(districtId || "");
    if (normalizedId && !districtObjects.has(normalizedId)) {
      return false;
    }
    selectedBuildingId = "";
    selectedDistrictId = normalizedId;
    selectedOperationId = "";
    selectedSubsystemId = "";
    applySelectionStyles();
    return normalizedId ? districtObjects.get(normalizedId).district : true;
  }

  function clearSelection() {
    selectedBuildingId = "";
    selectedDistrictId = "";
    selectedOperationId = "";
    selectedSubsystemId = "";
    applySelectionStyles();
  }

  function selectSubsystem(subsystemId = "") {
    const normalizedId = String(subsystemId || "");
    if (normalizedId && !subsystemObjects.has(normalizedId)) {
      return false;
    }
    selectedBuildingId = "";
    selectedDistrictId = "";
    selectedOperationId = "";
    selectedSubsystemId = normalizedId;
    applySelectionStyles();
    return normalizedId ? subsystemObjects.get(normalizedId).subsystem : true;
  }

  function selectOperation(operationId = "") {
    const normalizedId = String(operationId || "");
    if (normalizedId && !operationObjects.has(normalizedId)) {
      return false;
    }
    selectedBuildingId = "";
    selectedDistrictId = "";
    selectedOperationId = normalizedId;
    selectedSubsystemId = normalizedId
      ? operationObjects.get(normalizedId).operation.subsystemId
      : "";
    applySelectionStyles();
    return normalizedId ? operationObjects.get(normalizedId).operation : true;
  }

  function setSemanticLayers(layers = {}) {
    semanticLayers = {
      implementations: layers.implementations === true,
      subsystems: layers.subsystems !== false
    };
    syncSemanticVisibility();
    markDirty();
  }

  function captureView() {
    return {
      position: camera.position.toArray(),
      target: controls.getTarget(new THREE.Vector3()).toArray()
    };
  }

  function restoreView(view = {}) {
    const pose = normalizedViewPose(view);
    if (!pose) {
      return false;
    }
    useExplicitOrbitPivot();
    controls.setLookAt(...pose.position, ...pose.target, false);
    markDirty();
    return true;
  }

  async function flyToView(view = {}) {
    const pose = normalizedViewPose(view);
    if (!pose) {
      return false;
    }
    useExplicitOrbitPivot();
    await controls.setLookAt(...pose.position, ...pose.target, !reducedMotion);
    markDirty();
    return true;
  }

  function buildingFocusPose(record) {
    const building = record.building;
    const footprint = Math.max(building.width, building.footprintDepth);
    const distance = Math.max(150, building.buildingHeight * 2.5, footprint * 5.5);
    return {
      position: [
        building.x + distance * 0.42,
        building.elevation + building.buildingHeight + distance * 0.72,
        building.z + distance * 0.68
      ],
      target: [
        building.x,
        building.elevation + building.buildingHeight * 0.38,
        building.z
      ]
    };
  }

  function focusBuilding(buildingId = "") {
    const record = buildingObjects.get(String(buildingId || ""));
    if (!record) {
      return false;
    }
    const pose = buildingFocusPose(record);
    useExplicitOrbitPivot();
    void controls.setLookAt(...pose.position, ...pose.target, !reducedMotion);
    markDirty();
    return true;
  }

  async function flyToBuilding(buildingId = "") {
    const record = buildingObjects.get(String(buildingId || ""));
    if (!record) {
      return null;
    }
    const pose = buildingFocusPose(record);
    useExplicitOrbitPivot();
    await controls.setLookAt(...pose.position, ...pose.target, !reducedMotion);
    markDirty();
    return buildingScreenRect(buildingId);
  }

  function focusDistrict(districtId = "") {
    const record = districtObjects.get(String(districtId || ""));
    if (!record) {
      return false;
    }
    const district = record.district;
    const span = Math.max(district.width, district.footprintDepth);
    const distance = Math.max(180, span * 1.45);
    const surfaceElevation = district.elevation + district.terraceHeight;
    useExplicitOrbitPivot();
    controls.setLookAt(
      district.x + distance * 0.25,
      surfaceElevation + distance * 0.92,
      district.z + distance * 0.72,
      district.x,
      surfaceElevation,
      district.z,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  function focusSemanticRecord(record = null, radius = 60) {
    if (!record) {
      return false;
    }
    const distance = Math.max(170, radius * 4.2);
    useExplicitOrbitPivot();
    controls.setLookAt(
      record.x + distance * 0.32,
      record.y + distance * 0.72,
      record.z + distance * 0.7,
      record.x,
      record.y,
      record.z,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  function focusSubsystem(subsystemId = "") {
    const record = subsystemObjects.get(String(subsystemId || ""));
    return focusSemanticRecord(record?.subsystem, record?.subsystem.radius);
  }

  function focusOperation(operationId = "") {
    const record = operationObjects.get(String(operationId || ""));
    return focusSemanticRecord(record?.operation, 34);
  }

  async function fitWorld(smooth = true) {
    if (!cityLayout) {
      return false;
    }
    const span = Math.max(cityLayout.bounds.width, cityLayout.bounds.depth, 260);
    const targetY = semanticRoot?.visible
      ? Math.max(cityLayout.bounds.height * 0.18, (semanticLayout?.elevation || 0) * 0.36)
      : cityLayout.bounds.height * 0.18;
    useViewportOrbitPivot();
    await controls.setLookAt(
      span * 0.18,
      targetY + span * 0.72,
      span * 0.86,
      0,
      targetY,
      0,
      smooth && !reducedMotion
    );
    markDirty();
    return true;
  }

  function setView(view = "perspective") {
    if (!cityLayout) {
      return false;
    }
    const span = Math.max(cityLayout.bounds.width, cityLayout.bounds.depth, 260);
    const targetY = semanticRoot?.visible
      ? Math.max(cityLayout.bounds.height * 0.18, (semanticLayout?.elevation || 0) * 0.36)
      : cityLayout.bounds.height * 0.18;
    useViewportOrbitPivot();
    if (view === "top") {
      controls.setLookAt(0, targetY + span * 1.12, 0.01, 0, targetY, 0, !reducedMotion);
    } else {
      controls.setLookAt(0, targetY + span * 0.72, span * 0.86, 0, targetY, 0, !reducedMotion);
    }
    markDirty();
    return true;
  }

  function rotateView(azimuthDegrees = 0, polarDegrees = 0, smooth = true) {
    prepareViewportOrbitPivot();
    controls.rotate(
      THREE.MathUtils.degToRad(Number(azimuthDegrees) || 0),
      THREE.MathUtils.degToRad(Number(polarDegrees) || 0),
      smooth && !reducedMotion
    );
    markDirty();
  }

  function projectedPoint(x, y, z, bounds) {
    const projected = new THREE.Vector3(x, y, z).project(camera);
    return {
      x: bounds.left + (projected.x + 1) * bounds.width / 2,
      y: bounds.top + (1 - projected.y) * bounds.height / 2
    };
  }

  function buildingScreenRect(buildingId = "") {
    const record = buildingObjects.get(String(buildingId || ""));
    if (!record) {
      return null;
    }
    const building = record.building;
    const bounds = canvas.getBoundingClientRect();
    const halfWidth = Math.max(1, building.width / 2);
    const halfDepth = Math.max(1, building.footprintDepth / 2);
    const points = [];
    camera.updateMatrixWorld();
    for (const x of [building.x - halfWidth, building.x + halfWidth]) {
      for (const y of [building.elevation, building.elevation + building.buildingHeight + 3]) {
        for (const z of [building.z - halfDepth, building.z + halfDepth]) {
          points.push(projectedPoint(x, y, z, bounds));
        }
      }
    }
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const width = Math.max(20, maxX - minX);
    const height = Math.max(28, maxY - minY);
    return {
      height,
      width,
      x: (minX + maxX - width) / 2,
      y: (minY + maxY - height) / 2
    };
  }

  function createPortalObject(record) {
    const building = record.building;
    const group = new THREE.Group();
    const shellMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: SELECTED_BUILDING_COLOR,
      depthWrite: false,
      opacity: 0.72,
      transparent: true
    });
    const shellGeometry = new THREE.BoxGeometry(
      Math.max(3, building.width * 1.035),
      building.buildingHeight,
      Math.max(3, building.footprintDepth * 1.035)
    );
    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    shell.position.y = building.buildingHeight / 2 + 1;
    shell.renderOrder = 12;
    const outlineMaterial = new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xd8fbff,
      depthTest: false,
      depthWrite: false,
      opacity: 0.95,
      transparent: true
    });
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(shellGeometry), outlineMaterial);
    outline.position.copy(shell.position);
    outline.renderOrder = 13;

    const ringMaterials = [];
    const radius = Math.max(8, Math.max(building.width, building.footprintDepth) * 0.72);
    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index === 1 ? 0xb59cff : SELECTED_BUILDING_COLOR,
        depthTest: false,
        depthWrite: false,
        opacity: 0.72,
        side: THREE.DoubleSide,
        transparent: true
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 1.8, 48), material);
      ring.position.y = 1.2 + index * 1.5;
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 14;
      ring.userData.portalRingIndex = index;
      ringMaterials.push(material);
      group.add(ring);
    }
    group.add(shell, outline);
    group.position.set(building.x, building.elevation, building.z);
    return { group, outlineMaterial, ringMaterials, shellMaterial };
  }

  function beginBuildingPortal(buildingId = "") {
    const normalizedId = String(buildingId || "");
    const record = buildingObjects.get(normalizedId);
    if (!record) {
      return null;
    }
    clearPortal();
    const object = createPortalObject(record);
    portalRoot.add(object.group);
    portal = {
      ...object,
      amount: reducedMotion ? 1 : 0,
      baseY: record.building.elevation,
      buildingId: normalizedId,
      height: record.building.buildingHeight,
      phase: reducedMotion ? "open" : "opening",
      phaseAt: performance.now(),
      phaseStartAmount: reducedMotion ? 1 : 0
    };
    markDirty();
    return buildingScreenRect(normalizedId);
  }

  function endBuildingPortal({ immediate = false } = {}) {
    if (!portal) {
      return;
    }
    if (immediate || reducedMotion) {
      clearPortal();
      return;
    }
    portal.phase = "closing";
    portal.phaseAt = performance.now();
    portal.phaseStartAmount = portal.amount;
    markDirty();
  }

  function updatePortal(now) {
    if (!portal) {
      return;
    }
    const elapsed = now - portal.phaseAt;
    if (portal.phase === "opening") {
      const progress = Math.min(1, elapsed / BUILDING_PORTAL_DURATION_MS);
      portal.amount = 1 - (1 - progress) ** 3;
      if (progress >= 1) {
        portal.phase = "open";
        portal.phaseAt = now;
      }
    } else if (portal.phase === "closing") {
      const progress = Math.min(1, elapsed / (BUILDING_PORTAL_DURATION_MS * 0.72));
      portal.amount = portal.phaseStartAmount * (1 - progress ** 2);
      if (progress >= 1) {
        clearPortal();
        return;
      }
    }

    const pulse = (Math.sin(now * 0.0045) + 1) / 2;
    const amount = portal.amount;
    portal.group.position.y = portal.baseY + amount * (18 + portal.height * 0.13);
    portal.group.rotation.y = amount * (0.045 + pulse * 0.035);
    portal.group.scale.setScalar(1 + amount * (0.035 + pulse * 0.018));
    portal.shellMaterial.opacity = amount * (0.54 + pulse * 0.2);
    portal.outlineMaterial.opacity = amount * (0.72 + pulse * 0.28);
    portal.group.children.forEach((child) => {
      const index = child.userData.portalRingIndex;
      if (!Number.isInteger(index)) {
        return;
      }
      const cycle = (now * 0.0007 + index / 3) % 1;
      child.scale.setScalar(0.75 + cycle * 1.15);
      portal.ringMaterials[index].opacity = amount * (1 - cycle) * 0.7;
    });
    markDirty();
  }

  async function setOverview(overview = {}) {
    clearWorld();
    cityLayout = layoutGenesisCity(overview);
    semanticLayers = {
      implementations: overview.semantic?.layers?.implementations === true,
      subsystems: overview.semantic?.layers?.subsystems !== false
    };
    addCityLabel(cityLayout);
    addPresentationSurfaces(cityLayout);
    addDistricts(cityLayout);
    addBuildings(cityLayout);
    addSemanticSky(cityLayout, overview.semantic);
    applySelectionStyles();
    await fitWorld(false);
    return cityLayout;
  }

  function resize(width, height) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (nextWidth === viewportWidth && nextHeight === viewportHeight) {
      return false;
    }
    viewportWidth = nextWidth;
    viewportHeight = nextHeight;
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    markDirty();
    return true;
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
    if (!active) {
      return false;
    }
    updatePortal(now);
    const controlsChanged = controls.update(delta);
    const shouldContinue = Boolean(portal || controlsChanged);
    if (!dirty && !controlsChanged) {
      return shouldContinue;
    }
    updateBillboards();
    renderer.render(scene, camera);
    dirty = false;
    return shouldContinue;
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

  function prepareOrbitPointerDown(event) {
    if (event.pointerType === "touch") {
      prepareViewportOrbitPivot();
      return;
    }
    if (event.button === 2) {
      prepareViewportOrbitPivot();
    } else if (event.button === 1) {
      useViewportOrbitPivot();
    }
  }

  function handlePointerMove(event) {
    pointerNdc(event, navigationPointer);
    if (!grabState || event.pointerId !== grabState.pointerId) {
      if (implementationBundleRoot?.visible) {
        const hovered = pickedIntersection(event)?.object;
        setHoveredImplementationBundle(
          hovered?.userData.kind === "implementation-bundle"
            ? hovered.userData.implementationBundleId
            : "",
          event
        );
      } else {
        setHoveredImplementationBundle();
      }
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
    useViewportOrbitPivot();
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
    useViewportOrbitPivot();
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
      // Keep wheel dolly bounded. Infinity Dolly changes a zoom-in at
      // minDistance into forward target travel; with dollyToCursor that can
      // drive the camera through a dense City and leave CameraControls
      // animating an enormous target displacement. Ordinary navigation has
      // explicit walk controls, so wheel zoom must always stop at the camera
      // distance limits.
      controls.infinityDolly = false;
      useViewportOrbitPivot();
    }
    if (rotate) {
      prepareViewportOrbitPivot();
      grabState = null;
      pointerDown = null;
    }
    // CameraControls dispatches `wake` from update(), but a sleeping City has
    // no scheduled update yet. Wheel input is therefore itself an
    // invalidation boundary; subsequent frames continue only while controls
    // report motion.
    markDirty();
  }

  function openBuildingImmersively(buildingId, record, event = null) {
    event?.preventDefault?.();
    const returnView = captureView();
    if (selectedBuildingId !== buildingId) {
      selectBuilding(buildingId);
      onSelectBuilding({ buildingId, path: record.building.path });
    }
    const anchor = buildingScreenRect(buildingId);
    beginBuildingPortal(buildingId);
    onOpenBuilding({
      anchor,
      buildingId,
      path: record.building.path,
      returnView
    });
  }

  function handlePointerUp(event) {
    grabState = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) {
      pointerDown = null;
      if (event.pointerType === "touch") {
        lastTouchBuildingTap = { at: -Infinity, buildingId: "" };
      }
      return;
    }
    pointerDown = null;
    const intersection = pickedIntersection(event);
    const object = intersection?.object;
    if (implementationBundleRoot?.visible && object?.userData.kind === "implementation-bundle") {
      const record = implementationBundleObjects.get(object.userData.implementationBundleId);
      const subsystem = subsystemObjects.get(record?.bundle.subsystemId)?.subsystem;
      if (subsystem) {
        selectSubsystem(subsystem.id);
        onSelectSubsystem(subsystem);
      }
      return;
    }
    if (object?.userData.kind === "subsystem") {
      const record = subsystemObjects.get(object.userData.subsystemId);
      if (record) {
        selectSubsystem(record.subsystem.id);
        onSelectSubsystem(record.subsystem);
      }
      return;
    }
    if (object?.userData.kind === "operation") {
      const record = operationObjects.get(object.userData.operationId);
      if (record) {
        selectOperation(record.operation.id);
        onSelectOperation(record.operation);
      }
      return;
    }
    if (object?.userData.kind === "buildings") {
      const buildingId = object.userData.buildingIds[intersection.instanceId];
      const record = buildingObjects.get(buildingId);
      if (!record) {
        return;
      }
      if (event.pointerType === "touch") {
        const tappedAt = Number(event.timeStamp) || performance.now();
        const doubleTap = lastTouchBuildingTap.buildingId === buildingId &&
          tappedAt - lastTouchBuildingTap.at <= BUILDING_DOUBLE_TAP_WINDOW_MS;
        lastTouchBuildingTap = doubleTap
          ? { at: -Infinity, buildingId: "" }
          : { at: tappedAt, buildingId };
        if (doubleTap) {
          suppressSyntheticDoubleClickUntil = tappedAt + BUILDING_DOUBLE_TAP_WINDOW_MS;
          openBuildingImmersively(buildingId, record, event);
          return;
        }
      }
      selectBuilding(buildingId);
      onSelectBuilding({ buildingId, path: record.building.path });
      return;
    }
    if (object?.userData.kind === "districts") {
      const districtId = object.userData.districtIds[intersection.instanceId];
      const record = districtObjects.get(districtId);
      if (!record) {
        return;
      }
      selectDistrict(districtId);
      onSelectDistrict(record.district);
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
    if (intersection?.object?.userData.kind !== "buildings") {
      return;
    }
    const buildingId = intersection.object.userData.buildingIds[intersection.instanceId];
    const record = buildingObjects.get(buildingId);
    if (record) {
      openBuildingImmersively(buildingId, record, event);
    }
  }

  function handlePointerCancel() {
    grabState = null;
    pointerDown = null;
    setHoveredImplementationBundle();
  }

  canvas.addEventListener("pointerdown", prepareOrbitPointerDown, true);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("pointerleave", handlePointerCancel);
  canvas.addEventListener("dblclick", handleDoubleClick);
  canvas.addEventListener("lostpointercapture", handlePointerCancel);
  canvas.addEventListener("wheel", handleWheelMode, { capture: true, passive: true });
  canvas.addEventListener("keydown", handleKeyDown);

  return Object.freeze({
    beginBuildingPortal,
    buildingScreenRect,
    captureView,
    clearOverview: clearWorld,
    clearSelection,
    dispose() {
      canvas.removeEventListener("pointerdown", prepareOrbitPointerDown, true);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("pointerleave", handlePointerCancel);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      canvas.removeEventListener("lostpointercapture", handlePointerCancel);
      canvas.removeEventListener("wheel", handleWheelMode, true);
      canvas.removeEventListener("keydown", handleKeyDown);
      controls.removeEventListener("wake", markDirty);
      clearWorld();
      controls.dispose();
      renderer.dispose();
    },
    endBuildingPortal,
    fitWorld,
    flyToBuilding,
    flyToView,
    focusBuilding,
    focusDistrict,
    focusOperation,
    focusSubsystem,
    frame,
    resize,
    restoreView,
    rotateView,
    selectBuilding,
    selectDistrict,
    selectOperation,
    selectSubsystem,
    setSemanticLayers,
    setActive(value) {
      active = value === true;
      markDirty();
    },
    setOverview,
    setView
  });
}

export {
  buildingColor,
  createSystemWorld,
  districtColor
};

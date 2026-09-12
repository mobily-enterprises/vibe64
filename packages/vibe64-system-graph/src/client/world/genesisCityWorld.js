import {
  genesisSemanticWorld
} from "./genesisSemanticWorld.js";

const GENESIS_MACHINE_CITY_KIND = "machine";
const GENESIS_PROGRAM_CITY_KIND = "program";

function genesisCityKind(value = "") {
  return value === GENESIS_PROGRAM_CITY_KIND
    ? GENESIS_PROGRAM_CITY_KIND
    : GENESIS_MACHINE_CITY_KIND;
}

function genesisCityWorld(city = null, kind = GENESIS_MACHINE_CITY_KIND, {
  machineCity = null,
  programCity = null,
  semanticLayers = null
} = {}) {
  if (!city) {
    return null;
  }
  const normalizedKind = genesisCityKind(kind);
  const world = {
    buildings: city.buildings,
    cityKind: normalizedKind,
    cityLabel: normalizedKind === GENESIS_MACHINE_CITY_KIND
      ? "MACHINE CITY · FILES AND FUNCTIONS"
      : "PROGRAM CITY · SUBSYSTEMS AND OPERATIONS",
    districts: city.districts,
    presentationCampuses: normalizedKind === GENESIS_MACHINE_CITY_KIND
      ? city.presentationCampuses || []
      : [],
    presentationRegions: normalizedKind === GENESIS_MACHINE_CITY_KIND
      ? city.presentationRegions || []
      : []
  };
  if (normalizedKind === GENESIS_MACHINE_CITY_KIND) {
    world.functions = city.functions;
    const semantic = genesisSemanticWorld(machineCity, programCity);
    if (semantic) {
      world.semantic = {
        ...semantic,
        layers: {
          implementations: semanticLayers?.implementations === true,
          subsystems: semanticLayers?.subsystems !== false
        }
      };
    }
  } else {
    if (city.buildings.some((building) => building.districtId === null)) {
      world.districts = [...city.districts, { id: "presentation:unassigned", path: "", title: "Unassigned operations", parentId: null }];
      world.buildings = city.buildings.map((building) => building.districtId === null ? { ...building, districtId: "presentation:unassigned" } : building);
    }
    world.links = city.links;
  }
  return world;
}

export {
  GENESIS_MACHINE_CITY_KIND,
  GENESIS_PROGRAM_CITY_KIND,
  genesisCityKind,
  genesisCityWorld
};

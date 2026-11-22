// The one Vibe64-owned vocabulary of connected-repository package types. A type
// is recorded in vibe64.connections.json, the Stack default and the prepared
// vibe64.connected-sources.v2 map. Every type but `custom` names a treatment
// Vibe64 owns: workspace preparation puts a `dependency` connection of that type
// in effect in the session's own trees with that ecosystem's adapter, keeps it in
// effect and proves it, with no project command. `custom` runs the consuming
// project's per-connection script, for what no adapter covers.
const CONNECTED_CUSTOM_PACKAGE_TYPE = "custom";
const CONNECTED_SOURCES_CONTRACT = "vibe64.connected-sources.v2";

const CONNECTED_PACKAGE_TYPES = Object.freeze([
  Object.freeze({ value: "npm", label: "npm (Node.js)" }),
  Object.freeze({ value: "composer", label: "Composer (PHP)" }),
  Object.freeze({ value: "pip", label: "pip (Python)" }),
  Object.freeze({ value: "bundler", label: "Bundler (Ruby)" }),
  Object.freeze({ value: "gomod", label: "Go modules" }),
  Object.freeze({ value: "cargo", label: "Cargo (Rust)" }),
  Object.freeze({ value: "maven", label: "Maven" }),
  Object.freeze({ value: "gradle", label: "Gradle" }),
  Object.freeze({ value: "nuget", label: "NuGet (.NET)" }),
  Object.freeze({ value: CONNECTED_CUSTOM_PACKAGE_TYPE, label: "custom" })
]);

// How a declared Custom runner receives each custom connection; read by Colleague and the agent spec.
const CONNECTED_CUSTOM_RUNNER_CONTRACT = "Vibe64's preparer appends the absolute script path and --phase prepare|verify, --source-root <the session's copy of the repository>, --project-root <consuming project>, --sources-file <absolute Sources file> and --repository <GitHub URL> arguments to the Stack's Custom runner command, once per phase; execution checks the script remains inside the consuming project.";

const CONNECTED_PACKAGE_TYPE_VALUES = Object.freeze(CONNECTED_PACKAGE_TYPES.map(type => type.value));

function isConnectedPackageType(value) {
  return typeof value === "string" && CONNECTED_PACKAGE_TYPE_VALUES.includes(value);
}

/**
 * Only custom connections carry a per-connection project script.
 */
function connectedPackageTypeUsesScript(type) {
  return type === CONNECTED_CUSTOM_PACKAGE_TYPE;
}

/**
 * Whether Vibe64 itself puts a connection of this type in effect: every listed
 * type except custom, for a dependency. A composition's raw source stays the
 * consuming project's own treatment.
 */
function connectedPackageTypeHasAdapter(type) {
  return isConnectedPackageType(type) && type !== CONNECTED_CUSTOM_PACKAGE_TYPE;
}

function connectedPackageTypeListText(conjunction = "or") {
  const values = CONNECTED_PACKAGE_TYPE_VALUES;
  return `${values.slice(0, -1).join(", ")} ${conjunction} ${values.at(-1)}`;
}

export {
  CONNECTED_CUSTOM_RUNNER_CONTRACT,
  CONNECTED_PACKAGE_TYPES,
  CONNECTED_PACKAGE_TYPE_VALUES,
  CONNECTED_SOURCES_CONTRACT,
  connectedPackageTypeHasAdapter,
  connectedPackageTypeListText,
  connectedPackageTypeUsesScript,
  isConnectedPackageType
};

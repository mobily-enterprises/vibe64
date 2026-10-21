// The one Vibe64-owned vocabulary of connected-project package types. A type is
// a declared label recorded in vibe64.connections.json, the Stack default and
// the prepared vibe64.connected-sources.v1 map. Vibe64 never derives or runs a
// package-manager command from it: the consuming project's own Connected
// development Prepare/Verify commands give the source that ecosystem's native
// treatment. Only `custom` selects a per-connection project script.
const CONNECTED_CUSTOM_PACKAGE_TYPE = "custom";
const CONNECTED_SOURCES_CONTRACT = "vibe64.connected-sources.v1";

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
const CONNECTED_CUSTOM_RUNNER_CONTRACT = "Vibe64's preparer appends the absolute script path and --phase prepare|verify, --source-root <receiving source>, --project-root <consuming project>, --sources-file <absolute Sources file> and --repository <GitHub URL> arguments to the Stack's Custom runner command, once per phase; execution checks the script remains inside the consuming project.";

const CONNECTED_PACKAGE_TYPE_VALUES = Object.freeze(CONNECTED_PACKAGE_TYPES.map(type => type.value));

function isConnectedPackageType(value) {
  return typeof value === "string" && CONNECTED_PACKAGE_TYPE_VALUES.includes(value);
}

// Every listed type except custom is treated by the project's declared Verify
// command and cannot carry a per-connection script.
function connectedPackageTypeUsesScript(type) {
  return type === CONNECTED_CUSTOM_PACKAGE_TYPE;
}

function connectedPackageTypeLabel(type) {
  return CONNECTED_PACKAGE_TYPES.find(entry => entry.value === type)?.label || String(type || "");
}

function connectedPackageTypeListText(conjunction = "or") {
  const values = CONNECTED_PACKAGE_TYPE_VALUES;
  return `${values.slice(0, -1).join(", ")} ${conjunction} ${values.at(-1)}`;
}

export {
  CONNECTED_CUSTOM_PACKAGE_TYPE,
  CONNECTED_CUSTOM_RUNNER_CONTRACT,
  CONNECTED_PACKAGE_TYPES,
  CONNECTED_PACKAGE_TYPE_VALUES,
  CONNECTED_SOURCES_CONTRACT,
  connectedPackageTypeLabel,
  connectedPackageTypeListText,
  connectedPackageTypeUsesScript,
  isConnectedPackageType
};

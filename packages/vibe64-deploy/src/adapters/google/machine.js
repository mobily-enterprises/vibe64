// A service that needs whole machines of its own (a sandbox allowance, or reached at each instance) runs on Google Cloud
// as a regional managed instance group of Compute Engine machines, each booting Container-Optimized OS and running the
// service's image with Docker from this startup script. The instance template's metadata names the settings: plain
// ones (`vibe64-env`, NAME=base64 lines) and secret ones (`vibe64-secrets`, NAME=<Secret Manager version> lines, read at
// boot with the machine's own service account). The script gives the instance facts from the metadata server
// (V64_INSTANCE_ID its name, V64_PRIVATE_ADDRESS, V64_WORK_DIR on the machine's disk and, reached at each instance,
// V64_INSTANCE_URL its internal DNS name) and runs the image with what its sandbox allowances need: user namespaces
// (gVisor's rootless runsc makes its own) need Docker's seccomp and AppArmor profiles lifted, a FUSE mount /dev/fuse.

const OS_IMAGE = "projects/cos-cloud/global/images/family/cos-stable";
// Docker's flags each machine feature needs (mobilynet's machineFeatures: fuse, userns).
const FEATURE_FLAGS = Object.freeze({
  fuse: Object.freeze(["--device", "/dev/fuse", "--cap-add", "SYS_ADMIN"]),
  userns: Object.freeze(["--security-opt", "seccomp=unconfined", "--security-opt", "apparmor=unconfined"])
});
const WORK_DIR = "/srv/work";
const HOST_WORK_DIR = "/var/lib/vibe64/work";
// The user the image's service runs as (image.js).
const APP_USER = "10001:10001";

/** The Docker flags a service's machine features need, each once, in a fixed order. @param {string[]} features */
function featureFlags(features) {
  const unknown = features.filter((feature) => !Object.hasOwn(FEATURE_FLAGS, feature));
  if (unknown.length > 0) throw new TypeError(`No machine feature ${unknown.join(", ")} on Google Cloud.`);
  return Object.keys(FEATURE_FLAGS).filter((feature) => features.includes(feature)).flatMap((feature) => FEATURE_FLAGS[feature]);
}

/**
 * The startup script of a service's machines.
 * @param {{ image: string, region: string, port: number, reached: "any" | "each", machineFeatures: string[] }} service
 */
function startupScript({ image, region, port, reached, machineFeatures }) {
  const flags = featureFlags(machineFeatures).join(" ");
  return [
    "#!/bin/bash",
    "# Made by Vibe64: runs the service's image on this machine at each boot, with the settings its instance template names.",
    "set -euo pipefail",
    "md() { curl -fsS -H 'Metadata-Flavor: Google' \"http://metadata.google.internal/computeMetadata/v1/$1\"; }",
    "field() { tr -d '\\n' | sed -n \"s/.*\\\"$1\\\" *: *\\\"\\([^\\\"]*\\)\\\".*/\\1/p\"; }",
    "token=\"$(md instance/service-accounts/default/token | field access_token)\"",
    "args=()",
    // Each line NAME=<base64>, or NAME=<secret version>: split at its first =, as a base64 value can end in =.
    "while IFS= read -r line; do",
    "  [ -n \"$line\" ] || continue",
    "  name=\"${line%%=*}\"",
    "  export \"$name=$(printf '%s' \"${line#*=}\" | base64 -d)\"",
    "  args+=(-e \"$name\")",
    "done <<< \"$(md instance/attributes/vibe64-env || true)\"",
    "while IFS= read -r line; do",
    "  [ -n \"$line\" ] || continue",
    "  name=\"${line%%=*}\"",
    "  data=\"$(curl -fsS -H \"Authorization: Bearer $token\" \"https://secretmanager.googleapis.com/v1/${line#*=}:access\" | field data)\"",
    "  export \"$name=$(printf '%s' \"$data\" | base64 -d)\"",
    "  args+=(-e \"$name\")",
    "done <<< \"$(md instance/attributes/vibe64-secrets || true)\"",
    "instance=\"$(md instance/name)\"",
    "zone=\"$(md instance/zone)\"",
    "export V64_INSTANCE_ID=\"$instance\" V64_PRIVATE_ADDRESS=\"$(md instance/network-interfaces/0/ip)\" V64_WORK_DIR=" + WORK_DIR,
    "args+=(-e V64_INSTANCE_ID -e V64_PRIVATE_ADDRESS -e V64_WORK_DIR)",
    ...(reached === "each"
      ? [
        `export V64_INSTANCE_URL="http://$instance.\${zone##*/}.c.$(md project/project-id).internal:${port}"`,
        "args+=(-e V64_INSTANCE_URL)"
      ]
      : []),
    `mkdir -p ${HOST_WORK_DIR} && chown ${APP_USER} ${HOST_WORK_DIR}`,
    // Container-Optimized OS keeps /root read-only: Docker's credentials live beside the work folder.
    "export HOME=/var/lib/vibe64",
    `docker-credential-gcr configure-docker --registries=${region}-docker.pkg.dev`,
    "docker rm -f app > /dev/null 2>&1 || true",
    `docker pull ${image}`,
    `docker run -d --name app --restart=always --network=host --log-driver=gcplogs -v ${HOST_WORK_DIR}:${WORK_DIR} "\${args[@]}"${flags ? ` ${flags}` : ""} ${image}`,
    ""
  ].join("\n");
}

/**
 * The metadata lines a service's settings become: plain ones as NAME=base64, secret ones as NAME=<version>.
 * @param {Array<{ name: string, value?: string, valueSource?: { secretKeyRef: { secret: string, version: string } } }>} env
 * @param {string} project
 */
function metadataOf(env, project) {
  const plain = env.filter((entry) => typeof entry.value === "string").map((entry) => `${entry.name}=${Buffer.from(entry.value).toString("base64")}`);
  const secrets = env.filter((entry) => entry.valueSource).map(({ name, valueSource: { secretKeyRef } }) => (
    `${name}=projects/${project}/secrets/${secretKeyRef.secret}/versions/${secretKeyRef.version}`));
  return { env: plain.join("\n"), secrets: secrets.join("\n") };
}

/**
 * The environment a machine's metadata names, as Cloud Run's env (the inverse of metadataOf), so a service's settings
 * read the same whichever runs it.
 * @param {{ env?: string, secrets?: string }} metadata
 */
function envOfMetadata({ env = "", secrets = "" }) {
  const lines = (text) => text.split("\n").filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]);
  return [
    ...lines(env).map(([name, value]) => ({ name, value: Buffer.from(value, "base64").toString("utf8") })),
    ...lines(secrets).map(([name, ref]) => {
      const [, secret, version] = /\/secrets\/([^/]+)\/versions\/([^/]+)$/u.exec(ref) ?? [];
      return { name, valueSource: { secretKeyRef: { secret, version } } };
    })
  ];
}

export { APP_USER, OS_IMAGE, WORK_DIR, envOfMetadata, featureFlags, metadataOf, startupScript };

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { envOfMetadata, featureFlags, metadataOf, startupScript } from "../../packages/vibe64-deploy/src/adapters/google/machine.js";
import { engineLabels, googleLabels, itemLabel, itemOfLabel } from "../../packages/vibe64-deploy/src/adapters/google/names.js";
import { LABEL } from "../../packages/vibe64-deploy/src/record.js";

// The parts of a Google Cloud deployment that aren't calls: the labels in Google's form, and the startup script a
// group's machines run, run here for real with bash, its metadata server, Secret Manager and Docker stand-ins on PATH.

test("an item label is written in Google's form and read back the same; one Google can't hold is refused", () => {
  for (const item of ["service.web", "resource.files", "service.api-v2", "resource.Files", "service.a--b"]) {
    assert.match(itemLabel(item), /^[a-z0-9_-]{1,63}$/u);
    assert.equal(itemOfLabel(itemLabel(item)), item);
  }
  assert.equal(itemLabel("service.api-v2"), "service_api--v2");
  assert.throws(() => itemLabel(`service.${"x".repeat(60)}`), /too long for a Google Cloud label \(63 characters\)/u);
  const labels = { [LABEL.deployment]: "dep_abc", [LABEL.app]: "shop", [LABEL.environment]: "production", [LABEL.item]: "service.web" };
  assert.deepEqual(engineLabels(googleLabels(labels)), labels);
  // A label that isn't an item is dropped when read, so nothing passes for an item it isn't.
  assert.deepEqual(engineLabels({ [LABEL.item]: "web" }), {});
  assert.throws(() => googleLabels({ [LABEL.app]: "Shop" }), /isn't one Google Cloud takes/u);
});

test("settings become metadata lines and back: plain ones base64, secret ones a Secret Manager version", () => {
  const env = [{ name: "MODE", value: "jobs = on" }, { name: "TOKEN", valueSource: { secretKeyRef: { secret: "shop-web-TOKEN", version: "3" } } }];
  const metadata = metadataOf(env, "shop-standin");
  assert.deepEqual(metadata, { env: `MODE=${Buffer.from("jobs = on").toString("base64")}`, secrets: "TOKEN=projects/shop-standin/secrets/shop-web-TOKEN/versions/3" });
  assert.deepEqual(envOfMetadata(metadata), env);
  assert.deepEqual(featureFlags(["userns", "fuse"]), ["--device", "/dev/fuse", "--cap-add", "SYS_ADMIN", "--security-opt", "seccomp=unconfined", "--security-opt", "apparmor=unconfined"]);
  assert.throws(() => featureFlags(["kvm"]), /No machine feature kvm/u);
});

test("the startup script runs the image with every setting, the secrets read with the machine's token, the instance facts and the sandbox's flags", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "google-machine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await mkdir(bin);
  // Values whose base64 ends in = and ==, with spaces and an =, so each line splits at its first = only.
  const values = { MODE: "jobs", GREETING: "hello world = yes", SHORT: "ab" };
  const secret = "s3cr=t value";
  const env = metadataOf([...Object.entries(values).map(([name, value]) => ({ name, value })), { name: "TOKEN", valueSource: { secretKeyRef: { secret: "shop-workers-TOKEN", version: "2" } } }], "shop-standin");
  await writeFile(path.join(root, "env.txt"), env.env);
  await writeFile(path.join(root, "secrets.txt"), env.secrets);
  const stub = (name, body) => writeFile(path.join(bin, name), `#!/bin/bash\n${body}\n`).then(() => chmod(path.join(bin, name), 0o755));
  await stub("curl", [
    `root=${JSON.stringify(root)}`,
    "url=\"${@: -1}\"; auth=''",
    "for arg in \"$@\"; do case \"$arg\" in Authorization:*) auth=\"$arg\";; esac; done",
    "case \"$url\" in",
    "  */instance/service-accounts/default/token) printf '{\"access_token\": \"ya29.machine\",\\n \"expires_in\": 3599}';;",
    "  */instance/attributes/vibe64-env) cat \"$root/env.txt\";;",
    "  */instance/attributes/vibe64-secrets) cat \"$root/secrets.txt\";;",
    "  */instance/name) printf shop-workers-x1y2;;",
    "  */instance/zone) printf projects/123456789012/zones/us-central1-b;;",
    "  */instance/network-interfaces/0/ip) printf 10.64.0.7;;",
    "  */project/project-id) printf shop-standin;;",
    `  https://secretmanager.googleapis.com/v1/projects/shop-standin/secrets/shop-workers-TOKEN/versions/2:access)`,
    "    [ \"$auth\" = 'Authorization: Bearer ya29.machine' ] || exit 22",
    `    printf '{"name": "x", "payload": {"data": "${Buffer.from(secret).toString("base64")}"}}';;`,
    "  *) exit 22;;",
    "esac"
  ].join("\n"));
  await stub("docker", `root=${JSON.stringify(root)}\nprintf '%s\\n' "$*" >> "$root/docker.log"\nif [ "$1" = run ]; then prev=''; for arg in "$@"; do [ "$prev" = -e ] && printf '%s=%s\\n' "$arg" "\${!arg}" >> "$root/run-env.txt"; prev="$arg"; done; fi`);
  await stub("docker-credential-gcr", `printf '%s HOME=%s\\n' "$*" "$HOME" >> ${JSON.stringify(path.join(root, "credential.log"))}`);
  await stub("chown", "exit 0");

  const image = "us-central1-docker.pkg.dev/shop-standin/vibe64/shop-workers:r-1";
  const script = startupScript({ image, region: "us-central1", port: 3000, reached: "each", machineFeatures: ["fuse", "userns"] }).replaceAll("/var/lib/vibe64", path.join(root, "host"));
  await writeFile(path.join(root, "startup.sh"), script);
  const ran = spawnSync("bash", [path.join(root, "startup.sh")], { env: { PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);

  const runEnv = Object.fromEntries((await readFile(path.join(root, "run-env.txt"), "utf8")).trim().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  assert.deepEqual(runEnv, {
    ...values, TOKEN: secret, V64_INSTANCE_ID: "shop-workers-x1y2", V64_PRIVATE_ADDRESS: "10.64.0.7", V64_WORK_DIR: "/srv/work",
    V64_INSTANCE_URL: "http://shop-workers-x1y2.us-central1-b.c.shop-standin.internal:3000"
  });
  const docker = (await readFile(path.join(root, "docker.log"), "utf8")).trim().split("\n");
  assert.deepEqual(docker.slice(0, 2), ["rm -f app", `pull ${image}`]);
  assert.match(docker[2], new RegExp(`^run -d --name app --restart=always --network=host --log-driver=gcplogs -v ${root}/host/work:/srv/work -e MODE .* --device /dev/fuse --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined ${image}$`, "u"));
  assert.equal(await readFile(path.join(root, "credential.log"), "utf8"), `configure-docker --registries=us-central1-docker.pkg.dev HOME=${root}/host\n`);

  // Reached at any instance, with no sandbox: no instance address and no extra flags.
  const plain = startupScript({ image, region: "us-central1", port: 3000, reached: "any", machineFeatures: [] });
  assert.doesNotMatch(plain, /V64_INSTANCE_URL|--device|--security-opt/u);
});

import { LABEL } from "../../record.js";
import { CONSUMER_LABEL, DESCRIPTION, last, REPOSITORY, SERVICE_PORT } from "./base.js";
import { envOfMetadata, metadataOf, OS_IMAGE, startupScript } from "./machine.js";
import { engineLabels, googleLabels, hashOf, NETWORK, SERVICE_TAG, tagOf } from "./names.js";
import { BOOT_DISK_GIB, MACHINES, SHAPES } from "./prices.js";

// The Google Cloud adapter's services: each a Cloud Run service, or a regional managed instance group of Compute Engine
// machines when its size is one of the offer's machine sizes, with its settings (Secret Manager's for the secret ones),
// the resources' credentials, its firewall rule and its load balancer; read back as the engine's inventory reads them.

const MACHINE_SIZES = new Set(MACHINES.map((machine) => machine.name));
// A release's rollout, as the engine's refresh: its id is the release it moves to, read back from the service's image or
// template, and it is rolling from the start, since Cloud Build built the image before it began. So the engine links a
// service's resources while the rollout runs (their credentials are in the release's settings already).
const rolloutOf = (version) => ({ id: `release:${version}`, state: "rolling" });

function createGoogleServices(g) {
  const {
    call, listAll, orNull, orExisting, project, region, P, networkUrl, subnetUrl, runSubnet, compute, run, secrets, ids, kindOf, failed,
    computeDone, ensureCompute, deleteCompute, network, emailOf, account, putSecret, secretsOf, projectRole, shareRegistry, uploadRelease,
    builtImage, declarationOf, deleteBucketKey, linksEnv, putReaches, connectionsOf, frontend, deleteFrontend, internalFrontend,
    internalNameOf
  } = g;

  /** A service's own settings: plain ones as they are, secret ones as new versions of its secrets. */
  async function settingsEnv(name, { settings, secrets: values }, labels, email) {
    const env = Object.entries(settings).map(([key, value]) => ({ name: key, value }));
    for (const [key, value] of Object.entries(values)) {
      const id = `${name}-${key}`;
      env.push({ name: key, valueSource: { secretKeyRef: { secret: id, version: await putSecret(id, value, labels, email) } } });
    }
    return env;
  }

  // Every setting of a resource is V64_<RESOURCE>_<FIELD>, and no setting of a service's own starts with V64_.
  const isLink = (entry) => entry.name.startsWith("V64_");


  // --- Services: Cloud Run, or a managed instance group --------------------------------------------------------------

  /**
   * A Cloud Run service's body: its ingress, count, account, network, image, size, settings and readiness. The count is
   * the service's own scaling, not its template's, so changing it makes no new revision and replaces no instance.
   */
  function runBody({ labels, exposure, size, instances, image, env, email, healthPath }) {
    const shape = SHAPES.find((one) => one.name === size);
    return {
      labels,
      ingress: exposure === "public" ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_INTERNAL_ONLY",
      invokerIamDisabled: true,
      scaling: { minInstanceCount: instances, maxInstanceCount: instances },
      template: {
        labels,
        serviceAccount: email,
        vpcAccess: { networkInterfaces: [{ network: NETWORK, subnetwork: runSubnet }], egress: "ALL_TRAFFIC" },
        executionEnvironment: "EXECUTION_ENVIRONMENT_GEN2",
        containers: [{
          image,
          ports: [{ containerPort: SERVICE_PORT }],
          resources: { limits: { cpu: String(shape.vcpus), memory: `${shape.memoryGib}Gi` }, cpuIdle: false },
          env,
          startupProbe: { httpGet: { path: healthPath, port: SERVICE_PORT }, periodSeconds: 10, failureThreshold: 30 }
        }]
      }
    };
  }

  /** A Cloud Run service changed: read, `change` applied to its body, written whole. */
  async function patchRun(id, change) {
    const current = await run("GET", id);
    const body = structuredClone(current);
    for (const field of ["uri", "uid", "generation", "observedGeneration", "terminalCondition", "conditions", "latestReadyRevision", "latestCreatedRevision",
      "traffic", "trafficStatuses", "reconciling", "createTime", "updateTime", "creator", "lastModifier", "urls"]) delete body[field];
    change(body, current);
    await run("PATCH", id, { body });
  }

  /** A group's instance template: its machine, labels, tags, account, disk, network and the image's startup script. */
  async function machineTemplate({ name, size, labels, exposure, version, image, env, email, declaration }) {
    const { env: plain, secrets: secretLines } = metadataOf(env, project);
    const properties = {
      machineType: size,
      labels: { ...labels, "vibe64-exposure": exposure, "vibe64-version": version },
      tags: { items: [tagOf(name), SERVICE_TAG] },
      serviceAccounts: [{ email, scopes: ["https://www.googleapis.com/auth/cloud-platform"] }],
      disks: [{ boot: true, autoDelete: true, initializeParams: { sourceImage: OS_IMAGE, diskSizeGb: String(BOOT_DISK_GIB), diskType: "pd-balanced", labels } }],
      networkInterfaces: [{ network: networkUrl, subnetwork: subnetUrl }],
      metadata: {
        items: [
          { key: "startup-script", value: startupScript({ image, region, port: SERVICE_PORT, reached: declaration.reached, machineFeatures: declaration.machineFeatures }) },
          { key: "vibe64-env", value: plain },
          { key: "vibe64-secrets", value: secretLines },
          { key: "vibe64-release", value: JSON.stringify({ reached: declaration.reached, machineFeatures: declaration.machineFeatures, healthPath: declaration.healthPath }) },
          { key: "google-logging-enabled", value: "true" }
        ]
      }
    };
    const template = `${name}-${hashOf(JSON.stringify(properties), 10)}`;
    const made = await ensureCompute(`regions/${region}/instanceTemplates/${template}`, `regions/${region}/instanceTemplates`, { name: template, description: DESCRIPTION, properties });
    return made.selfLink;
  }

  /** What an instance template says: its properties, environment and the release facts it was made from. */
  function readTemplate(template) {
    const items = Object.fromEntries((template.properties?.metadata?.items ?? []).map((item) => [item.key, item.value]));
    return {
      template,
      env: envOfMetadata({ env: items["vibe64-env"], secrets: items["vibe64-secrets"] }),
      release: JSON.parse(items["vibe64-release"] ?? "{}"),
      image: /docker pull (\S+)/u.exec(items["startup-script"] ?? "")?.[1] ?? null
    };
  }

  /** What a group's current template says. */
  const templateOf = async (group) => readTemplate(await compute("GET", `regions/${region}/instanceTemplates/${last(group.instanceTemplate)}`));
  const templatesOf = () => listAll("compute", `compute/v1/${P}/regions/${region}/instanceTemplates`, "items", {}, { pageSize: "maxResults" });
  const isTemplateOf = (name, template) => new RegExp(`^${name}-[0-9a-f]{10}$`, "u").test(template.name);

  /**
   * A group handed another template: its machines replaced, a few at a time, none taken down first. Its templates
   * before the one it runs now are deleted first; one a machine still uses is kept for the next time.
   */
  async function rollGroup(name, current, template) {
    for (const old of (await templatesOf()).filter((one) => isTemplateOf(name, one) && ![last(current), last(template)].includes(one.name))) {
      try {
        await deleteCompute(`regions/${region}/instanceTemplates/${old.name}`);
      } catch (error) {
        if (error?.code !== "resourceInUseByAnotherResource") throw error;
      }
    }
    await computeDone(await compute("PATCH", `regions/${region}/instanceGroupManagers/${name}`, {
      body: { instanceTemplate: template, versions: [{ instanceTemplate: template }] }
    }));
  }

  /** A group's template made again with a change (its machine, image or settings), and the group rolled onto it. */
  async function changeGroup(id, change) {
    const name = last(id);
    const group = await compute("GET", `regions/${region}/instanceGroupManagers/${name}`);
    const { template, env, release, image } = await templateOf(group);
    const labels = { ...template.properties.labels };
    const exposure = labels["vibe64-exposure"];
    const version = labels["vibe64-version"];
    delete labels["vibe64-exposure"];
    delete labels["vibe64-version"];
    const next = change({ size: last(template.properties.machineType), env, image, version, release });
    const made = await machineTemplate({
      name, size: next.size, labels, exposure, version: next.version, image: next.image, env: next.env, email: template.properties.serviceAccounts[0].email,
      declaration: next.release
    });
    await rollGroup(name, group.instanceTemplate, made);
  }

  /** Every Cloud Run service and managed instance group of the region, as the plan and steps read them. */
  async function servicesNow() {
    const [services, groups, firewalls] = await Promise.all([
      listAll("run", `v2/${P}/locations/${region}/services`, "services"),
      listAll("compute", `compute/v1/${P}/regions/${region}/instanceGroupManagers`, "items", {}, { pageSize: "maxResults" }),
      listAll("compute", `compute/v1/${P}/global/firewalls`, "items", {}, { pageSize: "maxResults" })
    ]);
    const things = services.map((one) => {
      const name = last(one.name);
      const container = one.template?.containers?.[0] ?? {};
      const limits = container.resources?.limits ?? {};
      const instances = one.scaling?.minInstanceCount ?? 0;
      const exposure = one.ingress === "INGRESS_TRAFFIC_INTERNAL_ONLY" ? "internal" : "public";
      const working = Boolean(one.reconciling) || (one.observedGeneration !== undefined && String(one.observedGeneration) !== String(one.generation));
      const ready = one.terminalCondition?.state === "CONDITION_SUCCEEDED" && one.latestReadyRevision === one.latestCreatedRevision;
      const version = String(container.image ?? "").split(":").pop() || null;
      return {
        id: ids.run(name), name, kind: "service", labels: engineLabels(one.labels),
        size: SHAPES.find((shape) => String(shape.vcpus) === String(limits.cpu) && `${shape.memoryGib}Gi` === limits.memory)?.name ?? `cpu-${limits.cpu}-${limits.memory}`,
        instances, exposure, state: working ? "updating" : ready ? "running" : "failed",
        version,
        refresh: working ? rolloutOf(version) : null,
        healthy: ready && !working ? instances : 0,
        internalName: one.uri ? new URL(one.uri).host : null,
        internalUrl: exposure === "internal" && one.uri ? one.uri : null,
        connections: connectionsOf(name, firewalls),
        lastError: !working && one.terminalCondition?.state === "CONDITION_FAILED" ? { message: one.terminalCondition.message ?? "Cloud Run gave no reason." } : null
      };
    });
    const templates = new Map((groups.length > 0 ? await templatesOf() : []).map((template) => [template.name, template]));
    for (const group of groups) {
      const name = group.name;
      const template = templates.get(last(group.instanceTemplate));
      const labels = template?.properties?.labels ?? {};
      // A group Vibe64 did not make is named, so a service of the same name waits for it, and read no further.
      if (!labels[LABEL.deployment]) {
        things.push({ id: ids.group(name), name, kind: "service", labels: {}, size: null, instances: group.targetSize, exposure: null, state: "running", refresh: null, healthy: 0 });
        continue;
      }
      const { managedInstances = [] } = await compute("POST", `regions/${region}/instanceGroupManagers/${name}/listManagedInstances`);
      const errors = managedInstances.flatMap((instance) => instance.lastAttempt?.errors?.errors ?? []);
      const current = managedInstances.filter((instance) => last(instance.version?.instanceTemplate) === last(group.instanceTemplate));
      const working = !group.status?.isStable || group.status?.versionTarget?.isReached === false || current.length < managedInstances.length;
      const healthy = current.filter((instance) => instance.instanceStatus === "RUNNING" && instance.currentAction === "NONE"
        && (instance.instanceHealth ?? []).every((health) => health.detailedHealthState === "HEALTHY")).length;
      // The template's own two labels (its exposure, its release) are the adapter's, not the deployment's.
      const { "vibe64-exposure": exposure = null, "vibe64-version": version = null, ...own } = labels;
      things.push({
        id: ids.group(name), name, kind: "service", labels: engineLabels(own), size: last(template.properties?.machineType), instances: group.targetSize,
        exposure, state: errors.length > 0 ? "failed" : working ? "updating" : "running", version,
        refresh: working && errors.length === 0 ? rolloutOf(version) : null, healthy,
        internalName: exposure === "internal" ? internalNameOf(name) : null,
        connections: connectionsOf(name, firewalls),
        lastError: errors.length > 0 ? { message: `A machine of ${name} did not start: ${errors[0].message}` } : null
      });
    }
    return things;
  }

  /** A service's refresh as the engine reads it, from what Cloud Run or the group reports now. */
  async function readRefresh(id, refreshId) {
    const kind = String(refreshId).split(":")[0];
    const thing = (await servicesNow()).find((one) => one.id === id);
    if (!thing) return { kind, state: "failed", error: { message: "the service is gone at Google Cloud." } };
    if (thing.refresh) return { kind, state: thing.refresh.state };
    if (thing.lastError) return { kind, state: "failed", error: thing.lastError };
    return { kind, state: "succeeded" };
  }

  /** Makes a service, labelled: its account, settings, the resources' credentials, its rule, then Cloud Run or a group. */
  async function createService({ name, exposure, size, instances, app, version, settings, secrets: values, domain, connections, labels }) {
    const image = await builtImage(app, version);
    const declaration = await declarationOf(app, version);
    await network();
    const written = googleLabels(labels);
    const email = await account(name, labels);
    const env = [...await settingsEnv(name, { settings, secrets: values }, written, email), ...await linksEnv(declaration.needs, labels, name, email)];
    await putReaches(name, connections, !MACHINE_SIZES.has(size));
    if (!MACHINE_SIZES.has(size)) {
      const id = ids.run(name);
      if (!(await orNull(() => run("GET", id)))) {
        await orExisting(() => run("POST", `${P}/locations/${region}/services`, {
          query: { serviceId: name }, body: runBody({ labels: written, exposure, size, instances, image, env, email, healthPath: declaration.healthPath })
        }));
      }
      if (exposure === "public") await frontend(name, { domain });
      return { id, refreshId: rolloutOf(version).id };
    }
    await projectRole("roles/logging.logWriter", email, true);
    await call("artifactregistry", "GET", `v1/${P}/locations/${region}/repositories/${REPOSITORY}`);
    await shareRegistry(email);
    const health = await ensureCompute(`global/healthChecks/${name}-health`, "global/healthChecks", {
      name: `${name}-health`, type: "HTTP", httpHealthCheck: { port: SERVICE_PORT, requestPath: declaration.healthPath }, checkIntervalSec: 10, timeoutSec: 5, description: DESCRIPTION
    });
    const template = await machineTemplate({ name, size, labels: written, exposure, version, image, env, email, declaration });
    const group = await ensureCompute(`regions/${region}/instanceGroupManagers/${name}`, `regions/${region}/instanceGroupManagers`, {
      name, baseInstanceName: name, instanceTemplate: template, targetSize: instances, namedPorts: [{ name: "http", port: SERVICE_PORT }],
      autoHealingPolicies: [{ healthCheck: health.selfLink, initialDelaySec: 600 }],
      updatePolicy: { type: "PROACTIVE", minimalAction: "REPLACE", maxSurge: { fixed: 3 }, maxUnavailable: { fixed: 0 } }, description: DESCRIPTION
    });
    if (exposure === "public") await frontend(name, { group: group.instanceGroup, domain, health: health.selfLink });
    else await internalFrontend(name, { group: group.instanceGroup, health: health.selfLink });
    return { id: ids.group(name), refreshId: rolloutOf(version).id };
  }

  /** Hands a service a new release: its image once built, the resources its release needs. `{ version, refreshId }`. */
  async function releaseService(id, upload) {
    const app = upload.declaration.name;
    const { version } = await uploadRelease(app, upload);
    const image = await builtImage(app, version);
    const name = last(id);
    const email = emailOf(name);
    if (kindOf(id) === "run") {
      const current = await run("GET", id);
      const links = await linksEnv(upload.declaration.needs, engineLabels(current.labels), name, email);
      await patchRun(id, (body) => {
        const container = body.template.containers[0];
        container.image = image;
        container.env = [...(container.env ?? []).filter((entry) => !isLink(entry)), ...links];
        container.startupProbe = { httpGet: { path: upload.declaration.healthPath, port: SERVICE_PORT }, periodSeconds: 10, failureThreshold: 30 };
      });
      return { version, refreshId: rolloutOf(version).id };
    }
    const group = await compute("GET", `regions/${region}/instanceGroupManagers/${name}`);
    const { template } = await templateOf(group);
    const links = await linksEnv(upload.declaration.needs, engineLabels(template.properties.labels), name, email);
    await changeGroup(id, (now) => ({ ...now, image, version, env: [...now.env.filter((entry) => !isLink(entry)), ...links], release: upload.declaration }));
    return { version, refreshId: rolloutOf(version).id };
  }

  /** Replaces a service's own settings and secrets, its resources' kept. */
  async function putSettings(id, values) {
    const name = last(id);
    const email = emailOf(name);
    if (kindOf(id) === "run") {
      const current = await run("GET", id);
      const own = await settingsEnv(name, values, current.labels, email);
      await patchRun(id, (body) => {
        const container = body.template.containers[0];
        container.env = [...own, ...(container.env ?? []).filter(isLink)];
      });
      return "settings";
    }
    const group = await compute("GET", `regions/${region}/instanceGroupManagers/${name}`);
    const { template } = await templateOf(group);
    const labels = { ...template.properties.labels };
    delete labels["vibe64-exposure"];
    delete labels["vibe64-version"];
    const own = await settingsEnv(name, values, labels, email);
    await changeGroup(id, (now) => ({ ...now, env: [...own, ...now.env.filter(isLink)] }));
    return "settings";
  }

  /** Changes a service's size (a refresh), its count (the group resized, the Cloud Run service's scaling) or what it reaches. */
  async function changeService(id, change) {
    const name = last(id);
    if (change.connections) await putReaches(name, change.connections, kindOf(id) === "run");
    if (change.size !== undefined) {
      const machine = MACHINE_SIZES.has(change.size);
      if (machine !== (kindOf(id) === "group")) {
        throw failed(`${name} now needs ${machine ? "whole machines of its own" : "no machine of its own"}, so it can't be resized in place: take the app offline, then deploy.`, "service_runs_elsewhere");
      }
      if (machine) await changeGroup(id, (now) => ({ ...now, size: change.size }));
      else {
        const shape = SHAPES.find((one) => one.name === change.size);
        await patchRun(id, (body) => {
          body.template.containers[0].resources = { ...body.template.containers[0].resources, limits: { cpu: String(shape.vcpus), memory: `${shape.memoryGib}Gi` } };
        });
      }
      return "size";
    }
    if (change.instances !== undefined) {
      if (kindOf(id) === "group") {
        await computeDone(await compute("POST", `regions/${region}/instanceGroupManagers/${name}/resize`, { query: { size: change.instances } }));
        return null;
      }
      await patchRun(id, (body) => {
        body.scaling = { minInstanceCount: change.instances, maxInstanceCount: change.instances };
      });
      return null;
    }
    return null;
  }

  /** Deletes a service with its parts: its load balancer pieces, rule, secrets and account; its resources stay. */
  async function deleteService(id) {
    const name = last(id);
    const kind = kindOf(id);
    const thing = (await servicesNow()).find((one) => one.id === id);
    if (thing?.exposure === "public") await deleteFrontend(name);
    if (kind === "group") {
      await deleteCompute(`regions/${region}/forwardingRules/${name}-internal`);
      await deleteCompute(`regions/${region}/backendServices/${name}-internal`);
      await deleteCompute(`regions/${region}/instanceGroupManagers/${name}`);
      for (const template of (await templatesOf()).filter((one) => isTemplateOf(name, one))) {
        await deleteCompute(`regions/${region}/instanceTemplates/${template.name}`);
      }
      await deleteCompute(`global/healthChecks/${name}-health`);
      await projectRole("roles/logging.logWriter", emailOf(name), false);
    } else {
      await orNull(() => run("DELETE", id));
    }
    await putReaches(name, [], kind === "run");
    if (thing?.labels?.[LABEL.deployment]) {
      const written = googleLabels(thing.labels);
      for (const secret of await secretsOf(written)) await orNull(() => secrets("DELETE", `/${last(secret.name)}`));
      // The bucket keys its account held go with it: an account made again under its name is another, and its keys new.
      const keys = await listAll("secretmanager", `v1/${P}/secrets`, "secrets", {
        filter: `labels.${LABEL.deployment}=${written[LABEL.deployment]} AND labels.${CONSUMER_LABEL}=${name}`
      });
      for (const key of keys) await deleteBucketKey(key);
    }
    await orNull(() => call("iam", "DELETE", `v1/${P}/serviceAccounts/${emailOf(name)}`));
    return { removed: true };
  }

  return { servicesNow, readRefresh, createService, releaseService, putSettings, changeService, deleteService };
}

export { createGoogleServices };

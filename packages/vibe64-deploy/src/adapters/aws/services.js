// A deployment's services at AWS. Each runs its release's image, in one of two ways its release decides:
//
//   - on Fargate, an ECS service of the deployment's cluster, its tasks in the deployment's subnets with public
//     addresses (out to the internet, nothing in but what its security group lets in). Each change is a new revision of
//     its task definition, rolled out with ECS's circuit breaker, which puts the revision before back when the new one's
//     tasks don't start or don't answer their health path. The service's tag vibe64-revision names the revision it was
//     last given, so a revision ECS rolled back is a failed refresh;
//   - on whole machines of its own when it has a sandbox allowance or is reached at each instance: an EC2 Auto Scaling
//     group from a launch template (machine.js). Each change is a new version of the template, rolled onto the machines
//     by an instance refresh that starts each new machine before ending an old one, and makes the version the group's
//     only when it succeeds. A Fargate size for such a service, or a machine size for any other, is refused.
//
// Both register in the deployment's private names (Cloud Map), so `<app>-<service>.<names>` answers with their
// addresses, every instance's: that is the internal name a service reaching it is given. A public one is the target of
// the load balancer's HTTPS listener (domain.js). Each has a security group of its own: the load balancer reaches a
// public one, and a service reaches another (its Reaches) through a rule on the other's group from its own, on the port
// services listen on; the services it reaches are kept, in order, in its tag vibe64-reaches.
//
// Each service is given its settings (the plain ones in its definition, the secret ones kept in a Secrets Manager
// secret of its own, each read by version) and, as its release needs them, its resources' fields (resources.js
// linkValues): when it is made or handed a release, so its first tasks or machines start with them. The engine's link
// step then finds them given and lets the service's group into a database's.
import { createHash } from "node:crypto";

import { LABEL } from "../../record.js";
import { shellWord } from "../mobilynet/declaration.js";
import { ensureBase, ensureSecurityGroup, notOurs, unless } from "./base.js";
import { builtImage, declarationOf, uploadRelease } from "./build.js";
import { SERVICE_PORT, adapterError, keyValueTags, lowerTags, tagSpecification, tagsOf, tokenOf } from "./context.js";
import { routeTo, targetGroupOf } from "./domain.js";
import { NAMES_IMAGE, READY_HOOK, READY_SECONDS, specPlaceOf, userDataOf } from "./machine.js";
import { ROOT_DISK_GIB, fargateShape, isMachineSize } from "./offer.js";
import { databaseGroup, isBucket, linkValues, resourcesNow } from "./resources.js";
import { asList } from "./xml.js";

const REVISION_TAG = "vibe64-revision";
const REACHES_TAG = "vibe64-reaches";
// A service's last refresh, the id its create, release or change answered: while it rolls, the inventory reports it as
// the refresh the engine's steps link during. A create or a release rolls from the start, since CodeBuild built its
// image before it began.
const REFRESH_TAG = "vibe64-refresh";
const SPEC_LABEL = "vibe64.spec";
const REFRESHING = new Set(["Pending", "InProgress", "Cancelling", "RollbackInProgress", "Baking"]);
const REFRESH_FAILED = new Set(["Failed", "Cancelled", "RollbackFailed", "RollbackSuccessful"]);
const AMI = "resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64";

const isLink = (name) => name.startsWith("V64_");
const pick = (values, keep) => Object.fromEntries(Object.entries(values).filter(([name]) => keep(name)));
const isGroupId = (id) => String(id).includes(":autoscaling:");
const groupNameOf = (id) => String(id).split("autoScalingGroupName/").pop();
// A scaling activity that ended.
const ENDED = new Set(["Successful", "Failed", "Cancelled"]);
const itemOf = (tags) => String(tags[LABEL.item] ?? "").replace(/^service\./u, "");
const labelsOf = (tags) => Object.fromEntries(Object.values(LABEL).filter((key) => key in tags).map((key) => [key, tags[key]]));
const namesDomain = (ctx) => `${ctx.nameOf("names")}.internal`;

/** Whether a release's service runs on whole machines: a sandbox allowance, or reached at each instance. */
function needsMachine(declaration) {
  return declaration.machineFeatures.length > 0 || declaration.reached === "each";
}

/** Refuses a size the service's runtime can't take: a sandboxed service runs on whole machines, any other on Fargate. */
function runtimeCheck(declaration, size) {
  if (needsMachine(declaration) && !isMachineSize(size)) {
    throw adapterError("aws_sandbox_needs_machine", `Service ${declaration.service} has a sandbox allowance or is reached at each instance, so it runs on whole `
      + `machines of its own; ${size} is a Fargate size. Choose a machine size for it.`);
  }
  if (!needsMachine(declaration) && isMachineSize(size)) {
    throw adapterError("aws_size_unsupported", `Service ${declaration.service} runs on Fargate; ${size} is a whole machine, offered only to a service with a `
      + "sandbox allowance or reached at each instance.");
  }
}

// --- Reading what a service runs -------------------------------------------------------------------------------------

/**
 * Keeps a service's spec in the deployment's releases bucket under its SHA-256, where a machine reads it as it starts:
 * a task definition's label and a template's user data name only that place, `s3://<bucket>/<key> <sha256>`, so
 * neither grows with the settings (EC2 takes 16 KB of user data, ECS 64 KB of task definition, the settings once).
 */
async function keepSpec(ctx, base, spec) {
  const body = JSON.stringify(spec);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const key = `specs/${spec.service}/${sha256}.json`;
  await ctx.client.s3("PUT", base.bucket, key, { body, headers: { "content-type": "application/json" } });
  return `s3://${base.bucket}/${key} ${sha256}`;
}

/** The spec kept at a place keepSpec named. */
async function specAt(ctx, place) {
  const [, bucket, key] = /^s3:\/\/([^/]+)\/(\S+) [0-9a-f]{64}$/u.exec(String(place ?? "")) ?? [];
  if (!bucket) throw adapterError("aws_spec_unknown", `A service at AWS names its spec as "${place}", which isn't a place Vibe64 keeps one.`);
  return JSON.parse((await ctx.client.s3("GET", bucket, key)).text);
}

/** The spec a task definition revision names. */
async function specOfRevision(ctx, arn) {
  if (!ctx.cache.revisions.has(arn)) {
    const { taskDefinition } = await ctx.client.json("ecs", "DescribeTaskDefinition", { taskDefinition: arn });
    ctx.cache.revisions.set(arn, await specAt(ctx, taskDefinition.containerDefinitions[0].dockerLabels?.[SPEC_LABEL]));
  }
  return ctx.cache.revisions.get(arn);
}

/** The spec a launch template version names. */
async function specOfTemplate(ctx, templateId, version) {
  const key = `${templateId}:${version}`;
  if (!ctx.cache.revisions.has(key)) {
    const answer = await ctx.client.query("ec2", "DescribeLaunchTemplateVersions", { LaunchTemplateId: templateId, LaunchTemplateVersion: [String(version)] });
    ctx.cache.revisions.set(key, await specAt(ctx, specPlaceOf(asList(answer.launchTemplateVersionSet?.item)[0]?.launchTemplateData?.userData)));
  }
  return ctx.cache.revisions.get(key);
}

/** This deployment's service by its id, ECS's or Auto Scaling's account of it, or the refusal of one that isn't. */
async function readOwnService(ctx, id) {
  if (isGroupId(id)) {
    const group = asList((await ctx.client.query("autoscaling", "DescribeAutoScalingGroups", { "AutoScalingGroupNames.member": [groupNameOf(id)] })).AutoScalingGroups?.member)[0];
    if (!group) throw adapterError("aws_service_gone", `The machines of ${groupNameOf(id)} are gone at AWS.`);
    const tags = tagsOf(asList(group.Tags?.member));
    if (!ctx.isOwn(tags)) throw notOurs("The Auto Scaling group", group.AutoScalingGroupName);
    return { machine: true, id, name: group.AutoScalingGroupName, group, tags, public: asList(group.TargetGroupARNs?.member).length > 0 };
  }
  const answer = await unless(["ClusterNotFoundException"], () => ctx.client.json("ecs", "DescribeServices", { cluster: ctx.nameOf("cluster", 255), services: [id], include: ["TAGS"] }));
  const service = asList(answer?.services).find((one) => one.status !== "INACTIVE");
  if (!service) throw adapterError("aws_service_gone", `The ECS service ${id} is gone at AWS.`);
  const tags = tagsOf(service.tags);
  if (!ctx.isOwn(tags)) throw notOurs("The ECS service", service.serviceName);
  return { machine: false, id, name: service.serviceName, service, tags, public: asList(service.loadBalancers).length > 0 };
}

/** What a service runs now: the revision it was last given, or its group's template version. */
function specNow(ctx, current) {
  return current.machine
    ? specOfTemplate(ctx, current.group.LaunchTemplate.LaunchTemplateId, current.group.LaunchTemplate.Version)
    : specOfRevision(ctx, current.tags[REVISION_TAG] || current.service.taskDefinition);
}

/** An ECS service as the inventory reads it, its reached services' items in `reaches`. */
async function fargateThing(ctx, one) {
  const tags = tagsOf(one.tags);
  const wanted = tags[REVISION_TAG] || one.taskDefinition;
  const spec = await specOfRevision(ctx, wanted);
  const deployments = asList(one.deployments);
  const primary = deployments.find((deployment) => deployment.status === "PRIMARY");
  const draining = one.status === "DRAINING";
  const rolling = !draining && deployments.some((deployment) => deployment.rolloutState === "IN_PROGRESS");
  const failed = !draining && !rolling && Boolean(primary) && (primary.taskDefinition !== wanted || primary.rolloutState === "FAILED");
  const why = asList(one.events).find((event) => /fail|roll/iu.test(event.message ?? ""))?.message;
  return {
    id: one.serviceArn,
    name: one.serviceName,
    kind: "service",
    labels: labelsOf(tags),
    size: spec.size,
    instances: one.desiredCount,
    exposure: asList(one.loadBalancers).length > 0 ? "public" : "internal",
    state: draining ? "deleting" : rolling ? "updating" : failed ? "failed" : "running",
    version: spec.version,
    refresh: rolling ? { id: tags[REFRESH_TAG] ?? null, state: "rolling" } : null,
    healthy: rolling || failed || !primary ? 0 : primary.runningCount,
    internalName: `${spec.name}.${namesDomain(ctx)}`,
    lastError: failed ? { message: `ECS put the revision before back${why ? `: ${why}` : "."}` } : null,
    servingVersion: failed && primary.taskDefinition !== wanted ? (await specOfRevision(ctx, primary.taskDefinition)).version : null,
    reaches: String(tags[REACHES_TAG] ?? "").split(",").filter(Boolean)
  };
}

/** An Auto Scaling group as the inventory reads it, its reached services' items in `reaches`. */
async function machineThing(ctx, group) {
  const { client } = ctx;
  const tags = tagsOf(asList(group.Tags?.member));
  const version = String(group.LaunchTemplate.Version);
  const spec = await specOfTemplate(ctx, group.LaunchTemplate.LaunchTemplateId, version);
  const wanted = Number(group.DesiredCapacity);
  const healthy = asList(group.Instances?.member).filter((one) => String(one.LaunchTemplate?.Version) === version && one.LifecycleState === "InService"
    && one.HealthStatus === "Healthy").length;
  const deleting = Boolean(group.Status);
  const latest = asList((await client.query("autoscaling", "DescribeInstanceRefreshes", { AutoScalingGroupName: group.AutoScalingGroupName, MaxRecords: 1 }))
    .InstanceRefreshes?.member)[0];
  const refreshing = Boolean(latest) && REFRESHING.has(latest.Status);
  let lastError = latest && REFRESH_FAILED.has(latest.Status) ? { message: `The machines did not take the new version: ${latest.StatusReason ?? latest.Status}` } : null;
  if (!deleting && !refreshing && !lastError && healthy < wanted) {
    // A machine that didn't start is tried again by Auto Scaling; the last three launches ended and none ready is a
    // failure to report.
    const launches = asList((await client.query("autoscaling", "DescribeScalingActivities", { AutoScalingGroupName: group.AutoScalingGroupName, MaxRecords: 20 }))
      .Activities?.member).filter((one) => String(one.Description).startsWith("Launching a new EC2 instance") && ENDED.has(one.StatusCode));
    const activities = launches.slice(0, 3);
    if (activities.length === 3 && activities.every((one) => ["Failed", "Cancelled"].includes(one.StatusCode))) {
      lastError = { message: `A machine of ${group.AutoScalingGroupName} did not start: ${activities[0].StatusMessage ?? activities[0].Description}` };
    }
  }
  const working = !deleting && !lastError && (refreshing || healthy < wanted);
  return {
    id: group.AutoScalingGroupARN,
    name: group.AutoScalingGroupName,
    kind: "service",
    labels: labelsOf(tags),
    size: spec.size,
    instances: wanted,
    exposure: asList(group.TargetGroupARNs?.member).length > 0 ? "public" : "internal",
    state: deleting ? "deleting" : lastError ? "failed" : working ? "updating" : "running",
    version: spec.version,
    refresh: working ? { id: tags[REFRESH_TAG] ?? null, state: "rolling" } : null,
    healthy,
    internalName: `${spec.name}.${namesDomain(ctx)}`,
    lastError: deleting ? null : lastError,
    servingVersion: null,
    reaches: String(tags[REACHES_TAG] ?? "").split(",").filter(Boolean)
  };
}

/** The deployment's services at AWS, ECS's and Auto Scaling's, each with the connections it opens, in order. */
async function servicesNow(ctx) {
  const { client } = ctx;
  const cluster = ctx.nameOf("cluster", 255);
  const arns = [];
  let token;
  do {
    const page = await unless(["ClusterNotFoundException"], () => client.json("ecs", "ListServices", { cluster, maxResults: 100, ...(token ? { nextToken: token } : {}) }));
    arns.push(...asList(page?.serviceArns));
    token = page?.nextToken || undefined;
  } while (token);
  const things = [];
  for (let index = 0; index < arns.length; index += 10) {
    const { services } = await client.json("ecs", "DescribeServices", { cluster, services: arns.slice(index, index + 10), include: ["TAGS"] });
    for (const one of asList(services)) {
      if (one.status !== "INACTIVE" && ctx.isOwn(one.tags)) things.push(await fargateThing(ctx, one));
    }
  }
  token = undefined;
  do {
    const page = await client.query("autoscaling", "DescribeAutoScalingGroups", {
      "Filters.member": [{ Name: `tag:${LABEL.deployment}`, "Values.member": [ctx.own().id] }], NextToken: token
    });
    for (const group of asList(page.AutoScalingGroups?.member)) {
      if (ctx.isOwn(asList(group.Tags?.member))) things.push(await machineThing(ctx, group));
    }
    token = page.NextToken || undefined;
  } while (token);
  const idOf = new Map(things.filter((one) => one.state !== "deleting").map((one) => [itemOf(one.labels), one.id]));
  return things.map(({ reaches, ...thing }) => ({ ...thing, connections: reaches.filter((name) => idOf.has(name)).map((name) => ({ to: idOf.get(name), port: SERVICE_PORT })) }));
}

// --- Security groups, names, settings and links ----------------------------------------------------------------------

/** A security group of the deployment's VPC by name, or a retryable refusal while it isn't made. */
async function groupNamed(ctx, base, part) {
  const name = ctx.nameOf(part, 255);
  const found = asList((await ctx.client.query("ec2", "DescribeSecurityGroups", {
    Filter: [{ Name: "vpc-id", Value: [base.vpcId] }, { Name: "group-name", Value: [name] }]
  })).securityGroupInfo?.item)[0];
  if (!found) throw adapterError("aws_group_missing", `The security group ${name} isn't made yet.`, true);
  return found.groupId;
}

/** Lets one security group into another on a port (Reaches, or a service into its database). */
async function allowInto(ctx, target, source, port) {
  await unless(["InvalidPermission.Duplicate"], () => ctx.client.query("ec2", "AuthorizeSecurityGroupIngress", {
    GroupId: target, IpPermissions: [{ IpProtocol: "tcp", FromPort: port, ToPort: port, Groups: [{ GroupId: source }] }]
  }));
}

/** Takes one security group's way into another away. */
async function revokeFrom(ctx, target, source, port) {
  await unless(["InvalidPermission.NotFound"], () => ctx.client.query("ec2", "RevokeSecurityGroupIngress", {
    GroupId: target, IpPermissions: [{ IpProtocol: "tcp", FromPort: port, ToPort: port, Groups: [{ GroupId: source }] }]
  }));
}

/**
 * The rules a service's Reaches need: its group let into each reached service's, on the port, and out of any other
 * service's. Answers the reached services' items, in order.
 */
async function putReaches(ctx, base, group, connections) {
  const names = [];
  for (const { to } of connections) names.push(itemOf((await readOwnService(ctx, to)).tags));
  const wanted = new Set();
  for (const name of names) {
    const target = await groupNamed(ctx, base, `service-${name}`);
    wanted.add(target);
    await allowInto(ctx, target, group, SERVICE_PORT);
  }
  const referencing = asList((await ctx.client.query("ec2", "DescribeSecurityGroups", {
    Filter: [{ Name: "vpc-id", Value: [base.vpcId] }, { Name: "ip-permission.group-id", Value: [group] }]
  })).securityGroupInfo?.item);
  for (const one of referencing) {
    if (String(one.groupName).startsWith(ctx.nameOf("service-")) && !wanted.has(one.groupId)) await revokeFrom(ctx, one.groupId, group, SERVICE_PORT);
  }
  return names;
}

/** The service's entry in the deployment's private names, made once. */
async function namesServiceOf(ctx, base, name, machine) {
  const listed = await ctx.client.json("servicediscovery", "ListServices", { Filters: [{ Name: "NAMESPACE_ID", Values: [base.namespace.id], Condition: "EQ" }], MaxResults: 100 });
  const found = asList(listed.Services).find((one) => one.Name === name);
  if (found) return { id: found.Id, arn: found.Arn };
  const { Service } = await ctx.client.json("servicediscovery", "CreateService", {
    Name: name,
    NamespaceId: base.namespace.id,
    CreatorRequestId: `${ctx.own().id}-${name}`,
    DnsConfig: { RoutingPolicy: "MULTIVALUE", DnsRecords: [{ Type: "A", TTL: 10 }] },
    // ECS reports its tasks' health; a machine adds itself once its service answers and leaves as it stops.
    ...(machine ? {} : { HealthCheckCustomConfig: { FailureThreshold: 1 } }),
    Tags: keyValueTags(ctx.tagsFor("base.names"))
  });
  return { id: Service.Id, arn: Service.Arn };
}

/** A service's own settings: the plain ones as they are, the secret ones kept in its secret and read by version. */
/** The name of a service's own secret settings. */
const secretNameOf = (ctx, item) => `vibe64/${ctx.own().id}/services/${item}`;

async function ownSettings(ctx, item, labels, { settings, secrets }) {
  if (Object.keys(secrets).length === 0) return { env: { ...settings }, secrets: {} };
  const { client } = ctx;
  const name = secretNameOf(ctx, item);
  const known = await unless(["ResourceNotFoundException"], () => client.json("secretsmanager", "DescribeSecret", { SecretId: name }));
  if (known && !ctx.isOwn(known.Tags)) throw notOurs("The secret", name);
  // Taken offline before, its secret waits out its recovery window: it is restored.
  if (known?.DeletedDate) await client.json("secretsmanager", "RestoreSecret", { SecretId: name });
  const kept = known
    ? await client.json("secretsmanager", "PutSecretValue", { SecretId: name, SecretString: JSON.stringify(secrets) })
    : await client.json("secretsmanager", "CreateSecret", { Name: name, Description: `Vibe64: service ${item}'s secret settings`, SecretString: JSON.stringify(secrets), Tags: keyValueTags(labels) });
  return { env: { ...settings }, secrets: Object.fromEntries(Object.keys(secrets).map((key) => [key, { arn: kept.ARN, key, versionId: kept.VersionId }])) };
}

/** The resources' fields a release needs, and its service's group let into each database's. */
async function linksOf(ctx, declaration, group) {
  const resources = declaration.needs.length > 0 ? await resourcesNow(ctx) : [];
  const env = {};
  const secrets = {};
  for (const need of declaration.needs) {
    const thing = resources.find((one) => one.labels[LABEL.item] === `resource.${need.resource}` && one.state !== "deleting");
    if (thing?.state !== "running") throw adapterError("aws_resource_starting", `Waiting for ${need.resource} to be ready.`, true);
    const values = await linkValues(ctx, thing.id, need.as);
    if (values.group) await allowInto(ctx, values.group, group, values.port);
    Object.assign(env, values.plain);
    Object.assign(secrets, values.refs);
  }
  return { env, secrets };
}

// --- Writing what a service runs -------------------------------------------------------------------------------------

/** A new task definition revision running the spec: its ARN. */
async function registerRevision(ctx, base, spec, labels) {
  const { vcpus, memoryGib } = fargateShape(spec.size);
  const place = await keepSpec(ctx, base, spec);
  const { taskDefinition } = await ctx.client.json("ecs", "RegisterTaskDefinition", {
    family: ctx.nameOf(`service-${spec.service}`, 255),
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: String(vcpus * 1024),
    memory: String(memoryGib * 1024),
    runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
    executionRoleArn: base.roles.execution,
    containerDefinitions: [{
      name: "app",
      image: spec.image,
      essential: true,
      portMappings: [{ name: "http", containerPort: SERVICE_PORT, protocol: "tcp" }],
      environment: Object.entries(spec.env).map(([name, value]) => ({ name, value })),
      secrets: Object.entries(spec.secrets).map(([name, ref]) => ({ name, valueFrom: `${ref.arn}:${ref.key}::${ref.versionId ?? ""}` })),
      healthCheck: {
        command: ["CMD-SHELL", `curl -fsS -o /dev/null ${shellWord(`http://127.0.0.1:${SERVICE_PORT}${spec.healthPath}`)} || exit 1`],
        interval: 15, timeout: 5, retries: 4, startPeriod: 120
      },
      logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": base.logGroup, "awslogs-region": ctx.region, "awslogs-stream-prefix": spec.service } },
      dockerLabels: { [SPEC_LABEL]: place }
    }],
    tags: lowerTags(labels)
  });
  ctx.cache.revisions.set(taskDefinition.taskDefinitionArn, spec);
  return taskDefinition.taskDefinitionArn;
}

/** A launch template version running the spec on a machine of its size, the template made once: `{ id, version }`. */
async function templateVersionFor(ctx, base, spec, labels, group) {
  const { client } = ctx;
  const name = ctx.nameOf(`service-${spec.service}`, 128);
  const data = {
    ImageId: AMI,
    InstanceType: spec.size,
    IamInstanceProfile: { Arn: base.roles.instanceProfile },
    NetworkInterface: [{ DeviceIndex: 0, AssociatePublicIpAddress: true, SecurityGroupId: [group] }],
    MetadataOptions: { HttpTokens: "required", HttpEndpoint: "enabled" },
    BlockDeviceMapping: [{ DeviceName: "/dev/xvda", Ebs: { VolumeSize: ROOT_DISK_GIB, VolumeType: "gp3", Encrypted: true, DeleteOnTermination: true } }],
    UserData: userDataOf(await keepSpec(ctx, base, spec)),
    TagSpecification: [{ ResourceType: "instance", Tag: keyValueTags({ ...labels, Name: name }) }, { ResourceType: "volume", Tag: keyValueTags(labels) }]
  };
  const found = asList((await unless(["InvalidLaunchTemplateName.NotFoundException"], () => client.query("ec2", "DescribeLaunchTemplates", { LaunchTemplateName: [name] })))
    ?.launchTemplates?.item)[0];
  let id;
  let version;
  if (found) {
    if (!ctx.isOwn(asList(found.tagSet?.item))) throw notOurs("The launch template", name);
    id = found.launchTemplateId;
    version = (await client.query("ec2", "CreateLaunchTemplateVersion", { LaunchTemplateId: id, LaunchTemplateData: data })).launchTemplateVersion.versionNumber;
  } else {
    const made = (await client.query("ec2", "CreateLaunchTemplate", { LaunchTemplateName: name, LaunchTemplateData: data, TagSpecification: tagSpecification("launch-template", labels) })).launchTemplate;
    id = made.launchTemplateId;
    version = made.latestVersionNumber;
  }
  ctx.cache.revisions.set(`${id}:${version}`, spec);
  return { id, version: String(version) };
}

/**
 * Rolls a service onto a new spec: a new revision ECS rolls out, or a new template version an instance refresh rolls
 * onto the machines (refused, to be tried again, while one is under way). Its refresh's id, `<kind>:<revision>`.
 */
async function roll(ctx, base, current, spec, kind) {
  const { client } = ctx;
  if (current.machine) {
    const latest = asList((await client.query("autoscaling", "DescribeInstanceRefreshes", { AutoScalingGroupName: current.name, MaxRecords: 1 })).InstanceRefreshes?.member)[0];
    if (latest && REFRESHING.has(latest.Status)) throw adapterError("aws_machines_busy", `${current.name}'s machines are taking a version already.`, true);
    const group = await groupNamed(ctx, base, `service-${spec.service}`);
    const template = await templateVersionFor(ctx, base, spec, labelsOf(current.tags), group);
    try {
      await client.query("autoscaling", "StartInstanceRefresh", {
        AutoScalingGroupName: current.name,
        Strategy: "Rolling",
        DesiredConfiguration: { LaunchTemplate: { LaunchTemplateId: template.id, Version: template.version } },
        Preferences: { MinHealthyPercentage: 100, MaxHealthyPercentage: 200, InstanceWarmup: 60, SkipMatching: true }
      });
    } catch (error) {
      if (error?.code === "InstanceRefreshInProgress") throw adapterError("aws_machines_busy", `${current.name}'s machines are taking a version already.`, true);
      throw error;
    }
    const refreshId = `${kind}:${template.version}`;
    await client.query("autoscaling", "CreateOrUpdateTags", {
      "Tags.member": [{ ResourceId: current.name, ResourceType: "auto-scaling-group", Key: REFRESH_TAG, Value: refreshId, PropagateAtLaunch: false }]
    });
    return refreshId;
  }
  const revision = await registerRevision(ctx, base, spec, labelsOf(current.tags));
  const refreshId = `${kind}:${revision.split(":").pop()}`;
  await client.json("ecs", "TagResource", { resourceArn: current.id, tags: [{ key: REVISION_TAG, value: revision }, { key: REFRESH_TAG, value: refreshId }] });
  await client.json("ecs", "UpdateService", { cluster: base.cluster, service: current.id, taskDefinition: revision });
  return refreshId;
}

// --- The calls the steps make ----------------------------------------------------------------------------------------

/**
 * Makes a service, tagged: its group, names entry, settings and its release's resources, its route when public, then
 * its ECS service or its Auto Scaling group. `{ id, refreshId }`.
 */
async function createService(ctx, { name, exposure, size, instances, app, version, settings, secrets, connections, labels }, { idempotencyKey }) {
  const { client } = ctx;
  const base = await ensureBase(ctx);
  const item = itemOf(labels);
  const declaration = await declarationOf(ctx, app, version);
  runtimeCheck(declaration, size);
  const machine = needsMachine(declaration);
  const image = await builtImage(ctx, app, version);
  const group = await ensureSecurityGroup(ctx, base.vpcId, `service-${item}`, `Vibe64: service ${item}`,
    exposure === "public" ? [{ IpProtocol: "tcp", FromPort: SERVICE_PORT, ToPort: SERVICE_PORT, Groups: [{ GroupId: base.balancerGroup }] }] : []);
  const links = await linksOf(ctx, declaration, group);
  const own = await ownSettings(ctx, item, labels, { settings, secrets });
  const names = await namesServiceOf(ctx, base, declaration.name, machine);
  const reaches = await putReaches(ctx, base, group, connections);
  const target = exposure === "public" ? await targetGroupOf(ctx, { item, machine, healthPath: declaration.healthPath }) : null;
  if (target) await routeTo(ctx, target);
  const spec = {
    service: item, name: declaration.name, image, version, size, port: SERVICE_PORT, healthPath: declaration.healthPath,
    privileged: declaration.machineFeatures.length > 0, env: { ...links.env, ...own.env }, secrets: { ...links.secrets, ...own.secrets }
  };
  if (!machine) {
    const revision = await registerRevision(ctx, base, spec, labels);
    const refreshId = `create:${revision.split(":").pop()}`;
    try {
      const made = (await client.json("ecs", "CreateService", {
        cluster: base.cluster,
        serviceName: name,
        taskDefinition: revision,
        desiredCount: instances,
        launchType: "FARGATE",
        platformVersion: "LATEST",
        networkConfiguration: { awsvpcConfiguration: { subnets: base.subnets, securityGroups: [group], assignPublicIp: "ENABLED" } },
        ...(target ? { loadBalancers: [{ targetGroupArn: target, containerName: "app", containerPort: SERVICE_PORT }], healthCheckGracePeriodSeconds: 120 } : {}),
        serviceRegistries: [{ registryArn: names.arn }],
        deploymentConfiguration: { deploymentCircuitBreaker: { enable: true, rollback: true }, minimumHealthyPercent: 100, maximumPercent: 200 },
        tags: lowerTags({ ...labels, [REVISION_TAG]: revision, [REACHES_TAG]: reaches.join(","), [REFRESH_TAG]: refreshId }),
        clientToken: tokenOf(idempotencyKey, 36)
      })).service;
      return { id: made.serviceArn, refreshId };
    } catch (error) {
      // Made by a Deploy cut short: this deployment's service of that name stands, with the refresh it began.
      if (error?.code !== "InvalidParameterException" || !/idempotent/iu.test(error.message)) throw error;
      const known = await readOwnService(ctx, `${base.cluster.replace(":cluster/", ":service/")}/${name}`);
      return { id: known.service.serviceArn, refreshId: known.tags[REFRESH_TAG] ?? refreshId };
    }
  }
  const groupName = ctx.nameOf(`service-${item}`, 255);
  const template = await templateVersionFor(ctx, base, { ...spec, region: ctx.region, logGroup: base.logGroup, namesService: names.id, namesImage: NAMES_IMAGE, group: groupName }, labels, group);
  try {
    await client.query("autoscaling", "CreateAutoScalingGroup", {
      AutoScalingGroupName: groupName,
      LaunchTemplate: { LaunchTemplateId: template.id, Version: template.version },
      MinSize: instances,
      MaxSize: instances * 2,
      DesiredCapacity: instances,
      VPCZoneIdentifier: base.subnets.join(","),
      ...(target ? { "TargetGroupARNs.member": [target], HealthCheckType: "ELB" } : { HealthCheckType: "EC2" }),
      HealthCheckGracePeriod: 300,
      "LifecycleHookSpecificationList.member": [{
        LifecycleHookName: READY_HOOK, LifecycleTransition: "autoscaling:EC2_INSTANCE_LAUNCHING", HeartbeatTimeout: READY_SECONDS, DefaultResult: "ABANDON"
      }],
      "Tags.member": Object.entries({ ...labels, [REACHES_TAG]: reaches.join(","), [REFRESH_TAG]: `create:${template.version}`, Name: groupName })
        .map(([Key, Value]) => ({ ResourceId: groupName, ResourceType: "auto-scaling-group", Key, Value, PropagateAtLaunch: false }))
    });
  } catch (error) {
    if (error?.code !== "AlreadyExists") throw error;
    const known = asList((await client.query("autoscaling", "DescribeAutoScalingGroups", { "AutoScalingGroupNames.member": [groupName] })).AutoScalingGroups?.member)[0];
    if (known?.Status) throw adapterError("aws_service_leaving", `The old machines of ${item} are still going.`, true);
    if (known && !ctx.isOwn(asList(known.Tags?.member))) throw notOurs("The Auto Scaling group", groupName);
  }
  const made = asList((await client.query("autoscaling", "DescribeAutoScalingGroups", { "AutoScalingGroupNames.member": [groupName] })).AutoScalingGroups?.member)[0];
  return { id: made.AutoScalingGroupARN, refreshId: tagsOf(asList(made.Tags?.member))[REFRESH_TAG] ?? `create:${template.version}` };
}

/**
 * Hands a service a new release: its image once built, the resources the release needs, and `values`, its own settings
 * and secrets in place of those it has, in the same new revision (without them it keeps its own). `{ version,
 * refreshId }`.
 */
async function releaseService(ctx, id, upload, { values = null } = {}) {
  const current = await readOwnService(ctx, id);
  const base = await ensureBase(ctx);
  const { declaration } = upload;
  const { version } = await uploadRelease(ctx, declaration.name, upload);
  const spec = await specNow(ctx, current);
  runtimeCheck(declaration, spec.size);
  const image = await builtImage(ctx, declaration.name, version);
  const group = await groupNamed(ctx, base, `service-${spec.service}`);
  const links = await linksOf(ctx, declaration, group);
  if (current.public && declaration.healthPath !== spec.healthPath) {
    const target = await targetGroupOf(ctx, { item: spec.service, machine: current.machine, healthPath: declaration.healthPath });
    await ctx.client.query("elasticloadbalancing", "ModifyTargetGroup", { TargetGroupArn: target, HealthCheckPath: declaration.healthPath });
  }
  // Its own settings: those it brings, in place of those it has, or those it has.
  const own = values ? await ownSettings(ctx, spec.service, labelsOf(current.tags), values) : { env: pick(spec.env, (name) => !isLink(name)), secrets: pick(spec.secrets, (name) => !isLink(name)) };
  const next = {
    ...spec, name: declaration.name, image, version, healthPath: declaration.healthPath, privileged: declaration.machineFeatures.length > 0,
    env: { ...links.env, ...own.env }, secrets: { ...links.secrets, ...own.secrets }
  };
  return { version, refreshId: await roll(ctx, base, current, next, "release") };
}

/** Gives a service new settings: its secret ones kept anew, then a new revision. Its refresh's id. */
async function putSettings(ctx, id, { settings, secrets }) {
  const current = await readOwnService(ctx, id);
  const base = await ensureBase(ctx);
  const spec = await specNow(ctx, current);
  const own = await ownSettings(ctx, spec.service, labelsOf(current.tags), { settings, secrets });
  const next = { ...spec, env: { ...pick(spec.env, isLink), ...own.env }, secrets: { ...pick(spec.secrets, isLink), ...own.secrets } };
  return roll(ctx, base, current, next, "settings");
}

/** Changes a service's connections (rules, no refresh), its count (no refresh) or its size (a refresh). */
async function changeService(ctx, id, change) {
  const { client } = ctx;
  const current = await readOwnService(ctx, id);
  const base = await ensureBase(ctx);
  const item = itemOf(current.tags);
  if (change.connections) {
    const reaches = (await putReaches(ctx, base, await groupNamed(ctx, base, `service-${item}`), change.connections)).join(",");
    if (current.machine) {
      await client.query("autoscaling", "CreateOrUpdateTags", {
        "Tags.member": [{ ResourceId: current.name, ResourceType: "auto-scaling-group", Key: REACHES_TAG, Value: reaches, PropagateAtLaunch: false }]
      });
    } else {
      await client.json("ecs", "TagResource", { resourceArn: id, tags: [{ key: REACHES_TAG, value: reaches }] });
    }
    return null;
  }
  if (change.instances !== undefined) {
    if (current.machine) {
      await client.query("autoscaling", "UpdateAutoScalingGroup", {
        AutoScalingGroupName: current.name, MinSize: change.instances, MaxSize: change.instances * 2, DesiredCapacity: change.instances
      });
    } else {
      await client.json("ecs", "UpdateService", { cluster: base.cluster, service: id, desiredCount: change.instances });
    }
    return null;
  }
  if (change.size) {
    if (isMachineSize(change.size) !== current.machine) {
      throw adapterError("aws_size_unsupported", `${current.name} runs on ${current.machine ? "whole machines" : "Fargate"}; ${change.size} isn't one of its sizes.`);
    }
    return roll(ctx, base, current, { ...await specNow(ctx, current), size: change.size }, "size");
  }
  return null;
}

/** A service's refresh as the engine reads it, from what ECS or Auto Scaling reports now. */
async function readRefresh(ctx, id, refreshId) {
  const kind = String(refreshId).split(":")[0];
  const thing = (await servicesNow(ctx)).find((one) => one.id === id);
  if (!thing) return { kind, state: "failed", error: { message: "the service is gone at AWS." } };
  if (thing.refresh) return { kind, state: thing.refresh.state };
  if (thing.lastError) return { kind, state: "failed", error: thing.lastError, fromVersion: thing.servingVersion };
  return { kind, state: "succeeded" };
}

/**
 * Links a resource to a service: its fields are in what the service runs (given with its release, or now, in a new
 * revision, when they aren't), and its group is let into a database's. `{ id }`, the link's.
 */
async function linkResource(ctx, resourceId, serviceId, need) {
  const current = await readOwnService(ctx, serviceId);
  const base = await ensureBase(ctx);
  const spec = await specNow(ctx, current);
  const group = await groupNamed(ctx, base, `service-${spec.service}`);
  const values = await linkValues(ctx, resourceId, need);
  if (values.group) await allowInto(ctx, values.group, group, values.port);
  const given = Object.entries(values.plain).every(([name, value]) => spec.env[name] === value) && Object.keys(values.refs).every((name) => spec.secrets[name]);
  if (!given) await roll(ctx, base, current, { ...spec, env: { ...spec.env, ...values.plain }, secrets: { ...spec.secrets, ...values.refs } }, "link");
  return { id: `${serviceId}|${resourceId}` };
}

/** Takes a link away: the service's group out of a database's. Its settings go with its next release. */
async function unlinkResource(ctx, resourceId, linkId) {
  if (isBucket(resourceId)) return;
  const serviceId = String(linkId).split("|")[0];
  const base = await ensureBase(ctx);
  const current = await readOwnService(ctx, serviceId).catch((error) => (error?.code === "aws_service_gone" ? null : Promise.reject(error)));
  if (!current) return;
  const { group, port } = await databaseGroup(ctx, resourceId);
  if (group) await revokeFrom(ctx, group, await groupNamed(ctx, base, `service-${itemOf(current.tags)}`), port);
}

/** Deletes a service: off the load balancer when public, then its ECS service or its machines. */
async function deleteService(ctx, id) {
  const current = await readOwnService(ctx, id).catch((error) => (error?.code === "aws_service_gone" ? null : Promise.reject(error)));
  if (!current) return;
  if (current.public) await routeTo(ctx, null);
  if (current.machine) {
    await ctx.client.query("autoscaling", "DeleteAutoScalingGroup", { AutoScalingGroupName: current.name, ForceDelete: true });
  } else {
    await ctx.client.json("ecs", "DeleteService", { cluster: ctx.nameOf("cluster", 255), service: id, force: true });
  }
  // Its secret settings go with it, recoverable for a week (a Deploy that brings it back restores them).
  // (InvalidRequestException: already waiting out its window.)
  await unless(["ResourceNotFoundException", "InvalidRequestException"], () => ctx.client.json("secretsmanager", "DeleteSecret", { SecretId: secretNameOf(ctx, itemOf(current.tags)), RecoveryWindowInDays: 7 }));
}

export { changeService, createService, deleteService, linkResource, needsMachine, putSettings, readRefresh, releaseService, servicesNow, unlinkResource };

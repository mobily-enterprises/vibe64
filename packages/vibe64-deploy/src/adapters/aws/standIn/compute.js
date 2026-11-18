// The stand-in's compute: ECS clusters, task definitions and services on Fargate with their deployments (rolled out,
// rolled back by the circuit breaker), ECR repositories and images, CodeBuild projects and builds, Cloud Map
// namespaces, services and operations (JSON 1.1), and EC2 Auto Scaling groups with their machines, lifecycle hook,
// instance refreshes and activities (Query, lists of <member>).
//
// What a task or machine would meet when it starts is checked when it "starts" (at advance): its image is in ECR, every
// secret it is given exists with its key and version and its role may read it. A task or machine meeting a problem
// doesn't start: the deployment fails (and ECS puts the revision before back), the refresh fails, the machine is ended.
// Faults: tasksFail (tasks never get healthy), machinesNeverReady (no machine says it is ready), buildFails.
import { fault, listOf, required, tagsOfList } from "./wire.js";

const members = (items) => ({ member: items });
const ecsError = (code, message) => fault(400, code, message);
const lowerTags = (tags) => (tags ?? []).map((tag) => ({ key: tag.key, value: tag.value }));
const tagsObject = (tags) => Object.fromEntries((tags ?? []).map((tag) => [tag.key ?? tag.Key, tag.value ?? tag.Value]));

/** @param {any} world */
function createStandInCompute(world) {
  const clusters = new Map();
  const taskDefinitions = new Map();
  const services = new Map();
  const repositories = new Map();
  const projects = new Map();
  const builds = new Map();
  const namespaces = new Map();
  const operations = new Map();
  const names = new Map();
  const groups = new Map();
  let refreshSeq = 0;
  const at = () => world.now().getTime() / 1000;

  /** Why a container of this definition can't start, or "": its image, then each secret, read with its role. */
  function startProblem(definition, roleArn) {
    const container = definition.containerDefinitions[0];
    const [repositoryUri, tag] = [container.image.slice(0, container.image.lastIndexOf(":")), container.image.slice(container.image.lastIndexOf(":") + 1)];
    const repository = [...repositories.values()].find((one) => one.uri === repositoryUri);
    if (!repository?.images.has(tag)) return `CannotPullContainerError: ${container.image}: not found`;
    for (const secret of container.secrets ?? []) {
      const parts = String(secret.valueFrom).split(":");
      const arn = parts.slice(0, 7).join(":");
      if (!world.data.roleMay(roleArn, "secretsmanager:GetSecretValue", arn)) return `ResourceInitializationError: unable to pull secrets: AccessDeniedException on ${arn}`;
      const read = world.data.readSecretKey(arn, parts[7], parts[9] || null);
      if (read.problem) return `ResourceInitializationError: unable to pull secrets: ${read.problem}`;
    }
    return world.faults.tasksFail ? "Task failed container health checks" : "";
  }

  // --- ECS ----------------------------------------------------------------------------------------------------------

  const serviceView = (one) => ({
    serviceArn: one.arn, serviceName: one.name, clusterArn: one.cluster, status: one.status, desiredCount: one.desiredCount,
    runningCount: one.deployments.find((deployment) => deployment.status === "PRIMARY")?.runningCount ?? 0, pendingCount: 0, launchType: "FARGATE",
    taskDefinition: one.deployments.find((deployment) => deployment.status === "PRIMARY")?.taskDefinition ?? one.taskDefinition,
    loadBalancers: one.loadBalancers, serviceRegistries: one.serviceRegistries, networkConfiguration: one.networkConfiguration,
    deploymentConfiguration: one.deploymentConfiguration, deployments: one.deployments.map(({ started, ...deployment }) => deployment), events: [...one.events].reverse(), tags: lowerTags(one.tags),
    createdAt: one.createdAt
  });
  const clusterOf = (name) => {
    const cluster = [...clusters.values()].find((one) => (one.name === name || one.arn === name) && one.status === "ACTIVE");
    if (!cluster) throw ecsError("ClusterNotFoundException", "Cluster not found.");
    return cluster;
  };
  const definitionOf = (name) => {
    const found = taskDefinitions.get(name) ?? [...taskDefinitions.values()].filter((one) => one.family === name).at(-1);
    if (!found) throw ecsError("ClientException", "Unable to describe task definition.");
    return found;
  };
  function newDeployment(one, taskDefinition) {
    for (const deployment of one.deployments) if (deployment.status === "PRIMARY") deployment.status = "ACTIVE";
    one.deployments.unshift({
      id: `ecs-svc/${world.id("d").slice(2).padStart(19, "0")}`, status: "PRIMARY", taskDefinition, desiredCount: one.desiredCount, runningCount: 0, pendingCount: one.desiredCount,
      failedTasks: 0, rolloutState: "IN_PROGRESS", rolloutStateReason: "ECS deployment in progress.", createdAt: at(), updatedAt: at()
    });
  }

  const ecs = {
    DescribeClusters: (body) => ({
      clusters: (body.clusters ?? []).flatMap((name) => [...clusters.values()].filter((one) => one.name === name || one.arn === name))
        .map((one) => ({ clusterArn: one.arn, clusterName: one.name, status: one.status, ...(body.include?.includes("TAGS") ? { tags: lowerTags(one.tags) } : {}) })),
      failures: []
    }),
    CreateCluster: (body) => {
      const name = body.clusterName ?? "default";
      const found = [...clusters.values()].find((one) => one.name === name && one.status === "ACTIVE");
      const cluster = found ?? { arn: `arn:aws:ecs:${world.region}:${world.account}:cluster/${name}`, name, status: "ACTIVE", tags: lowerTags(body.tags) };
      clusters.set(cluster.arn, cluster);
      return { cluster: { clusterArn: cluster.arn, clusterName: name, status: "ACTIVE" } };
    },
    RegisterTaskDefinition: (body) => {
      const family = required(body, "family");
      if (body.requiresCompatibilities?.includes("FARGATE")) {
        if (body.networkMode !== "awsvpc") throw ecsError("ClientException", "Fargate only supports network mode 'awsvpc'.");
        if (typeof body.cpu !== "string" || typeof body.memory !== "string") throw ecsError("ClientException", "Fargate requires task definition to have execution role ARN to support log driver awslogs.");
        if (!world.data.roleExists(body.executionRoleArn)) throw ecsError("ClientException", "Role is not valid");
      }
      const container = body.containerDefinitions?.[0];
      if (!container?.image || !container?.name) throw ecsError("ClientException", "Container.image should not be null or empty.");
      const revision = [...taskDefinitions.values()].filter((one) => one.family === family).length + 1;
      const arn = `arn:aws:ecs:${world.region}:${world.account}:task-definition/${family}:${revision}`;
      const definition = { ...structuredClone(body), family, revision, taskDefinitionArn: arn, status: "ACTIVE" };
      delete definition.tags;
      taskDefinitions.set(arn, definition);
      return { taskDefinition: definition, tags: lowerTags(body.tags) };
    },
    DescribeTaskDefinition: (body) => ({ taskDefinition: definitionOf(required(body, "taskDefinition")) }),
    ListServices: (body) => {
      const cluster = clusterOf(body.cluster ?? "default");
      return { serviceArns: [...services.values()].filter((one) => one.cluster === cluster.arn && one.status !== "INACTIVE").map((one) => one.arn) };
    },
    DescribeServices: (body) => {
      const cluster = clusterOf(body.cluster ?? "default");
      if ((body.services ?? []).length > 10) throw ecsError("InvalidParameterException", "services can have at most 10 items.");
      const found = [];
      const failures = [];
      for (const name of body.services ?? []) {
        const one = [...services.values()].filter((service) => service.cluster === cluster.arn && (service.arn === name || service.name === name)).at(-1);
        if (one) found.push(serviceView(one));
        else failures.push({ arn: name, reason: "MISSING" });
      }
      return { services: found.map((one) => (body.include?.includes("TAGS") ? one : { ...one, tags: undefined })), failures };
    },
    CreateService: (body) => {
      const cluster = clusterOf(body.cluster ?? "default");
      const name = required(body, "serviceName");
      const existing = [...services.values()].find((one) => one.cluster === cluster.arn && one.name === name && one.status !== "INACTIVE");
      if (existing) {
        if (body.clientToken && existing.clientToken === body.clientToken) return { service: serviceView(existing) };
        throw ecsError("InvalidParameterException", "Creation of service was not idempotent.");
      }
      const definition = definitionOf(required(body, "taskDefinition"));
      if (body.launchType === "FARGATE" && !body.networkConfiguration?.awsvpcConfiguration?.subnets?.length) {
        throw ecsError("InvalidParameterException", "Network Configuration must be provided when networkMode 'awsvpc' is specified.");
      }
      for (const subnet of body.networkConfiguration?.awsvpcConfiguration?.subnets ?? []) if (!world.network.subnetExists(subnet)) throw ecsError("InvalidParameterException", `Error retrieving subnet information for [${subnet}]: The subnet ID '${subnet}' does not exist`);
      for (const group of body.networkConfiguration?.awsvpcConfiguration?.securityGroups ?? []) if (!world.network.groupExists(group)) throw ecsError("InvalidParameterException", `Error retrieving security group information for [${group}]`);
      for (const balancer of body.loadBalancers ?? []) {
        const target = world.network.targetGroup(balancer.targetGroupArn);
        if (!target) throw ecsError("InvalidParameterException", "Unable to assume role and validate the specified targetGroupArn.");
        if (!world.network.targetGroupRouted(balancer.targetGroupArn)) throw ecsError("InvalidParameterException", `The target group with targetGroupArn ${balancer.targetGroupArn} does not have an associated load balancer.`);
        if (target.targetType !== "ip") throw ecsError("InvalidParameterException", `The provided target group ${balancer.targetGroupArn} has target type instance, which is incompatible with the awsvpc network mode specified in the task definition.`);
      }
      for (const registry of body.serviceRegistries ?? []) {
        if (![...names.values()].some((one) => one.arn === registry.registryArn)) throw ecsError("InvalidParameterException", "The service registry ARN is not valid.");
      }
      const one = {
        arn: `arn:aws:ecs:${world.region}:${world.account}:service/${cluster.name}/${name}`, name, cluster: cluster.arn, status: "ACTIVE", desiredCount: Number(body.desiredCount ?? 0),
        taskDefinition: definition.taskDefinitionArn, loadBalancers: body.loadBalancers ?? [], serviceRegistries: body.serviceRegistries ?? [], networkConfiguration: body.networkConfiguration,
        deploymentConfiguration: body.deploymentConfiguration ?? {}, tags: lowerTags(body.tags), clientToken: body.clientToken ?? null, deployments: [], events: [], createdAt: at()
      };
      newDeployment(one, definition.taskDefinitionArn);
      services.set(one.arn, one);
      return { service: serviceView(one) };
    },
    UpdateService: (body) => {
      const cluster = clusterOf(body.cluster ?? "default");
      const one = [...services.values()].find((service) => service.cluster === cluster.arn && (service.arn === body.service || service.name === body.service) && service.status === "ACTIVE");
      if (!one) throw ecsError("ServiceNotFoundException", "Service not found.");
      if (body.desiredCount !== undefined) {
        one.desiredCount = Number(body.desiredCount);
        for (const deployment of one.deployments) if (deployment.status === "PRIMARY") deployment.desiredCount = one.desiredCount;
      }
      if (body.taskDefinition) {
        const definition = definitionOf(body.taskDefinition);
        one.taskDefinition = definition.taskDefinitionArn;
        newDeployment(one, definition.taskDefinitionArn);
      }
      return { service: serviceView(one) };
    },
    DeleteService: (body) => {
      const cluster = clusterOf(body.cluster ?? "default");
      const one = [...services.values()].find((service) => service.cluster === cluster.arn && (service.arn === body.service || service.name === body.service) && service.status === "ACTIVE");
      if (!one) throw ecsError("ServiceNotFoundException", "Service not found.");
      if (one.desiredCount > 0 && body.force !== true) throw ecsError("InvalidParameterException", "The service cannot be stopped while it is scaled above 0.");
      one.status = "DRAINING";
      return { service: serviceView(one) };
    },
    TagResource: (body) => {
      const one = services.get(required(body, "resourceArn"));
      if (!one) throw ecsError("InvalidParameterException", "The specified resource is not found.");
      for (const tag of body.tags ?? []) {
        if (String(tag.value ?? "").length > 256) throw ecsError("InvalidParameterException", "Tag value exceeds 256 characters.");
        one.tags = [...one.tags.filter((have) => have.key !== tag.key), { key: tag.key, value: tag.value }];
      }
      return {};
    }
  };

  // --- ECR and CodeBuild --------------------------------------------------------------------------------------------

  const repositoryView = (one) => ({ repositoryArn: one.arn, registryId: world.account, repositoryName: one.name, repositoryUri: one.uri, imageTagMutability: one.mutability, createdAt: one.created });
  const ecr = {
    DescribeRepositories: (body) => {
      const wanted = body.repositoryNames ?? null;
      const found = [...repositories.values()].filter((one) => !wanted || wanted.includes(one.name));
      if (wanted && found.length < wanted.length) throw fault(400, "RepositoryNotFoundException", `The repository with name '${wanted[0]}' does not exist in the registry with id '${world.account}'`);
      return { repositories: found.map(repositoryView) };
    },
    CreateRepository: (body) => {
      const name = required(body, "repositoryName");
      if (!/^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(name)) throw fault(400, "InvalidParameterException", `Invalid parameter at 'repositoryName' failed to satisfy constraint`);
      if (repositories.has(name)) throw fault(400, "RepositoryAlreadyExistsException", `The repository with name '${name}' already exists in the registry with id '${world.account}'`);
      const one = {
        arn: `arn:aws:ecr:${world.region}:${world.account}:repository/${name}`, name, uri: `${world.account}.dkr.ecr.${world.region}.amazonaws.com/${name}`,
        mutability: body.imageTagMutability ?? "MUTABLE", images: new Map(), tags: body.tags ?? [], created: at()
      };
      repositories.set(name, one);
      return { repository: repositoryView(one) };
    },
    ListTagsForResource: (body) => {
      const one = [...repositories.values()].find((repository) => repository.arn === body.resourceArn);
      if (!one) throw fault(400, "RepositoryNotFoundException", "The repository does not exist.");
      return { tags: one.tags };
    },
    DescribeImages: (body) => {
      const one = repositories.get(required(body, "repositoryName"));
      if (!one) throw fault(400, "RepositoryNotFoundException", `The repository with name '${body.repositoryName}' does not exist in the registry with id '${world.account}'`);
      const wanted = (body.imageIds ?? []).map((image) => image.imageTag);
      const tags = wanted.length > 0 ? wanted : [...one.images.keys()];
      const missing = tags.find((tag) => !one.images.has(tag));
      if (missing) throw fault(400, "ImageNotFoundException", `The image with imageId {imageDigest:'null', imageTag:'${missing}'} does not exist within the repository with name '${one.name}'`);
      return { imageDetails: tags.map((tag) => ({ registryId: world.account, repositoryName: one.name, imageDigest: one.images.get(tag), imageTags: [tag], imagePushedAt: at() })) };
    }
  };

  const codebuild = {
    BatchGetProjects: (body) => {
      const found = (body.names ?? []).filter((name) => projects.has(name));
      return { projects: found.map((name) => ({ name, arn: projects.get(name).arn, tags: projects.get(name).tags })), projectsNotFound: (body.names ?? []).filter((name) => !projects.has(name)) };
    },
    CreateProject: (body) => {
      const name = required(body, "name");
      if (projects.has(name)) throw fault(400, "ResourceAlreadyExistsException", `Project already exists: ${name}`);
      if (!world.data.roleSeen(body.serviceRole)) throw fault(400, "InvalidInputException", `CodeBuild is not authorized to perform: sts:AssumeRole on ${body.serviceRole}`);
      if (body.source?.type !== "S3" || !body.source?.buildspec) throw fault(400, "InvalidInputException", "Project source must be S3 with a buildspec for this stand-in.");
      projects.set(name, { name, arn: `arn:aws:codebuild:${world.region}:${world.account}:project/${name}`, ...structuredClone(body), tags: body.tags ?? [] });
      return { project: { name, arn: projects.get(name).arn } };
    },
    StartBuild: (body) => {
      const project = projects.get(required(body, "projectName"));
      if (!project) throw fault(400, "ResourceNotFoundException", `Project cannot be found: ${body.projectName}`);
      // CodeBuild keeps a build's idempotency token for five minutes.
      const again = [...builds.values()].find((one) => body.idempotencyToken && one.token === body.idempotencyToken && at() - one.startTime < 300);
      if (again) return { build: again };
      const location = body.sourceLocationOverride ?? project.source.location;
      const image = (body.environmentVariablesOverride ?? []).find((one) => one.name === "IMAGE_URI")?.value ?? "";
      const id = `${project.name}:${world.id("b").slice(2).padStart(8, "0")}-0000-4000-8000-000000000000`;
      const build = {
        id, arn: `arn:aws:codebuild:${world.region}:${world.account}:build/${id}`, projectName: project.name, buildStatus: "IN_PROGRESS", currentPhase: "QUEUED",
        sourceLocation: location, image, token: body.idempotencyToken ?? null, phases: [{ phaseType: "SUBMITTED", phaseStatus: "SUCCEEDED" }], startTime: at()
      };
      builds.set(id, build);
      return { build };
    },
    BatchGetBuilds: (body) => ({ builds: (body.ids ?? []).filter((id) => builds.has(id)).map((id) => builds.get(id)), buildsNotFound: (body.ids ?? []).filter((id) => !builds.has(id)) })
  };

  /** A build run to its end: its source read from S3, its image pushed to its repository, once per tag. */
  function finishBuild(build) {
    const [bucket, ...rest] = build.sourceLocation.split("/");
    const folder = rest.join("/");
    const fail = (phaseType, message) => Object.assign(build, {
      buildStatus: "FAILED", currentPhase: "COMPLETED", phases: [...build.phases, { phaseType, phaseStatus: "FAILED", contexts: [{ statusCode: "COMMAND_EXECUTION_ERROR", message }] }]
    });
    if (!world.data.objectExists(bucket, `${folder}release.tar.gz`)) return fail("DOWNLOAD_SOURCE", `CLIENT_ERROR: no matching artifact paths found for ${build.sourceLocation}`);
    if (world.faults.buildFails) return fail("BUILD", "Error while executing command: docker build --file vibe64-app/Containerfile. Reason: exit status 1");
    const colon = build.image.lastIndexOf(":");
    const repository = [...repositories.values()].find((one) => one.uri === build.image.slice(0, colon));
    const tag = build.image.slice(colon + 1);
    if (!repository) return fail("BUILD", `denied: repository for ${build.image} not found`);
    if (repository.mutability === "IMMUTABLE" && repository.images.has(tag)) return fail("BUILD", `tag invalid: The image tag '${tag}' already exists in the '${repository.name}' repository and cannot be overwritten because the repository is immutable.`);
    repository.images.set(tag, `sha256:${String(world.seq).padStart(64, "0")}`);
    return Object.assign(build, { buildStatus: "SUCCEEDED", currentPhase: "COMPLETED", phases: [...build.phases, { phaseType: "BUILD", phaseStatus: "SUCCEEDED" }] });
  }

  // --- Cloud Map ----------------------------------------------------------------------------------------------------

  const servicediscovery = {
    ListNamespaces: (body) => {
      const type = (body.Filters ?? []).find((one) => one.Name === "TYPE")?.Values?.[0];
      return { Namespaces: [...namespaces.values()].filter((one) => !type || one.type === type).map((one) => ({ Id: one.id, Arn: one.arn, Name: one.name, Type: one.type })) };
    },
    CreatePrivateDnsNamespace: (body) => {
      const name = required(body, "Name");
      const again = [...operations.values()].find((one) => one.request === body.CreatorRequestId && body.CreatorRequestId);
      if (again) return { OperationId: again.id };
      if ([...namespaces.values()].some((one) => one.name === name)) throw fault(400, "NamespaceAlreadyExists", `Namespace ${name} already exists.`);
      const id = world.id("op").slice(3).padStart(16, "0");
      operations.set(id, { id, type: "CREATE_NAMESPACE", status: "SUBMITTED", request: body.CreatorRequestId, name, vpc: body.Vpc, tags: body.Tags ?? [] });
      return { OperationId: id };
    },
    GetOperation: (body) => {
      const one = operations.get(required(body, "OperationId"));
      if (!one) throw fault(400, "OperationNotFound", "The operation does not exist.");
      return { Operation: { Id: one.id, Type: one.type, Status: one.status, ...(one.namespace ? { Targets: { NAMESPACE: one.namespace } } : {}) } };
    },
    ListServices: (body) => {
      const namespace = (body.Filters ?? []).find((one) => one.Name === "NAMESPACE_ID")?.Values?.[0];
      return { Services: [...names.values()].filter((one) => !namespace || one.namespace === namespace).map((one) => ({ Id: one.id, Arn: one.arn, Name: one.name })) };
    },
    CreateService: (body) => {
      const namespace = namespaces.get(required(body, "NamespaceId"));
      if (!namespace) throw fault(400, "NamespaceNotFound", "The namespace does not exist.");
      if ([...names.values()].some((one) => one.namespace === namespace.id && one.name === body.Name)) throw fault(400, "ServiceAlreadyExists", `Service ${body.Name} already exists.`);
      const id = `srv-${world.id("s").slice(2).padStart(16, "0")}`;
      const one = { id, arn: `arn:aws:servicediscovery:${world.region}:${world.account}:service/${id}`, name: required(body, "Name"), namespace: namespace.id, custom: Boolean(body.HealthCheckCustomConfig) };
      names.set(id, one);
      return { Service: { Id: id, Arn: one.arn, Name: one.name, NamespaceId: namespace.id, DnsConfig: body.DnsConfig } };
    }
  };

  // --- Auto Scaling -------------------------------------------------------------------------------------------------

  const groupOf = (name) => groups.get(name) ?? (() => {
    throw fault(400, "ValidationError", `AutoScalingGroup name not found - AutoScalingGroup ${name} not found`);
  })();
  const groupView = (one) => ({
    AutoScalingGroupName: one.name, AutoScalingGroupARN: one.arn, LaunchTemplate: { LaunchTemplateId: one.template.id, Version: one.template.version },
    MinSize: one.min, MaxSize: one.max, DesiredCapacity: one.desired, HealthCheckType: one.healthCheck, VPCZoneIdentifier: one.subnets.join(","),
    Instances: members(one.instances.filter((instance) => instance.state !== "Terminated").map((instance) => ({
      InstanceId: instance.id, LifecycleState: instance.state, HealthStatus: instance.health, AvailabilityZone: instance.zone,
      LaunchTemplate: { LaunchTemplateId: one.template.id, Version: instance.version }
    }))),
    TargetGroupARNs: members(one.targetGroups),
    Tags: members(Object.entries(one.tags).map(([Key, Value]) => ({ ResourceId: one.name, ResourceType: "auto-scaling-group", Key, Value, PropagateAtLaunch: false }))),
    ...(one.status ? { Status: one.status } : {})
  });
  /**
   * A machine started from a group's version: waiting on the group's hook until it says it is ready, else in service.
   * It boots for one advance and says so, or fails to, at the next.
   */
  function launch(one, version) {
    const instance = {
      id: world.id("i"), state: one.hook ? "Pending:Wait" : "InService", health: "Healthy", version: String(version), zone: `${world.region}${"ab"[one.instances.length % 2]}`, booting: true
    };
    one.instances.push(instance);
    one.activities.push({ ActivityId: world.id("act"), StatusCode: "InProgress", Description: `Launching a new EC2 instance: ${instance.id}`, instance: instance.id });
    return instance;
  }
  /** Why a machine of this version would not say it is ready, or "": its template, then each secret its role reads. */
  function machineProblem(one, version) {
    const data = world.network.templateData(one.template.id, version);
    if (!data) return "the launch template version does not exist";
    if (world.faults.machinesNeverReady) return "the service never answered its health path";
    const spec = JSON.parse(Buffer.from(Buffer.from(data.UserData ?? "", "base64").toString("utf8").split("\n")[1]?.replace("# vibe64-spec ", "") ?? "", "base64").toString("utf8") || "{}");
    const profileRole = world.data.view().profiles.find((profile) => profile.arn === data.IamInstanceProfile?.Arn)?.roles[0];
    const roleArn = world.data.view().roles.find((role) => role.name === profileRole)?.arn;
    if (!roleArn) return "Invalid IamInstanceProfile";
    const container = { image: spec.image ?? "", secrets: Object.entries(spec.secrets ?? {}).map(([name, ref]) => ({ name, valueFrom: `${ref.arn}:${ref.key}::${ref.versionId ?? ""}` })) };
    return startProblem({ containerDefinitions: [container] }, roleArn).replace("Task failed container health checks", "");
  }

  const autoscaling = {
    DescribeAutoScalingGroups: (params) => {
      const wanted = listOf(params.AutoScalingGroupNames, "member");
      const filters = listOf(params.Filters, "member").map((filter) => ({ name: filter.Name, values: listOf(filter.Values, "member") }));
      const found = [...groups.values()].filter((one) => (wanted.length === 0 || wanted.includes(one.name))
        && filters.every((filter) => filter.name.startsWith("tag:") && filter.values.includes(one.tags[filter.name.slice(4)])));
      return { AutoScalingGroups: members(found.map(groupView)) };
    },
    CreateAutoScalingGroup: (params) => {
      const name = required(params, "AutoScalingGroupName");
      if (groups.has(name)) throw fault(400, "AlreadyExists", `AutoScalingGroup by this name already exists - A group with the name ${name} already exists`);
      const template = params.LaunchTemplate;
      if (!world.network.templateExists(template?.LaunchTemplateId)) throw fault(400, "ValidationError", "You must use a valid fully-formed launch template.");
      if (!/^\d+$/u.test(String(template.Version))) throw fault(400, "ValidationError", "The launch template version must be a number for this stand-in.");
      const min = Number(params.MinSize);
      const max = Number(params.MaxSize);
      const desired = Number(params.DesiredCapacity ?? min);
      if (!(min <= desired && desired <= max)) throw fault(400, "ValidationError", "Desired capacity must be between min and max size.");
      const subnets = String(required(params, "VPCZoneIdentifier")).split(",");
      if (!subnets.every(world.network.subnetExists)) throw fault(400, "ValidationError", "The subnet ID does not exist.");
      const targetGroups = listOf(params.TargetGroupARNs, "member");
      for (const arn of targetGroups) if (world.network.targetGroup(arn)?.targetType !== "instance") throw fault(400, "ValidationError", `The target group ${arn} must have target type instance.`);
      const hook = listOf(params.LifecycleHookSpecificationList, "member").find((one) => one.LifecycleTransition === "autoscaling:EC2_INSTANCE_LAUNCHING") ?? null;
      const one = {
        name, arn: `arn:aws:autoscaling:${world.region}:${world.account}:autoScalingGroup:${world.id("g").slice(2).padStart(8, "0")}-0000-4000-8000-000000000000:autoScalingGroupName/${name}`,
        template: { id: template.LaunchTemplateId, version: String(template.Version) }, min, max, desired, subnets, targetGroups, healthCheck: params.HealthCheckType ?? "EC2",
        hook, tags: tagsOfList(listOf(params.Tags, "member")), instances: [], refreshes: [], activities: [], status: null
      };
      groups.set(name, one);
      for (let count = 0; count < desired; count += 1) launch(one, one.template.version);
      return {};
    },
    UpdateAutoScalingGroup: (params) => {
      const one = groupOf(required(params, "AutoScalingGroupName"));
      if (params.LaunchTemplate) one.template = { id: params.LaunchTemplate.LaunchTemplateId, version: String(params.LaunchTemplate.Version) };
      for (const [field, key] of [["MinSize", "min"], ["MaxSize", "max"], ["DesiredCapacity", "desired"]]) if (params[field] !== undefined) one[key] = Number(params[field]);
      return {};
    },
    DeleteAutoScalingGroup: (params) => {
      const one = groupOf(required(params, "AutoScalingGroupName"));
      if (one.instances.some((instance) => instance.state !== "Terminated") && params.ForceDelete !== "true") throw fault(400, "ResourceInUse", "You cannot delete an AutoScalingGroup while there are instances still in the group.");
      one.status = "Delete in progress";
      return {};
    },
    CreateOrUpdateTags: (params) => {
      for (const tag of listOf(params.Tags, "member")) groupOf(tag.ResourceId).tags[tag.Key] = tag.Value ?? "";
      return {};
    },
    DescribeInstanceRefreshes: (params) => {
      const one = groupOf(required(params, "AutoScalingGroupName"));
      const shown = [...one.refreshes].reverse().slice(0, Number(params.MaxRecords ?? 50));
      return { InstanceRefreshes: members(shown.map((refresh) => ({ InstanceRefreshId: refresh.id, AutoScalingGroupName: one.name, Status: refresh.status, ...(refresh.reason ? { StatusReason: refresh.reason } : {}) }))) };
    },
    StartInstanceRefresh: (params) => {
      const one = groupOf(required(params, "AutoScalingGroupName"));
      if (one.refreshes.some((refresh) => ["Pending", "InProgress", "Cancelling"].includes(refresh.status))) throw fault(400, "InstanceRefreshInProgress", "An Instance Refresh is already in progress and blocks the execution of this Instance Refresh.");
      const desired = params.DesiredConfiguration?.LaunchTemplate;
      if (desired && !world.network.templateData(desired.LaunchTemplateId, desired.Version)) throw fault(400, "ValidationError", "The launch template version does not exist.");
      const max = Number(params.Preferences?.MaxHealthyPercentage ?? 100);
      if (max > 100 && Number(params.Preferences?.MinHealthyPercentage ?? 90) !== 100) throw fault(400, "ValidationError", "MaxHealthyPercentage above 100 needs MinHealthyPercentage of 100.");
      refreshSeq += 1;
      const refresh = { id: `${String(refreshSeq).padStart(8, "0")}-0000-4000-8000-000000000000`, status: "Pending", version: String(desired?.Version ?? one.template.version), reason: null };
      one.refreshes.push(refresh);
      return { InstanceRefreshId: refresh.id };
    },
    DescribeScalingActivities: (params) => {
      const one = groupOf(required(params, "AutoScalingGroupName"));
      const shown = [...one.activities].reverse().slice(0, Number(params.MaxRecords ?? 100));
      return { Activities: members(shown.map(({ instance, ...activity }) => ({ ...activity, AutoScalingGroupName: one.name }))) };
    }
  };

  /** Moves everything on one step: namespaces made, builds ended, deployments rolled out or back, machines and refreshes. */
  function advance() {
    for (const one of operations.values()) {
      if (one.status === "SUBMITTED") one.status = "PENDING";
      else if (one.status === "PENDING" && !one.namespace) {
        const id = `ns-${world.id("n").slice(2).padStart(16, "0")}`;
        namespaces.set(id, { id, arn: `arn:aws:servicediscovery:${world.region}:${world.account}:namespace/${id}`, name: one.name, type: "DNS_PRIVATE", vpc: one.vpc, tags: one.tags });
        Object.assign(one, { status: "SUCCESS", namespace: id });
      }
    }
    for (const build of builds.values()) if (build.buildStatus === "IN_PROGRESS") finishBuild(build);
    for (const one of services.values()) {
      if (one.status === "DRAINING") {
        one.status = "INACTIVE";
        continue;
      }
      const primary = one.deployments.find((deployment) => deployment.status === "PRIMARY");
      if (!primary) continue;
      if (primary.rolloutState === "COMPLETED") {
        primary.runningCount = one.desiredCount;
        continue;
      }
      if (primary.rolloutState !== "IN_PROGRESS") continue;
      // ECS takes a while to start a deployment's tasks: they start at one advance and run, or fail, at the next.
      if (!primary.started) {
        primary.started = true;
        continue;
      }
      const definition = taskDefinitions.get(primary.taskDefinition);
      const problem = startProblem(definition, definition.executionRoleArn);
      if (!problem) {
        Object.assign(primary, { runningCount: one.desiredCount, pendingCount: 0, rolloutState: "COMPLETED", rolloutStateReason: "ECS deployment completed.", updatedAt: at() });
        one.deployments = [primary];
        one.events.push({ id: world.id("e"), createdAt: at(), message: `(service ${one.name}) has reached a steady state.` });
        continue;
      }
      const before = one.deployments.find((deployment) => deployment !== primary && deployment.rolloutState === "COMPLETED");
      one.events.push({ id: world.id("e"), createdAt: at(), message: `(service ${one.name}) (deployment ${primary.id}) deployment failed: tasks failed to start. ${problem}` });
      if (before && one.deploymentConfiguration?.deploymentCircuitBreaker?.rollback) {
        one.events.push({ id: world.id("e"), createdAt: at(), message: `(service ${one.name}) rolling back to deployment ${before.id}.` });
        one.deployments = [];
        newDeployment(one, before.taskDefinition);
        Object.assign(one.deployments[0], { runningCount: one.desiredCount, pendingCount: 0, rolloutState: "COMPLETED", rolloutStateReason: "ECS deployment rolled back." });
      } else {
        Object.assign(primary, { rolloutState: "FAILED", rolloutStateReason: `ECS deployment circuit breaker: tasks failed to start. ${problem}`, runningCount: 0 });
      }
    }
    for (const one of [...groups.values()]) {
      if (one.status) {
        groups.delete(one.name);
        continue;
      }
      const refresh = one.refreshes.find((each) => ["Pending", "InProgress"].includes(each.status));
      if (refresh?.status === "Pending") {
        refresh.status = "InProgress";
        refresh.started = one.instances.filter((instance) => instance.state !== "Terminated" && instance.version !== refresh.version).map(() => launch(one, refresh.version));
        continue;
      }
      for (const instance of one.instances.filter((each) => each.state === "Pending:Wait")) {
        if (instance.booting) {
          instance.booting = false;
          continue;
        }
        const problem = machineProblem(one, instance.version);
        const activity = one.activities.find((each) => each.instance === instance.id);
        if (problem) {
          instance.state = "Terminated";
          Object.assign(activity, { StatusCode: "Cancelled", StatusMessage: `Instance failed to complete user's Lifecycle Action: Lifecycle Action with token was abandoned: ${problem}` });
        } else {
          instance.state = "InService";
          Object.assign(activity, { StatusCode: "Successful" });
        }
      }
      if (refresh?.status === "InProgress") {
        if (refresh.started.some((instance) => instance.state === "Terminated")) {
          Object.assign(refresh, { status: "Failed", reason: "An instance failed to complete its lifecycle action, so the instance refresh failed." });
          for (const instance of refresh.started) instance.state = "Terminated";
        } else if (refresh.started.every((instance) => instance.state === "InService")) {
          for (const instance of one.instances) if (instance.version !== refresh.version) instance.state = "Terminated";
          one.template = { ...one.template, version: refresh.version };
          refresh.status = "Successful";
        }
        continue;
      }
      const live = one.instances.filter((instance) => instance.state !== "Terminated");
      for (let count = live.length; count < one.desired; count += 1) launch(one, one.template.version);
      for (const instance of live.slice(one.desired)) instance.state = "Terminated";
    }
  }

  return {
    ecs,
    ecr,
    codebuild,
    servicediscovery,
    autoscaling,
    advance,
    view: () => ({
      clusters: [...clusters.values()], taskDefinitions: [...taskDefinitions.values()], services: [...services.values()], repositories: [...repositories.values()].map(({ images, ...one }) => ({ ...one, tags: tagsObject(one.tags), images: [...images.keys()] })),
      projects: [...projects.values()], builds: [...builds.values()], namespaces: [...namespaces.values()], names: [...names.values()], scalingGroups: [...groups.values()]
    })
  };
}

export { createStandInCompute };

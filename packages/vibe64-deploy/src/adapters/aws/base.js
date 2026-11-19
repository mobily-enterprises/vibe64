// The parts a deployment's services and resources share at AWS, made once, found again by name and tags, each step
// idempotent so a Deploy cut short makes the rest next time:
//
//   - its network: a VPC of its own (VPC_CIDR) with DNS names, an internet gateway, two subnets in two zones with a
//     route out through the gateway, and VPC endpoints for S3 (a gateway endpoint, free) and ECR (its API and its image
//     registry), so images and files travel inside AWS. There is no NAT gateway: a service reaches the internet through
//     a public address of its own, and its security group lets nothing in but its load balancer and the services that
//     reach it;
//   - two security groups: the endpoints' (HTTPS from the VPC) and the load balancer's (HTTP and HTTPS from anywhere);
//   - its private names (a Cloud Map private DNS namespace), its ECS cluster and its log group (30 days);
//   - three roles under /vibe64/: the tasks' execution role (pull this deployment's images, write its logs), the
//     build's (read its releases, push its images) and the machines' (the same as the tasks', register in its private
//     names, say a machine is ready), with the machines' instance profile; the execution and machine roles read the
//     deployment's secrets alone (allowSecrets);
//   - its releases bucket and its image build (CodeBuild), which builds each service's upload with the Containerfile it
//     carries (image.js) and pushes it to the deployment's ECR. The build holds no credential of Vibe64's: its role is
//     the account's own.
//
// A part found under its name that isn't tagged as this deployment's is refused, never changed.
import { createHash } from "node:crypto";

import { AwsError } from "./client.js";
import { SUBNETS, VPC_CIDR, adapterError, keyValueTags, lowerTags, tagSpecification, tagsOf } from "./context.js";
import { asList, escapeText } from "./xml.js";

const LOG_RETENTION_DAYS = 30;
const ROLE_PATH = "/vibe64/";
const SECRETS_POLICY = "vibe64-secrets";
const BUILD_IMAGE = "aws/codebuild/amazonlinux-x86_64-standard:5.0";
// The build: the release's folder (its upload, release.tar.gz) unpacked, its Containerfile built and pushed as the
// image the build is given.
const BUILDSPEC = [
  "version: 0.2",
  "phases:",
  "  pre_build:",
  "    commands:",
  "      - aws ecr get-login-password --region \"$AWS_REGION\" | docker login --username AWS --password-stdin \"${IMAGE_URI%%/*}\"",
  "      - mkdir -p /tmp/release && tar -xzf release.tar.gz -C /tmp/release",
  "  build:",
  "    commands:",
  "      - cd /tmp/release && docker build --file vibe64-app/Containerfile --tag \"$IMAGE_URI\" .",
  "      - docker push \"$IMAGE_URI\"",
  ""
].join("\n");
const S3_NAMESPACE = "http://s3.amazonaws.com/doc/2006-03-01/";

const ec2Tag = (key, value) => ({ Name: `tag:${key}`, Value: [value] });

/** The answer, or `fallback` when AWS refused it with one of these codes (a thing already there or already gone). */
async function unless(codes, call, fallback = null) {
  try {
    return await call();
  } catch (error) {
    if (error instanceof AwsError && codes.includes(error.code)) return fallback;
    throw error;
  }
}

/**
 * A call naming a role IAM made moments ago, which AWS's other services may not see yet (IAM is eventually
 * consistent): their refusal to assume it is tried again at the next step.
 */
async function freshRole(call) {
  try {
    return await call();
  } catch (error) {
    if (error instanceof AwsError && error.code === "InvalidInputException" && /AssumeRole/u.test(error.message)) {
      throw adapterError("aws_role_propagating", "Waiting for AWS to see the deployment's new roles.", true);
    }
    throw error;
  }
}

/** The refusal of a thing found under this deployment's name that isn't its own. */
function notOurs(what, name) {
  return adapterError("aws_not_ours", `${what} ${name} is in this AWS account but isn't tagged as this deployment's, so Vibe64 leaves it alone. Remove or rename it at AWS, then deploy to production again.`);
}

/** A trust policy for an AWS service. @param {string} service */
function trustOf(service) {
  return JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: service }, Action: "sts:AssumeRole" }] });
}

/** An IAM role under /vibe64/ with its one inline policy, made once; its name and ARN. */
async function ensureRole(ctx, part, service, statements) {
  const name = ctx.nameOf(part, 64);
  let role = (await unless(["NoSuchEntity"], () => ctx.client.query("iam", "GetRole", { RoleName: name })))?.Role;
  if (role && !ctx.isOwn(asList(role.Tags?.member))) throw notOurs("The IAM role", name);
  if (!role) {
    role = (await ctx.client.query("iam", "CreateRole", {
      RoleName: name, Path: ROLE_PATH, AssumeRolePolicyDocument: trustOf(service), "Tags.member": keyValueTags(ctx.tagsFor(`base.${part}`))
    })).Role;
  }
  await ctx.client.query("iam", "PutRolePolicy", { RoleName: name, PolicyName: "vibe64", PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: statements }) });
  return { name, arn: role.Arn };
}

/**
 * The deployment's security group of this name in its VPC, made once, with these ingress rules added; its id.
 * @param {any} ctx @param {string} vpcId @param {string} part @param {string} description @param {any[]} permissions
 */
async function ensureSecurityGroup(ctx, vpcId, part, description, permissions = []) {
  const name = ctx.nameOf(part, 255);
  const found = asList((await ctx.client.query("ec2", "DescribeSecurityGroups", {
    Filter: [{ Name: "vpc-id", Value: [vpcId] }, { Name: "group-name", Value: [name] }]
  })).securityGroupInfo?.item)[0];
  const groupId = found?.groupId ?? (await ctx.client.query("ec2", "CreateSecurityGroup", {
    GroupName: name, GroupDescription: description, VpcId: vpcId, TagSpecification: tagSpecification("security-group", ctx.tagsFor(`base.${part}`))
  })).groupId;
  for (const permission of permissions) {
    await unless(["InvalidPermission.Duplicate"], () => ctx.client.query("ec2", "AuthorizeSecurityGroupIngress", { GroupId: groupId, IpPermissions: [permission] }));
  }
  return groupId;
}

/** The deployment's network: its VPC, gateway, subnets, routes, endpoints and the two shared security groups. */
async function ensureNetwork(ctx) {
  const { client, region } = ctx;
  const { id } = ctx.own();
  const mine = (part) => [ec2Tag("vibe64-deployment", id), ec2Tag("vibe64-item", `base.${part}`)];
  let vpcId = asList((await client.query("ec2", "DescribeVpcs", { Filter: mine("network") })).vpcSet?.item)[0]?.vpcId;
  if (!vpcId) {
    vpcId = (await client.query("ec2", "CreateVpc", { CidrBlock: VPC_CIDR, TagSpecification: tagSpecification("vpc", ctx.tagsFor("base.network")) })).vpc.vpcId;
  }
  // Interface endpoints and private names answer only in a VPC with DNS host names (one attribute a request).
  await client.query("ec2", "ModifyVpcAttribute", { VpcId: vpcId, "EnableDnsHostnames.Value": true });

  let gateway = asList((await client.query("ec2", "DescribeInternetGateways", { Filter: mine("gateway") })).internetGatewaySet?.item)[0];
  if (!gateway) {
    gateway = (await client.query("ec2", "CreateInternetGateway", { TagSpecification: tagSpecification("internet-gateway", ctx.tagsFor("base.gateway")) })).internetGateway;
  }
  if (!asList(gateway.attachmentSet?.item).some((one) => one.vpcId === vpcId)) {
    await unless(["Resource.AlreadyAssociated"], () => client.query("ec2", "AttachInternetGateway", { InternetGatewayId: gateway.internetGatewayId, VpcId: vpcId }));
  }

  const zones = asList((await client.query("ec2", "DescribeAvailabilityZones", {
    Filter: [{ Name: "zone-type", Value: ["availability-zone"] }, { Name: "state", Value: ["available"] }]
  })).availabilityZoneInfo?.item).map((zone) => zone.zoneName).sort();
  if (zones.length < 2) throw adapterError("aws_zones_unavailable", `${region} has fewer than two availability zones open to this account; deploy in another region.`);
  const existing = asList((await client.query("ec2", "DescribeSubnets", { Filter: [{ Name: "vpc-id", Value: [vpcId] }] })).subnetSet?.item);
  const subnets = [];
  for (const [index, { part, cidr }] of SUBNETS.entries()) {
    const found = existing.find((one) => one.cidrBlock === cidr);
    subnets.push(found?.subnetId ?? (await client.query("ec2", "CreateSubnet", {
      VpcId: vpcId, CidrBlock: cidr, AvailabilityZone: zones[index], TagSpecification: tagSpecification("subnet", ctx.tagsFor(`base.${part}`))
    })).subnet.subnetId);
  }

  let routes = asList((await client.query("ec2", "DescribeRouteTables", { Filter: mine("routes") })).routeTableSet?.item)[0];
  if (!routes) {
    routes = (await client.query("ec2", "CreateRouteTable", { VpcId: vpcId, TagSpecification: tagSpecification("route-table", ctx.tagsFor("base.routes")) })).routeTable;
  }
  if (!asList(routes.routeSet?.item).some((route) => route.destinationCidrBlock === "0.0.0.0/0")) {
    await unless(["RouteAlreadyExists"], () => client.query("ec2", "CreateRoute", { RouteTableId: routes.routeTableId, DestinationCidrBlock: "0.0.0.0/0", GatewayId: gateway.internetGatewayId }));
  }
  const associated = new Set(asList(routes.associationSet?.item).map((one) => one.subnetId));
  for (const subnetId of subnets.filter((one) => !associated.has(one))) {
    await unless(["Resource.AlreadyAssociated"], () => client.query("ec2", "AssociateRouteTable", { RouteTableId: routes.routeTableId, SubnetId: subnetId }));
  }

  const endpointsGroup = await ensureSecurityGroup(ctx, vpcId, "endpoints", "Vibe64: the VPC endpoints, reached over HTTPS from the VPC",
    [{ IpProtocol: "tcp", FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: VPC_CIDR }] }]);
  const balancerGroup = await ensureSecurityGroup(ctx, vpcId, "balancer", "Vibe64: the load balancer, reached over HTTP and HTTPS",
    [80, 443].map((port) => ({ IpProtocol: "tcp", FromPort: port, ToPort: port, IpRanges: [{ CidrIp: "0.0.0.0/0" }] })));

  const endpoints = asList((await client.query("ec2", "DescribeVpcEndpoints", { Filter: [{ Name: "vpc-id", Value: [vpcId] }] })).vpcEndpointSet?.item)
    .filter((one) => !["deleting", "deleted"].includes(String(one.state).toLowerCase()));
  const wanted = [
    { ServiceName: `com.amazonaws.${region}.s3`, VpcEndpointType: "Gateway", RouteTableId: [routes.routeTableId] },
    { ServiceName: `com.amazonaws.${region}.ecr.api`, VpcEndpointType: "Interface", SubnetId: subnets, SecurityGroupId: [endpointsGroup], PrivateDnsEnabled: true },
    { ServiceName: `com.amazonaws.${region}.ecr.dkr`, VpcEndpointType: "Interface", SubnetId: subnets, SecurityGroupId: [endpointsGroup], PrivateDnsEnabled: true }
  ];
  for (const endpoint of wanted.filter((one) => !endpoints.some((made) => made.serviceName === one.ServiceName))) {
    await client.query("ec2", "CreateVpcEndpoint", { VpcId: vpcId, ...endpoint, TagSpecification: tagSpecification("vpc-endpoint", ctx.tagsFor("base.endpoints")) });
  }
  return { vpcId, subnets, balancerGroup };
}

/** The deployment's private DNS namespace, made once and waited for; its id and name. */
async function ensureNamespace(ctx, vpcId) {
  const name = `${ctx.nameOf("names")}.internal`;
  const listed = await ctx.client.json("servicediscovery", "ListNamespaces", { Filters: [{ Name: "TYPE", Values: ["DNS_PRIVATE"], Condition: "EQ" }] });
  const found = asList(listed.Namespaces).find((one) => one.Name === name);
  if (found) return { id: found.Id, name };
  const { OperationId } = await ctx.client.json("servicediscovery", "CreatePrivateDnsNamespace", {
    Name: name, Vpc: vpcId, CreatorRequestId: `${ctx.own().id}-names`, Description: "Vibe64: the deployment's private names", Tags: keyValueTags(ctx.tagsFor("base.names"))
  });
  const { Operation } = await ctx.client.json("servicediscovery", "GetOperation", { OperationId });
  if (Operation.Status === "SUCCESS") return { id: Operation.Targets.NAMESPACE, name };
  if (Operation.Status === "FAIL") throw adapterError("aws_names_failed", `AWS could not make the deployment's private names: ${Operation.ErrorMessage ?? Operation.ErrorCode}`);
  throw adapterError("aws_names_pending", "AWS is still making the deployment's private names.", true);
}

/** An S3 request body's Content-MD5, which S3 asks of a bucket's settings. @param {string} body */
function md5Of(body) {
  return createHash("md5").update(body).digest("base64");
}

/** A bucket's tags as a plain object, or null when it has none. */
async function bucketTags(client, bucket) {
  const answer = await unless(["NoSuchTagSet"], () => client.s3("GET", bucket, "", { query: { tagging: "" } }));
  return answer ? tagsOf(asList(answer.xml?.TagSet?.Tag)) : null;
}

/**
 * A private bucket of this deployment in the region, made or found: every public access blocked, tagged. One under
 * the name that is someone else's, or this account's but not this deployment's, is refused.
 */
async function ensureBucket(ctx, name, tags) {
  const { client, region } = ctx;
  try {
    await client.s3("PUT", name, "", {
      body: region === "us-east-1" ? undefined : `<CreateBucketConfiguration xmlns="${S3_NAMESPACE}"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`
    });
  } catch (error) {
    if (error?.code === "BucketAlreadyExists") throw adapterError("aws_name_taken", `The S3 bucket name ${name} is another AWS account's, so Vibe64 can't make it.`);
    if (error?.code !== "BucketAlreadyOwnedByYou") throw error;
    if (!ctx.isOwn(await bucketTags(client, name))) throw notOurs("The S3 bucket", name);
  }
  const block = `<PublicAccessBlockConfiguration xmlns="${S3_NAMESPACE}"><BlockPublicAcls>true</BlockPublicAcls>`
    + "<IgnorePublicAcls>true</IgnorePublicAcls><BlockPublicPolicy>true</BlockPublicPolicy><RestrictPublicBuckets>true</RestrictPublicBuckets></PublicAccessBlockConfiguration>";
  await client.s3("PUT", name, "", { query: { publicAccessBlock: "" }, body: block, md5: md5Of(block) });
  const tagging = `<Tagging xmlns="${S3_NAMESPACE}"><TagSet>${Object.entries(tags)
    .map(([key, value]) => `<Tag><Key>${escapeText(key)}</Key><Value>${escapeText(value)}</Value></Tag>`).join("")}</TagSet></Tagging>`;
  await client.s3("PUT", name, "", { query: { tagging: "" }, body: tagging, md5: md5Of(tagging) });
}

/**
 * The shared parts, made or found: `{ vpcId, subnets, balancerGroup, namespace, cluster, logGroup, bucket, project,
 * repositoryPrefix, roles }`. Kept once complete.
 * @param {ReturnType<typeof import("./context.js").createContext>} ctx
 */
async function ensureBase(ctx) {
  if (ctx.cache.base) return ctx.cache.base;
  const { client, region } = ctx;
  const { app, environment } = ctx.own();
  const network = await ensureNetwork(ctx);
  const namespace = await ensureNamespace(ctx, network.vpcId);

  const clusterName = ctx.nameOf("cluster", 255);
  const known = asList((await client.json("ecs", "DescribeClusters", { clusters: [clusterName], include: ["TAGS"] })).clusters).find((one) => one.status !== "INACTIVE");
  if (known && !ctx.isOwn(known.tags)) throw notOurs("The ECS cluster", clusterName);
  const cluster = known?.clusterArn ?? (await client.json("ecs", "CreateCluster", {
    clusterName, tags: lowerTags(ctx.tagsFor("base.cluster")), settings: [{ name: "containerInsights", value: "disabled" }]
  })).cluster.clusterArn;

  const logGroup = `/vibe64/${app}/${environment}/${ctx.short}`;
  await unless(["ResourceAlreadyExistsException"], () => client.json("logs", "CreateLogGroup", { logGroupName: logGroup, tags: ctx.tagsFor("base.logs") }));
  await client.json("logs", "PutRetentionPolicy", { logGroupName: logGroup, retentionInDays: LOG_RETENTION_DAYS });

  const bucket = ctx.nameOf("releases");
  const repositoryPrefix = ctx.nameOf("images", 200);
  const repositories = `arn:aws:ecr:${region}:*:repository/${repositoryPrefix}/*`;
  const logs = `arn:aws:logs:${region}:*:log-group:${logGroup}:*`;
  const pull = [
    { Effect: "Allow", Action: "ecr:GetAuthorizationToken", Resource: "*" },
    { Effect: "Allow", Action: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource: repositories },
    { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: logs }
  ];
  const execution = await ensureRole(ctx, "execution", "ecs-tasks.amazonaws.com", pull);
  const build = await ensureRole(ctx, "build", "codebuild.amazonaws.com", [
    { Effect: "Allow", Action: ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket", "s3:GetBucketLocation"], Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`] },
    { Effect: "Allow", Action: "ecr:GetAuthorizationToken", Resource: "*" },
    {
      Effect: "Allow",
      Action: ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage"],
      Resource: repositories
    },
    { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: logs }
  ]);
  const machine = await ensureRole(ctx, "machine", "ec2.amazonaws.com", [
    ...pull,
    { Effect: "Allow", Action: ["servicediscovery:RegisterInstance", "servicediscovery:DeregisterInstance"], Resource: `arn:aws:servicediscovery:${region}:*:service/*` },
    { Effect: "Allow", Action: ["route53:ChangeResourceRecordSets", "route53:GetHealthCheck", "route53:CreateHealthCheck", "route53:UpdateHealthCheck", "route53:DeleteHealthCheck", "ec2:DescribeInstances"], Resource: "*" },
    { Effect: "Allow", Action: "autoscaling:CompleteLifecycleAction", Resource: `arn:aws:autoscaling:${region}:*:autoScalingGroup:*:autoScalingGroupName/${ctx.nameOf("")}*` },
    { Effect: "Allow", Action: "s3:GetObject", Resource: `arn:aws:s3:::${bucket}/specs/*` }
  ]);
  const profile = (await unless(["NoSuchEntity"], () => client.query("iam", "GetInstanceProfile", { InstanceProfileName: machine.name })))?.InstanceProfile
    ?? (await client.query("iam", "CreateInstanceProfile", { InstanceProfileName: machine.name, Path: ROLE_PATH, "Tags.member": keyValueTags(ctx.tagsFor("base.machine")) })).InstanceProfile;
  if (!asList(profile.Roles?.member).some((role) => role.RoleName === machine.name)) {
    await client.query("iam", "AddRoleToInstanceProfile", { InstanceProfileName: machine.name, RoleName: machine.name });
  }
  const roles = { execution: execution.arn, executionName: execution.name, machine: machine.arn, machineName: machine.name, instanceProfile: profile.Arn };
  await allowSecrets(ctx, roles, []);

  await ensureBucket(ctx, bucket, ctx.tagsFor("base.releases"));
  const project = ctx.nameOf("image", 150);
  const projects = asList((await client.json("codebuild", "BatchGetProjects", { names: [project] })).projects);
  if (projects.length > 0 && !ctx.isOwn(projects[0].tags)) throw notOurs("The CodeBuild project", project);
  if (projects.length === 0) {
    await freshRole(() => client.json("codebuild", "CreateProject", {
      name: project,
      description: "Vibe64: builds each service's image from its release",
      source: { type: "S3", location: `${bucket}/releases/`, buildspec: BUILDSPEC },
      artifacts: { type: "NO_ARTIFACTS" },
      environment: { type: "LINUX_CONTAINER", image: BUILD_IMAGE, computeType: "BUILD_GENERAL1_MEDIUM", privilegedMode: true },
      serviceRole: build.arn,
      timeoutInMinutes: 60,
      logsConfig: { cloudWatchLogs: { status: "ENABLED", groupName: logGroup, streamName: "build" } },
      tags: lowerTags(ctx.tagsFor("base.build"))
    }));
  }
  ctx.cache.base = { ...network, namespace, cluster, logGroup, bucket, project, repositoryPrefix, roles };
  return ctx.cache.base;
}

/**
 * The deployment's secrets the tasks and machines may read: its own (vibe64/<deployment>/…) and the databases'
 * credentials RDS keeps, each named; added to, never a wildcard over the account's.
 * @param {any} ctx @param {{ executionName: string, machineName: string }} roles @param {string[]} arns
 */
async function allowSecrets(ctx, roles, arns) {
  const own = `arn:aws:secretsmanager:${ctx.region}:*:secret:vibe64/${ctx.own().id}/*`;
  for (const role of [roles.executionName, roles.machineName]) {
    const kept = await unless(["NoSuchEntity"], () => ctx.client.query("iam", "GetRolePolicy", { RoleName: role, PolicyName: SECRETS_POLICY }));
    const before = kept ? JSON.parse(decodeURIComponent(kept.PolicyDocument)).Statement[0].Resource : [];
    const resources = [...new Set([own, ...asList(before), ...arns])].sort();
    if (kept && resources.length === asList(before).length) continue;
    await ctx.client.query("iam", "PutRolePolicy", {
      RoleName: role, PolicyName: SECRETS_POLICY,
      PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "secretsmanager:GetSecretValue", Resource: resources }] })
    });
  }
}

export { BUILDSPEC, allowSecrets, bucketTags, ensureBase, ensureBucket, ensureSecurityGroup, md5Of, notOurs, unless };

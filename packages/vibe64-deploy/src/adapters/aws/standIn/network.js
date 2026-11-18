// The stand-in's network: EC2's VPCs, internet gateways, subnets, route tables, security groups and their rules, VPC
// endpoints, availability zones, NAT gateways and launch templates (EC2's Query API, its answers in lowerCamel
// elements with lists of <item>), and Elastic Load Balancing's load balancers, listeners and target groups (its Query
// API, lists of <member>). A listener on HTTPS takes only an issued certificate of the account's.
import { fault, listOf, required, tagsOfList } from "./wire.js";

const tagSet = (tags) => ({ item: Object.entries(tags).map(([key, value]) => ({ key, value })) });
const tagsOfSpecification = (params, type) => tagsOfList(listOf(params.TagSpecification).filter((one) => one.ResourceType === type).flatMap((one) => listOf(one.Tag)));
const members = (items) => ({ member: items });

/** Whether a thing passes EC2's filters: each filter's values, any of them, against the thing's values for its name. */
function passes(params, valuesOf) {
  return listOf(params.Filter).every((filter) => {
    const wanted = listOf(filter.Value);
    const name = String(filter.Name);
    const have = name.startsWith("tag:") ? [valuesOf.tags?.()[name.slice(4)]] : valuesOf[name]?.() ?? [];
    return have.some((value) => value !== undefined && wanted.includes(String(value)));
  });
}

/** @param {any} world */
function createStandInNetwork(world) {
  const vpcs = new Map();
  const gateways = new Map();
  const subnets = new Map();
  const routeTables = new Map();
  const groups = new Map();
  const endpoints = new Map();
  const natGateways = new Map();
  const templates = new Map();
  const balancers = new Map();
  const listeners = new Map();
  const targetGroups = new Map();
  const zones = ["a", "b", "c"].map((letter) => `${world.region}${letter}`);

  const vpcOf = (id) => vpcs.get(id) ?? (() => {
    throw fault(400, "InvalidVpcID.NotFound", `The vpc ID '${id}' does not exist`);
  })();
  const groupOf = (id) => groups.get(id) ?? (() => {
    throw fault(400, "InvalidGroup.NotFound", `The security group '${id}' does not exist`);
  })();

  /** A security group's rules as EC2 lists them: one entry per protocol and ports, its sources inside. */
  function permissionsOf(rules) {
    const byPorts = new Map();
    for (const rule of rules) {
      const key = `${rule.protocol}|${rule.from}|${rule.to}`;
      if (!byPorts.has(key)) byPorts.set(key, { ipProtocol: rule.protocol, fromPort: rule.from, toPort: rule.to, groups: { item: [] }, ipRanges: { item: [] } });
      if (rule.group) byPorts.get(key).groups.item.push({ userId: world.account, groupId: rule.group });
      if (rule.cidr) byPorts.get(key).ipRanges.item.push({ cidrIp: rule.cidr });
    }
    return { item: [...byPorts.values()] };
  }

  /** The rules a form's IpPermissions name, one per source. */
  function rulesOf(params) {
    return listOf(params.IpPermissions).flatMap((permission) => {
      const base = { protocol: String(permission.IpProtocol), from: Number(permission.FromPort), to: Number(permission.ToPort) };
      return [
        ...listOf(permission.Groups).map((one) => ({ ...base, group: groupOf(String(one.GroupId)).id })),
        ...listOf(permission.IpRanges).map((one) => ({ ...base, cidr: String(one.CidrIp) }))
      ];
    });
  }
  const sameRule = (one, other) => one.protocol === other.protocol && one.from === other.from && one.to === other.to && one.group === other.group && one.cidr === other.cidr;

  const templateView = (template) => ({
    launchTemplateId: template.id, launchTemplateName: template.name, defaultVersionNumber: 1, latestVersionNumber: template.versions.length, tagSet: tagSet(template.tags)
  });
  const dataView = (data) => ({
    imageId: data.ImageId, instanceType: data.InstanceType, userData: data.UserData,
    ...(data.IamInstanceProfile ? { iamInstanceProfile: { arn: data.IamInstanceProfile.Arn } } : {}),
    ...(data.MetadataOptions ? { metadataOptions: { httpTokens: data.MetadataOptions.HttpTokens } } : {})
  });

  const ec2 = {
    DescribeAvailabilityZones: () => ({ availabilityZoneInfo: { item: zones.map((zoneName) => ({ zoneName, zoneState: "available", regionName: world.region, zoneType: "availability-zone" })) } }),
    DescribeVpcs: (params) => ({
      vpcSet: { item: [...vpcs.values()].filter((vpc) => passes(params, { tags: () => vpc.tags, "vpc-id": () => [vpc.id] }))
        .map((vpc) => ({ vpcId: vpc.id, state: "available", cidrBlock: vpc.cidr, tagSet: tagSet(vpc.tags) })) }
    }),
    CreateVpc: (params) => {
      const vpc = { id: world.id("vpc"), cidr: required(params, "CidrBlock"), tags: tagsOfSpecification(params, "vpc"), dnsHostnames: false };
      vpcs.set(vpc.id, vpc);
      return { vpc: { vpcId: vpc.id, state: "pending", cidrBlock: vpc.cidr, tagSet: tagSet(vpc.tags) } };
    },
    ModifyVpcAttribute: (params) => {
      const vpc = vpcOf(required(params, "VpcId"));
      const set = ["EnableDnsHostnames", "EnableDnsSupport"].filter((name) => params[name]?.Value !== undefined);
      if (set.length !== 1) throw fault(400, "InvalidParameterCombination", "Exactly one attribute may be modified at a time.");
      if (params.EnableDnsHostnames) vpc.dnsHostnames = params.EnableDnsHostnames.Value === "true";
      return { return: true };
    },
    DescribeInternetGateways: (params) => ({
      internetGatewaySet: { item: [...gateways.values()].filter((one) => passes(params, { tags: () => one.tags }))
        .map((one) => ({ internetGatewayId: one.id, attachmentSet: { item: one.vpc ? [{ vpcId: one.vpc, state: "available" }] : [] }, tagSet: tagSet(one.tags) })) }
    }),
    CreateInternetGateway: (params) => {
      const one = { id: world.id("igw"), vpc: null, tags: tagsOfSpecification(params, "internet-gateway") };
      gateways.set(one.id, one);
      return { internetGateway: { internetGatewayId: one.id, attachmentSet: { item: [] }, tagSet: tagSet(one.tags) } };
    },
    AttachInternetGateway: (params) => {
      const one = gateways.get(params.InternetGatewayId);
      vpcOf(params.VpcId);
      if (one.vpc) throw fault(400, "Resource.AlreadyAssociated", `resource ${one.id} is already attached to network ${one.vpc}`);
      one.vpc = params.VpcId;
      return { return: true };
    },
    DescribeSubnets: (params) => ({
      subnetSet: { item: [...subnets.values()].filter((one) => passes(params, { tags: () => one.tags, "vpc-id": () => [one.vpc] }))
        .map((one) => ({ subnetId: one.id, vpcId: one.vpc, cidrBlock: one.cidr, availabilityZone: one.zone, state: "available", tagSet: tagSet(one.tags) })) }
    }),
    CreateSubnet: (params) => {
      vpcOf(required(params, "VpcId"));
      if (!zones.includes(params.AvailabilityZone)) throw fault(400, "InvalidParameterValue", `Value (${params.AvailabilityZone}) for parameter availabilityZone is invalid.`);
      if ([...subnets.values()].some((one) => one.vpc === params.VpcId && one.cidr === params.CidrBlock)) throw fault(400, "InvalidSubnet.Conflict", `The CIDR '${params.CidrBlock}' conflicts with another subnet`);
      const one = { id: world.id("subnet"), vpc: params.VpcId, cidr: required(params, "CidrBlock"), zone: params.AvailabilityZone, tags: tagsOfSpecification(params, "subnet") };
      subnets.set(one.id, one);
      return { subnet: { subnetId: one.id, vpcId: one.vpc, cidrBlock: one.cidr, availabilityZone: one.zone, state: "available" } };
    },
    DescribeRouteTables: (params) => ({
      routeTableSet: { item: [...routeTables.values()].filter((one) => passes(params, { tags: () => one.tags, "vpc-id": () => [one.vpc] })).map((one) => ({
        routeTableId: one.id, vpcId: one.vpc, routeSet: { item: one.routes.map((route) => ({ destinationCidrBlock: route.cidr, gatewayId: route.gateway, state: "active" })) },
        associationSet: { item: one.subnets.map((subnetId, index) => ({ routeTableAssociationId: `rtbassoc-${one.id.slice(4)}${index}`, routeTableId: one.id, subnetId, main: false })) },
        tagSet: tagSet(one.tags)
      })) }
    }),
    CreateRouteTable: (params) => {
      vpcOf(required(params, "VpcId"));
      const one = { id: world.id("rtb"), vpc: params.VpcId, routes: [{ cidr: vpcs.get(params.VpcId).cidr, gateway: "local" }], subnets: [], tags: tagsOfSpecification(params, "route-table") };
      routeTables.set(one.id, one);
      return { routeTable: { routeTableId: one.id, vpcId: one.vpc, routeSet: { item: [] }, associationSet: { item: [] }, tagSet: tagSet(one.tags) } };
    },
    CreateRoute: (params) => {
      const one = routeTables.get(params.RouteTableId);
      if (one.routes.some((route) => route.cidr === params.DestinationCidrBlock)) throw fault(400, "RouteAlreadyExists", "The route identified by 0.0.0.0/0 already exists.");
      const gateway = gateways.get(params.GatewayId) ?? natGateways.get(params.NatGatewayId);
      if (!gateway) throw fault(400, "InvalidGatewayID.NotFound", "The gateway ID does not exist");
      one.routes.push({ cidr: params.DestinationCidrBlock, gateway: gateway.id });
      return { return: true };
    },
    AssociateRouteTable: (params) => {
      const one = routeTables.get(params.RouteTableId);
      if ([...routeTables.values()].some((table) => table.subnets.includes(params.SubnetId))) throw fault(400, "Resource.AlreadyAssociated", `the specified association for route table ${one.id} conflicts with an existing association`);
      one.subnets.push(params.SubnetId);
      return { associationId: `rtbassoc-${one.id.slice(4)}${one.subnets.length}` };
    },
    DescribeSecurityGroups: (params) => ({
      securityGroupInfo: { item: [...groups.values()].filter((one) => passes(params, {
        tags: () => one.tags, "vpc-id": () => [one.vpc], "group-name": () => [one.name], "group-id": () => [one.id], "ip-permission.group-id": () => one.rules.map((rule) => rule.group)
      })).map((one) => ({
        ownerId: world.account, groupId: one.id, groupName: one.name, groupDescription: one.description, vpcId: one.vpc, ipPermissions: permissionsOf(one.rules), tagSet: tagSet(one.tags)
      })) }
    }),
    CreateSecurityGroup: (params) => {
      vpcOf(required(params, "VpcId"));
      const name = required(params, "GroupName");
      if ([...groups.values()].some((one) => one.vpc === params.VpcId && one.name === name)) throw fault(400, "InvalidGroup.Duplicate", `The security group '${name}' already exists for VPC '${params.VpcId}'`);
      const one = { id: world.id("sg"), name, description: required(params, "GroupDescription"), vpc: params.VpcId, rules: [], tags: tagsOfSpecification(params, "security-group") };
      groups.set(one.id, one);
      return { groupId: one.id, tagSet: tagSet(one.tags) };
    },
    AuthorizeSecurityGroupIngress: (params) => {
      const one = groupOf(required(params, "GroupId"));
      const rules = rulesOf(params);
      if (rules.some((rule) => one.rules.some((have) => sameRule(have, rule)))) throw fault(400, "InvalidPermission.Duplicate", "the specified rule already exists");
      one.rules.push(...rules);
      return { return: true };
    },
    RevokeSecurityGroupIngress: (params) => {
      const one = groupOf(required(params, "GroupId"));
      const rules = rulesOf(params);
      if (!rules.every((rule) => one.rules.some((have) => sameRule(have, rule)))) throw fault(400, "InvalidPermission.NotFound", "The specified rule does not exist in this security group.");
      one.rules = one.rules.filter((have) => !rules.some((rule) => sameRule(have, rule)));
      return { return: true };
    },
    DescribeVpcEndpoints: (params) => ({
      vpcEndpointSet: { item: [...endpoints.values()].filter((one) => passes(params, { tags: () => one.tags, "vpc-id": () => [one.vpc] }))
        .map((one) => ({ vpcEndpointId: one.id, vpcEndpointType: one.type, vpcId: one.vpc, serviceName: one.service, state: "available", tagSet: tagSet(one.tags) })) }
    }),
    CreateVpcEndpoint: (params) => {
      vpcOf(required(params, "VpcId"));
      const service = required(params, "ServiceName");
      if (!new RegExp(`^com\\.amazonaws\\.${world.region}\\.(s3|ecr\\.api|ecr\\.dkr|logs|secretsmanager)$`, "u").test(service)) {
        throw fault(400, "InvalidServiceName", `The Vpc Endpoint Service '${service}' does not exist`);
      }
      const type = params.VpcEndpointType ?? "Gateway";
      if (type === "Interface" && listOf(params.SubnetId).length === 0) throw fault(400, "InvalidParameter", "Subnets are required for an Interface endpoint.");
      const one = { id: world.id("vpce"), vpc: params.VpcId, service, type, tags: tagsOfSpecification(params, "vpc-endpoint") };
      endpoints.set(one.id, one);
      return { vpcEndpoint: { vpcEndpointId: one.id, vpcEndpointType: type, vpcId: one.vpc, serviceName: service, state: "pending" } };
    },
    CreateNatGateway: (params) => {
      const one = { id: world.id("nat"), subnet: required(params, "SubnetId"), tags: tagsOfSpecification(params, "natgateway") };
      natGateways.set(one.id, one);
      return { natGateway: { natGatewayId: one.id, subnetId: one.subnet, state: "pending" } };
    },
    DescribeLaunchTemplates: (params) => {
      const names = listOf(params.LaunchTemplateName);
      const found = [...templates.values()].filter((one) => names.length === 0 || names.includes(one.name));
      if (names.length > 0 && found.length === 0) throw fault(400, "InvalidLaunchTemplateName.NotFoundException", "At least one of the launch templates specified in the request does not exist.");
      return { launchTemplates: { item: found.map(templateView) } };
    },
    CreateLaunchTemplate: (params) => {
      const name = required(params, "LaunchTemplateName");
      if ([...templates.values()].some((one) => one.name === name)) throw fault(400, "InvalidLaunchTemplateName.AlreadyExistsException", `Launch template name already in use.`);
      const data = required(params, "LaunchTemplateData");
      if (data.UserData && Buffer.from(data.UserData, "base64").length > 16384) throw fault(400, "InvalidUserData.Malformed", "User data is limited to 16384 bytes");
      const one = { id: world.id("lt"), name, versions: [data], tags: tagsOfSpecification(params, "launch-template") };
      templates.set(one.id, one);
      return { launchTemplate: templateView(one) };
    },
    CreateLaunchTemplateVersion: (params) => {
      const one = templates.get(params.LaunchTemplateId);
      if (!one) throw fault(400, "InvalidLaunchTemplateId.NotFound", `The specified launch template, with template ID ${params.LaunchTemplateId}, does not exist.`);
      const data = required(params, "LaunchTemplateData");
      if (data.UserData && Buffer.from(data.UserData, "base64").length > 16384) throw fault(400, "InvalidUserData.Malformed", "User data is limited to 16384 bytes");
      one.versions.push(data);
      return { launchTemplateVersion: { launchTemplateId: one.id, launchTemplateName: one.name, versionNumber: one.versions.length, launchTemplateData: dataView(data) } };
    },
    DescribeLaunchTemplateVersions: (params) => {
      const one = templates.get(params.LaunchTemplateId);
      if (!one) throw fault(400, "InvalidLaunchTemplateId.NotFound", `The specified launch template, with template ID ${params.LaunchTemplateId}, does not exist.`);
      return {
        launchTemplateVersionSet: { item: listOf(params.LaunchTemplateVersion).map((version) => {
          const data = one.versions[Number(version) - 1];
          if (!data) throw fault(400, "InvalidLaunchTemplateId.VersionNotFound", `Could not find launch template version ${version}`);
          return { launchTemplateId: one.id, launchTemplateName: one.name, versionNumber: Number(version), launchTemplateData: dataView(data) };
        }) }
      };
    }
  };

  const balancerView = (one) => ({
    LoadBalancerArn: one.arn, DNSName: one.dns, LoadBalancerName: one.name, Scheme: one.scheme, VpcId: one.vpc, Type: one.type, State: { Code: "active" },
    SecurityGroups: members(one.groups), AvailabilityZones: members(one.subnets.map((SubnetId) => ({ SubnetId, ZoneName: subnets.get(SubnetId)?.zone })))
  });
  const listenerView = (one) => ({
    ListenerArn: one.arn, LoadBalancerArn: one.balancer, Port: one.port, Protocol: one.protocol, SslPolicy: one.policy,
    Certificates: members(one.certificates.map((CertificateArn) => ({ CertificateArn }))), DefaultActions: members(one.actions)
  });
  const targetGroupView = (one) => ({
    TargetGroupArn: one.arn, TargetGroupName: one.name, Protocol: one.protocol, Port: one.port, VpcId: one.vpc, TargetType: one.targetType, HealthCheckPath: one.healthPath,
    LoadBalancerArns: members([...listeners.values()].filter((listener) => listener.actions.some((action) => action.TargetGroupArn === one.arn)).map((listener) => listener.balancer))
  });
  /** A form's actions, each checked. */
  function actionsOf(params) {
    return listOf(params.DefaultActions, "member").map((action) => {
      if (action.Type === "forward" && ![...targetGroups.values()].some((one) => one.arn === action.TargetGroupArn)) throw fault(400, "TargetGroupNotFound", "One or more target groups not found");
      if (!["forward", "redirect", "fixed-response"].includes(action.Type)) throw fault(400, "ValidationError", `Action type '${action.Type}' must be one of 'forward, redirect, fixed-response'`);
      return action;
    });
  }
  /** A form's certificates, each issued by ACM to the account. */
  function certificatesOf(params) {
    return listOf(params.Certificates, "member").map((one) => {
      if (world.certificateStatus(one.CertificateArn) !== "ISSUED") throw fault(400, "UnsupportedCertificate", `The certificate '${one.CertificateArn}' must have a fully-qualified domain name, a supported signature, and a supported key size.`);
      return one.CertificateArn;
    });
  }
  const tagged = new Map();

  const elasticloadbalancing = {
    DescribeLoadBalancers: (params) => {
      const names = listOf(params.Names, "member");
      const found = [...balancers.values()].filter((one) => names.length === 0 || names.includes(one.name));
      if (names.length > 0 && found.length < names.length) throw fault(400, "LoadBalancerNotFound", "One or more load balancers not found");
      return { LoadBalancers: members(found.map(balancerView)) };
    },
    CreateLoadBalancer: (params) => {
      const name = required(params, "Name");
      if (name.length > 32) throw fault(400, "ValidationError", `Load balancer name '${name}' cannot be longer than '32' characters`);
      if ([...balancers.values()].some((one) => one.name === name)) throw fault(400, "DuplicateLoadBalancerName", "A load balancer with the same name already exists");
      const subnetIds = listOf(params.Subnets, "member");
      if (new Set(subnetIds.map((id) => subnets.get(id)?.zone)).size < 2) throw fault(400, "ValidationError", "At least two subnets in two different Availability Zones must be specified");
      const one = {
        arn: `arn:aws:elasticloadbalancing:${world.region}:${world.account}:loadbalancer/app/${name}/${world.id("lb").slice(3)}`, name, dns: `${name}-${world.seq}.${world.region}.elb.amazonaws.com`,
        scheme: params.Scheme ?? "internet-facing", type: params.Type ?? "application", vpc: subnets.get(subnetIds[0]).vpc, subnets: subnetIds, groups: listOf(params.SecurityGroups, "member")
      };
      balancers.set(one.arn, one);
      tagged.set(one.arn, tagsOfList(listOf(params.Tags, "member")));
      return { LoadBalancers: members([balancerView(one)]) };
    },
    DescribeTags: (params) => ({
      TagDescriptions: members(listOf(params.ResourceArns, "member").map((ResourceArn) => ({
        ResourceArn, Tags: members(Object.entries(tagged.get(ResourceArn) ?? {}).map(([Key, Value]) => ({ Key, Value })))
      })))
    }),
    DescribeListeners: (params) => ({ Listeners: members([...listeners.values()].filter((one) => one.balancer === params.LoadBalancerArn).map(listenerView)) }),
    CreateListener: (params) => {
      const balancer = balancers.get(required(params, "LoadBalancerArn"));
      if (!balancer) throw fault(400, "LoadBalancerNotFound", "One or more load balancers not found");
      if ([...listeners.values()].some((one) => one.balancer === balancer.arn && String(one.port) === String(params.Port))) throw fault(400, "DuplicateListener", "A listener already exists on this port for this load balancer");
      const certificates = certificatesOf(params);
      if (params.Protocol === "HTTPS" && certificates.length === 0) throw fault(400, "CertificateNotFound", "A certificate must be specified for HTTPS listeners");
      const one = { arn: `${balancer.arn.replace(":loadbalancer/", ":listener/")}/${world.id("l").slice(2)}`, balancer: balancer.arn, port: Number(params.Port), protocol: params.Protocol, policy: params.SslPolicy, certificates, actions: actionsOf(params) };
      listeners.set(one.arn, one);
      return { Listeners: members([listenerView(one)]) };
    },
    ModifyListener: (params) => {
      const one = listeners.get(required(params, "ListenerArn"));
      if (!one) throw fault(400, "ListenerNotFound", "One or more listeners not found");
      if (params.Certificates) one.certificates = certificatesOf(params);
      if (params.DefaultActions) one.actions = actionsOf(params);
      return { Listeners: members([listenerView(one)]) };
    },
    DescribeTargetGroups: (params) => {
      const names = listOf(params.Names, "member");
      const found = [...targetGroups.values()].filter((one) => names.length === 0 || names.includes(one.name));
      if (names.length > 0 && found.length < names.length) throw fault(400, "TargetGroupNotFound", "One or more target groups not found");
      return { TargetGroups: members(found.map(targetGroupView)) };
    },
    CreateTargetGroup: (params) => {
      const name = required(params, "Name");
      if (name.length > 32) throw fault(400, "ValidationError", `Target group name '${name}' cannot be longer than '32' characters`);
      if (targetGroups.has(name)) throw fault(400, "DuplicateTargetGroupName", "A target group with the same name exists, but with different settings");
      vpcOf(required(params, "VpcId"));
      const one = {
        arn: `arn:aws:elasticloadbalancing:${world.region}:${world.account}:targetgroup/${name}/${world.id("tg").slice(3)}`, name, protocol: params.Protocol, port: Number(params.Port),
        vpc: params.VpcId, targetType: params.TargetType ?? "instance", healthPath: params.HealthCheckPath ?? "/"
      };
      targetGroups.set(name, one);
      tagged.set(one.arn, tagsOfList(listOf(params.Tags, "member")));
      return { TargetGroups: members([targetGroupView(one)]) };
    },
    ModifyTargetGroup: (params) => {
      const one = [...targetGroups.values()].find((group) => group.arn === params.TargetGroupArn);
      if (!one) throw fault(400, "TargetGroupNotFound", "One or more target groups not found");
      if (params.HealthCheckPath) one.healthPath = params.HealthCheckPath;
      return { TargetGroups: members([targetGroupView(one)]) };
    }
  };

  return {
    ec2,
    elasticloadbalancing,
    /** What the other parts ask of the network. */
    groupExists: (id) => groups.has(id),
    subnetExists: (id) => subnets.has(id),
    templateData: (id, version) => templates.get(id)?.versions[Number(version) - 1] ?? null,
    templateExists: (id) => templates.has(id),
    /** The target group of this ARN when a listener forwards to it. */
    targetGroupRouted: (arn) => [...listeners.values()].some((one) => one.actions.some((action) => action.TargetGroupArn === arn)),
    targetGroup: (arn) => [...targetGroups.values()].find((one) => one.arn === arn) ?? null,
    view: () => ({
      vpcs: [...vpcs.values()], gateways: [...gateways.values()], subnets: [...subnets.values()], routeTables: [...routeTables.values()], securityGroups: [...groups.values()],
      endpoints: [...endpoints.values()], natGateways: [...natGateways.values()], templates: [...templates.values()], balancers: [...balancers.values()],
      listeners: [...listeners.values()], targetGroups: [...targetGroups.values()]
    })
  };
}

export { createStandInNetwork };

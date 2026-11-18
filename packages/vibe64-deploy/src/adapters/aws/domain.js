// The public service's way in at AWS: one internet-facing Application Load Balancer per deployment, in its two
// subnets, with an ACM certificate for the domain validated by DNS. Port 80 redirects to HTTPS; port 443 answers 503
// until the public service is made, then forwards to its target group (its tasks' addresses on Fargate, its machines
// on EC2), which asks the service's health path. AWS issues the certificate once two DNS records are in place at the
// domain's DNS (domainRecords): the certificate's validation record, and the domain pointed at the load balancer. Each
// Deploy's domain step waits for it for CERTIFICATE_WAIT_MS (AWS validates within minutes of seeing the record), then is
// refused, naming the records.
import { ensureBase, notOurs, unless } from "./base.js";
import { SERVICE_PORT, adapterError, keyValueTags, tagsOf, tokenOf } from "./context.js";
import { asList } from "./xml.js";

const TLS_POLICY = "ELBSecurityPolicy-TLS13-1-2-Res-PQ-2025-09";
// How long the domain step waits for AWS to issue a certificate it asked for, before telling the owner what to add.
const CERTIFICATE_WAIT_MS = 15 * 60_000;
const NOT_YET = Object.freeze({ Type: "fixed-response", FixedResponseConfig: { StatusCode: "503", ContentType: "text/plain", MessageBody: "This app is starting." } });

/** The tags of load balancing things by ARN. */
async function balancingTags(ctx, arns) {
  const answer = await ctx.client.query("elasticloadbalancing", "DescribeTags", { "ResourceArns.member": arns });
  return new Map(asList(answer.TagDescriptions?.member).map((one) => [one.ResourceArn, tagsOf(asList(one.Tags?.member))]));
}

/** The deployment's load balancer, or null when there is none yet. */
async function readBalancer(ctx) {
  const name = ctx.nameOf("public", 32);
  const found = asList((await unless(["LoadBalancerNotFound"], () => ctx.client.query("elasticloadbalancing", "DescribeLoadBalancers", { "Names.member": [name] })))
    ?.LoadBalancers?.member)[0];
  if (!found) return null;
  if (!ctx.isOwn((await balancingTags(ctx, [found.LoadBalancerArn])).get(found.LoadBalancerArn))) throw notOurs("The load balancer", name);
  const listeners = asList((await ctx.client.query("elasticloadbalancing", "DescribeListeners", { LoadBalancerArn: found.LoadBalancerArn })).Listeners?.member);
  return { arn: found.LoadBalancerArn, dns: found.DNSName, https: listeners.find((one) => String(one.Port) === "443") ?? null, http: listeners.find((one) => String(one.Port) === "80") ?? null };
}

/** A certificate's DNS validation record, once AWS has made it. */
const validationRecordOf = (certificate) => asList(certificate.DomainValidationOptions).find((one) => one.ResourceRecord)?.ResourceRecord ?? null;

/** This deployment's certificate for the domain, newest first, or null. */
async function certificateOf(ctx, domain) {
  const candidates = [];
  let token;
  do {
    const page = await ctx.client.json("acm", "ListCertificates", { CertificateStatuses: ["PENDING_VALIDATION", "ISSUED"], MaxItems: 1000, ...(token ? { NextToken: token } : {}) });
    candidates.push(...asList(page.CertificateSummaryList).filter((one) => one.DomainName === domain));
    token = page.NextToken || undefined;
  } while (token);
  for (const { CertificateArn } of candidates.reverse()) {
    const { Tags } = await ctx.client.json("acm", "ListTagsForCertificate", { CertificateArn });
    if (ctx.isOwn(Tags)) return (await ctx.client.json("acm", "DescribeCertificate", { CertificateArn })).Certificate;
  }
  return null;
}

/**
 * Covers the domain: the load balancer made, a certificate issued for the domain, its listeners on 80 and 443. While
 * AWS has not issued the certificate, a refusal naming the DNS records to add.
 * @param {any} ctx @param {string} domain @param {{ idempotencyKey: string }} options
 */
async function ensureDomain(ctx, domain, { idempotencyKey }) {
  const { client } = ctx;
  const base = await ensureBase(ctx);
  let balancer = await readBalancer(ctx);
  if (!balancer) {
    await client.query("elasticloadbalancing", "CreateLoadBalancer", {
      Name: ctx.nameOf("public", 32), Type: "application", Scheme: "internet-facing", IpAddressType: "ipv4",
      "Subnets.member": base.subnets, "SecurityGroups.member": [base.balancerGroup], "Tags.member": keyValueTags(ctx.tagsFor("base.balancer"))
    });
    balancer = await readBalancer(ctx);
  }
  let certificate = await certificateOf(ctx, domain);
  if (!certificate) {
    const { CertificateArn } = await client.json("acm", "RequestCertificate", {
      DomainName: domain, ValidationMethod: "DNS", IdempotencyToken: tokenOf(idempotencyKey), Tags: keyValueTags(ctx.tagsFor("base.domain"))
    });
    certificate = (await client.json("acm", "DescribeCertificate", { CertificateArn })).Certificate;
  }
  if (certificate.Status !== "ISSUED") {
    const record = validationRecordOf(certificate);
    if (!record) throw adapterError("aws_certificate_pending", `AWS is still preparing ${domain}'s certificate.`, true);
    const records = `${record.Type} ${record.Name} with the value ${record.Value}, and ${domain} pointed at ${balancer.dns} (a CNAME, or an alias record in Route 53)`;
    // The wait is this Deploy's (its idempotency key is its run's): a Deploy after the records were added waits again.
    if (!ctx.cache.waits.has(idempotencyKey)) ctx.cache.waits.set(idempotencyKey, ctx.now());
    if (ctx.now() - ctx.cache.waits.get(idempotencyKey) < CERTIFICATE_WAIT_MS) {
      throw adapterError("aws_certificate_validating", `Waiting for AWS to issue ${domain}'s certificate, which it does once two DNS records are in place: ${records}.`, true);
    }
    throw adapterError("aws_certificate_pending", `AWS issues ${domain}'s certificate once two DNS records are in place at the domain's DNS: ${records}. Add them, then deploy again.`);
  }
  if (!balancer.http) {
    await client.query("elasticloadbalancing", "CreateListener", {
      LoadBalancerArn: balancer.arn, Protocol: "HTTP", Port: 80,
      "DefaultActions.member": [{ Type: "redirect", RedirectConfig: { Protocol: "HTTPS", Port: "443", StatusCode: "HTTP_301" } }]
    });
  }
  if (!balancer.https) {
    await client.query("elasticloadbalancing", "CreateListener", {
      LoadBalancerArn: balancer.arn, Protocol: "HTTPS", Port: 443, SslPolicy: TLS_POLICY,
      "Certificates.member": [{ CertificateArn: certificate.CertificateArn }], "DefaultActions.member": [NOT_YET]
    });
  } else if (asList(balancer.https.Certificates?.member)[0]?.CertificateArn !== certificate.CertificateArn) {
    await client.query("elasticloadbalancing", "ModifyListener", { ListenerArn: balancer.https.ListenerArn, "Certificates.member": [{ CertificateArn: certificate.CertificateArn }] });
  }
  return null;
}

/**
 * The DNS records the owner adds for the domain, as far as AWS has made them: the certificate's validation record and
 * the domain at the load balancer; and the certificate's status (null before the domain step asked for one).
 * @param {any} ctx @param {string} domain
 */
async function domainRecords(ctx, domain) {
  const [balancer, certificate] = [await readBalancer(ctx), await certificateOf(ctx, domain)];
  const record = certificate ? validationRecordOf(certificate) : null;
  return {
    domain,
    certificate: certificate?.Status ?? null,
    records: [
      ...(record ? [{ name: record.Name, type: record.Type, data: record.Value }] : []),
      ...(balancer ? [{ name: `${domain}.`, type: "CNAME", data: `${balancer.dns}.` }] : [])
    ]
  };
}

/**
 * The public service's target group, made once: `ip` targets for Fargate tasks, `instance` for machines, asked the
 * service's health path. Its ARN.
 */
async function targetGroupOf(ctx, { item, machine, healthPath }) {
  const { client } = ctx;
  const base = await ensureBase(ctx);
  const name = ctx.nameOf(item, 32);
  const found = asList((await unless(["TargetGroupNotFound"], () => client.query("elasticloadbalancing", "DescribeTargetGroups", { "Names.member": [name] })))
    ?.TargetGroups?.member)[0];
  if (found) {
    if (!ctx.isOwn((await balancingTags(ctx, [found.TargetGroupArn])).get(found.TargetGroupArn))) throw notOurs("The target group", name);
    return found.TargetGroupArn;
  }
  const made = await client.query("elasticloadbalancing", "CreateTargetGroup", {
    Name: name, Protocol: "HTTP", Port: SERVICE_PORT, VpcId: base.vpcId, TargetType: machine ? "instance" : "ip",
    HealthCheckPath: healthPath, HealthCheckIntervalSeconds: 15, HealthyThresholdCount: 2, "Matcher.HttpCode": "200-399",
    "Tags.member": keyValueTags(ctx.tagsFor(`service.${item}`))
  });
  return asList(made.TargetGroups?.member)[0].TargetGroupArn;
}

/** Points the HTTPS listener at a target group, or (null) back at "starting". */
async function routeTo(ctx, targetGroupArn) {
  const balancer = await readBalancer(ctx);
  if (!balancer?.https) throw adapterError("aws_domain_missing", "The load balancer has no HTTPS listener yet: the domain step makes it.", true);
  await ctx.client.query("elasticloadbalancing", "ModifyListener", {
    ListenerArn: balancer.https.ListenerArn, "DefaultActions.member": [targetGroupArn ? { Type: "forward", TargetGroupArn: targetGroupArn } : NOT_YET]
  });
}

export { domainRecords, ensureDomain, routeTo, targetGroupOf };

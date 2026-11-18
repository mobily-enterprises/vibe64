// The stand-in's data and identity: RDS instances and subnet groups (Query, lists named per type), IAM roles, instance
// profiles, users and their access keys and inline policies (Query, from us-east-1), Secrets Manager's secrets with
// their versions, ACM's certificates, CloudWatch Logs' log groups (JSON 1.1), and S3's buckets and objects (REST, XML).
// An RDS instance made with ManageMasterUserPassword gets its credentials as a Secrets Manager secret RDS keeps
// (rds!db-…), as AWS does; a certificate stays PENDING_VALIDATION until the test says its DNS records are in place.
import { createHash } from "node:crypto";

import { xmlOf } from "../xml.js";
import { fault, listOf, matchesPattern, required, tagsOfList } from "./wire.js";

const ENGINE_PORTS = Object.freeze({ postgres: 5432, mariadb: 3306, mysql: 3306 });
const RETENTION_DAYS = new Set([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653]);
const S3_NAMESPACE = "http://s3.amazonaws.com/doc/2006-03-01/";
const members = (items) => ({ member: items });
const keyValues = (tags) => Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));

/** @param {any} world */
function createStandInData(world) {
  const at = () => world.now().getTime() / 1000;
  const databases = new Map();
  const subnetGroups = new Map();
  const roles = new Map();
  const profiles = new Map();
  const users = new Map();
  const secrets = new Map();
  const certificates = new Map();
  const logGroups = new Map();
  const buckets = new Map();
  /** Bucket names other AWS accounts hold. */
  const othersBuckets = new Set();

  // --- RDS --------------------------------------------------------------------------------------------------------

  const databaseView = (db) => ({
    DBInstanceIdentifier: db.id, DBInstanceArn: db.arn, DBInstanceClass: db.instanceClass, Engine: db.engine, DBInstanceStatus: db.status, MasterUsername: db.user,
    DBName: db.dbName, MultiAZ: db.multiAz, PubliclyAccessible: false, StorageEncrypted: true,
    ...(db.status === "available" || db.endpoint ? { Endpoint: { Address: `${db.id}.c0standin.${world.region}.rds.amazonaws.com`, Port: ENGINE_PORTS[db.engine], HostedZoneId: "Z2R2ITUGPM61AM" } } : {}),
    ...(db.secret ? { MasterUserSecret: { SecretArn: db.secret, SecretStatus: "active", KmsKeyId: `arn:aws:kms:${world.region}:${world.account}:key/standin` } } : {}),
    VpcSecurityGroups: { VpcSecurityGroupMembership: db.groups.map((VpcSecurityGroupId) => ({ VpcSecurityGroupId, Status: "active" })) },
    DBSubnetGroup: { DBSubnetGroupName: db.subnetGroup },
    PendingModifiedValues: db.pending,
    TagList: { Tag: keyValues(db.tags) }
  });
  const databaseOf = (id) => [...databases.values()].find((db) => db.id === id || db.arn === id) ?? (() => {
    throw fault(404, "DBInstanceNotFound", `DBInstance ${id} not found.`);
  })();

  const rds = {
    CreateDBSubnetGroup: (params) => {
      const name = required(params, "DBSubnetGroupName");
      if (subnetGroups.has(name)) throw fault(400, "DBSubnetGroupAlreadyExists", `The DB subnet group '${name}' already exists.`);
      const ids = listOf(params.SubnetIds, "SubnetIdentifier");
      if (ids.length < 2 || !ids.every(world.network.subnetExists)) throw fault(400, "DBSubnetGroupDoesNotCoverEnoughAZs", "The DB subnet group doesn't meet Availability Zone (AZ) coverage requirement.");
      subnetGroups.set(name, { name, subnets: ids, tags: tagsOfList(listOf(params.Tags, "Tag")) });
      return { DBSubnetGroup: { DBSubnetGroupName: name, SubnetGroupStatus: "Complete" } };
    },
    CreateDBInstance: (params) => {
      const id = required(params, "DBInstanceIdentifier");
      if (!/^[a-z][a-z0-9-]{0,62}$/u.test(id) || id.endsWith("-") || id.includes("--")) throw fault(400, "InvalidParameterValue", "The parameter DBInstanceIdentifier is not a valid identifier.");
      if (databases.has(id)) throw fault(400, "DBInstanceAlreadyExists", "DB instance already exists");
      const engine = required(params, "Engine");
      if (!ENGINE_PORTS[engine]) throw fault(400, "InvalidParameterValue", `Invalid DB engine: ${engine}`);
      if (params.ManageMasterUserPassword === "true" && params.MasterUserPassword) throw fault(400, "InvalidParameterCombination", "You can't specify MasterUserPassword and ManageMasterUserPassword together.");
      if (params.ManageMasterUserPassword !== "true" && !params.MasterUserPassword) throw fault(400, "InvalidParameterValue", "The parameter MasterUserPassword is not a valid password.");
      if (!subnetGroups.has(params.DBSubnetGroupName)) throw fault(404, "DBSubnetGroupNotFoundFault", `DB subnet group '${params.DBSubnetGroupName}' does not exist.`);
      const groups = listOf(params.VpcSecurityGroupIds, "VpcSecurityGroupId");
      if (!groups.every(world.network.groupExists)) throw fault(400, "InvalidParameterValue", "Invalid security group");
      const db = {
        id, arn: `arn:aws:rds:${world.region}:${world.account}:db:${id}`, instanceClass: required(params, "DBInstanceClass"), engine, status: "creating", user: required(params, "MasterUsername"),
        dbName: params.DBName, multiAz: params.MultiAZ === "true", groups, subnetGroup: params.DBSubnetGroupName, pending: undefined, endpoint: false,
        tags: tagsOfList(listOf(params.Tags, "Tag")), secret: null
      };
      if (params.ManageMasterUserPassword === "true") {
        db.secret = putSecret(`rds!db-${world.id("x").slice(2)}`, JSON.stringify({ username: db.user, password: `standin-${world.seq}` }), { "aws:rds:primaryDBInstanceArn": db.arn }).arn;
      }
      databases.set(id, db);
      return { DBInstance: databaseView(db) };
    },
    DescribeDBInstances: (params) => {
      if (params.DBInstanceIdentifier) return { DBInstances: { DBInstance: [databaseView(databaseOf(params.DBInstanceIdentifier))] } };
      const all = [...databases.values()];
      const start = Number(params.Marker ?? 0);
      const size = Number(params.MaxRecords ?? 100);
      const page = all.slice(start, start + size);
      return { DBInstances: { DBInstance: page.map(databaseView) }, ...(start + size < all.length ? { Marker: String(start + size) } : {}) };
    },
    ModifyDBInstance: (params) => {
      const db = databaseOf(required(params, "DBInstanceIdentifier"));
      if (db.status !== "available") throw fault(400, "InvalidDBInstanceState", `Database instance is not in available state.`);
      db.pending = {
        ...(params.DBInstanceClass && params.DBInstanceClass !== db.instanceClass ? { DBInstanceClass: params.DBInstanceClass } : {}),
        ...(params.MultiAZ !== undefined && (params.MultiAZ === "true") !== db.multiAz ? { MultiAZ: params.MultiAZ === "true" } : {})
      };
      if (params.ApplyImmediately === "true" && Object.keys(db.pending).length > 0) db.status = "modifying";
      return { DBInstance: databaseView(db) };
    },
    DeleteDBInstance: (params) => {
      const db = databaseOf(required(params, "DBInstanceIdentifier"));
      if (params.SkipFinalSnapshot !== "true" && !params.FinalDBSnapshotIdentifier) {
        throw fault(400, "InvalidParameterCombination", "FinalDBSnapshotIdentifier is required unless SkipFinalSnapshot is specified.");
      }
      db.status = "deleting";
      db.finalSnapshot = params.FinalDBSnapshotIdentifier ?? null;
      return { DBInstance: databaseView(db) };
    }
  };

  // --- IAM --------------------------------------------------------------------------------------------------------

  const iamArn = (kind, path, name) => `arn:aws:iam::${world.account}:${kind}${path ?? "/"}${name}`;
  const noSuch = (what, name) => fault(404, "NoSuchEntity", `The ${what} with name ${name} cannot be found.`);
  const exists = (what, name) => fault(409, "EntityAlreadyExists", `${what} with name ${name} already exists.`);
  const roleView = (role) => ({ Path: role.path, RoleName: role.name, RoleId: role.id, Arn: role.arn, AssumeRolePolicyDocument: encodeURIComponent(role.trust), Tags: members(keyValues(role.tags)) });

  const iam = {
    GetRole: (params) => ({ Role: roleView(roles.get(params.RoleName) ?? (() => { throw noSuch("role", params.RoleName); })()) }),
    CreateRole: (params) => {
      const name = required(params, "RoleName");
      if (roles.has(name)) throw exists("Role", name);
      const role = { name, path: params.Path ?? "/", id: world.id("AROA").toUpperCase(), arn: iamArn("role", params.Path, name), trust: required(params, "AssumeRolePolicyDocument"), policies: new Map(), tags: tagsOfList(listOf(params.Tags, "member")) };
      JSON.parse(role.trust);
      roles.set(name, role);
      return { Role: roleView(role) };
    },
    PutRolePolicy: (params) => {
      const role = roles.get(params.RoleName) ?? (() => { throw noSuch("role", params.RoleName); })();
      const document = required(params, "PolicyDocument");
      const parsed = JSON.parse(document);
      if (!Array.isArray(parsed.Statement)) throw fault(400, "MalformedPolicyDocument", "Syntax errors in policy.");
      role.policies.set(required(params, "PolicyName"), document);
      return {};
    },
    GetRolePolicy: (params) => {
      const role = roles.get(params.RoleName) ?? (() => { throw noSuch("role", params.RoleName); })();
      const document = role.policies.get(params.PolicyName);
      if (!document) throw noSuch("role policy", params.PolicyName);
      return { RoleName: role.name, PolicyName: params.PolicyName, PolicyDocument: encodeURIComponent(document) };
    },
    GetInstanceProfile: (params) => {
      const profile = profiles.get(params.InstanceProfileName) ?? (() => { throw noSuch("instance profile", params.InstanceProfileName); })();
      return { InstanceProfile: profileView(profile) };
    },
    CreateInstanceProfile: (params) => {
      const name = required(params, "InstanceProfileName");
      if (profiles.has(name)) throw exists("Instance Profile", name);
      const profile = { name, path: params.Path ?? "/", arn: iamArn("instance-profile", params.Path, name), roles: [], tags: tagsOfList(listOf(params.Tags, "member")) };
      profiles.set(name, profile);
      return { InstanceProfile: profileView(profile) };
    },
    AddRoleToInstanceProfile: (params) => {
      const profile = profiles.get(params.InstanceProfileName) ?? (() => { throw noSuch("instance profile", params.InstanceProfileName); })();
      if (!roles.has(params.RoleName)) throw noSuch("role", params.RoleName);
      if (profile.roles.length > 0) throw fault(409, "LimitExceeded", "Cannot exceed quota for InstanceSessionsPerInstanceProfile: 1");
      profile.roles.push(params.RoleName);
      return {};
    },
    GetUser: (params) => {
      const user = users.get(params.UserName) ?? (() => { throw noSuch("user", params.UserName); })();
      return { User: { UserName: user.name, Path: user.path, Arn: user.arn, UserId: user.id, Tags: members(keyValues(user.tags)) } };
    },
    CreateUser: (params) => {
      const name = required(params, "UserName");
      if (users.has(name)) throw exists("User", name);
      const user = { name, path: params.Path ?? "/", arn: iamArn("user", params.Path, name), id: world.id("AIDA").toUpperCase(), keys: [], policies: new Map(), tags: tagsOfList(listOf(params.Tags, "member")) };
      users.set(name, user);
      return { User: { UserName: name, Path: user.path, Arn: user.arn, UserId: user.id } };
    },
    PutUserPolicy: (params) => {
      const user = users.get(params.UserName) ?? (() => { throw noSuch("user", params.UserName); })();
      JSON.parse(required(params, "PolicyDocument"));
      user.policies.set(required(params, "PolicyName"), params.PolicyDocument);
      return {};
    },
    ListAccessKeys: (params) => {
      const user = users.get(params.UserName) ?? (() => { throw noSuch("user", params.UserName); })();
      return { AccessKeyMetadata: members(user.keys.map((AccessKeyId) => ({ UserName: user.name, AccessKeyId, Status: "Active" }))), IsTruncated: false };
    },
    CreateAccessKey: (params) => {
      const user = users.get(params.UserName) ?? (() => { throw noSuch("user", params.UserName); })();
      if (user.keys.length >= 2) throw fault(409, "LimitExceeded", "Cannot exceed quota for AccessKeysPerUser: 2");
      const id = `AKIA${world.id("K").slice(2).toUpperCase().padStart(16, "0")}`;
      user.keys.push(id);
      return { AccessKey: { UserName: user.name, AccessKeyId: id, Status: "Active", SecretAccessKey: createHash("sha256").update(id).digest("base64").slice(0, 40) } };
    },
    DeleteAccessKey: (params) => {
      const user = users.get(params.UserName) ?? (() => { throw noSuch("user", params.UserName); })();
      if (!user.keys.includes(params.AccessKeyId)) throw noSuch("access key", params.AccessKeyId);
      user.keys = user.keys.filter((key) => key !== params.AccessKeyId);
      return {};
    },
    DeleteUserPolicy: (params) => {
      const user = users.get(params.UserName) ?? (() => { throw noSuch("user", params.UserName); })();
      if (!user.policies.delete(params.PolicyName)) throw noSuch("user policy", params.PolicyName);
      return {};
    },
    DeleteUser: (params) => {
      const user = users.get(params.UserName) ?? (() => { throw noSuch("user", params.UserName); })();
      if (user.keys.length > 0 || user.policies.size > 0) throw fault(409, "DeleteConflict", "Cannot delete entity, must delete policies and access keys first.");
      users.delete(user.name);
      return {};
    }
  };
  const profileView = (profile) => ({
    InstanceProfileName: profile.name, Path: profile.path, Arn: profile.arn, Roles: members(profile.roles.map((name) => roleView(roles.get(name)))), Tags: members(keyValues(profile.tags))
  });

  /** Whether a role's inline policies let it do an action on a resource (Allow statements only). */
  function roleMay(roleArn, action, resource) {
    const role = [...roles.values()].find((one) => one.arn === roleArn);
    if (!role) return false;
    return [...role.policies.values()].some((document) => JSON.parse(document).Statement.some((statement) => statement.Effect === "Allow"
      && [statement.Action].flat().some((pattern) => matchesPattern(pattern, action))
      && [statement.Resource].flat().some((pattern) => matchesPattern(pattern.replace(/:\*:/gu, `:${world.account}:`), resource))));
  }

  // --- Secrets Manager ----------------------------------------------------------------------------------------------

  function putSecret(name, value, tags) {
    const secret = { name, arn: `arn:aws:secretsmanager:${world.region}:${world.account}:secret:${name}-${world.id("s").slice(-6)}`, tags, versions: [], deleted: null };
    secrets.set(name, secret);
    addVersion(secret, value);
    return secret;
  }
  function addVersion(secret, value) {
    const id = `${world.id("v").slice(2).padStart(8, "0")}-0000-4000-8000-000000000000`;
    secret.versions = secret.versions.map((one) => ({ ...one, current: false }));
    secret.versions.push({ id, value, current: true });
    return id;
  }
  const secretOf = (id) => secrets.get(id) ?? [...secrets.values()].find((one) => one.arn === id) ?? (() => {
    throw Object.assign(fault(400, "ResourceNotFoundException", "Secrets Manager can't find the specified secret."), { messageKey: "Message" });
  })();

  const secretsmanager = {
    CreateSecret: (body) => {
      const name = required(body, "Name");
      if (secrets.has(name)) throw Object.assign(fault(400, "ResourceExistsException", `The operation failed because the secret ${name} already exists.`), { messageKey: "Message" });
      const secret = putSecret(name, required(body, "SecretString"), Object.fromEntries((body.Tags ?? []).map((tag) => [tag.Key, tag.Value])));
      return { ARN: secret.arn, Name: name, VersionId: secret.versions.at(-1).id };
    },
    PutSecretValue: (body) => {
      const secret = secretOf(required(body, "SecretId"));
      if (secret.deleted) throw Object.assign(fault(400, "InvalidRequestException", "You can't perform this operation on the secret because it was marked for deletion."), { messageKey: "Message" });
      const id = addVersion(secret, required(body, "SecretString"));
      return { ARN: secret.arn, Name: secret.name, VersionId: id, VersionStages: ["AWSCURRENT"] };
    },
    DescribeSecret: (body) => {
      const secret = secretOf(required(body, "SecretId"));
      return {
        ARN: secret.arn, Name: secret.name, Tags: Object.entries(secret.tags).map(([Key, Value]) => ({ Key, Value })),
        VersionIdsToStages: Object.fromEntries(secret.versions.map((one) => [one.id, one.current ? ["AWSCURRENT"] : []])), ...(secret.deleted ? { DeletedDate: secret.deleted } : {})
      };
    },
    RestoreSecret: (body) => {
      const secret = secretOf(required(body, "SecretId"));
      secret.deleted = null;
      return { ARN: secret.arn, Name: secret.name };
    },
    DeleteSecret: (body) => {
      const secret = secretOf(required(body, "SecretId"));
      if (secret.deleted) throw Object.assign(fault(400, "InvalidRequestException", "You can't perform this operation on the secret because it was already scheduled for deletion."), { messageKey: "Message" });
      const days = Number(body.RecoveryWindowInDays ?? 30);
      if (days < 7 || days > 30) throw Object.assign(fault(400, "InvalidParameterException", "The recovery window must be 7 to 30 days."), { messageKey: "Message" });
      secret.deleted = world.now().getTime() / 1000;
      return { ARN: secret.arn, Name: secret.name, DeletionDate: secret.deleted + days * 86400 };
    }
  };

  /**
   * A secret's value as ECS or a machine reads it (a JSON key of a version, or the current one), or why it can't be.
   * @returns {{ value?: string, problem?: string }}
   */
  function readSecretKey(arn, key, versionId) {
    const secret = [...secrets.values()].find((one) => one.arn === arn);
    if (!secret) return { problem: `secret ${arn} not found` };
    if (secret.deleted) return { problem: `secret ${secret.name} is marked for deletion` };
    const version = versionId ? secret.versions.find((one) => one.id === versionId) : secret.versions.find((one) => one.current);
    if (!version) return { problem: `version ${versionId} of ${secret.name} not found` };
    const value = JSON.parse(version.value)[key];
    return typeof value === "string" ? { value } : { problem: `key ${key} not in ${secret.name}` };
  }

  // --- ACM and CloudWatch Logs ----------------------------------------------------------------------------------------

  /** Domains whose validation records the owner has put in place. */
  const validated = new Set();
  const certificateView = (one) => ({
    CertificateArn: one.arn, DomainName: one.domain, Status: one.status, Type: "AMAZON_ISSUED", SubjectAlternativeNames: [one.domain], CreatedAt: one.created,
    DomainValidationOptions: [{ DomainName: one.domain, ValidationMethod: "DNS", ValidationStatus: one.status === "ISSUED" ? "SUCCESS" : "PENDING_VALIDATION", ResourceRecord: one.record }]
  });
  const certificateOf = (arn) => certificates.get(arn) ?? (() => {
    throw fault(400, "ResourceNotFoundException", `Could not find certificate ${arn}.`);
  })();

  const acm = {
    RequestCertificate: (body) => {
      const domain = required(body, "DomainName");
      if (body.ValidationMethod !== "DNS") throw fault(400, "ValidationException", "The validation method must be DNS for this stand-in.");
      if (body.IdempotencyToken && !/^\w{1,32}$/u.test(body.IdempotencyToken)) throw fault(400, "ValidationException", "IdempotencyToken must match \\w+ and be at most 32 characters.");
      const again = [...certificates.values()].find((one) => one.token && one.token === body.IdempotencyToken && one.domain === domain);
      if (again) return { CertificateArn: again.arn };
      const id = world.id("c").slice(2).padStart(8, "0");
      const one = {
        arn: `arn:aws:acm:${world.region}:${world.account}:certificate/${id}-0000-4000-8000-000000000000`, domain, status: "PENDING_VALIDATION", token: body.IdempotencyToken ?? null, created: at(),
        tags: Object.fromEntries((body.Tags ?? []).map((tag) => [tag.Key, tag.Value])), record: { Name: `_${id}.${domain}.`, Type: "CNAME", Value: `_${id}.acm-validations.aws.` }
      };
      certificates.set(one.arn, one);
      return { CertificateArn: one.arn };
    },
    ListCertificates: (body) => {
      const statuses = body.CertificateStatuses ?? null;
      return { CertificateSummaryList: [...certificates.values()].filter((one) => !statuses || statuses.includes(one.status)).map((one) => ({ CertificateArn: one.arn, DomainName: one.domain, Status: one.status })) };
    },
    DescribeCertificate: (body) => ({ Certificate: certificateView(certificateOf(required(body, "CertificateArn"))) }),
    ListTagsForCertificate: (body) => ({ Tags: Object.entries(certificateOf(required(body, "CertificateArn")).tags).map(([Key, Value]) => ({ Key, Value })) })
  };

  const logs = {
    CreateLogGroup: (body) => {
      const name = required(body, "logGroupName");
      if (logGroups.has(name)) throw fault(400, "ResourceAlreadyExistsException", "The specified log group already exists");
      logGroups.set(name, { name, retention: null, tags: body.tags ?? {} });
      return {};
    },
    PutRetentionPolicy: (body) => {
      const group = logGroups.get(required(body, "logGroupName"));
      if (!group) throw fault(400, "ResourceNotFoundException", "The specified log group does not exist.");
      if (!RETENTION_DAYS.has(Number(body.retentionInDays))) throw fault(400, "InvalidParameterException", "1 validation error detected: Value at 'retentionInDays' failed to satisfy constraint");
      group.retention = Number(body.retentionInDays);
      return {};
    }
  };

  // --- S3 ---------------------------------------------------------------------------------------------------------

  const s3Error = (status, code, message) => fault(status, code, message);
  const xml = (name, value) => `<?xml version="1.0" encoding="UTF-8"?>\n${xmlOf(name, value, ` xmlns="${S3_NAMESPACE}"`)}`;
  const md5 = (body) => createHash("md5").update(body).digest("base64");

  /**
   * One S3 request: `{ status, body, headers }`.
   * @param {{ method: string, bucket: string, key: string, query: URLSearchParams, headers: Headers, body: Buffer }} request
   */
  function s3({ method, bucket: name, key, query, headers, body }) {
    if (!name) {
      if (method !== "GET") throw s3Error(405, "MethodNotAllowed", "The specified method is not allowed against this resource.");
      const prefix = query.get("prefix") ?? "";
      const region = query.get("bucket-region");
      const found = [...buckets.values()].filter((one) => one.name.startsWith(prefix) && (!region || one.region === region));
      return { status: 200, body: xml("ListAllMyBucketsResult", { Owner: { ID: world.account }, Buckets: { Bucket: found.map((one) => ({ Name: one.name, CreationDate: one.created, BucketRegion: one.region })) }, Prefix: prefix }) };
    }
    const bucket = buckets.get(name);
    const sub = ["tagging", "publicAccessBlock", "list-type"].find((one) => query.has(one)) ?? null;
    if (method === "PUT" && !key && !sub) {
      if (othersBuckets.has(name)) throw s3Error(409, "BucketAlreadyExists", "The requested bucket name is not available.");
      if (bucket) throw s3Error(409, "BucketAlreadyOwnedByYou", "Your previous request to create the named bucket succeeded and you already own it.");
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(name)) throw s3Error(400, "InvalidBucketName", "The specified bucket is not valid.");
      const constraint = /<LocationConstraint>([^<]+)<\/LocationConstraint>/u.exec(body.toString("utf8"))?.[1] ?? "us-east-1";
      if (constraint !== world.region) throw s3Error(400, "IllegalLocationConstraintException", `The ${constraint} location constraint is incompatible for the region specific endpoint this request was sent to.`);
      buckets.set(name, { name, region: world.region, created: world.now().toISOString(), tags: null, blocked: false, objects: new Map() });
      return { status: 200, body: "", headers: { location: `/${name}` } };
    }
    if (!bucket) throw s3Error(404, "NoSuchBucket", "The specified bucket does not exist");
    if (sub === "tagging" || sub === "publicAccessBlock") {
      if (method === "PUT") {
        if (headers.get("content-md5") !== md5(body)) throw s3Error(400, "InvalidDigest", "The Content-MD5 you specified was invalid.");
        const text = body.toString("utf8");
        if (sub === "tagging") bucket.tags = Object.fromEntries([...text.matchAll(/<Tag><Key>([^<]*)<\/Key><Value>([^<]*)<\/Value><\/Tag>/gu)].map(([, tag, value]) => [tag, value]));
        else bucket.blocked = ["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"].every((flag) => text.includes(`<${flag}>true</${flag}>`));
        return { status: sub === "tagging" ? 204 : 200, body: "" };
      }
      if (sub === "tagging") {
        if (!bucket.tags) throw s3Error(404, "NoSuchTagSet", "The TagSet does not exist");
        return { status: 200, body: xml("Tagging", { TagSet: { Tag: Object.entries(bucket.tags).map(([Key, Value]) => ({ Key, Value })) } }) };
      }
    }
    if (sub === "list-type" && method === "GET") {
      const all = [...bucket.objects.keys()].filter((one) => one.startsWith(query.get("prefix") ?? "")).sort();
      const shown = all.slice(0, Number(query.get("max-keys") ?? 1000));
      return { status: 200, body: xml("ListBucketResult", { Name: name, KeyCount: shown.length, IsTruncated: shown.length < all.length, Contents: shown.map((Key) => ({ Key, Size: bucket.objects.get(Key).body.length })) }) };
    }
    if (method === "DELETE" && !key) {
      if (bucket.objects.size > 0) throw s3Error(409, "BucketNotEmpty", "The bucket you tried to delete is not empty");
      buckets.delete(name);
      return { status: 204, body: "" };
    }
    if (method === "DELETE") {
      bucket.objects.delete(key);
      return { status: 204, body: "" };
    }
    if (method === "PUT") {
      bucket.objects.set(key, { body: Buffer.from(body), type: headers.get("content-type") ?? "binary/octet-stream" });
      return { status: 200, body: "", headers: { etag: `"${createHash("md5").update(body).digest("hex")}"` } };
    }
    const object = bucket.objects.get(key);
    if (method === "HEAD") return object ? { status: 200, body: "", headers: { "content-length": String(object.body.length) } } : { status: 404, body: "" };
    if (method === "GET") {
      if (!object) throw s3Error(404, "NoSuchKey", "The specified key does not exist.");
      return { status: 200, body: object.body, headers: { "content-type": object.type } };
    }
    throw s3Error(405, "MethodNotAllowed", "The specified method is not allowed against this resource.");
  }

  /** Moves RDS on one step: creating, backing-up, then available; a change applied; a deletion done. A certificate of a domain whose records are in place is issued; new roles are seen. */
  function advance() {
    for (const role of roles.values()) role.seen = true;
    for (const one of certificates.values()) if (one.status === "PENDING_VALIDATION" && validated.has(one.domain)) one.status = "ISSUED";
    for (const db of [...databases.values()]) {
      if (db.status === "creating") db.status = "backing-up";
      else if (db.status === "backing-up") Object.assign(db, { status: "available", endpoint: true });
      else if (db.status === "modifying") {
        if (db.pending?.DBInstanceClass) db.instanceClass = db.pending.DBInstanceClass;
        if (db.pending?.MultiAZ !== undefined) db.multiAz = db.pending.MultiAZ;
        Object.assign(db, { status: "available", pending: undefined });
      } else if (db.status === "deleting") databases.delete(db.id);
    }
  }

  return {
    rds,
    iam,
    secretsmanager,
    acm,
    logs,
    s3,
    advance,
    roleMay,
    readSecretKey,
    roleExists: (arn) => [...roles.values()].some((one) => one.arn === arn),
    /** Whether a role is seen by AWS's other services: from the advance after IAM made it (IAM is eventually consistent). */
    roleSeen: (arn) => [...roles.values()].some((one) => one.arn === arn && one.seen),
    objectExists: (bucket, key) => Boolean(buckets.get(bucket)?.objects.has(key)),
    certificateStatus: (arn) => certificates.get(arn)?.status ?? null,
    /** The owner put a domain's validation records in place: AWS issues its certificates at the next advance. */
    issue: (domain) => validated.add(domain),
    othersBuckets,
    view: () => ({
      databases: [...databases.values()], subnetGroups: [...subnetGroups.values()], roles: [...roles.values()], profiles: [...profiles.values()], users: [...users.values()],
      secrets: [...secrets.values()].map(({ versions, ...one }) => ({ ...one, versions: versions.length })), certificates: [...certificates.values()],
      logGroups: [...logGroups.values()], buckets: [...buckets.values()].map(({ objects, ...one }) => ({ ...one, keys: [...objects.keys()] }))
    })
  };
}

export { createStandInData };

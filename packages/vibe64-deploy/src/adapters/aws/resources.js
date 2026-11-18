// The resources a deployment makes at AWS, each tagged as its item of the record:
//
//   - a PostgreSQL database is RDS for PostgreSQL and a MySQL one RDS for MariaDB (offer.js ENGINES), in the
//     deployment's subnets with no public address, encrypted, its storage growing from 20 GiB, backed up for 7 days, its
//     master password made and kept by RDS in Secrets Manager (never seen here), in a security group of its own that
//     lets in only the services linked to it, on its port; a size ending .multi-az keeps a standby copy in another zone;
//   - a bucket is private S3 (every public access blocked) with a key of its own that reaches that bucket alone: an IAM
//     user under /vibe64/ whose one policy names the bucket, its access key kept in Secrets Manager the moment it is
//     made (never returned, logged or kept anywhere else).
//
// A service linked to a resource is given its fields as V64_<RESOURCE>_<FIELD> (image.js): a database's host, port,
// database, user and password (and sslmode=require for PostgreSQL), a bucket's name, region, endpoint and key; the
// secret ones as references into Secrets Manager, which ECS (or the machine, as it starts) resolves.
import { needSetting } from "../mobilynet/declaration.js";
import { allowSecrets, bucketTags, ensureBase, ensureBucket, ensureSecurityGroup, notOurs, unless } from "./base.js";
import { adapterError, keyValueTags, tagsOf } from "./context.js";
import { DATABASE_STORAGE_GIB, ENGINES, databaseClassOf } from "./offer.js";
import { asList } from "./xml.js";

const KIND_OF_ENGINE = Object.freeze(Object.fromEntries(Object.entries(ENGINES).map(([kind, { engine }]) => [engine, kind])));
const DATABASE_NAME = "app";
const MASTER_USER = "vibe64";
// RDS's states a database failed in; any other than available is one it is on its way through.
const RDS_FAILED = /^(failed|incompatible-|inaccessible-encryption-credentials|storage-full|restore-error)/u;

const itemOf = (labels) => String(labels?.["vibe64-item"] ?? "").replace(/^resource\./u, "");
const isBucket = (id) => String(id).startsWith("arn:aws:s3:::");

/** An RDS instance as the inventory reads it. @param {any} db */
function databaseThing(db) {
  const pending = db.PendingModifiedValues ?? {};
  const multiAz = String(pending.MultiAZ ?? db.MultiAZ) === "true";
  const status = String(db.DBInstanceStatus);
  const changing = Boolean(pending.DBInstanceClass) || pending.MultiAZ !== undefined;
  return {
    id: db.DBInstanceArn,
    name: db.DBInstanceIdentifier,
    kind: "resource",
    labels: tagsOf(asList(db.TagList?.Tag)),
    size: `${pending.DBInstanceClass ?? db.DBInstanceClass}${multiAz ? ".multi-az" : ""}`,
    resourceKind: KIND_OF_ENGINE[db.Engine] ?? null,
    state: status === "deleting" ? "deleting" : RDS_FAILED.test(status) ? "failed" : status === "available" && !changing ? "running" : "starting",
    lastError: RDS_FAILED.test(status) ? { message: `RDS reports the database ${status}.` } : null
  };
}

/**
 * The deployment's resources at AWS: its RDS databases (read with their tags, every page) and its buckets (those under
 * its name, their tags read once).
 * @param {any} ctx
 */
async function resourcesNow(ctx) {
  const { client } = ctx;
  const things = [];
  let marker;
  do {
    const page = await client.query("rds", "DescribeDBInstances", { MaxRecords: 100, Marker: marker });
    for (const db of asList(page.DBInstances?.DBInstance)) {
      if (ctx.isOwn(asList(db.TagList?.Tag))) things.push(databaseThing(db));
    }
    marker = page.Marker || undefined;
  } while (marker);
  let token;
  do {
    const page = await client.s3("GET", "", "", { query: { prefix: `${ctx.nameOf("")}-`, "bucket-region": ctx.region, ...(token ? { "continuation-token": token } : {}) } });
    for (const { Name: name } of asList(page.xml?.Buckets?.Bucket)) {
      if (!ctx.cache.bucketTags.has(name)) ctx.cache.bucketTags.set(name, await bucketTags(client, name));
      const labels = ctx.cache.bucketTags.get(name);
      if (ctx.isOwn(labels) && String(labels["vibe64-item"]).startsWith("resource.")) {
        things.push({ id: `arn:aws:s3:::${name}`, name, kind: "resource", labels, size: "standard", resourceKind: "bucket", state: "running", lastError: null });
      }
    }
    token = page.xml?.ContinuationToken || undefined;
  } while (token);
  return things;
}

/** An RDS instance by its ARN or identifier, or null. */
async function readDatabase(ctx, id) {
  const answer = await unless(["DBInstanceNotFound", "DBInstanceNotFoundFault"], () => ctx.client.query("rds", "DescribeDBInstances", { DBInstanceIdentifier: id }));
  return asList(answer?.DBInstances?.DBInstance)[0] ?? null;
}

/** This deployment's database by its ARN, or the refusal of one that isn't. */
async function ownDatabase(ctx, id) {
  const db = await readDatabase(ctx, id);
  if (!db) throw adapterError("aws_resource_gone", `The database ${id} is gone at AWS.`);
  if (!ctx.isOwn(asList(db.TagList?.Tag))) throw notOurs("The RDS database", db.DBInstanceIdentifier);
  return db;
}

/** This deployment's bucket by its ARN, its name and tags, or the refusal of one that isn't. */
async function ownBucket(ctx, id) {
  const name = String(id).replace(/^arn:aws:s3:::/u, "");
  const labels = await bucketTags(ctx.client, name);
  if (!ctx.isOwn(labels)) throw notOurs("The S3 bucket", name);
  return { name, labels };
}

/** The secret a bucket's key is kept in. @param {any} ctx @param {string} resource */
const keySecretName = (ctx, resource) => `vibe64/${ctx.own().id}/resources/${resource}`;

/** Makes a database, or finds this deployment's that a Deploy cut short made. */
async function createDatabase(ctx, { resource, kind, size, labels }) {
  const base = await ensureBase(ctx);
  const name = ctx.nameOf(resource);
  const found = await readDatabase(ctx, name);
  if (found && !ctx.isOwn(asList(found.TagList?.Tag))) throw notOurs("The RDS database", name);
  if (found) return { id: found.DBInstanceArn, name, size };
  const subnetGroup = ctx.nameOf("databases", 255);
  await unless(["DBSubnetGroupAlreadyExists", "DBSubnetGroupAlreadyExistsFault"], () => ctx.client.query("rds", "CreateDBSubnetGroup", {
    DBSubnetGroupName: subnetGroup, DBSubnetGroupDescription: "Vibe64: the deployment's databases", "SubnetIds.SubnetIdentifier": base.subnets,
    "Tags.Tag": keyValueTags(ctx.tagsFor("base.databases"))
  }));
  const group = await ensureSecurityGroup(ctx, base.vpcId, `database-${resource}`, `Vibe64: database ${resource}, reached by the services linked to it`);
  const { instanceClass, multiAz } = databaseClassOf(size);
  const made = await ctx.client.query("rds", "CreateDBInstance", {
    DBInstanceIdentifier: name,
    Engine: ENGINES[kind].engine,
    DBInstanceClass: instanceClass,
    MultiAZ: multiAz,
    AllocatedStorage: DATABASE_STORAGE_GIB,
    MaxAllocatedStorage: 200,
    StorageType: "gp3",
    StorageEncrypted: true,
    MasterUsername: MASTER_USER,
    ManageMasterUserPassword: true,
    DBName: DATABASE_NAME,
    DBSubnetGroupName: subnetGroup,
    "VpcSecurityGroupIds.VpcSecurityGroupId": [group],
    PubliclyAccessible: false,
    BackupRetentionPeriod: 7,
    CopyTagsToSnapshot: true,
    "Tags.Tag": keyValueTags(labels)
  });
  return { id: made.DBInstance.DBInstanceArn, name, size };
}

/** Makes a private bucket and its own key, kept in Secrets Manager; or finds this deployment's. */
async function createBucket(ctx, { resource, labels }) {
  const { client } = ctx;
  await ensureBase(ctx);
  const name = ctx.nameOf(`bucket-${resource}`);
  await ensureBucket(ctx, name, labels);
  ctx.cache.bucketTags.set(name, labels);
  const user = ctx.nameOf(`bucket-${resource}`, 64);
  const madeUser = (await unless(["NoSuchEntity"], () => client.query("iam", "GetUser", { UserName: user })))?.User;
  if (madeUser && !ctx.isOwn(asList(madeUser.Tags?.member))) throw notOurs("The IAM user", user);
  if (!madeUser) await client.query("iam", "CreateUser", { UserName: user, Path: "/vibe64/", "Tags.member": keyValueTags(labels) });
  await client.query("iam", "PutUserPolicy", {
    UserName: user,
    PolicyName: "vibe64-bucket",
    PolicyDocument: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Action: ["s3:ListBucket", "s3:GetBucketLocation"], Resource: `arn:aws:s3:::${name}` },
        { Effect: "Allow", Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"], Resource: `arn:aws:s3:::${name}/*` }
      ]
    })
  });
  const secretName = keySecretName(ctx, resource);
  const known = await unless(["ResourceNotFoundException"], () => client.json("secretsmanager", "DescribeSecret", { SecretId: secretName }));
  if (known && !ctx.isOwn(known.Tags)) throw notOurs("The secret", secretName);
  const keys = asList((await client.query("iam", "ListAccessKeys", { UserName: user })).AccessKeyMetadata?.member);
  // A new key when none is kept: a key made before its secret was kept (a Deploy cut short) is replaced, its secret
  // half never kept; a bucket made again after one deleted restores the secret its key goes in.
  if (!known || known.DeletedDate || keys.length === 0) {
    for (const key of keys) await client.query("iam", "DeleteAccessKey", { UserName: user, AccessKeyId: key.AccessKeyId });
    const { AccessKey } = await client.query("iam", "CreateAccessKey", { UserName: user });
    const value = JSON.stringify({ accessKeyId: AccessKey.AccessKeyId, secretAccessKey: AccessKey.SecretAccessKey });
    if (!known) {
      await client.json("secretsmanager", "CreateSecret", {
        Name: secretName, Description: `Vibe64: the key of bucket ${name}, which reaches that bucket alone`, SecretString: value, Tags: keyValueTags(labels)
      });
    } else {
      if (known.DeletedDate) await client.json("secretsmanager", "RestoreSecret", { SecretId: secretName });
      await client.json("secretsmanager", "PutSecretValue", { SecretId: secretName, SecretString: value });
    }
  }
  return { id: `arn:aws:s3:::${name}`, name, size: "standard" };
}

/**
 * Makes a resource, tagged as its item: `{ id, name, size }`.
 * @param {any} ctx @param {{ kind: string, size: string, labels: Record<string, string> }} spec
 */
async function createResource(ctx, { kind, size, labels }) {
  const resource = itemOf(labels);
  if (ENGINES[kind]) return createDatabase(ctx, { resource, kind, size, labels });
  if (kind === "bucket") return createBucket(ctx, { resource, labels });
  throw adapterError("aws_resource_unsupported", `Vibe64 doesn't make a ${kind} at AWS.`);
}

/** Moves a database to another size, or its standby copy on or off, now. */
async function resizeResource(ctx, id, size) {
  if (isBucket(id)) return;
  const db = await ownDatabase(ctx, id);
  const { instanceClass, multiAz } = databaseClassOf(size);
  // RDS takes one change at a time: while one is applied, the next is tried again at the next step.
  await unless(["InvalidDBInstanceState", "InvalidDBInstanceStateFault"], async () => {
    await ctx.client.query("rds", "ModifyDBInstance", { DBInstanceIdentifier: db.DBInstanceIdentifier, DBInstanceClass: instanceClass, MultiAZ: multiAz, ApplyImmediately: true });
    return true;
  }) || (() => {
    throw adapterError("aws_database_busy", `${db.DBInstanceIdentifier} is applying another change; Vibe64 tries again shortly.`, true);
  })();
}

/**
 * What a service linked to a resource is given: `{ plain, refs, group, port }`, `refs` each secret setting's secret
 * ARN and JSON key, `group` the database's security group (null for a bucket) and `port` its port. The secret its
 * service reads is added to what the deployment's roles may read.
 * @param {any} ctx @param {string} id the resource's ARN @param {string} as its need's name (V64_<ID>)
 */
async function linkValues(ctx, id, as) {
  const name = (field) => needSetting(as, field);
  if (isBucket(id)) {
    const bucket = await ownBucket(ctx, id);
    const { ARN } = await ctx.client.json("secretsmanager", "DescribeSecret", { SecretId: keySecretName(ctx, itemOf(bucket.labels)) });
    return {
      plain: { [name("bucket")]: bucket.name, [name("region")]: ctx.region, [name("endpoint")]: `https://s3.${ctx.region}.amazonaws.com` },
      refs: { [name("accessKeyId")]: { arn: ARN, key: "accessKeyId" }, [name("secretAccessKey")]: { arn: ARN, key: "secretAccessKey" } },
      group: null,
      port: null
    };
  }
  const db = await ownDatabase(ctx, id);
  const secret = db.MasterUserSecret?.SecretArn;
  if (!db.Endpoint?.Address || !secret) throw adapterError("aws_database_starting", `${db.DBInstanceIdentifier} has no address or credentials yet.`, true);
  await allowSecrets(ctx, (await ensureBase(ctx)).roles, [secret]);
  return {
    plain: {
      [name("host")]: db.Endpoint.Address,
      [name("port")]: String(db.Endpoint.Port),
      [name("database")]: DATABASE_NAME,
      ...(db.Engine === "postgres" ? { [name("sslmode")]: "require" } : {})
    },
    refs: { [name("user")]: { arn: secret, key: "username" }, [name("password")]: { arn: secret, key: "password" } },
    group: asList(db.VpcSecurityGroups?.VpcSecurityGroupMembership)[0]?.VpcSecurityGroupId ?? null,
    port: Number(db.Endpoint.Port)
  };
}

/** A database's security group and port, which the services linked to it are let into. */
async function databaseGroup(ctx, id) {
  const db = await ownDatabase(ctx, id);
  return { group: asList(db.VpcSecurityGroups?.VpcSecurityGroupMembership)[0]?.VpcSecurityGroupId ?? null, port: Number(db.Endpoint?.Port ?? 0) };
}

/**
 * Deletes a resource and its data, the owner's own action: a database with a final snapshot kept; a bucket only once
 * it is empty, then its key and the key's secret.
 */
async function deleteResource(ctx, id) {
  const { client } = ctx;
  if (!isBucket(id)) {
    const db = await ownDatabase(ctx, id);
    const stamp = new Date(ctx.now()).toISOString().replace(/[^0-9]/gu, "").slice(0, 12);
    await client.query("rds", "DeleteDBInstance", {
      DBInstanceIdentifier: db.DBInstanceIdentifier, FinalDBSnapshotIdentifier: `${db.DBInstanceIdentifier}-final-${stamp}`, DeleteAutomatedBackups: false
    });
    return;
  }
  const bucket = await ownBucket(ctx, id);
  const listed = await client.s3("GET", bucket.name, "", { query: { "list-type": "2", "max-keys": "1" } });
  if (Number(listed.xml?.KeyCount ?? 0) > 0) {
    throw adapterError("aws_bucket_not_empty", `${bucket.name} still holds files. Empty it at AWS (S3, ${bucket.name}, Empty), then delete it here.`);
  }
  await client.s3("DELETE", bucket.name, "");
  ctx.cache.bucketTags.delete(bucket.name);
  const resource = itemOf(bucket.labels);
  const user = ctx.nameOf(`bucket-${resource}`, 64);
  for (const key of asList((await unless(["NoSuchEntity"], () => client.query("iam", "ListAccessKeys", { UserName: user })))?.AccessKeyMetadata?.member)) {
    await client.query("iam", "DeleteAccessKey", { UserName: user, AccessKeyId: key.AccessKeyId });
  }
  await unless(["NoSuchEntity"], () => client.query("iam", "DeleteUserPolicy", { UserName: user, PolicyName: "vibe64-bucket" }));
  await unless(["NoSuchEntity"], () => client.query("iam", "DeleteUser", { UserName: user }));
  await unless(["ResourceNotFoundException", "InvalidRequestException"], () => client.json("secretsmanager", "DeleteSecret", { SecretId: keySecretName(ctx, resource), RecoveryWindowInDays: 7 }));
}

export { createResource, databaseGroup, deleteResource, isBucket, linkValues, resizeResource, resourcesNow };

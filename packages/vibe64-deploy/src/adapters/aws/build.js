// Each service's image at AWS, built at AWS: its upload (image.js imageUpload: the release archive with its
// Containerfile) is kept in the deployment's releases bucket, at releases/<app>/<tag>/release.tar.gz with its
// declaration beside it (<tag>.json), and built by the deployment's CodeBuild project (base.js BUILDSPEC) into the
// deployment's ECR as <images>/<app>:<tag>. The tag is the first 32 hexadecimal digits of the upload's SHA-256, so the
// same upload is built once: an image already in ECR, or a build under way (its id kept at <tag>.build), is not
// started again. Nothing of Vibe64's is in the build: the project's role is the account's, its source the bucket.
//
// While a build runs, the calls that need its image answer a retryable refusal, so the engine's next step asks again.
import { ensureBase, notOurs, unless } from "./base.js";
import { adapterError, keyValueTags } from "./context.js";
import { asList } from "./xml.js";

const TAG_LENGTH = 32;
const BUILD_ENDED_BADLY = new Set(["FAILED", "FAULT", "TIMED_OUT", "STOPPED"]);

/** The image tag of an upload: its SHA-256's first 32 hexadecimal digits. @param {{ sha256: string }} upload */
const tagOfUpload = (upload) => String(upload.sha256).replace(/^sha256:/u, "").slice(0, TAG_LENGTH);

const sourceOf = (app, tag) => `releases/${app}/${tag}/`;
const objectOf = (app, tag, ending) => `releases/${app}/${tag}${ending}`;

/** The deployment's repository of an app's images, made once: its URI. */
async function repositoryOf(ctx, app) {
  if (ctx.cache.repositories.has(app)) return ctx.cache.repositories.get(app);
  const { client } = ctx;
  const base = await ensureBase(ctx);
  const repositoryName = `${base.repositoryPrefix}/${app}`;
  let repository = asList((await unless(["RepositoryNotFoundException"], () => client.json("ecr", "DescribeRepositories", { repositoryNames: [repositoryName] })))?.repositories)[0];
  if (repository) {
    const { tags } = await client.json("ecr", "ListTagsForResource", { resourceArn: repository.repositoryArn });
    if (!ctx.isOwn(tags)) throw notOurs("The ECR repository", repositoryName);
  } else {
    repository = (await client.json("ecr", "CreateRepository", {
      repositoryName, imageTagMutability: "IMMUTABLE", tags: keyValueTags(ctx.tagsFor("base.images"))
    })).repository;
  }
  ctx.cache.repositories.set(app, repository.repositoryUri);
  return repository.repositoryUri;
}

/** Whether ECR holds an app's image of this tag. */
async function isBuilt(ctx, app, tag) {
  const base = await ensureBase(ctx);
  const answer = await unless(["ImageNotFoundException"], () => ctx.client.json("ecr", "DescribeImages", {
    repositoryName: `${base.repositoryPrefix}/${app}`, imageIds: [{ imageTag: tag }]
  }));
  return asList(answer?.imageDetails).length > 0;
}

/** The build kept for a release, or null: CodeBuild's account of it. */
async function buildOf(ctx, app, tag) {
  const base = await ensureBase(ctx);
  const kept = await unless(["NoSuchKey"], () => ctx.client.s3("GET", base.bucket, objectOf(app, tag, ".build")));
  if (!kept) return null;
  return asList((await ctx.client.json("codebuild", "BatchGetBuilds", { ids: [kept.text.trim()] })).builds)[0] ?? null;
}

/** Starts a release's build from its kept source, and keeps its id. */
async function startBuild(ctx, app, tag) {
  const base = await ensureBase(ctx);
  const uri = await repositoryOf(ctx, app);
  const { build } = await ctx.client.json("codebuild", "StartBuild", {
    projectName: base.project,
    sourceTypeOverride: "S3",
    sourceLocationOverride: `${base.bucket}/${sourceOf(app, tag)}`,
    environmentVariablesOverride: [{ name: "IMAGE_URI", value: `${uri}:${tag}`, type: "PLAINTEXT" }],
    idempotencyToken: `${app}-${tag}`
  });
  await ctx.client.s3("PUT", base.bucket, objectOf(app, tag, ".build"), { body: build.id, headers: { "content-type": "text/plain" } });
}

/**
 * Keeps a release's upload and declaration and starts its image's build, once: `{ version }`, the image's tag.
 * @param {any} ctx @param {string} app the service's app name (its declaration's) @param {{ bytes: Buffer, sha256: string, declaration: any }} upload
 */
async function uploadRelease(ctx, app, upload) {
  const base = await ensureBase(ctx);
  await repositoryOf(ctx, app);
  const tag = tagOfUpload(upload);
  await ctx.client.s3("PUT", base.bucket, objectOf(app, tag, ".json"), { body: JSON.stringify(upload.declaration), headers: { "content-type": "application/json" } });
  if (await isBuilt(ctx, app, tag)) return { version: tag };
  const build = await buildOf(ctx, app, tag);
  if (build && !BUILD_ENDED_BADLY.has(build.buildStatus)) return { version: tag };
  await ctx.client.s3("PUT", base.bucket, `${sourceOf(app, tag)}release.tar.gz`, { body: upload.bytes, headers: { "content-type": "application/gzip" } });
  await startBuild(ctx, app, tag);
  return { version: tag };
}

/**
 * A release's image URI once built. While its build runs, a retryable refusal; a build that failed, a refusal with
 * CodeBuild's reason and where its log is.
 */
async function builtImage(ctx, app, tag) {
  const uri = await repositoryOf(ctx, app);
  if (await isBuilt(ctx, app, tag)) return `${uri}:${tag}`;
  const build = await buildOf(ctx, app, tag);
  if (!build) {
    const base = await ensureBase(ctx);
    const kept = await unless(["NoSuchKey", "NotFound"], () => ctx.client.s3("HEAD", base.bucket, `${sourceOf(app, tag)}release.tar.gz`));
    if (!kept) throw adapterError("aws_release_missing", `${app}'s release ${tag} isn't kept at AWS any more: deploy again.`);
    await startBuild(ctx, app, tag);
  }
  if (!build || !BUILD_ENDED_BADLY.has(build.buildStatus)) {
    throw adapterError("aws_image_building", `Building ${app}'s image${build?.currentPhase ? ` (${build.currentPhase.toLowerCase()})` : ""}.`, true);
  }
  const failed = asList(build.phases).find((phase) => BUILD_ENDED_BADLY.has(phase.phaseStatus));
  const why = asList(failed?.contexts).map((one) => one.message).filter(Boolean).join(" ") || `CodeBuild says ${build.buildStatus}.`;
  const base = await ensureBase(ctx);
  throw adapterError("aws_image_failed", `${app}'s image did not build${failed ? ` (${failed.phaseType})` : ""}: ${why} Its log is in CloudWatch Logs, ${base.logGroup}.`);
}

/** A release's declaration, kept beside its upload. */
async function declarationOf(ctx, app, tag) {
  const base = await ensureBase(ctx);
  const kept = await unless(["NoSuchKey"], () => ctx.client.s3("GET", base.bucket, objectOf(app, tag, ".json")));
  if (!kept) throw adapterError("aws_release_missing", `${app}'s release ${tag} isn't kept at AWS any more: deploy again.`);
  return JSON.parse(kept.text);
}

export { builtImage, declarationOf, tagOfUpload, uploadRelease };

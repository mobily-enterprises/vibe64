import { CONTAINERFILE } from "../../image.js";
import { REPOSITORY } from "./base.js";
import { GoogleError } from "./client.js";

// The Google Cloud adapter's releases: each service's upload kept in the build bucket (its source, and the declaration
// its release is made with), and its image built from it by Cloud Build into Artifact Registry, tagged with the
// upload's digest, so one upload is built once whichever step asks.

const BUILDING = new Set(["QUEUED", "PENDING", "WORKING"]);

function createGoogleReleases(g) {
  const {
    call, listAll, project, region, buildServiceAccount, P, failed, registry, buildBucket
  } = g;

  // --- Releases: the source kept, the image built by Cloud Build ----------------------------------------------------

  const tagOfUpload = (upload) => `r-${upload.sha256.slice(0, 32)}`;
  const imageOf = (app, tag) => `${region}-docker.pkg.dev/${project}/${REPOSITORY}/${app}:${tag}`;
  const objectOf = (app, tag, extension) => `releases/${app}/${tag}.${extension}`;

  /** The builds tagged with a release's tag, newest first. */
  const buildsOf = (tag) => listAll("cloudbuild", `v1/${P}/locations/${region}/builds`, "builds", { filter: `tags="${tag}"` });

  /** An object put once: one already there (412) is kept. */
  async function putObject(bucket, name, bytes, contentType) {
    try {
      await call("storage", "POST", `upload/storage/v1/b/${bucket}/o`, { query: { uploadType: "media", name, ifGenerationMatch: 0 }, upload: { bytes, contentType } });
    } catch (error) {
      if (!(error instanceof GoogleError && error.status === 412)) throw error;
    }
  }

  /** Starts the build of a release's image from its kept source. */
  async function startBuild(app, tag) {
    const [bucket] = await Promise.all([buildBucket(), registry()]);
    await call("cloudbuild", "POST", `v1/${P}/locations/${region}/builds`, {
      body: {
        source: { storageSource: { bucket, object: objectOf(app, tag, "tar.gz") } },
        steps: [{ name: "gcr.io/cloud-builders/docker", args: ["build", "--file", CONTAINERFILE, "--tag", imageOf(app, tag), "."] }],
        images: [imageOf(app, tag)],
        tags: ["vibe64", app, tag],
        timeout: "3600s",
        options: { logging: "CLOUD_LOGGING_ONLY" },
        ...(buildServiceAccount ? { serviceAccount: `${P}/serviceAccounts/${buildServiceAccount}` } : {})
      }
    });
  }

  /** Keeps a release's source and declaration and starts its build, once: `{ version }`, its tag. */
  async function uploadRelease(app, upload) {
    const tag = tagOfUpload(upload);
    if ((await buildsOf(tag)).length > 0) return { version: tag };
    const bucket = await buildBucket();
    await putObject(bucket, objectOf(app, tag, "json"), Buffer.from(JSON.stringify(upload.declaration)), "application/json");
    await putObject(bucket, objectOf(app, tag, "tar.gz"), upload.bytes, "application/gzip");
    await startBuild(app, tag);
    return { version: tag };
  }

  /**
   * A release's image, once built: while its build runs, a retryable refusal (the engine's next step asks again); a
   * build that failed, a refusal with Cloud Build's reason and its log.
   */
  async function builtImage(app, tag) {
    const [build] = await buildsOf(tag);
    if (!build) await startBuild(app, tag);
    if (!build || BUILDING.has(build.status)) throw new GoogleError({ status: 409, code: "build_running", message: `Building ${app}'s image.`, retryable: true });
    if (build.status !== "SUCCESS") {
      throw failed(`The image of ${app} did not build (${build.status}): ${build.statusDetail || "Cloud Build gave no reason."}${build.logUrl ? ` Its log: ${build.logUrl}` : ""}`, "build_failed");
    }
    return imageOf(app, tag);
  }

  /** A release's declaration, kept beside its source. */
  async function declarationOf(app, tag) {
    const bytes = await call("storage", "GET", `storage/v1/b/${await buildBucket()}/o/${encodeURIComponent(objectOf(app, tag, "json"))}`, { query: { alt: "media" }, raw: true });
    return JSON.parse(String(bytes));
  }

  return { uploadRelease, builtImage, declarationOf };
}

export { createGoogleReleases };

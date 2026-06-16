import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createService
} from "../../packages/vibe64-deployments/src/server/service.js";
import {
  createDeploymentStore
} from "../../packages/vibe64-deployments/src/server/deploymentStore.js";
import {
  createDeploymentRunner
} from "../../packages/vibe64-deployments/src/server/deploymentRunner.js";
import {
  createCaddyRouteMaterializer
} from "../../packages/vibe64-deployments/src/server/caddyRouteMaterializer.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

function deploymentTestContext(root, slug) {
  const projectsRoot = path.join(root, "projects");
  const targetRoot = path.join(projectsRoot, slug);
  return {
    projectLocalRoot: path.join(targetRoot, ".vibe64-local"),
    projectStateRoot: path.join(targetRoot, ".vibe64"),
    projectsRoot,
    slug,
    systemRoot: path.join(projectsRoot, ".vibe64-demon"),
    targetRoot
  };
}

async function createDeploymentTestService(root, {
  deploymentStore = null,
  deploymentRunner = null
} = {}) {
  const projectsRoot = path.join(root, "projects");
  const projectContext = createStudioProjectContext({
    env: {},
    explicitProjectsRoot: projectsRoot,
    explicitSystemRoot: path.join(projectsRoot, ".vibe64-demon"),
    home: root
  });
  return createService({
    ...(deploymentStore ? { deploymentStore } : {}),
    deploymentRunner: deploymentRunner || createDeploymentRunner({
      runCommand: fakeSuccessfulRunCommand().runCommand
    }),
    projectContext
  });
}

async function inProject(root, slug, operation) {
  const context = deploymentTestContext(root, slug);
  await mkdir(context.targetRoot, {
    recursive: true
  });
  return runWithProjectRequestContext(context, operation);
}

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function configureJskitProject(context) {
  await Promise.all([
    writeProjectFile(context.targetRoot, "package.json", JSON.stringify({
      name: "example-jskit-app",
      scripts: {
        build: "vite build",
        "db:migrate": "jskit db migrate",
        server: "node dist/server.js"
      }
    }, null, 2)),
    writeProjectFile(context.projectStateRoot, "project_type", "jskit\n"),
    writeProjectFile(context.projectStateRoot, "config/github_pr_merge_method", "merge\n"),
    writeProjectFile(context.projectStateRoot, "config/jskit_database_runtime", "mysql\n")
  ]);
}

function fakeSuccessfulRunCommand() {
  const calls = [];
  async function runCommand(command, args, options = {}) {
    calls.push({
      args: [...args],
      command,
      options
    });
    if (command === "docker" && args[0] === "run" && args.includes("-d")) {
      return commandResult("release-container-id");
    }
    if (command === "docker" && args[0] === "exec") {
      return commandResult("ready 200");
    }
    if (command === process.execPath) {
      return commandResult("ready 200");
    }
    if (command === "bash") {
      return commandResult("runtime services ready");
    }
    return commandResult("ok");
  }
  return {
    calls,
    runCommand
  };
}

function fakeHealthFailureRunCommand() {
  const calls = [];
  async function runCommand(command, args, options = {}) {
    calls.push({
      args: [...args],
      command,
      options
    });
    if (command === "docker" && args[0] === "run" && args.includes("-d")) {
      return commandResult("release-container-id");
    }
    if (command === process.execPath) {
      return commandFailure("unhealthy http://127.0.0.1");
    }
    return commandResult("ok");
  }
  return {
    calls,
    runCommand
  };
}

function commandResult(output = "") {
  return {
    exitCode: 0,
    ok: true,
    output,
    stderr: "",
    stdout: output
  };
}

function commandFailure(output = "") {
  return {
    exitCode: 1,
    ok: false,
    output,
    stderr: output,
    stdout: ""
  };
}

function dockerDetachedRun(calls = []) {
  return calls.find((call) => {
    return call.command === "docker" &&
      call.args[0] === "run" &&
      call.args.includes("-d");
  });
}

function dockerForcedRemove(calls = []) {
  return calls.find((call) => {
    return call.command === "docker" &&
      call.args[0] === "rm" &&
      call.args[1] === "-f";
  });
}

function assertArgValue(args = [], name = "", expected = "") {
  const index = args.indexOf(name);
  assert.notEqual(index, -1, `Missing Docker argument ${name}`);
  assert.equal(args[index + 1], expected);
}

test("Vibe64 deployment service validates reserved and official-looking public names", async () => {
  await withTemporaryRoot(async (root) => {
    const service = await createDeploymentTestService(root);

    const reserved = await inProject(root, "beepollen", () => service.validatePublicName({
      publicName: "billing"
    }));
    assert.equal(reserved.ok, false);
    assert.equal(reserved.code, "vibe64_public_name_reserved");

    const officialLooking = await inProject(root, "beepollen", () => service.validatePublicName({
      publicName: "support-vibe64"
    }));
    assert.equal(officialLooking.ok, false);
    assert.equal(officialLooking.code, "vibe64_public_name_reserved");

    const available = await inProject(root, "beepollen", () => service.validatePublicName({
      publicName: "beepollen"
    }));
    assert.equal(available.ok, true);
    assert.equal(available.available, true);
    assert.equal(available.publicHost, "beepollen.users.vibe64.dev");
  });
});

test("Vibe64 deployment service reads the selected adapter publish plan", async () => {
  await withTemporaryRoot(async (root) => {
    const service = await createDeploymentTestService(root);
    const context = deploymentTestContext(root, "beepollen");
    await configureJskitProject(context);

    const result = await runWithProjectRequestContext(context, () => service.readPublishPlan());

    assert.equal(result.ok, true);
    assert.equal(result.project.slug, "beepollen");
    assert.equal(result.publishPlan.ok, true);
    assert.equal(result.publishPlan.adapterId, "jskit");
    assert.equal(result.publishPlan.build.command, "npm run build");
    assert.equal(result.publishPlan.migrate.command, "npm run db:migrate");
    assert.equal(result.publishPlan.serve.command, "npm run server");
    assert.equal(result.publishPlan.runtimeServices[0].id, "jskit-mariadb");
  });
});

test("Vibe64 deployment service publishes with release logs and Docker restart supervision", async () => {
  await withTemporaryRoot(async (root) => {
    const fake = fakeSuccessfulRunCommand();
    const service = await createDeploymentTestService(root, {
      deploymentRunner: createDeploymentRunner({
        runCommand: fake.runCommand
      })
    });
    const context = deploymentTestContext(root, "beepollen");
    await configureJskitProject(context);
    await Promise.all([
      writeProjectFile(context.targetRoot, "src/app.js", "console.log('published');\n"),
      writeProjectFile(context.targetRoot, ".git/config", "[core]\n"),
      writeProjectFile(context.targetRoot, ".vibe64/project_type", "jskit\n"),
      writeProjectFile(context.targetRoot, ".vibe64-local/sessions/session.json", "{}\n")
    ]);

    const result = await runWithProjectRequestContext(context, async () => {
      await service.reservePublicName({
        publicName: "beepollen"
      });
      return service.publishCurrentProject();
    });

    assert.equal(result.ok, true);
    assert.equal(result.release.status, "published");
    assert.equal(result.state.currentRelease.releaseId, result.release.releaseId);
    assert.equal(result.release.container.restartPolicy, "on-failure:5");
    assert.equal(result.release.container.containerId, "release-container-id");

    const detachedRun = dockerDetachedRun(fake.calls);
    assert.ok(detachedRun, "Expected a detached Docker release container to be started.");
    assertArgValue(detachedRun.args, "--restart", "on-failure:5");
    assert.ok(detachedRun.args.includes("--log-driver"));
    assert.ok(detachedRun.args.includes("json-file"));
    assert.ok(detachedRun.args.includes("max-size=10m"));
    assert.ok(detachedRun.args.includes("max-file=5"));
    const publishIndex = detachedRun.args.indexOf("-p");
    assert.notEqual(publishIndex, -1, "Expected release container to publish a loopback port for Caddy.");
    assert.match(detachedRun.args[publishIndex + 1], /^127\.0\.0\.1:\d+:4100$/u);
    assert.equal(detachedRun.args.join(" ").includes("systemctl"), false);
    assert.equal(detachedRun.args.join(" ").includes("systemd"), false);

    const logsRoot = path.join(result.state.stateRoot, "releases", result.release.releaseId, "logs");
    assert.match(await readFile(path.join(logsRoot, "build.log"), "utf8"), /ok/u);
    assert.match(await readFile(path.join(logsRoot, "migrate.log"), "utf8"), /ok/u);
    assert.match(await readFile(path.join(logsRoot, "start.log"), "utf8"), /release-container-id/u);
    assert.match(await readFile(path.join(logsRoot, "health.log"), "utf8"), /ready 200/u);

    const manifest = JSON.parse(await readFile(
      path.join(result.state.stateRoot, "releases", result.release.releaseId, "manifest.json"),
      "utf8"
    ));
    assert.equal(manifest.releaseId, result.release.releaseId);
    assert.equal(manifest.status, "published");
    assert.equal(manifest.publishedAt.length > 0, true);
    assert.equal(manifest.publishedAt, manifest.finishedAt);
    assert.equal(manifest.publicHost, "beepollen.users.vibe64.dev");
    assert.equal(manifest.artifact.kind, "workspace-snapshot");
    assert.match(manifest.artifact.workspacePath, /\/releases\/.+\/artifact\/workspace$/u);
    assert.match(manifest.container.loopbackBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.match(manifest.caddy.sitePath, /\/caddy\/sites\/beepollen\.caddy$/u);
    assert.match(manifest.caddy.accessLogPath, /\/\.vibe64-local\/deployments\/logs\/access\.log$/u);
    assert.equal(manifest.caddy.accessLogPath.includes(manifest.releaseId), false);
    assert.equal((await stat(path.dirname(manifest.caddy.accessLogPath))).isDirectory(), true);
    assert.ok(detachedRun.args.includes(`${manifest.artifact.workspacePath}:/workspace`));
    assert.equal(detachedRun.args.includes(`${context.targetRoot}:/workspace`), false);
    assert.match(await readFile(path.join(manifest.artifact.workspacePath, "src/app.js"), "utf8"), /published/u);
    await assert.rejects(
      () => readFile(path.join(manifest.artifact.workspacePath, ".git/config"), "utf8"),
      { code: "ENOENT" }
    );
    await assert.rejects(
      () => readFile(path.join(manifest.artifact.workspacePath, ".vibe64-local/sessions/session.json"), "utf8"),
      { code: "ENOENT" }
    );

    const caddySite = await readFile(manifest.caddy.sitePath, "utf8");
    assert.match(caddySite, /beepollen\.users\.vibe64\.dev/u);
    assert.match(caddySite, /import vibe64_published_app 127\.0\.0\.1:\d+ /u);
    assert.match(caddySite, /\/\.vibe64-local\/deployments\/logs\/access\.log/u);

    const caddySnippet = await readFile(manifest.caddy.snippetPath, "utf8");
    assert.match(caddySnippet, /\(vibe64_published_app\)/u);
    assert.match(caddySnippet, /reverse_proxy \{args\[0\]\}/u);

    const reloadingMaterializer = createCaddyRouteMaterializer({
      reload: true,
      runCommand: fake.runCommand
    });
    await assert.rejects(
      () => reloadingMaterializer.materializeProject(context, result.state),
      /VIBE64_CADDY_CONFIG/u
    );
  });
});

test("Vibe64 deployment service removes a started release container when publish health fails", async () => {
  await withTemporaryRoot(async (root) => {
    const fake = fakeHealthFailureRunCommand();
    const service = await createDeploymentTestService(root, {
      deploymentRunner: createDeploymentRunner({
        runCommand: fake.runCommand
      })
    });
    const context = deploymentTestContext(root, "beepollen");
    await configureJskitProject(context);

    const result = await runWithProjectRequestContext(context, async () => {
      await service.reservePublicName({
        publicName: "beepollen"
      });
      return service.publishCurrentProject();
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "vibe64_deployment_phase_failed");

    const detachedRun = dockerDetachedRun(fake.calls);
    assert.ok(detachedRun, "Expected the release container to start before health failed.");
    const cleanup = dockerForcedRemove(fake.calls);
    assert.ok(cleanup, "Expected the failed release container to be force removed.");
    assert.equal(cleanup.args[2], detachedRun.args[detachedRun.args.indexOf("--name") + 1]);

    const releases = await runWithProjectRequestContext(context, () => service.listReleases());
    assert.equal(releases.ok, true);
    assert.equal(releases.releases.length, 1);
    assert.equal(releases.releases[0].status, "failed");
    assert.equal(releases.releases[0].phases.at(-1).id, "cleanup");
    assert.equal(releases.releases[0].phases.at(-1).ok, true);
  });
});

test("Vibe64 deployment service rolls back to an earlier published release", async () => {
  await withTemporaryRoot(async (root) => {
    const fake = fakeSuccessfulRunCommand();
    const service = await createDeploymentTestService(root, {
      deploymentRunner: createDeploymentRunner({
        runCommand: fake.runCommand
      })
    });
    const context = deploymentTestContext(root, "beepollen");
    await configureJskitProject(context);

    const result = await runWithProjectRequestContext(context, async () => {
      await service.reservePublicName({
        publicName: "beepollen"
      });
      const first = await service.publishCurrentProject();
      const second = await service.publishCurrentProject();
      const rollback = await service.rollbackRelease({
        releaseId: first.release.releaseId
      });
      return {
        first,
        rollback,
        second
      };
    });

    assert.equal(result.first.ok, true);
    assert.equal(result.second.ok, true);
    assert.notEqual(result.first.release.releaseId, result.second.release.releaseId);
    assert.equal(result.rollback.ok, true);
    assert.equal(result.rollback.currentRelease.releaseId, result.first.release.releaseId);
    assert.equal(result.rollback.currentRelease.rolledBackAt.length > 0, true);
  });
});

test("Vibe64 deployment service reserves public names once per tenant and idempotently per project", async () => {
  await withTemporaryRoot(async (root) => {
    const service = await createDeploymentTestService(root);

    const reserved = await inProject(root, "beepollen", () => service.reservePublicName({
      publicName: "beepollen"
    }));
    assert.equal(reserved.ok, true);
    assert.equal(reserved.publicName.publicName, "beepollen");
    assert.equal(reserved.publicName.publicHost, "beepollen.users.vibe64.dev");

    const repeated = await inProject(root, "beepollen", () => service.reservePublicName({
      publicName: "beepollen"
    }));
    assert.equal(repeated.ok, true);
    assert.equal(repeated.publicName.publicName, "beepollen");

    const validationFromOwner = await inProject(root, "beepollen", () => service.validatePublicName({
      publicName: "beepollen"
    }));
    assert.equal(validationFromOwner.available, true);
    assert.equal(validationFromOwner.reservedByCurrentProject, true);

    const validationFromOtherProject = await inProject(root, "dogandgroom", () => service.validatePublicName({
      publicName: "beepollen"
    }));
    assert.equal(validationFromOtherProject.ok, true);
    assert.equal(validationFromOtherProject.available, false);
    assert.equal(validationFromOtherProject.code, "vibe64_public_name_unavailable");

    const conflict = await inProject(root, "dogandgroom", () => service.reservePublicName({
      publicName: "beepollen"
    }));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.errors[0].code, "vibe64_public_name_unavailable");
  });
});

test("Vibe64 deployment service blocks implicit public-name renames", async () => {
  await withTemporaryRoot(async (root) => {
    const service = await createDeploymentTestService(root);

    await inProject(root, "beepollen", () => service.reservePublicName({
      publicName: "beepollen"
    }));
    const rename = await inProject(root, "beepollen", () => service.reservePublicName({
      publicName: "other-name"
    }));

    assert.equal(rename.ok, false);
    assert.equal(rename.errors[0].code, "vibe64_public_name_already_configured");
  });
});

test("Vibe64 deployment service changes public names through the explicit change action", async () => {
  await withTemporaryRoot(async (root) => {
    const txtRecords = new Map();
    const fake = fakeSuccessfulRunCommand();
    const service = await createDeploymentTestService(root, {
      deploymentRunner: createDeploymentRunner({
        runCommand: fake.runCommand
      }),
      deploymentStore: createDeploymentStore({
        resolveTxtRecords: async (hostname) => txtRecords.get(hostname) || []
      })
    });
    const context = deploymentTestContext(root, "beepollen");
    await configureJskitProject(context);

    const result = await runWithProjectRequestContext(context, async () => {
      await service.reservePublicName({
        publicName: "beepollen"
      });
      const added = await service.addCustomDomain({
        hostname: "www.example.com"
      });
      const requiredRecord = added.domain.requiredDnsRecords[0];
      txtRecords.set(requiredRecord.host, [[requiredRecord.value]]);
      const verified = await service.verifyCustomDomain({
        hostname: "www.example.com"
      });
      const published = await service.publishCurrentProject();
      const changed = await service.changePublicName({
        publicName: "bee-live"
      });
      return {
        changed,
        published,
        requiredRecord,
        verified
      };
    });

    assert.equal(result.verified.ok, true);
    assert.equal(result.published.ok, true);
    assert.equal(result.changed.ok, true);
    assert.equal(result.changed.publicName.publicName, "bee-live");
    assert.equal(result.changed.publicName.publicHost, "bee-live.users.vibe64.dev");
    assert.equal(result.changed.domains[0].publicName, "bee-live");
    assert.equal(result.changed.domains[0].publicHost, "bee-live.users.vibe64.dev");
    assert.equal(result.changed.domains[0].verificationStatus, "verified");
    assert.equal(result.changed.domains[0].requiredDnsRecords[0].value, result.requiredRecord.value);

    const oldPublicName = await service.tlsAsk({
      domain: "beepollen.users.vibe64.dev"
    });
    assert.equal(oldPublicName.ok, false);
    assert.equal(oldPublicName.code, "vibe64_deployment_host_not_found");

    const newPublicName = await service.tlsAsk({
      domain: "bee-live.users.vibe64.dev"
    });
    assert.equal(newPublicName.ok, true);
    assert.equal(newPublicName.publicName, "bee-live");
    assert.equal(newPublicName.releaseId, result.published.release.releaseId);

    const customDomain = await service.tlsAsk({
      domain: "www.example.com"
    });
    assert.equal(customDomain.ok, true);
    assert.equal(customDomain.publicName, "bee-live");
    assert.equal(customDomain.releaseId, result.published.release.releaseId);

    const caddySite = await readFile(result.changed.caddy.sitePath, "utf8");
    assert.match(caddySite, /bee-live\.users\.vibe64\.dev/u);
    assert.doesNotMatch(caddySite, /beepollen\.users\.vibe64\.dev/u);
    assert.match(caddySite, /www\.example\.com/u);
    assert.equal(result.changed.currentRelease.caddy.publicName, "bee-live");
    assert.deepEqual(result.changed.currentRelease.caddy.hosts, [
      "bee-live.users.vibe64.dev",
      "www.example.com"
    ]);
    const currentRelease = JSON.parse(await readFile(
      path.join(context.projectLocalRoot, "deployments", "current.json"),
      "utf8"
    ));
    assert.equal(currentRelease.caddy.publicName, "bee-live");
    assert.deepEqual(currentRelease.caddy.hosts, [
      "bee-live.users.vibe64.dev",
      "www.example.com"
    ]);
    const releaseManifest = JSON.parse(await readFile(
      path.join(context.projectLocalRoot, "deployments", "releases", result.published.release.releaseId, "manifest.json"),
      "utf8"
    ));
    assert.equal(releaseManifest.caddy.publicName, "bee-live");
    await assert.rejects(
      () => readFile(path.join(context.systemRoot, "caddy", "sites", "beepollen.caddy"), "utf8"),
      { code: "ENOENT" }
    );
  });
});

test("Vibe64 deployment service stores custom domain bindings after public-name reservation", async () => {
  await withTemporaryRoot(async (root) => {
    const service = await createDeploymentTestService(root);

    const beforePublicName = await inProject(root, "beepollen", () => service.addCustomDomain({
      hostname: "www.example.com"
    }));
    assert.equal(beforePublicName.ok, false);
    assert.equal(beforePublicName.errors[0].code, "vibe64_public_name_required");

    await inProject(root, "beepollen", () => service.reservePublicName({
      publicName: "beepollen"
    }));
    const added = await inProject(root, "beepollen", () => service.addCustomDomain({
      hostname: "WWW.Example.com."
    }));
    assert.equal(added.ok, true);
    assert.equal(added.domain.hostname, "www.example.com");
    assert.equal(added.domain.publicHost, "beepollen.users.vibe64.dev");
    assert.equal(added.domain.requiredDnsRecords[0].type, "TXT");
    assert.equal(added.domain.verificationStatus, "pending");

    const listed = await inProject(root, "beepollen", () => service.listDomainBindings());
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.domains.map((domain) => domain.hostname), ["www.example.com"]);

    await inProject(root, "dogandgroom", () => service.reservePublicName({
      publicName: "dogandgroom"
    }));
    const conflict = await inProject(root, "dogandgroom", () => service.addCustomDomain({
      hostname: "www.example.com"
    }));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.errors[0].code, "vibe64_custom_domain_unavailable");
  });
});

test("Vibe64 deployment service verifies custom domains before TLS and route approval", async () => {
  await withTemporaryRoot(async (root) => {
    const txtRecords = new Map();
    const fake = fakeSuccessfulRunCommand();
    const service = await createDeploymentTestService(root, {
      deploymentRunner: createDeploymentRunner({
        runCommand: fake.runCommand
      }),
      deploymentStore: createDeploymentStore({
        resolveTxtRecords: async (hostname) => txtRecords.get(hostname) || []
      })
    });
    const context = deploymentTestContext(root, "beepollen");
    await configureJskitProject(context);

    const unpublishedTls = await runWithProjectRequestContext(context, async () => {
      await service.reservePublicName({
        publicName: "beepollen"
      });
      return service.tlsAsk({
        domain: "beepollen.users.vibe64.dev"
      });
    });
    assert.equal(unpublishedTls.ok, false);
    assert.equal(unpublishedTls.code, "vibe64_deployment_release_not_published");

    const published = await runWithProjectRequestContext(context, () => service.publishCurrentProject());
    assert.equal(published.ok, true);

    const publicNameTls = await service.tlsAsk({
      domain: "beepollen.users.vibe64.dev"
    });
    assert.equal(publicNameTls.ok, true);
    assert.equal(publicNameTls.certificateAllowed, true);
    assert.equal(publicNameTls.routeKind, "public-name");

    const publicNameRoute = await service.resolveHostRoute({
      host: "beepollen.users.vibe64.dev"
    });
    assert.equal(publicNameRoute.ok, true);
    assert.equal(publicNameRoute.project.slug, "beepollen");
    assert.match(publicNameRoute.target.internalBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.match(publicNameRoute.target.loopbackProxyTarget, /^127\.0\.0\.1:\d+$/u);

    const unknown = await service.tlsAsk({
      domain: "unknown.users.vibe64.dev"
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, "vibe64_deployment_host_not_found");

    const added = await runWithProjectRequestContext(context, () => service.addCustomDomain({
      hostname: "www.example.com"
    }));
    assert.equal(added.ok, true);

    const pendingCustomDomain = await service.tlsAsk({
      domain: "www.example.com"
    });
    assert.equal(pendingCustomDomain.ok, false);
    assert.equal(pendingCustomDomain.code, "vibe64_custom_domain_not_verified");

    const requiredRecord = added.domain.requiredDnsRecords[0];
    txtRecords.set(requiredRecord.host, [[requiredRecord.value]]);
    const verified = await runWithProjectRequestContext(context, () => service.verifyCustomDomain({
      hostname: "www.example.com"
    }));
    assert.equal(verified.ok, true);
    assert.equal(verified.domain.verificationStatus, "verified");

    const customDomainTls = await service.tlsAsk({
      domain: "www.example.com"
    });
    assert.equal(customDomainTls.ok, true);
    assert.equal(customDomainTls.routeKind, "custom-domain");

    const customDomainRoute = await service.resolveHostRoute({
      host: "www.example.com"
    });
    assert.equal(customDomainRoute.ok, true);
    assert.equal(customDomainRoute.release.releaseId, published.release.releaseId);
    assert.equal(customDomainRoute.target.internalBaseUrl, publicNameRoute.target.internalBaseUrl);

    const caddySite = await readFile(published.release.caddy.sitePath, "utf8");
    assert.match(caddySite, /beepollen\.users\.vibe64\.dev, www\.example\.com/u);
    const currentRelease = JSON.parse(await readFile(
      path.join(context.projectLocalRoot, "deployments", "current.json"),
      "utf8"
    ));
    assert.deepEqual(currentRelease.caddy.hosts, [
      "beepollen.users.vibe64.dev",
      "www.example.com"
    ]);
  });
});

test("Vibe64 deployment service keeps verified domain bindings pointed at the current release", async () => {
  await withTemporaryRoot(async (root) => {
    const txtRecords = new Map();
    const fake = fakeSuccessfulRunCommand();
    const service = await createDeploymentTestService(root, {
      deploymentRunner: createDeploymentRunner({
        runCommand: fake.runCommand
      }),
      deploymentStore: createDeploymentStore({
        resolveTxtRecords: async (hostname) => txtRecords.get(hostname) || []
      })
    });
    const context = deploymentTestContext(root, "beepollen");
    await configureJskitProject(context);

    const result = await runWithProjectRequestContext(context, async () => {
      await service.reservePublicName({
        publicName: "beepollen"
      });
      const added = await service.addCustomDomain({
        hostname: "www.example.com"
      });
      const requiredRecord = added.domain.requiredDnsRecords[0];
      txtRecords.set(requiredRecord.host, [[requiredRecord.value]]);
      const verifiedBeforePublish = await service.verifyCustomDomain({
        hostname: "www.example.com"
      });
      const first = await service.publishCurrentProject();
      const afterFirst = await service.listDomainBindings();
      const second = await service.publishCurrentProject();
      const afterSecond = await service.listDomainBindings();
      const rollback = await service.rollbackRelease({
        releaseId: first.release.releaseId
      });
      const afterRollback = await service.listDomainBindings();
      return {
        afterFirst,
        afterRollback,
        afterSecond,
        first,
        rollback,
        second,
        verifiedBeforePublish
      };
    });

    assert.equal(result.verifiedBeforePublish.ok, true);
    assert.equal(result.verifiedBeforePublish.domain.activeReleaseId, "");
    assert.equal(result.afterFirst.domains[0].activeReleaseId, result.first.release.releaseId);
    assert.equal(result.afterSecond.domains[0].activeReleaseId, result.second.release.releaseId);
    assert.equal(result.afterRollback.domains[0].activeReleaseId, result.first.release.releaseId);
    assert.equal(result.rollback.currentRelease.releaseId, result.first.release.releaseId);
    assert.equal(result.afterRollback.domains[0].lastRoutingHealthCheckAt.length > 0, true);
  });
});

test("Vibe64 deployment service keeps custom domains pending when DNS TXT is missing", async () => {
  await withTemporaryRoot(async (root) => {
    const service = await createDeploymentTestService(root, {
      deploymentStore: createDeploymentStore({
        resolveHostAddresses: async () => [],
        resolveTxtRecords: async () => []
      })
    });

    const result = await inProject(root, "beepollen", async () => {
      await service.reservePublicName({
        publicName: "beepollen"
      });
      await service.addCustomDomain({
        hostname: "www.example.com"
      });
      return service.verifyCustomDomain({
        hostname: "www.example.com"
      });
    });

    assert.equal(result.ok, false);
    assert.equal(result.verified, false);
    assert.equal(result.domain.verificationStatus, "pending");
  });
});

test("Vibe64 deployment service accepts hosts-file custom domains for local routing only", async () => {
  await withTemporaryRoot(async (root) => {
    const fake = fakeSuccessfulRunCommand();
    const service = await createDeploymentTestService(root, {
      deploymentRunner: createDeploymentRunner({
        runCommand: fake.runCommand
      }),
      deploymentStore: createDeploymentStore({
        resolveHostAddresses: async () => [{ address: "127.0.0.1" }],
        resolveTxtRecords: async () => []
      })
    });
    const context = deploymentTestContext(root, "beepollen");
    await configureJskitProject(context);

    const result = await runWithProjectRequestContext(context, async () => {
      await service.reservePublicName({
        publicName: "beepollen"
      });
      await service.addCustomDomain({
        hostname: "local.example.com"
      });
      const published = await service.publishCurrentProject();
      const verified = await service.verifyCustomDomain({
        hostname: "local.example.com"
      });
      const route = await service.resolveHostRoute({
        host: "local.example.com"
      });
      const tls = await service.tlsAsk({
        domain: "local.example.com"
      });
      return {
        published,
        route,
        tls,
        verified
      };
    });

    assert.equal(result.verified.ok, true);
    assert.equal(result.verified.domain.verificationMethod, "hosts_file");
    assert.equal(result.verified.domain.certificateStatus, "local_only");
    assert.deepEqual(result.verified.domain.observedHostAddresses, ["127.0.0.1"]);
    assert.equal(result.route.ok, true);
    assert.equal(result.route.release.releaseId, result.published.release.releaseId);
    assert.equal(result.route.certificateStatus, "local_only");
    assert.equal(result.tls.ok, false);
    assert.equal(result.tls.certificateAllowed, false);
    assert.equal(result.tls.code, "vibe64_custom_domain_certificate_not_ready");
  });
});

test("Vibe64 deployment service rejects platform domains as custom domains", async () => {
  await withTemporaryRoot(async (root) => {
    const service = await createDeploymentTestService(root);

    await inProject(root, "beepollen", () => service.reservePublicName({
      publicName: "beepollen"
    }));
    const platformDomain = await inProject(root, "beepollen", () => service.addCustomDomain({
      hostname: "docs.vibe64.com"
    }));

    assert.equal(platformDomain.ok, false);
    assert.equal(platformDomain.errors[0].code, "vibe64_custom_domain_platform_owned");
  });
});

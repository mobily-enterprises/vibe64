import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function commandResult(output = "") {
  return {
    exitCode: 0,
    ok: true,
    output,
    stderr: "",
    stdout: output
  };
}

function dockerDetachedRun(calls = []) {
  return calls.find((call) => {
    return call.command === "docker" &&
      call.args[0] === "run" &&
      call.args.includes("-d");
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
    assert.equal(manifest.publicHost, "beepollen.users.vibe64.dev");
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
    assert.match(publicNameRoute.target.internalBaseUrl, /^http:\/\/.+:4100$/u);

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
  });
});

test("Vibe64 deployment service keeps custom domains pending when DNS TXT is missing", async () => {
  await withTemporaryRoot(async (root) => {
    const service = await createDeploymentTestService(root, {
      deploymentStore: createDeploymentStore({
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

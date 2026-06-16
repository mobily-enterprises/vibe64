import {
  currentProjectLocalRoot,
  currentProjectRequestContext,
  currentProjectStateRoot,
  currentProjectTargetRoot
} from "@local/vibe64-core/server/projectRequestContext";
import {
  createVibe64ProjectAdapterContext
} from "@local/vibe64-adapters/server";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";

import {
  createDeploymentStore
} from "./deploymentStore.js";
import {
  createDeploymentRunner
} from "./deploymentRunner.js";
import {
  createCaddyRouteMaterializer
} from "./caddyRouteMaterializer.js";

function deploymentResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_deployment_request_failed",
    fallbackMessage: "Vibe64 deployment request failed."
  });
}

function createService({
  caddyRouteMaterializer = createCaddyRouteMaterializer(),
  clock,
  deploymentStore = createDeploymentStore({ clock }),
  deploymentRunner = createDeploymentRunner(),
  projectContext = getStudioProjectContext()
} = {}) {
  function deploymentContext() {
    const requestContext = currentProjectRequestContext();
    const targetRoot = String(currentProjectTargetRoot() || projectContext.targetRoot || "").trim();
    const selectedProject = projectContext.selectedProject || null;
    const projectSlug = String(requestContext?.slug || selectedProject?.slug || selectedProject?.name || "").trim();
    const projectLocalRoot = String(
      currentProjectLocalRoot() ||
      requestContext?.projectLocalRoot ||
      (targetRoot && typeof projectContext.projectLocalRootForTarget === "function"
        ? projectContext.projectLocalRootForTarget(targetRoot)
        : "")
    ).trim();
    const projectStateRoot = String(
      currentProjectStateRoot() ||
      requestContext?.projectStateRoot ||
      (targetRoot && typeof projectContext.projectStateRootForTarget === "function"
        ? projectContext.projectStateRootForTarget(targetRoot)
        : "")
    ).trim();
    return {
      projectLocalRoot,
      projectSlug,
      projectStateRoot,
      systemRoot: String(requestContext?.systemRoot || projectContext.systemRoot || "").trim(),
      targetRoot
    };
  }

  function deploymentSystemContext() {
    const requestContext = currentProjectRequestContext();
    return {
      systemRoot: String(requestContext?.systemRoot || projectContext.systemRoot || "").trim()
    };
  }

  async function readPublishPlanForCurrentProject() {
    const context = deploymentContext();
    const publishPlan = await readPublishPlan(context);
    return {
      ok: true,
      project: {
        projectRoot: context.targetRoot,
        slug: context.projectSlug
      },
      publishPlan
    };
  }

  async function readPublishPlan(context = deploymentContext()) {
    const adapterContext = createVibe64ProjectAdapterContext({
      projectLocalRoot: context.projectLocalRoot,
      projectSharedRoot: context.projectStateRoot,
      targetRoot: context.targetRoot
    });
    return adapterContext.readPublishPlan();
  }

  async function publishCurrentProject(input = {}) {
    const context = deploymentContext();
    if (input?.publicName) {
      await deploymentStore.reservePublicName(context, input);
    }
    const release = await deploymentRunner.publish({
      context,
      publishPlan: await readPublishPlan(context),
      store: deploymentStore
    });
    const caddy = await materializeCaddyRoute(context);
    const routedRelease = await deploymentStore.updateRelease(context, release.releaseId, {
      caddy
    });
    return {
      caddy,
      ok: true,
      release: routedRelease,
      state: await deploymentStore.readState(context)
    };
  }

  async function materializeCaddyRoute(context = deploymentContext()) {
    return caddyRouteMaterializer.materializeProject(context, await deploymentStore.readState(context));
  }

  async function materializeCurrentReleaseRoute(context = deploymentContext()) {
    const state = await deploymentStore.readState(context);
    const caddy = await caddyRouteMaterializer.materializeProject(context, state);
    if (state.currentRelease?.releaseId && caddy?.active === true) {
      await deploymentStore.updateRelease(context, state.currentRelease.releaseId, {
        caddy
      });
    }
    return caddy;
  }

  async function readStateWithMaterializedRoute(context = deploymentContext()) {
    const caddy = await materializeCurrentReleaseRoute(context);
    return {
      ...await deploymentStore.readState(context),
      caddy
    };
  }

  async function rollbackRelease(input = {}) {
    const context = deploymentContext();
    await deploymentStore.rollbackRelease(context, input);
    return readStateWithMaterializedRoute(context);
  }

  async function changePublicName(input = {}) {
    const context = deploymentContext();
    await deploymentStore.changePublicName(context, input);
    return readStateWithMaterializedRoute(context);
  }

  async function verifyCustomDomain(input = {}) {
    const context = deploymentContext();
    const result = await deploymentStore.verifyCustomDomain(context, input);
    return {
      ...result,
      ...(result.ok === true ? { caddy: await materializeCurrentReleaseRoute(context) } : {})
    };
  }

  return Object.freeze({
    async addCustomDomain(input = {}) {
      return deploymentResult(() => deploymentStore.addCustomDomain(deploymentContext(), input));
    },
    async changePublicName(input = {}) {
      return deploymentResult(() => changePublicName(input));
    },
    async listDomainBindings() {
      return deploymentResult(() => deploymentStore.listDomainBindings(deploymentContext()));
    },
    async listReleases() {
      return deploymentResult(() => deploymentStore.listReleases(deploymentContext()));
    },
    async publishCurrentProject(input = {}) {
      return deploymentResult(() => publishCurrentProject(input));
    },
    async readState() {
      return deploymentResult(() => deploymentStore.readState(deploymentContext()));
    },
    async readPublishPlan() {
      return deploymentResult(() => readPublishPlanForCurrentProject());
    },
    async resolveHostRoute(input = {}) {
      return deploymentResult(() => deploymentStore.resolveHostRoute(deploymentSystemContext(), input));
    },
    async reservePublicName(input = {}) {
      return deploymentResult(() => deploymentStore.reservePublicName(deploymentContext(), input));
    },
    async rollbackRelease(input = {}) {
      return deploymentResult(() => rollbackRelease(input));
    },
    async tlsAsk(input = {}) {
      return deploymentResult(() => deploymentStore.tlsAsk(deploymentSystemContext(), input));
    },
    async validatePublicName(input = {}) {
      return deploymentResult(() => deploymentStore.validatePublicNameAvailability(deploymentContext(), input));
    },
    async verifyCustomDomain(input = {}) {
      return deploymentResult(() => verifyCustomDomain(input));
    }
  });
}

export { createService };

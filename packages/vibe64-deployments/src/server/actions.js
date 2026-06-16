import {
  customDomainInputValidator,
  deploymentHostInputValidator,
  deploymentPublishInputValidator,
  deploymentStateReadInputValidator,
  deploymentTlsAskInputValidator,
  publicNameInputValidator,
  releaseIdInputValidator
} from "./inputSchemas.js";

const ACTION_ADD_CUSTOM_DOMAIN = "feature.vibe64-deployments.domains.add";
const ACTION_CHANGE_PUBLIC_NAME = "feature.vibe64-deployments.public-name.change";
const ACTION_RESOLVE_HOST_ROUTE = "feature.vibe64-deployments.route.resolve";
const ACTION_LIST_DOMAIN_BINDINGS = "feature.vibe64-deployments.domains.list";
const ACTION_LIST_RELEASES = "feature.vibe64-deployments.releases.list";
const ACTION_PUBLISH_PROJECT = "feature.vibe64-deployments.publish.run";
const ACTION_READ_PUBLISH_PLAN = "feature.vibe64-deployments.publish-plan.read";
const ACTION_READ_DEPLOYMENT_STATE = "feature.vibe64-deployments.state.read";
const ACTION_RESERVE_PUBLIC_NAME = "feature.vibe64-deployments.public-name.reserve";
const ACTION_ROLLBACK_RELEASE = "feature.vibe64-deployments.releases.rollback";
const ACTION_TLS_ASK = "feature.vibe64-deployments.tls.ask";
const ACTION_VALIDATE_PUBLIC_NAME = "feature.vibe64-deployments.public-name.validate";
const ACTION_VERIFY_CUSTOM_DOMAIN = "feature.vibe64-deployments.domains.verify";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_DEPLOYMENT_STATE,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: deploymentStateReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_DEPLOYMENT_STATE
    },
    observability: {},
    async execute(_input, _context, deps) {
      return deps.featureService.readState();
    }
  },
  {
    id: ACTION_READ_PUBLISH_PLAN,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: deploymentStateReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_PUBLISH_PLAN
    },
    observability: {},
    async execute(_input, _context, deps) {
      return deps.featureService.readPublishPlan();
    }
  },
  {
    id: ACTION_LIST_RELEASES,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: deploymentStateReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_LIST_RELEASES
    },
    observability: {},
    async execute(_input, _context, deps) {
      return deps.featureService.listReleases();
    }
  },
  {
    id: ACTION_PUBLISH_PROJECT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: deploymentPublishInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_PUBLISH_PROJECT
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.featureService.publishCurrentProject(input);
    }
  },
  {
    id: ACTION_ROLLBACK_RELEASE,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: releaseIdInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_ROLLBACK_RELEASE
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.featureService.rollbackRelease(input);
    }
  },
  {
    id: ACTION_VALIDATE_PUBLIC_NAME,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: publicNameInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_VALIDATE_PUBLIC_NAME
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.featureService.validatePublicName(input);
    }
  },
  {
    id: ACTION_RESERVE_PUBLIC_NAME,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: publicNameInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RESERVE_PUBLIC_NAME
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.featureService.reservePublicName(input);
    }
  },
  {
    id: ACTION_CHANGE_PUBLIC_NAME,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: publicNameInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_CHANGE_PUBLIC_NAME
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.featureService.changePublicName(input);
    }
  },
  {
    id: ACTION_LIST_DOMAIN_BINDINGS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: deploymentStateReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_LIST_DOMAIN_BINDINGS
    },
    observability: {},
    async execute(_input, _context, deps) {
      return deps.featureService.listDomainBindings();
    }
  },
  {
    id: ACTION_ADD_CUSTOM_DOMAIN,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: customDomainInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_ADD_CUSTOM_DOMAIN
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.featureService.addCustomDomain(input);
    }
  },
  {
    id: ACTION_VERIFY_CUSTOM_DOMAIN,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: customDomainInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_VERIFY_CUSTOM_DOMAIN
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.featureService.verifyCustomDomain(input);
    }
  },
  {
    id: ACTION_TLS_ASK,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: deploymentTlsAskInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_TLS_ASK
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.featureService.tlsAsk(input);
    }
  },
  {
    id: ACTION_RESOLVE_HOST_ROUTE,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: deploymentHostInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_RESOLVE_HOST_ROUTE
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.featureService.resolveHostRoute(input);
    }
  }
]);

export {
  ACTION_ADD_CUSTOM_DOMAIN,
  ACTION_CHANGE_PUBLIC_NAME,
  ACTION_RESOLVE_HOST_ROUTE,
  ACTION_LIST_DOMAIN_BINDINGS,
  ACTION_LIST_RELEASES,
  ACTION_PUBLISH_PROJECT,
  ACTION_READ_PUBLISH_PLAN,
  ACTION_READ_DEPLOYMENT_STATE,
  ACTION_RESERVE_PUBLIC_NAME,
  ACTION_ROLLBACK_RELEASE,
  ACTION_TLS_ASK,
  ACTION_VALIDATE_PUBLIC_NAME,
  ACTION_VERIFY_CUSTOM_DOMAIN,
  featureActions
};

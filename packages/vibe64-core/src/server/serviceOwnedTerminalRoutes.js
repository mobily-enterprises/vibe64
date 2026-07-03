import {
  registerTerminalWebSocketRoute
} from "./terminalWebSocketRoutes.js";

const REQUIRED_METHOD_KEYS = [
  "start",
  "read",
  "close",
  "subscribe",
  "write",
  "resize"
];

function registerServiceOwnedTerminalRoutes(app, routes, {
  basePath,
  body = null,
  buildAccessInput = () => ({}),
  buildStartInput = null,
  getService = null,
  methods = {},
  projectContext = null,
  serviceId,
  serviceUnavailableMessage,
  summaries = {}
} = {}) {
  validateServiceOwnedTerminalRouteOptions(app, routes, {
    basePath,
    buildAccessInput,
    buildStartInput,
    getService,
    methods,
    serviceId,
    serviceUnavailableMessage
  });

  const startInput = buildStartInput || ((request) => routes.requestBody(request));
  const resolveService = getService || (() => app.make(serviceId));

  routes.serviceRoute("POST", basePath, {
    body,
    summary: summaries.start
  }, (request) => {
    const service = resolveService(request);
    return serviceMethod(service, methods.start)(startInput(request));
  });

  routes.serviceRoute("GET", `${basePath}/:terminalSessionId`, {
    statusCode: 200,
    summary: summaries.read
  }, (request) => {
    const service = resolveService(request);
    return serviceMethod(service, methods.read)(
      request.params.terminalSessionId,
      buildAccessInput(request)
    );
  });

  routes.serviceRoute("DELETE", `${basePath}/:terminalSessionId`, {
    statusCode: 200,
    summary: summaries.close
  }, (request) => {
    const service = resolveService(request);
    return serviceMethod(service, methods.close)(
      request.params.terminalSessionId,
      buildAccessInput(request)
    );
  });

  registerTerminalWebSocketRoute(app, {
    projectContext,
    routePath: `${routes.routeBase}${basePath}/:terminalSessionId/ws`,
    serviceId,
    serviceUnavailableMessage,
    subscribe(service, { request, subscriber, terminalSessionId }) {
      return serviceMethod(service, methods.subscribe)(
        terminalSessionId,
        subscriber,
        buildAccessInput(request)
      );
    },
    resize(service, { cols, request, rows, terminalSessionId }) {
      return serviceMethod(service, methods.resize)(
        terminalSessionId,
        {
          cols,
          rows
        },
        buildAccessInput(request)
      );
    },
    write(service, { data, request, terminalSessionId }) {
      return serviceMethod(service, methods.write)(
        terminalSessionId,
        data,
        buildAccessInput(request)
      );
    }
  });
}

function validateServiceOwnedTerminalRouteOptions(app, routes, {
  basePath,
  buildAccessInput,
  buildStartInput,
  getService,
  methods,
  serviceId,
  serviceUnavailableMessage
}) {
  if (!app || typeof app.make !== "function") {
    throw new TypeError("registerServiceOwnedTerminalRoutes requires application make().");
  }
  if (!routes || typeof routes.serviceRoute !== "function") {
    throw new TypeError("registerServiceOwnedTerminalRoutes requires routes.serviceRoute().");
  }
  if (!routes || typeof routes.routeBase !== "string") {
    throw new TypeError("registerServiceOwnedTerminalRoutes requires routes.routeBase.");
  }
  if (typeof basePath !== "string" || basePath.length === 0) {
    throw new TypeError("registerServiceOwnedTerminalRoutes requires a basePath.");
  }
  if (!basePath.startsWith("/")) {
    throw new TypeError("registerServiceOwnedTerminalRoutes basePath must start with '/'.");
  }
  for (const methodKey of REQUIRED_METHOD_KEYS) {
    if (typeof methods?.[methodKey] !== "string" || methods[methodKey].length === 0) {
      throw new TypeError(`registerServiceOwnedTerminalRoutes requires methods.${methodKey}.`);
    }
  }
  if (typeof buildAccessInput !== "function") {
    throw new TypeError("registerServiceOwnedTerminalRoutes buildAccessInput must be a function.");
  }
  if (buildStartInput != null && typeof buildStartInput !== "function") {
    throw new TypeError("registerServiceOwnedTerminalRoutes buildStartInput must be a function.");
  }
  if (buildStartInput == null && typeof routes.requestBody !== "function") {
    throw new TypeError("registerServiceOwnedTerminalRoutes requires routes.requestBody() when buildStartInput is omitted.");
  }
  if (getService != null && typeof getService !== "function") {
    throw new TypeError("registerServiceOwnedTerminalRoutes getService must be a function.");
  }
  if (typeof serviceId !== "string" || serviceId.length === 0) {
    throw new TypeError("registerServiceOwnedTerminalRoutes requires a serviceId.");
  }
  if (typeof serviceUnavailableMessage !== "string" || serviceUnavailableMessage.length === 0) {
    throw new TypeError("registerServiceOwnedTerminalRoutes requires a serviceUnavailableMessage.");
  }
}

function serviceMethod(service, methodName) {
  const method = service?.[methodName];
  if (typeof method !== "function") {
    throw new TypeError(`Service-owned terminal method "${methodName}" is unavailable.`);
  }
  return method.bind(service);
}

export {
  registerServiceOwnedTerminalRoutes
};

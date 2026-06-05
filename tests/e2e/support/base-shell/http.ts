function sseStatusPayload(status, itemsKey = "checks") {
  const items = Array.isArray(status?.[itemsKey]) ? status[itemsKey] : [];
  const events = [
    ["run.started", {}],
    ...items.flatMap((item) => [
      ["check.started", {
        id: item.id,
        label: item.label
      }],
      ["check.finished", {
        check: item,
        id: item.id,
        label: item.label,
        status: item.status
      }]
    ]),
    ["run.finished", {
      status
    }]
  ];

  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`)
    .join("\n")
    .concat("\n");
}

async function fulfillSse(route, status, itemsKey = "checks") {
  await route.fulfill({
    contentType: "text/event-stream",
    body: sseStatusPayload(status, itemsKey)
  });
}

async function fulfillJson(route, payload) {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(payload)
  });
}

function apiEndpointPattern(pathSuffix, {
  children = false,
  prefix = false
} = {}) {
  const suffix = `/${String(pathSuffix || "").trim().replace(/^\/+|\/+$/gu, "")}`;
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const trailingPattern = children ? "(?:/.*)" : prefix ? "(?:/.*)?" : "";
  return new RegExp(`/api(?:/app/[^/]+)?${escapedSuffix}${trailingPattern}(?:\\?.*)?$`, "u");
}

async function routeApiEndpoint(page, pathSuffix, handler, options = {}) {
  await page.route(apiEndpointPattern(pathSuffix, options), handler);
}

function trackStudioApiRequests(page) {
  const requests: string[] = [];

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/api/studio/") || /\/api\/app\/[^/]+\/studio\//u.test(pathname)) {
      requests.push(pathname);
    }
  });

  return {
    count(pathname: string) {
      return requests.filter((requestPathname) => requestPathname === pathname).length;
    },
    requests
  };
}

function setupReadinessPayload({
  currentStage = null,
  message = "",
  ready = true,
  stages = []
} = {}) {
  return {
    currentStage,
    message,
    ready,
    stages
  };
}

export {
  apiEndpointPattern,
  fulfillJson,
  fulfillSse,
  routeApiEndpoint,
  setupReadinessPayload,
  trackStudioApiRequests
};

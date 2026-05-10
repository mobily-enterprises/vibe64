import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import { currentAppQueryInputValidator } from "./inputSchemas.js";
import { ACTION_READ_CURRENT_APP } from "./actions.js";

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/",
    relativePath: routeRelativePath,
    strictParams: false
  });

  router.register(
    "GET",
    routeBase,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Inspect the current JSKIT app."
      },
      query: currentAppQueryInputValidator
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: ACTION_READ_CURRENT_APP,
        input: request.input.query || {}
      });

      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };

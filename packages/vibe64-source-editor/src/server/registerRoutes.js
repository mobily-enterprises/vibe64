import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

const SOURCE_EDITOR_SERVICE_ID = "feature.vibe64-source-editor.service";

function sourceEditorService(app) {
  return app.make(SOURCE_EDITOR_SERVICE_ID);
}

function registerRoutes(
  app,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 source editor routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-source-editor"]
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/tree", {
    summary: "Read the editable source tree for a Vibe64 session."
  }, (request) => {
    return sourceEditorService(app).readTree({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/files", {
    summary: "Find editable source files in a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditorService(app).listFiles({
      limit: query.limit,
      query: query.q,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/search", {
    summary: "Search editable source files in a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditorService(app).search({
      limit: query.limit,
      query: query.q,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations", {
    bodyLimit: 256 * 1024,
    summary: "Explain a selected source range in a Vibe64 session."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).explainSelection({
      endColumn: body.endColumn,
      endLine: body.endLine,
      force: body.force === true,
      path: body.path,
      sessionId: request.params.sessionId,
      startColumn: body.startColumn,
      startLine: body.startLine
    });
  });

  routes.serviceRoute("DELETE", "/sessions/:sessionId/source-editor/explanations/:explanationId", {
    summary: "Dispose a temporary source explanation chat in a Vibe64 session."
  }, (request) => {
    return sourceEditorService(app).deleteExplanation({
      explanationId: request.params.explanationId,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/:explanationId/followups", {
    bodyLimit: 128 * 1024,
    summary: "Add a follow-up question to a temporary source explanation chat."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).addExplanationFollowup({
      explanationId: request.params.explanationId,
      message: body.message,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/file", {
    summary: "Read an editable source file from a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditorService(app).readFile({
      path: query.path,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("PUT", "/sessions/:sessionId/source-editor/file", {
    bodyLimit: 2 * 1024 * 1024,
    summary: "Autosave an editable source file in a Vibe64 session."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).saveFile({
      baseHash: body.baseHash,
      path: body.path,
      sessionId: request.params.sessionId,
      text: body.text
    });
  });
}

export { registerRoutes };

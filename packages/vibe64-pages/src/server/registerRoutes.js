import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

import { PAGES_ACTIONS } from "./pagesActions.js";
import {
  frameHostContentSecurityPolicy,
  frameHostHtml,
  PAGE_FILES_ROUTE,
  pageContentSecurityPolicy,
  pageFileResponse,
  pageFilesBase,
  requestOrigin,
  sandboxHeaders
} from "./pageSandbox.js";

/** @typedef {import("./types.js").PagesService} PagesService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

const PAGES_BODY_LIMIT = 16 * 1024;

function pageInput(request) {
  return { pageId: request.params.pageId };
}

function pageBodyInput(request) {
  return { ...requestBody(request), pageId: request.params.pageId };
}

function pageVersionInput(request) {
  return { pageId: request.params.pageId, version: Number(request.params.version) };
}

/**
 * A page served to a sandbox has no one to explain an error to: plain text.
 * @param {object} reply
 * @param {number} status
 * @param {string} message
 */
function plainRefusal(reply, status, message) {
  reply.code(status).headers({
    ...sandboxHeaders("default-src 'none'; sandbox"),
    "content-type": "text/plain; charset=utf-8"
  }).send(message);
}

const LINK_ENDED = "This page link has ended. Open the page again from Vibe64's Pages list.";

/**
 * The project members' page routes, through the project access check, and
 * the viewing link's frame and files, which carry their own authority.
 * @param {RuntimeHttp} http
 * @param {object} capabilities
 * @param {boolean} capabilities.localhostCheckBypassed
 * @param {StudioProjectContext} capabilities.projectContext
 * @param {PagesService} capabilities.pages
 */
function registerRoutes(http, { localhostCheckBypassed, projectContext, pages }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-pages"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Vibe64 page routes only accept requests from this computer.",
      projectContext
    })
  });
  routes.actionRoute("GET", "/pages", {
    actionId: PAGES_ACTIONS.LIST,
    summary: "List this project's pages, current and archived.",
    bodyLimit: PAGES_BODY_LIMIT
  });
  routes.actionRoute("GET", "/pages/stars", {
    actionId: PAGES_ACTIONS.STARS_READ,
    summary: "List the current pages this person starred.",
    bodyLimit: PAGES_BODY_LIMIT
  });
  routes.actionRoute("GET", "/pages/:pageId", {
    actionId: PAGES_ACTIONS.READ,
    buildInput: pageInput,
    summary: "Read one page's title, maker, times and state.",
    bodyLimit: PAGES_BODY_LIMIT
  });
  routes.actionRoute("POST", "/pages/:pageId/view", {
    actionId: PAGES_ACTIONS.VIEW_OPEN,
    buildInput: pageBodyInput,
    summary: "Open a short-lived viewing link to one page.",
    bodyLimit: PAGES_BODY_LIMIT
  });
  routes.actionRoute("POST", "/pages/:pageId/star", {
    actionId: PAGES_ACTIONS.STAR_SET,
    buildInput: pageBodyInput,
    summary: "Star or unstar a page for this person.",
    bodyLimit: PAGES_BODY_LIMIT
  });
  routes.actionRoute("POST", "/pages/:pageId/archive", {
    actionId: PAGES_ACTIONS.ARCHIVE,
    buildInput: pageInput,
    summary: "Archive a page.",
    bodyLimit: PAGES_BODY_LIMIT
  });
  routes.actionRoute("POST", "/pages/:pageId/restore", {
    actionId: PAGES_ACTIONS.RESTORE,
    buildInput: pageInput,
    summary: "Restore an archived page.",
    bodyLimit: PAGES_BODY_LIMIT
  });
  routes.actionRoute("POST", "/pages/:pageId/versions/:version/restore", {
    actionId: PAGES_ACTIONS.VERSION_RESTORE,
    buildInput: pageVersionInput,
    summary: "Bring back an earlier kept version of a page as its newest one.",
    bodyLimit: PAGES_BODY_LIMIT
  });
  routes.actionRoute("DELETE", "/pages/:pageId", {
    actionId: PAGES_ACTIONS.DELETE,
    buildInput: pageInput,
    summary: "Delete an archived page and its kept versions.",
    bodyLimit: PAGES_BODY_LIMIT
  });

  // The viewing link is the whole authority of these two: a sandboxed page
  // sends no cookie and has an opaque origin, so no Studio check could pass.
  const viewing = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-pages"] }), {
    relativePath: "vibe64/pages",
    surface: "app"
  });
  viewing.serviceRoute("GET", "/view/:token", {
    summary: "Show a page through its viewing link, in a sandboxed frame that may only show the page's own files."
  }, async (request, reply) => {
    const viewed = await pages.viewedPage(request.params.token);
    const origin = requestOrigin(request);
    if (!viewed) return plainRefusal(reply, 404, LINK_ENDED);
    if (!origin) return plainRefusal(reply, 400, "This page link needs the address it was opened at.");
    const filesBase = pageFilesBase(origin, request.params.token);
    return reply.code(200).headers({
      ...sandboxHeaders(frameHostContentSecurityPolicy(filesBase)),
      "content-type": "text/html; charset=utf-8"
    }).send(frameHostHtml({
      title: viewed.record.title,
      filesPath: `${PAGE_FILES_ROUTE}/${request.params.token}/`,
      theme: viewed.link.theme
    }));
  });
  viewing.serviceRoute("GET", "/files/:token/*", {
    summary: "Serve one of a page's own files through its viewing link, sandboxed."
  }, async (request, reply) => {
    const viewed = await pages.viewedPage(request.params.token);
    const origin = requestOrigin(request);
    if (!viewed) return plainRefusal(reply, 404, LINK_ENDED);
    if (!origin) return plainRefusal(reply, 400, "This page link needs the address it was opened at.");
    const response = await pageFileResponse({
      link: viewed.link,
      requested: String(request.params["*"] || ""),
      versionFolder: viewed.versionFolder,
      font: pages.font
    });
    if (!response) return plainRefusal(reply, 404, "This page has no such file.");
    return reply.code(200).headers({
      ...sandboxHeaders(pageContentSecurityPolicy(pageFilesBase(origin, request.params.token))),
      // Its own scripts fetch its files from an opaque origin.
      "access-control-allow-origin": "*",
      "content-type": response.contentType
    }).send(response.body);
  });
}

export { registerRoutes };

import { describe, expect, it } from "vitest";

import {
  previewRouteHasParams,
  previewRouteInitialFormValues,
  previewRouteParams,
  previewRoutePath,
  previewRoutesForTarget
} from "../../src/lib/vibe64PreviewRoutes.js";

describe("Vibe64 preview routes", () => {
  it("uses only adapter-declared preview routes", () => {
    expect(previewRoutesForTarget({
      previewRoutes: [
        { id: "home", label: "Home", pathTemplate: "/home" },
        { label: "Broken route", pathTemplate: "/broken" },
        { id: "missing-path", label: "Missing path" }
      ]
    })).toEqual([
      { id: "home", label: "Home", pathTemplate: "/home" }
    ]);
  });

  it("resolves parameterized route templates", () => {
    const route = {
      id: "job",
      pathTemplate: "/w/:workspaceSlug/admin/jobs/:jobId",
      params: [
        {
          defaultValue: "mercmobily",
          name: "workspaceSlug"
        },
        {
          label: "Job",
          name: "jobId"
        }
      ]
    };

    expect(previewRouteHasParams(route)).toBe(true);
    expect(previewRouteInitialFormValues(route)).toEqual({
      jobId: "",
      workspaceSlug: "mercmobily"
    });
    expect(previewRoutePath(route, {
      jobId: "11514",
      workspaceSlug: "merc mobily"
    })).toEqual({
      missingParam: "",
      ok: true,
      path: "/w/merc%20mobily/admin/jobs/11514"
    });
    expect(previewRoutePath(route, {
      workspaceSlug: "mercmobily"
    })).toMatchObject({
      missingParam: "jobId",
      ok: false
    });
  });

  it("infers missing parameter metadata from the route template", () => {
    expect(previewRouteParams({
      id: "job",
      pathTemplate: "/w/:workspaceSlug/admin/jobs/:jobId"
    })).toEqual([
      {
        label: "Workspace Slug",
        name: "workspaceSlug",
        placeholder: "workspaceSlug",
        required: true
      },
      {
        label: "Job Id",
        name: "jobId",
        placeholder: "jobId",
        required: true
      }
    ]);
  });
});

import { expect, test } from "@playwright/test";

import {
  DEVELOPMENT_PATH,
  readyProjectConfigPayload,
  targetRoot
} from "./support/base-shell-data";
import {
  fulfillJson,
  routeApiEndpoint
} from "./support/base-shell/http";
import {
  mockProtectedRouteReady
} from "./support/base-shell/setup-mocks";

test("empty project setup shows the recommended technology before alternatives", async ({ page }) => {
  let configSavePayload = null;
  let projectTypeSaved = false;
  let projectTypePutCount = 0;
  const configReadProjectTypes: string[] = [];

  await mockProtectedRouteReady(page);
  await routeApiEndpoint(page, "/vibe64/project-type", async (route) => {
    if (route.request().method().toUpperCase() === "PUT") {
      projectTypePutCount += 1;
      projectTypeSaved = true;
      await fulfillJson(route, savedProjectTypePayload());
      return;
    }
    await fulfillJson(route, projectTypeSaved ? savedProjectTypePayload() : missingProjectTypePayload());
  });
  await routeApiEndpoint(page, "/vibe64/project-config", async (route) => {
    const request = route.request();
    if (request.method().toUpperCase() === "PUT") {
      configSavePayload = request.postDataJSON();
      projectTypeSaved = true;
    } else {
      configReadProjectTypes.push(new URL(request.url()).searchParams.get("projectType") || "");
    }
    await fulfillJson(route, readyProjectConfigPayload);
  });

  await page.goto(`${DEVELOPMENT_PATH}?vibe64_e2e=1`);

  await expect(page.getByRole("heading", { name: "Choose app type" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Web application Build something people use in a browser." })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "JSKIT AI" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Next.js" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Laravel" })).toHaveCount(0);

  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { name: "JSKIT AI is the default" })).toBeVisible();
  await expect(page.getByText("Recommended for Web application.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use JSKIT AI" })).toBeVisible();
  await expect(page.getByText("Best for")).toHaveCount(0);

  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByText("Best for")).toBeVisible();
  await expect(page.getByText("End result")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next.js" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Laravel" })).toHaveCount(0);

  await page.getByRole("button", { name: "Alternatives (2)" }).click();

  await expect(page.getByRole("heading", { name: "Next.js" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Laravel" })).toBeVisible();

  await page.getByRole("button", { name: "Back to app type" }).click();
  await page.getByRole("button", { name: "Phone app" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { name: "JSKIT AI is the default" })).toBeVisible();
  await expect(page.getByText("Recommended for Phone app.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Alternatives (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next.js" })).toHaveCount(0);

  await page.getByRole("button", { name: "Use JSKIT AI" }).click();

  await expect(page.locator(".project-config-setup")).toBeVisible();
  await expect(page.getByText("Phone app / JSKIT AI")).toBeVisible();
  expect(projectTypePutCount).toBe(0);
  expect(configReadProjectTypes).toContain("jskit");

  await page.getByRole("button", { name: "Change app type" }).click();
  await expect(page.getByRole("heading", { name: "Choose app type" })).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Use JSKIT AI" }).click();
  await page.getByRole("button", { name: "Save config" }).click();

  await expect.poll(() => configSavePayload).toMatchObject({
    projectType: "jskit"
  });
  expect(projectTypePutCount).toBe(0);
});

function savedProjectTypePayload() {
  return {
    ok: true,
    projectType: {
      ...missingProjectTypePayload().projectType,
      adapter: {
        id: "jskit",
        label: "JSKIT AI"
      },
      errorCode: "",
      message: "",
      projectType: "jskit",
      ready: true,
      status: "ready"
    }
  };
}

function missingProjectTypePayload() {
  const adapters = {
    jskit: {
      bestFor: "Production CRUD and operations apps where Vibe64 can lean on JSKIT conventions.",
      description: "Web apps written in Vue and Node.js, using JSKIT conventions built for AI-assisted product work.",
      enabled: true,
      explanation: "Studio prepares a JSKIT application with its provider layout and app scripts.",
      id: "jskit",
      label: "JSKIT AI",
      outcome: "A JSKIT application with provider layout, package scripts, and runtime expectations.",
      projectUrl: "https://www.npmjs.com/package/@jskit-ai/jskit-cli",
      projectUrlLabel: "Open JSKIT",
      summary: "Full-stack Vue and Node.js apps using JSKIT conventions.",
      techStack: ["Vue", "Node.js", "JSKIT"]
    },
    nextjs: {
      bestFor: "General-purpose React products and SaaS apps.",
      description: "React web apps and full-stack products built around the standard Next.js ecosystem.",
      enabled: true,
      explanation: "Studio seeds or inspects a Next.js app.",
      id: "nextjs",
      label: "Next.js",
      outcome: "A Next.js application with common TypeScript and database options.",
      projectUrl: "https://nextjs.org",
      projectUrlLabel: "Open Next.js",
      summary: "React and full-stack web apps built around Next.js.",
      techStack: ["React", "Next.js", "TypeScript"]
    },
    laravel: {
      bestFor: "Full-stack PHP products, admin systems, and API backends.",
      description: "Full-stack PHP web applications and API-backed products using Laravel conventions.",
      enabled: true,
      explanation: "Studio seeds or inspects a Laravel app.",
      id: "laravel",
      label: "Laravel",
      outcome: "A Laravel application with official starter kit choices.",
      projectUrl: "https://laravel.com",
      projectUrlLabel: "Open Laravel",
      summary: "Full-stack PHP products using Laravel conventions.",
      techStack: ["PHP", "Laravel", "Composer"]
    },
    cpp: {
      bestFor: "Native utilities and low-level services.",
      description: "Native software that runs close to the machine.",
      enabled: true,
      explanation: "Studio prepares a C++ project.",
      id: "cpp",
      label: "C++",
      outcome: "A C++ project with build tooling.",
      projectUrl: "https://isocpp.org",
      projectUrlLabel: "Open C++",
      summary: "Native system software.",
      techStack: ["C++", "CMake"]
    }
  };

  return {
    ok: true,
    projectType: {
      availableApplicationTypes: [
        {
          adapters: [adapters.jskit, adapters.nextjs, adapters.laravel],
          description: "Browser-based products, dashboards, admin systems, SaaS apps, and full-stack web applications.",
          icon: "web_application",
          id: "web_application",
          label: "Web application",
          summary: "Build something people use in a browser."
        },
        {
          adapters: [adapters.jskit, adapters.nextjs],
          description: "Mobile products that start from a web app base.",
          icon: "phone_app",
          id: "phone_app",
          label: "Phone app",
          summary: "Build a mobile app from a web app base."
        },
        {
          adapters: [adapters.cpp],
          description: "Native software that runs close to the machine.",
          icon: "system_program",
          id: "system_program",
          label: "System program",
          summary: "Build native software that runs close to the machine."
        }
      ],
      availableProjectTypes: [adapters.jskit, adapters.nextjs, adapters.laravel, adapters.cpp],
      errorCode: "",
      message: "",
      path: `${targetRoot}/.vibe64/project_type`,
      projectType: "",
      ready: false,
      status: "missing",
      targetRoot
    }
  };
}

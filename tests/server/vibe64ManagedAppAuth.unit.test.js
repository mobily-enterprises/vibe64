import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_APP_AUTH_ENV,
  VIBE64_APP_AUTH_MODE_CONFIG,
  VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE,
  VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG,
  VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG
} from "@local/vibe64-core/shared";
import {
  appAuthSmtpLoginPath,
  appAuthPatPath,
  createManagedAppAuthService
} from "../../packages/vibe64-accounts/src/server/managedAppAuthService.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status
  });
}

function createSupabaseFetch({
  organizations = [
    {
      name: "Personal",
      slug: "personal"
    }
  ]
} = {}) {
  const calls = [];
  const projects = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const pathname = `${parsed.pathname}${parsed.search}`;
    const method = String(options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({
      body,
      method,
      pathname
    });

    if (method === "GET" && pathname === "/v1/organizations") {
      return jsonResponse(organizations);
    }
    if (method === "GET" && pathname === "/v1/projects") {
      return jsonResponse(projects);
    }
    if (method === "POST" && pathname === "/v1/projects") {
      const ref = String(body.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-|-$/gu, "");
      const project = {
        id: ref,
        name: body.name,
        ref,
        status: "ACTIVE"
      };
      projects.push(project);
      return jsonResponse(project, 201);
    }
    const apiKeysMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/api-keys\?reveal=true$/u);
    if (method === "GET" && apiKeysMatch) {
      return jsonResponse([
        {
          api_key: `pk_${apiKeysMatch[1]}`,
          name: "publishable",
          type: "publishable"
        }
      ]);
    }
    const authConfigMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/config\/auth$/u);
    if (method === "GET" && authConfigMatch) {
      return jsonResponse({
        uri_allow_list: "https://existing.example.com"
      });
    }
    if (method === "PATCH" && authConfigMatch) {
      return jsonResponse({
        ref: authConfigMatch[1],
        uri_allow_list: body.uri_allow_list
      });
    }
    return jsonResponse({
      message: `Unhandled fake Supabase route: ${method} ${pathname}`
    }, 404);
  };
  return {
    calls,
    fetchImpl,
    projects
  };
}

test("managed app auth creates shared Supabase dev/prod projects from a PAT", async () => {
  await withTemporaryRoot(async (root) => {
    const systemRoot = path.join(root, "system");
    const providerHomesRoot = path.join(root, "providers");
    const supabase = createSupabaseFetch();
    const service = createManagedAppAuthService({
      fetchImpl: supabase.fetchImpl,
      providerHomesRoot,
      systemRoot
    });

    const before = await service.getStatus();
    assert.equal(before.ok, true);
    assert.equal(before.tokenPresent, false);
    assert.equal(before.ready, false);

    const setup = await service.setup({
      accessToken: "sbp_unit_pat",
      regionGroup: "americas"
    });
    assert.equal(setup.ok, true);
    assert.equal(setup.ready, true);
    assert.equal(setup.tokenPresent, true);
    assert.equal(setup.projects.dev.name, "Vibe64 Auth Dev");
    assert.equal(setup.projects.dev.publishableKeyPresent, true);
    assert.equal(setup.projects.prod.name, "Vibe64 Auth Prod");
    assert.equal(setup.projects.prod.publishableKeyPresent, true);
    assert.equal(Object.hasOwn(setup.projects.dev, "publishableKey"), false);
    assert.equal(await readFile(appAuthPatPath(providerHomesRoot), "utf8"), "sbp_unit_pat\n");
    assert.equal(supabase.calls.filter((call) => call.method === "POST" && call.pathname === "/v1/projects").length, 2);

    const managedEnv = await service.projectEnvironment({
      projectConfig: {
        values: {
          vibe64_app_auth_environment: "prod",
          [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE
        }
      }
    });
    assert.equal(managedEnv[VIBE64_APP_AUTH_ENV.mode], VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE);
    assert.equal(managedEnv[VIBE64_APP_AUTH_ENV.supabaseUrl], "https://vibe64-auth-dev.supabase.co");
    assert.equal(managedEnv[VIBE64_APP_AUTH_ENV.supabasePublishableKey], "pk_vibe64-auth-dev");
    assert.equal(managedEnv[VIBE64_APP_AUTH_ENV.targetEnvironment], "dev");
  });
});

test("managed app auth connects a PAT without creating projects", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "providers");
    const supabase = createSupabaseFetch();
    const service = createManagedAppAuthService({
      fetchImpl: supabase.fetchImpl,
      providerHomesRoot,
      systemRoot: path.join(root, "system")
    });

    const connected = await service.connect({
      accessToken: "sbp_unit_pat",
      regionGroup: "emea"
    });

    assert.equal(connected.ok, true);
    assert.equal(connected.tokenPresent, true);
    assert.equal(connected.ready, false);
    assert.equal(connected.organizationSlug, "personal");
    assert.equal(connected.regionGroup, "emea");
    assert.equal(await readFile(appAuthPatPath(providerHomesRoot), "utf8"), "sbp_unit_pat\n");
    assert.equal(supabase.calls.some((call) => call.method === "POST" && call.pathname === "/v1/projects"), false);
  });
});

test("managed app auth accepts only current setup and SMTP field names", async () => {
  await withTemporaryRoot(async (root) => {
    const service = createManagedAppAuthService({
      fetchImpl: createSupabaseFetch().fetchImpl,
      providerHomesRoot: path.join(root, "providers"),
      systemRoot: path.join(root, "system")
    });

    const setup = await service.setup({
      pat: "sbp_legacy_pat"
    });
    assert.equal(setup.ok, false);
    assert.equal(setup.code, "vibe64_supabase_pat_required");

    const smtp = await service.saveSmtpLogin({
      fromEmail: "auth@example.com",
      fromName: "Example Auth",
      host: "smtp.example.com",
      password: "password with spaces",
      port: "587",
      username: "smtp-user"
    });
    assert.equal(smtp.ok, false);
    assert.equal(smtp.code, "vibe64_smtp_login_required");
    assert.deepEqual(smtp.missing, [
      "smtpHost",
      "smtpPassword",
      "smtpPort",
      "smtpUser"
    ]);
  });
});

test("managed app auth creates projects from a stored PAT after organization choice", async () => {
  await withTemporaryRoot(async (root) => {
    const supabase = createSupabaseFetch({
      organizations: [
        {
          name: "Alpha",
          slug: "alpha"
        },
        {
          name: "Beta",
          slug: "beta"
        }
      ]
    });
    const service = createManagedAppAuthService({
      fetchImpl: supabase.fetchImpl,
      providerHomesRoot: path.join(root, "providers"),
      systemRoot: path.join(root, "system")
    });

    const connected = await service.connect({
      accessToken: "sbp_unit_pat"
    });
    assert.equal(connected.ok, true);
    assert.equal(connected.ready, false);
    assert.equal(connected.organizationSlug, "");
    assert.deepEqual(connected.organizations.map((organization) => organization.slug), ["alpha", "beta"]);

    const setup = await service.setup({
      organizationSlug: "beta"
    });
    assert.equal(setup.ok, true);
    assert.equal(setup.ready, true);
    assert.equal(setup.organizationSlug, "beta");
    assert.equal(setup.projects.dev.publishableKeyPresent, true);
    assert.equal(setup.projects.prod.publishableKeyPresent, true);
    assert.equal(supabase.calls.filter((call) => call.method === "POST" && call.pathname === "/v1/projects").length, 2);
  });
});

test("managed app auth requires organization choice when a PAT can see multiple Supabase orgs", async () => {
  await withTemporaryRoot(async (root) => {
    const supabase = createSupabaseFetch({
      organizations: [
        {
          name: "Alpha",
          slug: "alpha"
        },
        {
          name: "Beta",
          slug: "beta"
        }
      ]
    });
    const service = createManagedAppAuthService({
      fetchImpl: supabase.fetchImpl,
      providerHomesRoot: path.join(root, "providers"),
      systemRoot: path.join(root, "system")
    });

    const setup = await service.setup({
      accessToken: "sbp_unit_pat"
    });
    assert.equal(setup.ok, false);
    assert.equal(setup.errors[0].code, "vibe64_supabase_organization_required");
    assert.deepEqual(setup.organizations.map((organization) => organization.slug), ["alpha", "beta"]);
    assert.equal(supabase.calls.some((call) => call.method === "POST" && call.pathname === "/v1/projects"), false);
  });
});

test("managed app auth sync groups redirect URLs by managed environment", async () => {
  await withTemporaryRoot(async (root) => {
    const supabase = createSupabaseFetch();
    const service = createManagedAppAuthService({
      fetchImpl: supabase.fetchImpl,
      providerHomesRoot: path.join(root, "providers"),
      redirectUrlResolvers: [
        async () => ({
          redirectUrlsByEnvironment: {
            dev: [
              "https://dev.example.com",
              "https://dev.example.com/**"
            ],
            prod: [
              "https://prod.example.com",
              "https://prod.example.com/**"
            ]
          }
        })
      ],
      systemRoot: path.join(root, "system")
    });

    const setup = await service.setup({
      accessToken: "sbp_unit_pat"
    });
    assert.equal(setup.ok, true);
    assert.equal(setup.sync.changed, true);

    const patches = supabase.calls.filter((call) => call.method === "PATCH" && /\/config\/auth$/u.test(call.pathname));
    assert.equal(patches.length, 2);
    const devPatch = patches.find((call) => call.pathname.includes("/vibe64-auth-dev/"));
    const prodPatch = patches.find((call) => call.pathname.includes("/vibe64-auth-prod/"));
    assert.match(devPatch.body.uri_allow_list, /https:\/\/dev\.example\.com\/\*\*/u);
    assert.doesNotMatch(devPatch.body.uri_allow_list, /prod\.example\.com/u);
    assert.match(prodPatch.body.uri_allow_list, /https:\/\/prod\.example\.com\/\*\*/u);
    assert.doesNotMatch(prodPatch.body.uri_allow_list, /dev\.example\.com/u);
  });
});

test("managed app auth sync configures Supabase custom SMTP from saved SMTP login", async () => {
  await withTemporaryRoot(async (root) => {
    const supabase = createSupabaseFetch();
    const providerHomesRoot = path.join(root, "providers");
    const service = createManagedAppAuthService({
      fetchImpl: supabase.fetchImpl,
      providerHomesRoot,
      systemRoot: path.join(root, "system")
    });

    const saved = await service.saveSmtpLogin({
      fromEmail: "auth@example.com",
      fromName: "Example Auth",
      smtpHost: "smtp.example.com",
      smtpPassword: "password with spaces",
      smtpPort: "587",
      smtpUser: "smtp-user"
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.smtp.ready, true);
    assert.equal(saved.smtp.passwordPresent, true);
    assert.equal(Object.hasOwn(saved.smtp, "password"), false);
    assert.equal(Object.hasOwn(saved.smtp, "smtpPassword"), false);
    const storedSmtp = JSON.parse(await readFile(appAuthSmtpLoginPath(providerHomesRoot), "utf8"));
    assert.equal(storedSmtp.smtpPassword, "password with spaces");
    assert.equal((await stat(appAuthSmtpLoginPath(providerHomesRoot))).mode & 0o777, 0o600);

    const updated = await service.saveSmtpLogin({
      fromEmail: "login@example.com",
      fromName: "Example Login",
      smtpHost: "smtp2.example.com",
      smtpPassword: "",
      smtpPort: "2525",
      smtpUser: "smtp-user-2"
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.smtp.passwordPresent, true);
    const updatedStoredSmtp = JSON.parse(await readFile(appAuthSmtpLoginPath(providerHomesRoot), "utf8"));
    assert.equal(updatedStoredSmtp.fromEmail, "login@example.com");
    assert.equal(updatedStoredSmtp.smtpHost, "smtp2.example.com");
    assert.equal(updatedStoredSmtp.smtpPassword, "password with spaces");
    assert.equal(updatedStoredSmtp.smtpPort, "2525");

    const setup = await service.setup({
      accessToken: "sbp_unit_pat"
    });

    assert.equal(setup.ok, true);
    assert.equal(setup.sync.smtpConfigured, true);
    const patches = supabase.calls.filter((call) => call.method === "PATCH" && /\/config\/auth$/u.test(call.pathname));
    assert.equal(patches.length, 2);
    assert.equal(patches[0].body.external_email_enabled, true);
    assert.equal(patches[0].body.smtp_admin_email, "login@example.com");
    assert.equal(patches[0].body.smtp_host, "smtp2.example.com");
    assert.equal(patches[0].body.smtp_pass, "password with spaces");
    assert.equal(patches[0].body.smtp_port, 2525);
    assert.equal(patches[0].body.smtp_sender_name, "Example Login");
    assert.equal(patches[0].body.smtp_user, "smtp-user-2");
    assert.equal(Object.hasOwn(patches[0].body, "uri_allow_list"), false);
  });
});

test("managed app auth distinguishes manual credentials from managed sync", async () => {
  await withTemporaryRoot(async (root) => {
    const projectConfig = {
      values: {
        [VIBE64_APP_AUTH_MODE_CONFIG]: VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE,
        [VIBE64_MANUAL_SUPABASE_PROJECT_URL_CONFIG]: "https://manual.supabase.co",
        [VIBE64_MANUAL_SUPABASE_PUBLISHABLE_KEY_CONFIG]: "pk_manual"
      }
    };
    const service = createManagedAppAuthService({
      projectService: {
        async readProjectConfig() {
          return {
            config: {
              ...projectConfig,
              ready: true
            },
            ok: true
          };
        }
      },
      providerHomesRoot: path.join(root, "providers"),
      systemRoot: path.join(root, "system")
    });

    const connection = await service.getConnectionStatus();
    assert.equal(connection.ok, undefined);
    assert.equal(connection.connected, true);
    assert.equal(connection.required, true);
    assert.equal(connection.syncManaged, false);

    const env = await service.projectEnvironment({
      projectConfig
    });
    assert.equal(env[VIBE64_APP_AUTH_ENV.mode], VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE);
    assert.equal(env[VIBE64_APP_AUTH_ENV.supabaseUrl], "https://manual.supabase.co");
    assert.equal(env[VIBE64_APP_AUTH_ENV.supabasePublishableKey], "pk_manual");
  });
});

test("managed app auth setup honors runtime management permissions", async () => {
  await withTemporaryRoot(async (root) => {
    const service = createManagedAppAuthService({
      accountRuntime: {
        providerHomesRoot: path.join(root, "providers"),
        requireAppAuthManagement() {
          return {
            errors: [
              {
                code: "vibe64_owner_required",
                message: "Only owners."
              }
            ],
            ok: false
          };
        },
        systemRoot: path.join(root, "system")
      },
      fetchImpl: createSupabaseFetch().fetchImpl
    });

    const setup = await service.setup({
      accessToken: "sbp_unit_pat"
    });
    assert.equal(setup.ok, false);
    assert.equal(setup.errors[0].code, "vibe64_owner_required");
  });
});

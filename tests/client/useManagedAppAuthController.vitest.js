import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, effectScope, ref } from "vue";

const commandMocks = vi.hoisted(() => ({
  calls: [],
  useCommand: vi.fn()
}));

const endpointMocks = vi.hoisted(() => ({
  reload: vi.fn(),
  useEndpointResource: vi.fn()
}));

vi.mock("@jskit-ai/users-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@jskit-ai/users-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

import {
  useManagedAppAuthController
} from "../../packages/vibe64-accounts/src/client/composables/useManagedAppAuthController.js";

describe("useManagedAppAuthController", () => {
  beforeEach(() => {
    commandMocks.calls.length = 0;
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options) => ({
      isRunning: false,
      run: vi.fn(async (context = {}) => {
        const payload = options.buildRawPayload({}, {
          context
        });
        commandMocks.calls.push({
          apiSuffix: options.apiSuffix,
          payload
        });
        return {
          ok: true,
          payload
        };
      })
    }));
    endpointMocks.reload.mockReset();
    endpointMocks.reload.mockResolvedValue({
      ok: true
    });
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockReturnValue({
      data: ref({
        ok: true
      }),
      isLoading: ref(false),
      loadError: ref(""),
      reload: endpointMocks.reload
    });
  });

  it("passes requested managed Supabase setup environments through to the command payload", async () => {
    const scope = effectScope();
    let controller;
    scope.run(() => {
      controller = useManagedAppAuthController({
        apiSuffixBase: "/vibe64/adapter-settings/components/jskit-managed-app-auth",
        endpoints: {
          connect: "/api/connect",
          disconnect: "/api/disconnect",
          setup: "/api/setup",
          smtpLogin: "/api/smtp-login",
          smtpLoginDisconnect: "/api/smtp-login/disconnect",
          status: "/api/status",
          sync: "/api/sync"
        },
        queryKey: computed(() => ["vibe64", "managed-app-auth"])
      });
    });

    const result = await controller.setup({
      environment: "prod",
      environments: ["dev", "prod"],
      organizationSlug: "acme",
      regionGroup: "emea"
    });

    expect(result.payload).toEqual({
      accessToken: "",
      environment: "prod",
      environments: ["dev", "prod"],
      organizationSlug: "acme",
      regionGroup: "emea"
    });
    expect(commandMocks.calls).toContainEqual({
      apiSuffix: "/vibe64/adapter-settings/components/jskit-managed-app-auth/setup",
      payload: result.payload
    });
  });
});

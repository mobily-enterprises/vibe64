import { effectScope, nextTick, reactive } from "vue";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

let accountsState;
let syncGithubIdentity;

vi.mock("@/composables/useVibe64Accounts.js", () => ({
  useVibe64Accounts: () => accountsState
}));

vi.mock("@jskit-ai/users-web/client/composables/useCommand", () => ({
  useCommand: () => ({
    run: syncGithubIdentity
  })
}));

const localGithubConnectedStatus = Object.freeze({
  accounts: Object.freeze([
    Object.freeze({
      connected: true,
      id: "github",
      status: "connected",
      username: "mercmobily"
    })
  ])
});

const liveGithubDisconnectedStatus = Object.freeze({
  accounts: Object.freeze([
    Object.freeze({
      connected: false,
      id: "github",
      message: "GitHub CLI token is invalid. Reconnect GitHub to continue.",
      status: "not_connected",
      username: ""
    })
  ])
});

const liveGithubConnectedStatus = Object.freeze({
  accounts: Object.freeze([
    Object.freeze({
      connected: true,
      id: "github",
      status: "connected",
      username: "mercmobily"
    })
  ])
});

describe("useAccountsSetup", () => {
  beforeEach(() => {
    syncGithubIdentity = vi.fn(async () => ({
      ok: true
    }));
  });

  it("does not auto-continue from stale local GitHub status", async () => {
    const emitted = [];
    accountsState = reactive({
      status: localGithubConnectedStatus,
      refresh: vi.fn(async () => {
        accountsState.status = liveGithubDisconnectedStatus;
        return {
          data: liveGithubDisconnectedStatus
        };
      })
    });

    const scope = effectScope();
    try {
      const { useAccountsSetup } = await import("../../src/composables/useAccountsSetup.js");
      scope.run(() => {
        useAccountsSetup({
          autoContinueWhenReady: true,
          providerIds: ["github"]
        }, (event) => {
          emitted.push(event);
        });
      });

      await flushVueJobs();

      expect(accountsState.refresh).toHaveBeenCalledTimes(1);
      expect(syncGithubIdentity).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    } finally {
      scope.stop();
    }
  });

  it("auto-continues and syncs GitHub identity after live verification", async () => {
    const emitted = [];
    accountsState = reactive({
      status: localGithubConnectedStatus,
      refresh: vi.fn(async () => {
        accountsState.status = liveGithubConnectedStatus;
        return {
          data: liveGithubConnectedStatus
        };
      })
    });

    const scope = effectScope();
    try {
      const { useAccountsSetup } = await import("../../src/composables/useAccountsSetup.js");
      scope.run(() => {
        useAccountsSetup({
          autoContinueWhenReady: true,
          providerIds: ["github"]
        }, (event) => {
          emitted.push(event);
        });
      });

      await flushVueJobs();

      expect(accountsState.refresh).toHaveBeenCalledTimes(1);
      expect(syncGithubIdentity).toHaveBeenCalledTimes(1);
      expect(emitted).toEqual(["continue"]);
    } finally {
      scope.stop();
    }
  });
});

async function flushVueJobs() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

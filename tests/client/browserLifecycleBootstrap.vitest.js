import { describe, expect, it, vi } from "vitest";

const lifecycleMock = vi.hoisted(() => ({
  connectBrowserLifecycleSocket: vi.fn()
}));

vi.mock("../../src/lib/browserLifecycle.js", () => ({
  connectBrowserLifecycleSocket: lifecycleMock.connectBrowserLifecycleSocket
}));

import {
  bootBrowserLifecycle
} from "../../src/lib/browserLifecycleBootstrap.js";

describe("browser lifecycle bootstrap", () => {
  it("opens the lifecycle socket from app startup", () => {
    const options = {
      browserWindow: {}
    };

    bootBrowserLifecycle(options);

    expect(lifecycleMock.connectBrowserLifecycleSocket).toHaveBeenCalledWith(options);
  });
});

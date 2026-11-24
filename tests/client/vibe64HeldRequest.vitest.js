import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { delay, followHeldRequest } from "../../src/lib/vibe64HeldRequest.js";

const WORDS = Object.freeze({
  lostContact: "Vibe64 could not be reached.",
  notWorded: "The request could not be completed."
});

function lostAnswer() {
  return Object.assign(new Error("Request failed with status 0."), { status: 0 });
}

// Whether `promise` has settled, read after the test lets its callbacks run.
function settledFlag(promise) {
  const flag = { settled: false };
  void promise.then(() => {
    flag.settled = true;
  }, () => {
    flag.settled = true;
  });
  return flag;
}

describe("vibe64HeldRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits the whole time when nothing aborts it", async () => {
    const waiting = settledFlag(delay(1_000, new AbortController().signal));

    await vi.advanceTimersByTimeAsync(999);
    expect(waiting.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(waiting.settled).toBe(true);
  });

  it("ends a wait at once when its signal aborts, leaving no timer", async () => {
    const controller = new AbortController();
    const waiting = settledFlag(delay(5_000, controller.signal));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(waiting.settled).toBe(false);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(waiting.settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not wait when its signal has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const waiting = settledFlag(delay(5_000, controller.signal));

    await vi.advanceTimersByTimeAsync(0);

    expect(waiting.settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("throws the signal's reason when it aborts during a wait after a lost answer, and does not send again", async () => {
    const controller = new AbortController();
    const reason = new Error("The check was cancelled.");
    const send = vi.fn().mockRejectedValueOnce(lostAnswer()).mockResolvedValue({ ok: true });
    const failure = followHeldRequest(send, { ...WORDS, signal: controller.signal }).catch(error => error);
    const following = settledFlag(failure);

    await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(following.settled).toBe(false);
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);

    expect(following.settled).toBe(true);
    expect(await failure).toBe(reason);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("throws an AbortError when its signal aborts during a wait without a reason", async () => {
    const controller = new AbortController();
    const send = vi.fn().mockRejectedValueOnce(lostAnswer()).mockResolvedValue({ ok: true });
    const failure = followHeldRequest(send, { ...WORDS, signal: controller.signal }).catch(error => error);
    const following = settledFlag(failure);

    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(following.settled).toBe(true);
    expect(await failure).toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("passes the signal to an injected wait, and does not send again when it aborted meanwhile", async () => {
    const controller = new AbortController();
    const reason = new Error("The check was cancelled.");
    const wait = vi.fn(async () => {
      controller.abort(reason);
    });
    const send = vi.fn().mockRejectedValueOnce(lostAnswer()).mockResolvedValue({ ok: true });

    await expect(followHeldRequest(send, { ...WORDS, signal: controller.signal, wait })).rejects.toBe(reason);

    expect(wait).toHaveBeenCalledWith(1_000, controller.signal);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends again after a lost answer's wait when it has no signal", async () => {
    const send = vi.fn().mockRejectedValueOnce(lostAnswer()).mockResolvedValue({ ok: true });
    const following = followHeldRequest(send, WORDS);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(following).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(true);
  });
});

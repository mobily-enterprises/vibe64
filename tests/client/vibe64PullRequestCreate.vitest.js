import { describe, expect, it } from "vitest";
import {
  PULL_REQUEST_LOST_CONTACT,
  PULL_REQUEST_NOT_CREATED,
  createPullRequestFollowed
} from "../../src/lib/vibe64PullRequestCreate.js";

const noWait = async () => {};
const lost = status => Object.assign(new Error(`Request failed with status ${status}.`), { status });

describe("following a pull request the dialog creates", () => {
  it("repeats the same request while the server answers that it is creating, until its outcome", async () => {
    const answers = [
      { ok: true, creating: true, requestId: "r", waitingFor: "creating" },
      { ok: true, creating: true, requestId: "r", waitingFor: "creating" },
      { ok: true, pullRequest: { number: 12 } }
    ];
    const repeats = [];
    const result = await createPullRequestFollowed(async (repeat) => {
      repeats.push(repeat);
      return answers[repeats.length - 1];
    }, { wait: noWait });
    expect(result).toEqual({ ok: true, pullRequest: { number: 12 } });
    expect(repeats).toEqual([false, true, true]);
  });

  it.each([0, 502, 504])("repeats the same request after an answer lost with status %s", async (status) => {
    const repeats = [];
    const result = await createPullRequestFollowed(async (repeat) => {
      repeats.push(repeat);
      if (repeats.length === 1) throw lost(status);
      return { ok: true, pullRequest: { number: 12 } };
    }, { wait: noWait });
    expect(result.pullRequest.number).toBe(12);
    expect(repeats).toEqual([false, true]);
  });

  it("says in words, never with a status code, when it cannot reach Vibe64 to follow the creation", async () => {
    let sends = 0;
    const failure = await createPullRequestFollowed(async () => {
      sends += 1;
      throw lost(504);
    }, { wait: noWait }).catch(error => error);
    expect(failure.message).toBe(PULL_REQUEST_LOST_CONTACT);
    expect(failure.message).not.toMatch(/\d{3}/u);
    expect(sends).toBeGreaterThan(1);
  });

  it("passes the server's refusal on as it is, without repeating", async () => {
    let sends = 0;
    const refusal = Object.assign(new Error("Wait for the assistant turn to finish before changing this session's repository."), {
      code: "vibe64_session_repository_agent_active",
      status: 409
    });
    const failure = await createPullRequestFollowed(async () => {
      sends += 1;
      throw refusal;
    }, { wait: noWait }).catch(error => error);
    expect(failure).toBe(refusal);
    expect(sends).toBe(1);
  });

  it("says a failure the server did not word in words, never with its status code", async () => {
    const failure = await createPullRequestFollowed(async () => {
      throw Object.assign(new Error("Request failed with status 404."), { status: 404 });
    }, { wait: noWait }).catch(error => error);
    expect(failure.message).toBe(PULL_REQUEST_NOT_CREATED);
  });
});

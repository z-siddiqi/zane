import { describe, expect, test } from "bun:test";

import {
  appendItemDelta,
  createThreadTranscript,
  hydrateTranscript,
  restorePartialItem,
  startTurn,
} from "../src/lib/thread-transcript";

const threadId = "thread-1";
const turnId = "turn-1";
const userItem = {
  id: "user-1",
  type: "userMessage",
  content: [{ type: "text", text: "Tell me something", text_elements: [] }],
};

describe("thread transcript refresh recovery", () => {
  test("merges a delta that beats the resume response", () => {
    let state = startTurn(createThreadTranscript(threadId), turnId);
    state = appendItemDelta(state, {
      itemId: "agent-1",
      turnId,
      delta: " to help",
      role: "assistant",
    });
    state = hydrateTranscript(state, [{
      id: turnId,
      status: "inProgress",
      items: [userItem, { id: "agent-1", type: "agentMessage", text: "I want" }],
    }]);

    expect(state.messages.map((message) => message.text)).toEqual([
      "Tell me something",
      "I want to help",
    ]);
    expect(state.activeTurnId).toBe(turnId);
    expect(state.turnStatus).toBe("InProgress");
  });

  test("a completed authoritative snapshot clears stale live state", () => {
    let state = startTurn(createThreadTranscript(threadId), turnId);
    state = appendItemDelta(state, {
      itemId: "stale-agent",
      turnId,
      delta: "stale",
      role: "assistant",
    });
    state = hydrateTranscript(state, [{ id: turnId, status: "completed", items: [userItem] }]);

    expect(state.messages.map((message) => message.id)).toEqual(["user-1"]);
    expect(state.activeTurnId).toBeNull();
    expect(state.turnStatus).toBe("Completed");
  });

  test("an Anchor replay is idempotent across reconnects", () => {
    let state = startTurn(createThreadTranscript(threadId), turnId);
    state = restorePartialItem(state, {
      itemId: "agent-1",
      turnId,
      text: "One partial sentence",
      role: "assistant",
    });
    state = restorePartialItem(state, {
      itemId: "agent-1",
      turnId,
      text: "One partial sentence",
      role: "assistant",
    });
    state = appendItemDelta(state, {
      itemId: "agent-1",
      turnId,
      delta: " continues",
      role: "assistant",
    });

    expect(state.messages[0]?.text).toBe("One partial sentence continues");
  });

  test("an active resume keeps a pending approval replayed before it", () => {
    let state = startTurn(createThreadTranscript(threadId), turnId);
    state = {
      ...state,
      messages: [{
        id: "approval-1",
        threadId,
        turnId: null,
        role: "approval",
        kind: "approval-request",
        text: "Approve command",
        approval: {
          id: "approval-1",
          rpcId: 12,
          method: "item/commandExecution/requestApproval",
          type: "command",
          description: "Approve command",
          status: "pending",
        },
      }],
    };
    state = hydrateTranscript(state, [{ id: turnId, status: "inProgress", items: [userItem] }]);

    expect(state.messages.map((message) => message.id)).toEqual(["user-1", "approval-1"]);
  });
});

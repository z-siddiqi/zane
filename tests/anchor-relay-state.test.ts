import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearRelaySnapshots,
  recordRelayMessage,
  relaySnapshot,
} from "../services/anchor/src/relay-state";

const threadId = "thread-1";
const turnId = "turn-1";

describe("Anchor partial-turn replay", () => {
  beforeEach(clearRelaySnapshots);
  afterEach(clearRelaySnapshots);

  test("retains streamed text until the turn completes", () => {
    recordRelayMessage({
      method: "turn/started",
      params: { threadId, turn: { id: turnId, status: "inProgress" } },
    });
    recordRelayMessage({
      method: "item/started",
      params: {
        threadId,
        turnId,
        item: {
          id: "user-1",
          type: "userMessage",
          content: [{ type: "text", text: "Do the thing", text_elements: [] }],
        },
      },
    });
    recordRelayMessage({
      method: "item/agentMessage/delta",
      params: { threadId, turnId, itemId: "agent-1", delta: "One" },
    });
    recordRelayMessage({
      method: "item/agentMessage/delta",
      params: { threadId, turnId, itemId: "agent-1", delta: " steady" },
    });

    expect(relaySnapshot(threadId)).toEqual({
      method: "zane/thread/replay",
      params: {
        threadId,
        turnId,
        items: [{ itemId: "agent-1", role: "assistant", text: "One steady" }],
      },
    });

    recordRelayMessage({
      method: "turn/completed",
      params: { threadId, turn: { id: turnId, status: "completed" } },
    });
    expect(relaySnapshot(threadId)).toBeNull();
  });
});

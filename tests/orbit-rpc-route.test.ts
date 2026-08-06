import { describe, expect, test } from "bun:test";

import {
  parseRoutedRpcId,
  routeAnchorRpcId,
  routeClientRpcId,
} from "../services/orbit/src/relay/rpc-route";

describe("Orbit RPC ownership", () => {
  test("round-trips browser and app-server request ids", () => {
    expect(parseRoutedRpcId(routeClientRpcId("connection-a", 42))).toEqual({
      source: "client",
      ownerId: "connection-a",
      originalId: 42,
    });
    expect(parseRoutedRpcId(routeAnchorRpcId("anchor-a", "approval-7"))).toEqual({
      source: "anchor",
      ownerId: "anchor-a",
      originalId: "approval-7",
    });
  });

  test("does not reinterpret ordinary client ids", () => {
    expect(parseRoutedRpcId("thread-list-1")).toBeNull();
  });
});

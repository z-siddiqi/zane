export type RpcId = string | number;

export interface RoutedRpcId {
  ownerId: string;
  originalId: RpcId;
  source: "client" | "anchor";
}

const PREFIX = "zane:rpc:";

export function routeClientRpcId(connectionId: string, originalId: RpcId): string {
  return encode({ source: "client", ownerId: connectionId, originalId });
}

export function routeAnchorRpcId(anchorId: string, originalId: RpcId): string {
  return encode({ source: "anchor", ownerId: anchorId, originalId });
}

export function parseRoutedRpcId(value: unknown): RoutedRpcId | null {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(value.slice(PREFIX.length))) as Partial<RoutedRpcId>;
    if (decoded.source !== "client" && decoded.source !== "anchor") return null;
    if (typeof decoded.ownerId !== "string" || !decoded.ownerId) return null;
    if (typeof decoded.originalId !== "string" && typeof decoded.originalId !== "number") return null;
    return decoded as RoutedRpcId;
  } catch {
    return null;
  }
}

function encode(value: RoutedRpcId): string {
  return `${PREFIX}${encodeURIComponent(JSON.stringify(value))}`;
}

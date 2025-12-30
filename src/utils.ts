import { createHmac, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";

export async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export function safeRepoDir(repoFullName: string) {
  // "owner/repo" -> "owner__repo"
  return repoFullName.replace("/", "__");
}

export function verifyWebhookSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  webhookSecret: string
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const theirSigHex = signatureHeader.slice("sha256=".length);
  const mac = createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  // timingSafeEqual requires same length buffers
  const a = Buffer.from(theirSigHex, "hex");
  const b = Buffer.from(mac, "hex");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

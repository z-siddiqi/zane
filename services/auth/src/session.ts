import { SignJWT, jwtVerify } from "jose";

import type { SessionPayload, StoredUser } from "./types";
import { createSessionRecord, getSessionRecord } from "./db";
import { base64UrlEncode } from "./utils";

const JWT_ISSUER = "zane-auth";
const JWT_AUDIENCE = "zane-web";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

function parseBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim();
}

function getJwtSecret(env: CloudflareEnv): string {
  if (!env.ZANE_WEB_JWT_SECRET?.trim()) {
    throw new Error("ZANE_WEB_JWT_SECRET is required");
  }
  return env.ZANE_WEB_JWT_SECRET.trim();
}

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
}

export async function verifySession(req: Request, env: CloudflareEnv): Promise<SessionPayload | null> {
  const token = parseBearerToken(req);
  if (!token) return null;
  try {
    const secret = getJwtSecret(env);
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (typeof payload.sub !== "string" || typeof payload.name !== "string") return null;
    const jti = typeof payload.jti === "string" ? payload.jti : "";
    if (!jti) return null;

    const record = await getSessionRecord(env, jti);
    if (!record || record.revoked_at) return null;
    const now = Math.floor(Date.now() / 1000);
    if (record.expires_at <= now) return null;

    return { sub: payload.sub, name: payload.name, jti };
  } catch {
    return null;
  }
}

export async function createSession(env: CloudflareEnv, user: StoredUser): Promise<string> {
  const secret = getJwtSecret(env);
  const key = new TextEncoder().encode(secret);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SEC;
  const jti = generateSessionId();
  const token = await new SignJWT({ name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(key);
  await createSessionRecord(env, jti, user.id, exp);
  return token;
}

import type { StoredCredential, StoredUser } from "./types";
import { base64UrlEncode } from "./utils";

interface PasskeyUserRow {
  id: string;
  name: string;
  display_name: string;
}

interface PasskeyCredentialRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
}

interface AuthSessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

function randomUserId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
}

function parseTransports(value: string | null): StoredCredential["transports"] {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as StoredCredential["transports"];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function getUser(env: CloudflareEnv): Promise<StoredUser | null> {
  const row = await env.DB.prepare(
    "SELECT id, name, display_name FROM passkey_users ORDER BY created_at ASC LIMIT 1"
  ).first<PasskeyUserRow>();
  if (!row) return null;
  return { id: row.id, name: row.name, displayName: row.display_name };
}

export async function ensureUser(env: CloudflareEnv): Promise<StoredUser> {
  const existing = await getUser(env);
  if (existing) return existing;

  const user: StoredUser = {
    id: randomUserId(),
    name: "owner",
    displayName: "Owner",
  };

  await env.DB.prepare("INSERT INTO passkey_users (id, name, display_name, created_at) VALUES (?, ?, ?, ?)")
    .bind(user.id, user.name, user.displayName, Date.now())
    .run();

  return user;
}

export async function listCredentials(env: CloudflareEnv, userId: string): Promise<StoredCredential[]> {
  const result = await env.DB.prepare(
    "SELECT id, user_id, public_key, counter, transports, device_type, backed_up FROM passkey_credentials WHERE user_id = ? ORDER BY created_at ASC"
  )
    .bind(userId)
    .all<PasskeyCredentialRow>();

  return result.results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    counter: row.counter,
    transports: parseTransports(row.transports),
    deviceType: row.device_type ?? undefined,
    backedUp: Boolean(row.backed_up),
  }));
}

export async function getCredential(env: CloudflareEnv, id: string): Promise<StoredCredential | null> {
  const row = await env.DB.prepare(
    "SELECT id, user_id, public_key, counter, transports, device_type, backed_up FROM passkey_credentials WHERE id = ?"
  )
    .bind(id)
    .first<PasskeyCredentialRow>();

  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    counter: row.counter,
    transports: parseTransports(row.transports),
    deviceType: row.device_type ?? undefined,
    backedUp: Boolean(row.backed_up),
  };
}

export async function upsertCredential(env: CloudflareEnv, credential: StoredCredential): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO passkey_credentials (id, user_id, public_key, counter, transports, device_type, backed_up, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, counter = excluded.counter, transports = excluded.transports, device_type = excluded.device_type, backed_up = excluded.backed_up, updated_at = excluded.updated_at"
  )
    .bind(
      credential.id,
      credential.userId,
      credential.publicKey,
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
      credential.deviceType ?? null,
      credential.backedUp ? 1 : 0,
      Date.now(),
      Date.now()
    )
    .run();
}

export async function updateCounter(env: CloudflareEnv, id: string, counter: number): Promise<void> {
  await env.DB.prepare("UPDATE passkey_credentials SET counter = ?, updated_at = ? WHERE id = ?")
    .bind(counter, Date.now(), id)
    .run();
}

export async function createSessionRecord(
  env: CloudflareEnv,
  sessionId: string,
  userId: string,
  expiresAt: number
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO auth_sessions (id, user_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)"
  )
    .bind(sessionId, userId, Date.now(), expiresAt)
    .run();
}

export async function getSessionRecord(env: CloudflareEnv, sessionId: string): Promise<AuthSessionRow | null> {
  return await env.DB.prepare("SELECT id, user_id, created_at, expires_at, revoked_at FROM auth_sessions WHERE id = ?")
    .bind(sessionId)
    .first<AuthSessionRow>();
}

export async function revokeSession(env: CloudflareEnv, sessionId: string): Promise<void> {
  await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(Date.now(), sessionId)
    .run();
}

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

import type { ChallengeRecord, StoredCredential, StoredUser } from "./types";
import { base64UrlDecode, base64UrlEncode, corsHeaders, getRpId, isAllowedOrigin } from "./utils";
import { createSession, verifySession } from "./session";
import {
  createUser,
  getCredential,
  getUserById,
  getUserByName,
  hasAnyUsers,
  listCredentials,
  randomUserId,
  revokeSession,
  updateCounter,
  upsertCredential,
} from "./db";
import { CHALLENGE_TTL_MS, consumeChallenge, setChallenge } from "./challenge";

interface ChallengeStoreSetRequest {
  key: string;
  record: ChallengeRecord;
}

interface ChallengeStoreConsumeRequest {
  key: string;
}

interface RegisterOptionsRequest {
  name?: string;
  displayName?: string;
}

interface RegisterVerifyRequest {
  credential: RegistrationResponseJSON;
}

interface LoginOptionsRequest {
  username: string;
}

interface LoginVerifyRequest {
  credential: AuthenticationResponseJSON;
}

export class PasskeyChallengeStore extends DurableObject<CloudflareEnv> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/set") {
      const body = (await req.json()) as ChallengeStoreSetRequest;
      if (!body?.key || !body?.record) {
        return new Response("Bad request", { status: 400 });
      }
      await this.ctx.storage.put(body.key, body.record);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/consume") {
      const body = (await req.json()) as ChallengeStoreConsumeRequest;
      if (!body?.key) {
        return new Response("Bad request", { status: 400 });
      }
      const record = await this.ctx.storage.get<ChallengeRecord>(body.key);
      if (!record) {
        return Response.json({ record: null });
      }
      if (Date.now() > record.expiresAt) {
        await this.ctx.storage.delete(body.key);
        return Response.json({ record: null });
      }
      await this.ctx.storage.delete(body.key);
      return Response.json({ record });
    }

    return new Response("Not found", { status: 404 });
  }
}

async function handleSession(req: Request, env: CloudflareEnv): Promise<Response> {
  const session = await verifySession(req, env);
  const systemHasUsers = await hasAnyUsers(env);

  let user = null;
  let hasPasskey = false;

  if (session) {
    const storedUser = await getUserById(env, session.sub);
    if (storedUser) {
      user = { id: storedUser.id, name: storedUser.name };
      const credentials = await listCredentials(env, storedUser.id);
      hasPasskey = credentials.length > 0;
    }
  }

  return Response.json(
    {
      authenticated: Boolean(session && user),
      user,
      hasPasskey,
      systemHasUsers,
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleRegisterOptions(req: Request, env: CloudflareEnv): Promise<Response> {
  const session = await verifySession(req, env);
  const body = (await req.json()) as RegisterOptionsRequest;

  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) {
    return Response.json({ error: "Origin not allowed." }, { status: 403, headers: corsHeaders(req, env) });
  }

  let userId: string;
  let userName: string;
  let userDisplayName: string;
  let excludeCredentials: { id: string; transports?: StoredCredential["transports"] }[] = [];
  let pendingUser: { id: string; name: string; displayName: string } | undefined;

  if (session) {
    // Adding a passkey to an existing account
    const existing = await getUserById(env, session.sub);
    if (!existing) {
      return Response.json({ error: "User not found." }, { status: 404, headers: corsHeaders(req, env) });
    }
    userId = existing.id;
    userName = existing.name;
    userDisplayName = existing.displayName;
    const credentials = await listCredentials(env, existing.id);
    excludeCredentials = credentials.map((c) => ({ id: c.id, transports: c.transports }));
  } else {
    // New user registration — defer user creation to verify step
    const name = body.name?.trim();
    const displayName = body.displayName?.trim() || name;
    if (!name) {
      return Response.json({ error: "Name is required." }, { status: 400, headers: corsHeaders(req, env) });
    }

    const existingByName = await getUserByName(env, name);
    if (existingByName) {
      return Response.json({ error: "Username already taken." }, { status: 409, headers: corsHeaders(req, env) });
    }

    userId = randomUserId();
    userName = name;
    userDisplayName = displayName!;
    pendingUser = { id: userId, name, displayName: userDisplayName };
  }

  const rpID = getRpId(origin!);

  const options = await generateRegistrationOptions({
    rpName: "Zane",
    rpID,
    userID: base64UrlDecode(userId),
    userName,
    userDisplayName,
    attestationType: "none",
    timeout: CHALLENGE_TTL_MS,
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  const stored = await setChallenge(env, options.challenge, {
    type: "registration",
    userId: session ? userId : undefined,
    pendingUser,
  });
  if (!stored) {
    return Response.json({ error: "Failed to persist challenge." }, { status: 500, headers: corsHeaders(req, env) });
  }

  return Response.json(options, { status: 200, headers: corsHeaders(req, env) });
}

async function handleRegisterVerify(req: Request, env: CloudflareEnv): Promise<Response> {
  const body = (await req.json()) as RegisterVerifyRequest;
  if (!body?.credential) {
    return Response.json({ error: "Invalid payload." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) {
    return Response.json({ error: "Origin not allowed." }, { status: 403, headers: corsHeaders(req, env) });
  }

  // Extract and consume the challenge before verification
  const clientDataB64 = body.credential.response.clientDataJSON;
  const clientData = JSON.parse(new TextDecoder().decode(base64UrlDecode(clientDataB64))) as { challenge?: string };
  if (!clientData.challenge) {
    return Response.json({ error: "Missing challenge." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const challengeRecord = await consumeChallenge(env, clientData.challenge);
  if (!challengeRecord) {
    return Response.json({ error: "Registration challenge expired." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const rpID = getRpId(origin!);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge: challengeRecord.value,
      expectedOrigin: origin!,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    return Response.json(
      { error: "Registration verification failed." },
      { status: 400, headers: corsHeaders(req, env) }
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return Response.json({ error: "Registration not verified." }, { status: 400, headers: corsHeaders(req, env) });
  }

  // Resolve the user: existing account (adding passkey) or new registration
  let user: StoredUser;
  if (challengeRecord.userId) {
    const existing = await getUserById(env, challengeRecord.userId);
    if (!existing) {
      return Response.json({ error: "User not found." }, { status: 404, headers: corsHeaders(req, env) });
    }
    user = existing;
  } else if (challengeRecord.pendingUser) {
    // Re-check uniqueness in case of a race between two concurrent registrations
    const existingByName = await getUserByName(env, challengeRecord.pendingUser.name);
    if (existingByName) {
      return Response.json({ error: "Username already taken." }, { status: 409, headers: corsHeaders(req, env) });
    }
    user = await createUser(env, challengeRecord.pendingUser.name, challengeRecord.pendingUser.displayName);
  } else {
    return Response.json({ error: "Invalid challenge record." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const info = verification.registrationInfo;
  const credentialId = info.credential.id;
  const existingCredentials = await listCredentials(env, user.id);
  const existing = existingCredentials.find((credential) => credential.id === credentialId);

  if (!existing) {
    await upsertCredential(env, {
      id: credentialId,
      userId: user.id,
      publicKey: base64UrlEncode(info.credential.publicKey),
      counter: info.credential.counter,
      transports: body.credential.response.transports as AuthenticatorTransport[] | undefined,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp ?? false,
    });
  }

  const token = await createSession(env, user);
  return Response.json(
    {
      verified: true,
      token,
      user: { id: user.id, name: user.name },
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleLoginOptions(req: Request, env: CloudflareEnv): Promise<Response> {
  const body = (await req.json()) as LoginOptionsRequest;
  const username = body.username?.trim();
  if (!username) {
    return Response.json({ error: "Username is required." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const user = await getUserByName(env, username);
  if (!user) {
    return Response.json({ error: "Invalid credentials." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const credentials = await listCredentials(env, user.id);
  if (credentials.length === 0) {
    return Response.json({ error: "Invalid credentials." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) {
    return Response.json({ error: "Origin not allowed." }, { status: 403, headers: corsHeaders(req, env) });
  }

  const rpID = getRpId(origin!);

  const allowCredentials = credentials.map((credential) => ({
    id: credential.id,
    transports: credential.transports,
  }));

  const options = await generateAuthenticationOptions({
    rpID,
    timeout: CHALLENGE_TTL_MS,
    allowCredentials,
    userVerification: "required",
  });

  const stored = await setChallenge(env, options.challenge, { type: "authentication", userId: user.id });
  if (!stored) {
    return Response.json({ error: "Failed to persist challenge." }, { status: 500, headers: corsHeaders(req, env) });
  }

  return Response.json(options, { status: 200, headers: corsHeaders(req, env) });
}

async function handleLoginVerify(req: Request, env: CloudflareEnv): Promise<Response> {
  const body = (await req.json()) as LoginVerifyRequest;
  if (!body?.credential) {
    return Response.json({ error: "Invalid payload." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) {
    return Response.json({ error: "Origin not allowed." }, { status: 403, headers: corsHeaders(req, env) });
  }

  const credential = await getCredential(env, body.credential.id);
  if (!credential) {
    return Response.json({ error: "Unknown credential." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const user = await getUserById(env, credential.userId);
  if (!user) {
    return Response.json({ error: "User not found." }, { status: 404, headers: corsHeaders(req, env) });
  }

  // Extract challenge from clientDataJSON to consume the stored record
  const clientDataB64 = body.credential.response.clientDataJSON;
  const clientData = JSON.parse(new TextDecoder().decode(base64UrlDecode(clientDataB64))) as { challenge?: string };
  if (!clientData.challenge) {
    return Response.json({ error: "Missing challenge." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const challengeRecord = await consumeChallenge(env, clientData.challenge);
  if (!challengeRecord) {
    return Response.json(
      { error: "Authentication challenge expired." },
      { status: 400, headers: corsHeaders(req, env) }
    );
  }

  const rpID = getRpId(origin!);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge: challengeRecord.value,
      expectedOrigin: origin!,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: base64UrlDecode(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
      },
    });
  } catch {
    return Response.json(
      { error: "Authentication verification failed." },
      { status: 400, headers: corsHeaders(req, env) }
    );
  }

  if (!verification.verified || !verification.authenticationInfo) {
    return Response.json({ error: "Authentication not verified." }, { status: 400, headers: corsHeaders(req, env) });
  }

  await updateCounter(env, credential.id, verification.authenticationInfo.newCounter);

  const token = await createSession(env, user);
  return Response.json(
    {
      verified: true,
      token,
      user: { id: user.id, name: user.name },
    },
    { status: 200, headers: corsHeaders(req, env) }
  );
}

async function handleLogout(req: Request, env: CloudflareEnv): Promise<Response> {
  const session = await verifySession(req, env);
  if (session) {
    await revokeSession(env, session.jti);
  }
  return new Response(null, { status: 204, headers: corsHeaders(req, env) });
}

export default class AuthService extends WorkerEntrypoint<CloudflareEnv> {
  async fetch(req: Request): Promise<Response> {
    const env = this.env;
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(null, { status: 200 });
    }

    if (url.pathname === "/auth/session" && req.method === "GET") {
      return await handleSession(req, env);
    }

    if (url.pathname === "/auth/register/options" && req.method === "POST") {
      return await handleRegisterOptions(req, env);
    }

    if (url.pathname === "/auth/register/verify" && req.method === "POST") {
      return await handleRegisterVerify(req, env);
    }

    if (url.pathname === "/auth/login/options" && req.method === "POST") {
      return await handleLoginOptions(req, env);
    }

    if (url.pathname === "/auth/login/verify" && req.method === "POST") {
      return await handleLoginVerify(req, env);
    }

    if (url.pathname === "/auth/logout" && req.method === "POST") {
      return await handleLogout(req, env);
    }

    return new Response("Not found", { status: 404, headers: corsHeaders(req, env) });
  }
}

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

import type { ChallengeRecord, SessionPayload } from "./types";
import { base64UrlDecode, base64UrlEncode, corsHeaders, getRpId, isAllowedOrigin } from "./utils";
import { createSession, verifySession } from "./session";
import {
  ensureUser,
  getCredential,
  getUser,
  listCredentials,
  revokeSession,
  updateCounter,
  upsertCredential,
} from "./db";
import { CHALLENGE_TTL_MS, consumeChallenge, setChallenge } from "./challenge";

interface ChallengeRequest {
  type: "registration" | "authentication";
  value?: string;
  ttlMs?: number;
}

interface RegisterVerifyRequest {
  credential: RegistrationResponseJSON;
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

    const body = (await req.json()) as ChallengeRequest;
    if (!body?.type) {
      return new Response("Bad request", { status: 400 });
    }

    if (url.pathname === "/set") {
      if (typeof body.value !== "string") {
        return new Response("Bad request", { status: 400 });
      }
      const ttl = typeof body.ttlMs === "number" ? body.ttlMs : CHALLENGE_TTL_MS;
      const record: ChallengeRecord = { value: body.value, expiresAt: Date.now() + ttl };
      await this.ctx.storage.put(body.type, record);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/consume") {
      const record = await this.ctx.storage.get<ChallengeRecord>(body.type);
      if (!record) {
        return Response.json({ value: null });
      }
      if (Date.now() > record.expiresAt) {
        await this.ctx.storage.delete(body.type);
        return Response.json({ value: null });
      }
      await this.ctx.storage.delete(body.type);
      return Response.json({ value: record.value });
    }

    return new Response("Not found", { status: 404 });
  }
}

async function handleSession(req: Request, env: CloudflareEnv): Promise<Response> {
  const session = await verifySession(req, env);
  const user = await getUser(env);
  const credentials = user ? await listCredentials(env, user.id) : [];

  return Response.json(
    {
      authenticated: Boolean(session),
      user: session ? { id: session.sub, name: session.name } : null,
      hasPasskey: credentials.length > 0,
    },
    { status: 200, headers: corsHeaders(req, env) },
  );
}

async function handleRegisterOptions(req: Request, env: CloudflareEnv): Promise<Response> {
  const session = await verifySession(req, env);
  const existingUser = await getUser(env);
  const credentials = existingUser ? await listCredentials(env, existingUser.id) : [];

  // Allow registration if: no passkeys exist (first setup) OR user is signed in (adding device)
  if (credentials.length > 0 && !session) {
    return Response.json({ error: "Sign in to add another passkey." }, { status: 403, headers: corsHeaders(req, env) });
  }

  const user = existingUser ?? (await ensureUser(env));
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) {
    return Response.json({ error: "Origin not allowed." }, { status: 403, headers: corsHeaders(req, env) });
  }

  const rpID = getRpId(origin!);

  const excludeCredentials = credentials.map((credential) => ({
    id: credential.id,
    transports: credential.transports,
  }));

  const options = await generateRegistrationOptions({
    rpName: "Zane",
    rpID,
    userID: base64UrlDecode(user.id),
    userName: user.name,
    userDisplayName: user.displayName,
    attestationType: "none",
    timeout: CHALLENGE_TTL_MS,
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  const stored = await setChallenge(env, "registration", options.challenge);
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

  const session = await verifySession(req, env);
  const existingUser = await getUser(env);
  const credentials = existingUser ? await listCredentials(env, existingUser.id) : [];

  // Allow registration if: no passkeys exist (first setup) OR user is signed in (adding device)
  if (credentials.length > 0 && !session) {
    return Response.json({ error: "Sign in to add another passkey." }, { status: 403, headers: corsHeaders(req, env) });
  }

  const user = existingUser ?? (await ensureUser(env));
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) {
    return Response.json({ error: "Origin not allowed." }, { status: 403, headers: corsHeaders(req, env) });
  }

  const expectedChallenge = await consumeChallenge(env, "registration");
  if (!expectedChallenge) {
    return Response.json({ error: "Registration challenge expired." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const rpID = getRpId(origin!);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge,
      expectedOrigin: origin!,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    return Response.json(
      { error: "Registration verification failed." },
      { status: 400, headers: corsHeaders(req, env) },
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return Response.json({ error: "Registration not verified." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const info = verification.registrationInfo;
  const credentialId = info.credential.id;
  const existing = credentials.find((credential) => credential.id === credentialId);

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
    { status: 200, headers: corsHeaders(req, env) },
  );
}

async function handleLoginOptions(req: Request, env: CloudflareEnv): Promise<Response> {
  const user = await getUser(env);
  if (!user) {
    return Response.json({ error: "No passkey registered." }, { status: 409, headers: corsHeaders(req, env) });
  }

  const credentials = await listCredentials(env, user.id);
  if (credentials.length === 0) {
    return Response.json({ error: "No passkey registered." }, { status: 409, headers: corsHeaders(req, env) });
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

  const stored = await setChallenge(env, "authentication", options.challenge);
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

  const user = await getUser(env);
  if (!user) {
    return Response.json({ error: "User not initialized." }, { status: 409, headers: corsHeaders(req, env) });
  }

  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin, env)) {
    return Response.json({ error: "Origin not allowed." }, { status: 403, headers: corsHeaders(req, env) });
  }

  const expectedChallenge = await consumeChallenge(env, "authentication");
  if (!expectedChallenge) {
    return Response.json(
      { error: "Authentication challenge expired." },
      { status: 400, headers: corsHeaders(req, env) },
    );
  }

  const credential = await getCredential(env, body.credential.id);
  if (!credential) {
    return Response.json({ error: "Unknown credential." }, { status: 400, headers: corsHeaders(req, env) });
  }

  const rpID = getRpId(origin!);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge,
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
      { status: 400, headers: corsHeaders(req, env) },
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
    { status: 200, headers: corsHeaders(req, env) },
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

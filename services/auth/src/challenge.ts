export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function setChallenge(
  env: CloudflareEnv,
  type: "registration" | "authentication",
  value: string,
): Promise<boolean> {
  const id = env.PASSKEY_CHALLENGE_DO.idFromName("default");
  const stub = env.PASSKEY_CHALLENGE_DO.get(id);
  const response = await stub.fetch("https://challenge/set", {
    method: "POST",
    body: JSON.stringify({ type, value, ttlMs: CHALLENGE_TTL_MS }),
  });
  return response.ok;
}

export async function consumeChallenge(
  env: CloudflareEnv,
  type: "registration" | "authentication",
): Promise<string | null> {
  const id = env.PASSKEY_CHALLENGE_DO.idFromName("default");
  const stub = env.PASSKEY_CHALLENGE_DO.get(id);
  const response = await stub.fetch("https://challenge/consume", {
    method: "POST",
    body: JSON.stringify({ type }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { value?: string };
  return data.value ?? null;
}

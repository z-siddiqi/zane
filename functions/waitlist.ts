interface Env {
  DB: D1Database;
}

// HTML5 spec email regex with mandatory TLD
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const RATE_LIMIT_MS = 60_000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const email = body?.email?.trim().toLowerCase();

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return Response.json({ error: "Valid email is required." }, { status: 400 });
  }

  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  if (ip) {
    const recent = await env.DB.prepare(
      "SELECT 1 FROM waitlist WHERE ip = ? AND created_at > ?",
    )
      .bind(ip, Date.now() - RATE_LIMIT_MS)
      .first();

    if (recent) {
      return Response.json(
        { error: "Please wait before trying again." },
        { status: 429 },
      );
    }
  }

  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO waitlist (email, ip, created_at) VALUES (?, ?, ?)",
  )
    .bind(email, ip, Date.now())
    .run();

  if (result.meta.changes === 0) {
    return Response.json({ ok: true, message: "You're already on the list." });
  }

  return Response.json({ ok: true, message: "You're on the list." });
};

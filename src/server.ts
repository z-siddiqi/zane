import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";

function verifyGithubSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null
): boolean {
  if (!WEBHOOK_SECRET) {
    console.error("[error] GITHUB_WEBHOOK_SECRET not set");
    return false;
  }

  if (!signatureHeader?.startsWith("sha256=")) return false;

  const theirSigHex = signatureHeader.slice("sha256=".length);
  const mac = createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  // timingSafeEqual requires same length buffers
  const a = Buffer.from(theirSigHex, "hex");
  const b = Buffer.from(mac, "hex");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function summariseEvent(event: string, payload: any) {
  if (event === "ping") {
    return {
      kind: "ping",
      hook_id: payload.hook_id,
      zen: payload.zen,
    };
  }

  if (event === "projects_v2_item") {
    return {
      kind: "projects_v2_item",
      action: payload.action,
      org: payload.organization?.login,
      sender: payload.sender?.login,
      item_id: payload.projects_v2_item?.id,
      project_node_id: payload.projects_v2_item?.project_node_id,
    };
  }

  if (event === "sub_issues") {
    return {
      kind: "sub_issues",
      action: payload.action,
      repo: payload.repository?.full_name,
      parent_issue_id: payload.parent_issue_id,
      parent_issue_number: payload.parent_issue?.number,
      parent_issue_title: payload.parent_issue?.title,
      child_issue_number: payload.issue?.number,
      child_issue_title: payload.issue?.title,
    };
  }

  return {
    kind: event,
    action: payload.action,
    repo: payload.repository?.full_name,
  };
}

const server = Bun.serve({
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(null, { status: 200 });
    }

    if (req.method !== "POST" || url.pathname !== "/webhook") {
      return new Response(null, { status: 404 });
    }

    const event = req.headers.get("x-github-event") ?? "unknown";
    const delivery = req.headers.get("x-github-delivery") ?? "unknown";
    const signature256 = req.headers.get("x-hub-signature-256");

    const raw = new Uint8Array(await req.arrayBuffer());
    if (!verifyGithubSignature(raw, signature256)) {
      console.error(
        `[deny] invalid signature delivery=${delivery} event=${event}`
      );
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
      });
    }

    let payload: any;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return new Response(null, { status: 400 });
    }

    const summary = summariseEvent(event, payload);
    console.log(`[ok] delivery=${delivery} event=${event}`);
    console.log(summary);

    return new Response(
      JSON.stringify({
        received: true,
        delivery,
        event,
        summary,
      }),
      { status: 200 }
    );
  },
});

console.log(`Listening on http://localhost:${server.port}`);
console.log(`Webhook endpoint: http://localhost:${server.port}/webhook`);

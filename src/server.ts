import * as db from "./db";
import { queue } from "./queue";
import { verifyWebhookSignature } from "./utils";

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";

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
    if (!verifyWebhookSignature(raw, signature256, GITHUB_WEBHOOK_SECRET)) {
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

    const action = payload?.action ?? null;

    const _delivery = db.upsertDelivery(delivery, event, action);
    if (_delivery.changes === 0) {
      console.log(`[server] duplicate delivery detected: ${delivery}`);
      return new Response(
        JSON.stringify({ received: true, duplicate: true, delivery, event }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    db.upsertWebhookEvent({
      deliveryId: delivery,
      event,
      action,
      repoFullName: payload.repository?.full_name ?? null,
      payloadJson: JSON.stringify(payload),
    });

    if (event === "projects_v2_item") {
      const fv = payload?.changes?.field_value;

      const isStatus = fv?.field_type === "single_select" && fv?.field_name === "Status";

      const movedToInProgress =
        isStatus &&
        (fv?.to?.name ?? "").toLowerCase() === "in progress" &&
        (fv?.from?.name ?? "").toLowerCase() !== "in progress";

      if (movedToInProgress) {
        const contentNodeId = payload.projects_v2_item?.content_node_id;
        const jobId = `task-${contentNodeId}-${Date.now()}`;
        
        await queue.add(
          "ENSURE_FEATURE_SPEC",
          {
            projectItemNodeId: itemNodeId,
            contentNodeId, // this is the Issue node id; useful later
            projectNodeId: payload.projects_v2_item?.project_node_id,
            org: payload.organization?.login,
            from: fv.from?.name,
            to: fv.to?.name,
            changedAt: payload.projects_v2_item?.updated_at,
          },
          {
            jobId,
            attempts: 2,
            backoff: { type: "exponential", delay: 5000 },
          }
        );

        console.log(`[server] enqueued: ${jobId}`);
      }
    }

    return new Response(
      JSON.stringify({ received: true, duplicate: false, delivery, event }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  },
});

console.log(`[server] listening on ${server.url}`);
console.log(`[server] webhook endpoint: ${server.url}/webhook`);

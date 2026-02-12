import { Hono } from "hono";
import { handleAuthRequest } from "../auth/index";
import type { Env } from "../types";

export function createHttpApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/health", () => new Response(null, { status: 200 }));

  app.all("/auth/*", async (c) => {
    const response = await handleAuthRequest(c.req.raw, c.env);
    return response ?? new Response("Not found", { status: 404 });
  });

  return app;
}

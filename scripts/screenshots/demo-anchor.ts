// Fake anchor for README screenshots: serves a fictional project's sessions and
// approvals, and forwards models/account data to the real anchor so they stay realistic.
// Usage: bun scripts/screenshots/demo-anchor.ts  (listens on DEMO_PORT, default 8799)

const PORT = Number(process.env.DEMO_PORT ?? 8799);
const UPSTREAM = process.env.UPSTREAM_URL ?? "ws://localhost:8788/ws";
const FORWARDED = new Set(["model/list", "collaborationMode/list", "skills/list", "account/read", "account/usage/read"]);

const CWD = "/Users/demo/code/weather-api";
// Times are relative to 9:41 today, matching the overridden simulator status bar.
const nineFortyOne = new Date();
nineFortyOne.setHours(9, 41, 0, 0);
const now = Math.floor(nineFortyOne.getTime() / 1000);
const ago = (minutes: number) => now - minutes * 60;

const sessions = [
  { id: "7f3a9c2e-41b8-4d2a-9e6f-0c5d8a1b2e34", preview: "Add rate limiting to the /forecast endpoint", minutes: 4, active: true },
  { id: "b91e4d07-6c3a-4f18-a2d5-7e9f0b3c6a12", preview: "Write a migration to add station elevation", minutes: 38, active: true },
  { id: "3c8d2f6a-9b14-4e7c-8a05-d1f2e3b4c5a6", preview: "Fix the flaky timezone test in forecast_test.go", minutes: 95 },
  { id: "e4a7b2c9-5d16-4f3e-b8a0-2c9d1e7f6b45", preview: "Cache upstream NOAA responses for 10 minutes", minutes: 60 * 5 },
  { id: "5d2c8e1f-7a39-4b6d-9c04-e8f1a2b3d4c5", preview: "Profile the /history handler, p95 is around 900ms", minutes: 60 * 22 },
  { id: "a6f1d3e8-2b47-4c9a-8d15-f0e2c4b6a7d8", preview: "Explain how the retry middleware decides to back off", minutes: 60 * 27 },
  { id: "c3b9e5a2-8d61-4f0c-a7e4-1b2d3c4e5f60", preview: "Add OpenAPI docs for the /alerts endpoints", minutes: 60 * 49 },
  { id: "9e2f7c4b-3a58-4d1e-b6c9-5f0a1d2e3b4c", preview: "Bump Go to 1.25 and fix the deprecation warnings", minutes: 60 * 74 },
  { id: "1b5e9d3c-6f27-4a8b-9e10-c2d4f6a8b0e1", preview: "Set up golangci-lint in CI", minutes: 60 * 98 },
];

function thread(s: (typeof sessions)[number], turns: unknown[] = []) {
  return {
    id: s.id,
    preview: s.preview,
    name: null,
    modelProvider: "openai",
    model: "gpt-6.1-sol",
    createdAt: ago(s.minutes),
    updatedAt: ago(s.minutes),
    status: { type: s.active ? "active" : "idle" },
    cwd: CWD,
    gitInfo: { branch: "main" },
    turns,
  };
}

const RATE_LIMIT_DIFF = `@@ -0,0 +1,24 @@
+package middleware
+
+import (
+	"net/http"
+
+	"golang.org/x/time/rate"
+)
+
+// RateLimit allows 20 requests per second per client, with bursts of 40.
+func RateLimit(next http.Handler) http.Handler {
+	limiters := newLimiterStore(rate.Limit(20), 40)
+	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
+		if !limiters.get(clientIP(r)).Allow() {
+			w.Header().Set("Retry-After", "1")
+			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
+			return
+		}
+		next.ServeHTTP(w, r)
+	})
+}`;

const transcripts: Record<string, unknown[]> = {
  "7f3a9c2e-41b8-4d2a-9e6f-0c5d8a1b2e34": [
    {
      id: "turn-1",
      status: "completed",
      items: [
        { id: "u1", type: "userMessage", content: [{ type: "text", text: "Add rate limiting to the /forecast endpoint. 20 req/s per client is fine." }] },
        { id: "a1", type: "agentMessage", text: "I'll add a per-client token bucket in the middleware package and wire it into the /forecast route." },
        { id: "c1", type: "commandExecution", command: "rg -n \"forecast\" internal/server/routes.go", aggregatedOutput: "42:\tr.Get(\"/forecast\", h.Forecast)\n", exitCode: 0 },
        { id: "f1", type: "fileChange", changes: [{ path: "internal/middleware/ratelimit.go", diff: RATE_LIMIT_DIFF }] },
        { id: "a2", type: "agentMessage", text: "Added `RateLimit` middleware and applied it to `/forecast`. Over-limit requests get a 429 with `Retry-After: 1`." },
      ],
    },
    {
      id: "turn-2",
      status: "inProgress",
      items: [
        { id: "u2", type: "userMessage", content: [{ type: "text", text: "Nice. Run the full test suite with the race detector." }] },
      ],
    },
  ],
  "b91e4d07-6c3a-4f18-a2d5-7e9f0b3c6a12": [
    {
      id: "turn-1",
      status: "inProgress",
      items: [
        { id: "u1", type: "userMessage", content: [{ type: "text", text: "Write a migration to add an elevation column to stations." }] },
        { id: "a1", type: "agentMessage", text: "I'll add migration 0007 with a nullable `elevation_m` column and backfill it from the station metadata." },
      ],
    },
  ],
};

const approvals = [
  {
    method: "item/commandExecution/requestApproval",
    params: { threadId: "7f3a9c2e-41b8-4d2a-9e6f-0c5d8a1b2e34", turnId: "turn-2", itemId: "c2", command: ["go", "test", "./...", "-race"], reason: "Run the full test suite with the race detector", cwd: CWD },
  },
  {
    method: "item/fileChange/requestApproval",
    params: { threadId: "b91e4d07-6c3a-4f18-a2d5-7e9f0b3c6a12", turnId: "turn-1", itemId: "f1", reason: "Create migrations/0007_station_elevation.sql", grantRoot: CWD },
  },
  {
    method: "item/tool/requestUserInput",
    params: {
      threadId: "3c8d2f6a-9b14-4e7c-8a05-d1f2e3b4c5a6",
      turnId: "turn-1",
      itemId: "q1",
      questions: [{ id: "tz", header: "Timezone", question: "Should the test pin TZ to UTC, or keep America/Chicago to cover DST?" }],
    },
  },
  {
    method: "item/commandExecution/requestApproval",
    params: { threadId: "e4a7b2c9-5d16-4f3e-b8a0-2c9d1e7f6b45", turnId: "turn-1", itemId: "c1", command: ["curl", "-s", "api.weather.gov/alerts/active"], reason: "Fetch a sample NOAA response for the cache test fixture", cwd: CWD },
  },
];

const rateLimits = {
  limitId: "codex",
  limitName: null,
  primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: ago(-180) },
  secondary: { usedPercent: 41, windowDurationMins: 10080, resetsAt: ago(-60 * 24 * 3) },
  credits: null,
  planType: "plus",
  rateLimitReachedType: null,
};

function demoResult(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case "thread/list":
      return { data: sessions.map((s) => thread(s)), nextCursor: null };
    case "thread/resume": {
      const s = sessions.find((x) => x.id === params.threadId) ?? sessions[0];
      return { thread: thread(s, transcripts[s.id] ?? []), model: "gpt-6.1-sol", modelProvider: "openai", cwd: CWD, approvalPolicy: "on-request", sandbox: { type: "workspaceWrite" } };
    }
    case "account/rateLimits/read":
      return { rateLimits, rateLimitsByLimitId: { codex: rateLimits }, rateLimitResetCredits: null };
    default:
      return {};
  }
}

type Client = { upstream: WebSocket; pending: Map<string, unknown>; queue: string[] };

Bun.serve<Client, undefined>({
  port: PORT,
  fetch(req, server) {
    const upstream = new WebSocket(UPSTREAM);
    return server.upgrade(req, { data: { upstream, pending: new Map(), queue: [] } }) ? undefined : new Response("websocket only", { status: 400 });
  },
  websocket: {
    open(ws) {
      const { upstream } = ws.data;
      upstream.onopen = () => {
        for (const message of ws.data.queue) upstream.send(message);
        ws.data.queue = [];
      };
      // Only relay upstream replies to requests we forwarded; drop its notifications.
      upstream.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        const key = String(msg.id);
        if (msg.id != null && ws.data.pending.has(key)) {
          msg.id = ws.data.pending.get(key);
          ws.data.pending.delete(key);
          ws.send(JSON.stringify(msg));
        }
      };
      setTimeout(() => {
        approvals.forEach((approval, index) => ws.send(JSON.stringify({ id: `demo-approval-${index}`, ...approval })));
      }, 500);
    },
    message(ws, raw) {
      const msg = JSON.parse(String(raw));
      if (msg.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
      if (msg.method == null || msg.id == null) return;
      if (FORWARDED.has(msg.method)) {
        const key = `demo-${msg.id}`;
        ws.data.pending.set(key, msg.id);
        const out = JSON.stringify({ ...msg, id: key });
        if (ws.data.upstream.readyState === WebSocket.OPEN) ws.data.upstream.send(out);
        else ws.data.queue.push(out);
        return;
      }
      ws.send(JSON.stringify({ id: msg.id, result: demoResult(msg.method, msg.params ?? {}) }));
    },
    close(ws) {
      ws.data.upstream.close();
    },
  },
});

console.log(`demo anchor on ws://localhost:${PORT}/ws (forwarding to ${UPSTREAM})`);

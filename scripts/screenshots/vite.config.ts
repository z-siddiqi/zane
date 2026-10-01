// Dev server for README screenshots: local mode (no auth), pointed at the demo anchor.
// Usage: bunx --bun vite --config scripts/screenshots/vite.config.ts --port 5198
import { mergeConfig } from "vite";
import base from "../../vite.config";

const DEMO_ANCHOR_URL = `ws://localhost:${process.env.DEMO_PORT ?? 8799}/ws`;

export default mergeConfig(base, {
  define: {
    "import.meta.env.AUTH_URL": JSON.stringify(""),
  },
  plugins: [
    {
      name: "demo-anchor-url",
      transformIndexHtml: () => [
        {
          tag: "script",
          injectTo: "head-prepend",
          children: `localStorage.setItem("zane_config", ${JSON.stringify(JSON.stringify({ url: DEMO_ANCHOR_URL }))});`,
        },
      ],
    },
  ],
});

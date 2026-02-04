import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [
    {
      name: "require-env",
      configResolved(config) {
        if (config.command === "build" && !process.env.AUTH_URL) {
          throw new Error("AUTH_URL environment variable is required for production builds.");
        }
      },
    },
    svelte(),
  ],
  define: {
    "import.meta.env.AUTH_URL": JSON.stringify(process.env.AUTH_URL ?? ""),
    "import.meta.env.VAPID_PUBLIC_KEY": JSON.stringify(process.env.VAPID_PUBLIC_KEY ?? ""),
  },
});

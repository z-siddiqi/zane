import { createRouter } from "sv-router";
import Landing from "./routes/Landing.svelte";

export const { navigate, route } = createRouter({
  "/": Landing,
});

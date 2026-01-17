import { createRouter } from "sv-router";
import Home from "./routes/Home.svelte";
import Thread from "./routes/Thread.svelte";
import Review from "./routes/Review.svelte";

export const { navigate, route } = createRouter({
  "/": Home,
  "/thread/:id": Thread,
  "/thread/:id/review": Review,
});

import { createRouter } from "sv-router";
import Landing from "./routes/Landing.svelte";
import Home from "./routes/Home.svelte";
import NewTask from "./routes/NewTask.svelte";
import Thread from "./routes/Thread.svelte";
import Settings from "./routes/Settings.svelte";
import Device from "./routes/Device.svelte";

export const { navigate, route } = createRouter({
  "/": Landing,
  "/app": Home,
  "/task": NewTask,
  "/thread/:id": Thread,
  "/settings": Settings,
  "/device": Device,
});

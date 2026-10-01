import { createRouter } from "sv-router";
import Landing from "./routes/Landing.svelte";
import Login from "./routes/Login.svelte";
import Register from "./routes/Register.svelte";
import Home from "./routes/Home.svelte";
import Sessions from "./routes/Sessions.svelte";
import Thread from "./routes/Thread.svelte";
import Settings from "./routes/Settings.svelte";
import Inbox from "./routes/Inbox.svelte";
import Device from "./routes/Device.svelte";

export const { navigate, route } = createRouter({
  "/": Landing,
  "/login": Login,
  "/register": Register,
  "/app": Home,
  "/sessions": Sessions,
  "/thread/:id": Thread,
  "/inbox": Inbox,
  "/settings": Settings,
  "/device": Device,
});

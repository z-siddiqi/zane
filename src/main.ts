import "./global.css";
import App from "./App.svelte";
import { mount } from "svelte";

function showFatalError(error: unknown): void {
  console.error("Zane failed to render", error);
  const target = document.getElementById("app");
  if (!target || target.dataset.crashed === "true") return;
  target.dataset.crashed = "true";
  target.replaceChildren();

  const shell = document.createElement("main");
  shell.style.cssText = "min-height:100vh;padding:24px;background:#0b0d10;color:#e6e8eb;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace";
  const title = document.createElement("h1");
  title.textContent = "Zane needs to recover";
  title.style.cssText = "font-size:18px;margin:0 0 12px";
  const detail = document.createElement("p");
  detail.textContent = error instanceof Error ? error.message : "The app hit an unexpected client error.";
  detail.style.cssText = "color:#aeb4bd;margin:0 0 18px;overflow-wrap:anywhere";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reload Zane";
  button.style.cssText = "padding:9px 12px;border:1px solid #4b5563;border-radius:6px;background:#171a20;color:#fff;font:inherit";
  button.addEventListener("click", () => window.location.reload());
  shell.append(title, detail, button);
  target.append(shell);
}

let app: ReturnType<typeof mount> | null = null;

try {
  app = mount(App, {
    target: document.getElementById("app")!,
  });
} catch (error) {
  showFatalError(error);
}

export default app;

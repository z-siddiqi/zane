<script lang="ts">
  import { socket } from "./lib/socket.svelte";
  import { threads } from "./lib/threads.svelte";
  import { messages } from "./lib/messages.svelte";
  import ThreadList from "./components/ThreadList.svelte";
  import Transcript from "./components/Transcript.svelte";

  void messages;

  let url = $state("wss://orbit.yrvgilpord.workers.dev/ws/client");
  let token = $state("");
  let workingDir = $state("");

  function handleConnect() {
    if (socket.status === "connected") {
      socket.disconnect();
    } else {
      socket.connect(url, token);
    }
  }

  $effect(() => {
    if (socket.status === "connected") {
      threads.fetch();
    }
  });
</script>

<div class="app">
  <header class="header">
    <h1>Zane</h1>
    <span class="status" class:connected={socket.status === "connected"}>
      {socket.status}
    </span>
  </header>

  <div class="connection">
    <input
      type="text"
      bind:value={url}
      placeholder="WebSocket URL"
      disabled={socket.status === "connected"}
    />
    <input
      type="password"
      bind:value={token}
      placeholder="Token (optional)"
      disabled={socket.status === "connected"}
    />
    <input
      type="text"
      bind:value={workingDir}
      placeholder="Working directory (e.g. /home/user/project)"
    />
    <button onclick={handleConnect}>
      {socket.status === "connected" ? "Disconnect" : "Connect"}
    </button>
  </div>

  {#if socket.error}
    <p class="error">{socket.error}</p>
  {/if}

  {#if socket.status === "connected"}
    <ThreadList {workingDir} />
    <Transcript />
  {/if}
</div>

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .header h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  .status {
    font-size: 0.875rem;
    color: #666;
  }

  .status.connected {
    color: #16a34a;
  }

  .connection {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  input {
    padding: 0.5rem;
    font-size: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-family: inherit;
  }

  input:disabled {
    background: #f5f5f5;
  }

  button {
    padding: 0.5rem 1rem;
    font-size: 1rem;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }

  button:hover {
    background: #333;
  }

  .error {
    color: #dc2626;
  }
</style>

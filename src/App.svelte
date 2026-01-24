<script lang="ts">
  import { Router } from "sv-router";
  import AuthGate from "./lib/components/AuthGate.svelte";
  import "./router";
</script>

<AuthGate>
  <div class="app">
    <Router />
  </div>
</AuthGate>

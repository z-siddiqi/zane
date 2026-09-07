import type { ModelOption, ModelServiceTier, ReasoningEffort, RpcMessage } from "./types";
import { socket } from "./socket.svelte";

type FetchStatus = "idle" | "loading" | "success" | "error";

class ModelsStore {
  options = $state<ModelOption[]>([]);
  status = $state<FetchStatus>("idle");
  defaultModel = $derived(
    this.options.find((option) => option.isDefault) ?? this.options[0] ?? null
  );

  #requestId: number | null = null;

  constructor() {
    socket.onMessage((msg) => this.#handleMessage(msg));
    socket.onConnect(() => this.fetch());
  }

  /** Fetch models if we haven't already */
  fetch() {
    if (this.status !== "idle") return;
    this.#send();
  }

  /** Force refresh models */
  refresh() {
    this.status = "idle";
    this.#send();
  }

  #send() {
    if (socket.status !== "connected") return;

    this.#requestId = Date.now();
    this.status = "loading";

    socket.send({
      method: "model/list",
      id: this.#requestId,
      params: {},
    });
  }

  #handleMessage(msg: RpcMessage) {
    // Only handle our request
    if (!this.#requestId || msg.id !== this.#requestId) return;

    this.#requestId = null;

    if (msg.error) {
      this.status = "error";
      console.error("Failed to fetch models:", msg.error);
      return;
    }

    this.options = this.#parseModels(msg.result);
    this.status = this.options.length > 0 ? "success" : "error";
  }

  #parseModels(result: unknown): ModelOption[] {
    // Handle different response shapes
    const items = this.#extractArray(result);

    return items
      .map((item) => this.#parseModelItem(item))
      .filter((m): m is ModelOption => m !== null)
      .filter((model) => !model.hidden);
  }

  #extractArray(result: unknown): unknown[] {
    if (Array.isArray(result)) return result;
    if (!result || typeof result !== "object") return [];

    const obj = result as Record<string, unknown>;
    return (obj.models as unknown[]) ?? (obj.data as unknown[]) ?? (obj.items as unknown[]) ?? [];
  }

  #parseModelItem(item: unknown): ModelOption | null {
    if (typeof item === "string") {
      return { value: item, label: item };
    }

    if (!item || typeof item !== "object") return null;

    const obj = item as Record<string, unknown>;
    const value = String(obj.id ?? obj.model ?? obj.name ?? obj.value ?? "");
    if (!value) return null;

    const label = String(obj.label ?? obj.displayName ?? obj.title ?? value);

    const supportedReasoningEfforts = this.#parseReasoningEfforts(obj.supportedReasoningEfforts);
    const defaultReasoningEffort = this.#parseReasoningEffort(obj.defaultReasoningEffort);

    return {
      value,
      label,
      model: this.#stringOrUndefined(obj.model),
      upgrade: this.#stringOrNull(obj.upgrade),
      description: this.#stringOrUndefined(obj.description),
      hidden: Boolean(obj.hidden),
      supportedReasoningEfforts,
      defaultReasoningEffort,
      serviceTiers: this.#parseServiceTiers(obj.serviceTiers, obj.additionalSpeedTiers),
      defaultServiceTier: this.#stringOrUndefined(obj.defaultServiceTier),
      inputModalities: this.#parseStringArray(obj.inputModalities),
      supportsPersonality: typeof obj.supportsPersonality === "boolean" ? obj.supportsPersonality : undefined,
      isDefault: typeof obj.isDefault === "boolean" ? obj.isDefault : undefined,
    };
  }

  #stringOrUndefined(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  #stringOrNull(value: unknown): string | null | undefined {
    if (value === null) return null;
    return this.#stringOrUndefined(value);
  }

  #parseStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const parsed = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    return parsed.length > 0 ? parsed : undefined;
  }

  #parseReasoningEfforts(value: unknown): ReasoningEffort[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const efforts = value
      .map((entry) => {
        if (typeof entry === "string") return this.#parseReasoningEffort(entry);
        if (!entry || typeof entry !== "object") return undefined;
        return this.#parseReasoningEffort((entry as Record<string, unknown>).reasoningEffort);
      })
      .filter((effort): effort is ReasoningEffort => Boolean(effort));

    return efforts.length > 0 ? [...new Set(efforts)] : undefined;
  }

  #parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  #parseServiceTiers(value: unknown, legacyValue: unknown): ModelServiceTier[] | undefined {
    const tiers: ModelServiceTier[] = [];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim()) {
          tiers.push({ id: entry.trim(), name: entry.trim() });
          continue;
        }
        if (!entry || typeof entry !== "object") continue;
        const item = entry as Record<string, unknown>;
        const id = this.#stringOrUndefined(item.id);
        if (!id) continue;
        tiers.push({
          id,
          name: this.#stringOrUndefined(item.name) ?? id,
          description: this.#stringOrUndefined(item.description),
        });
      }
    }

    if (tiers.length === 0 && Array.isArray(legacyValue)) {
      for (const entry of legacyValue) {
        const id = this.#stringOrUndefined(entry);
        if (id && !tiers.some((tier) => tier.id === id)) {
          tiers.push({ id, name: id });
        }
      }
    }

    return tiers.length > 0 ? tiers : undefined;
  }
}

export const models = new ModelsStore();

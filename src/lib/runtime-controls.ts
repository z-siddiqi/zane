import type { ModelOption, Personality, ReasoningEffort } from "./types";

export const DEFAULT_SERVICE_TIER = "default";

export interface RuntimeOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

export const PERSONALITY_OPTIONS: RuntimeOption<Personality>[] = [
  { value: "default", label: "Default" },
  { value: "none", label: "None" },
  { value: "friendly", label: "Friendly" },
  { value: "pragmatic", label: "Pragmatic" },
];

const FALLBACK_REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

export function formatRuntimeLabel(value: string): string {
  const labels: Record<string, string> = {
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Max",
    ultra: "Ultra",
    persistent: "Persistent",
    priority: "Fast",
    fast: "Fast",
    flex: "Flex",
  };
  return labels[value.toLowerCase()] ?? value;
}

export function reasoningOptionsForModel(model: ModelOption | null): RuntimeOption<ReasoningEffort>[] {
  const efforts = model?.supportedReasoningEfforts?.length
    ? model.supportedReasoningEfforts
    : FALLBACK_REASONING_EFFORTS;
  return efforts.map((value) => ({ value, label: formatRuntimeLabel(value) }));
}

export function serviceTierOptionsForModel(model: ModelOption | null): RuntimeOption[] {
  const options: RuntimeOption[] = [{ value: DEFAULT_SERVICE_TIER, label: "Standard" }];
  for (const tier of model?.serviceTiers ?? []) {
    if (tier.id === DEFAULT_SERVICE_TIER || options.some((option) => option.value === tier.id)) continue;
    options.push({
      value: tier.id,
      label: tier.name || formatRuntimeLabel(tier.id),
      description: tier.description,
    });
  }
  return options;
}

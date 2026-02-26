import type { ModelRouter } from "../index.js";

const DEFAULT_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

const TASK_MODEL_MAP: Record<string, string> = {
  extraction: "haiku",
  formatting: "haiku",
  lookup: "haiku",
  development: "sonnet",
  research: "sonnet",
  analysis: "sonnet",
  architecture: "opus",
  debugging: "opus",
  planning: "opus",
};

export class DefaultModelRouter implements ModelRouter {
  private aliases: Record<string, string>;

  constructor(customAliases?: Record<string, string>) {
    this.aliases = { ...DEFAULT_ALIASES, ...customAliases };
  }

  resolveAlias(alias: string): string {
    return this.aliases[alias] || alias;
  }

  selectForTask(taskType: string): string {
    const alias = TASK_MODEL_MAP[taskType.toLowerCase()];
    return alias ? this.resolveAlias(alias) : this.resolveAlias("sonnet");
  }
}

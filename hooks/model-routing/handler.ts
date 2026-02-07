// model-routing hook — injects model selection rules at agent:bootstrap

interface HookEvent {
  type: string;
  action: string;
  context?: {
    bootstrapFiles?: Array<{ path: string; content: string }>;
  };
  messages: string[];
}

const handler = async (event: HookEvent) => {
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return;
  }

  event.context?.bootstrapFiles?.push({
    path: "model-routing-rules",
    content: [
      "## Model Routing (auto-injected by plugin)",
      "",
      "BEFORE every `sessions_spawn`, select the right model:",
      "",
      "| Task Type | Model | Alias |",
      "|-----------|-------|-------|",
      "| OCR, extraction, audit, bulk ops, scraping, formatting | **Haiku** | `anthropic/claude-haiku` |",
      "| Dev, refactoring, code review, web research, writing | **Sonnet** | `anthropic/claude-sonnet-4` |",
      "| Complex reasoning, architecture, strategic decisions | **Opus** | `anthropic/claude-opus-4-6` |",
      "",
      "### Anti-patterns",
      "- ❌ NEVER spawn a sub-agent without specifying the `model` parameter",
      "- ❌ NEVER use Opus for execution/collection tasks",
      "- ❌ NEVER do multiple web_fetch in Opus main context — delegate to Sonnet sub-agent",
      "- ❌ NEVER spawn 5+ sub-agents simultaneously without rate limit check",
      "",
      "### Context Budget",
      "- < 50%: normal operation",
      "- 50-70%: delegate reads to sub-agents",
      "- > 70%: switch to Sonnet if on Opus, delegate aggressively",
      "- > 85%: stop reading files, work from memory only",
    ].join("\n"),
  });
};

export default handler;

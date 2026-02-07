// dot-ai OpenClaw plugin
// Registers hooks for workspace convention enforcement and model routing

export const id = "dot-ai";
export const name = "dot-ai — Universal AI Workspace Convention";

export default function register(api: any) {
  api.logger.info("[dot-ai] Plugin loaded");

  // Register plugin hooks from the hooks directory
  // OpenClaw discovers hooks from HOOK.md files automatically
  // The hooks/dot-ai-enforce/ and hooks/model-routing/ directories
  // contain HOOK.md + handler.ts pairs that are auto-loaded

  api.registerService({
    id: "dot-ai",
    start: () => {
      api.logger.info("[dot-ai] Workspace convention enforcement active");
    },
    stop: () => {
      api.logger.info("[dot-ai] Service stopped");
    },
  });
}

// model-routing hook — injects model selection rules at agent:bootstrap
import type { HookEvent, HookHandler } from "../../types";
import { MODEL_ROUTING_CONTENT } from "../../constants";

const handler: HookHandler = async (event: HookEvent) => {
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return;
  }

  event.context?.bootstrapFiles?.push({
    path: "model-routing-rules",
    content: MODEL_ROUTING_CONTENT,
  });
};

export default handler;

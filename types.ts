// Shared TypeScript types for dot-ai plugin

export interface HookEvent {
  type: string;
  action: string;
  context?: {
    workspaceDir?: string;
    bootstrapFiles?: Array<{ path: string; content: string }>;
  };
  messages: string[];
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface HookMeta {
  name: string;
  description: string;
}

export interface Service {
  id: string;
  start(): void;
  stop(): void;
}

export interface PluginAPI {
  logger: Logger;
  registerHook(
    event: string,
    handler: (event: HookEvent) => Promise<void>,
    meta: HookMeta
  ): void;
  registerService(service: Service): void;
}

export type HookHandler = (event: HookEvent) => Promise<void>;

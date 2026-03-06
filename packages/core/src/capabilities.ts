import type { ToolDefinition } from './extension-types.js';

/**
 * The result returned by a capability execution.
 */
export interface CapabilityResult {
  text: string;
  details?: Record<string, unknown>;
}

/**
 * An interactive tool (capability) that an extension exposes to agents.
 * Adapters translate these into the agent's native tool format.
 */
export interface Capability {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(params: Record<string, unknown>): Promise<CapabilityResult>;
  /** Capability category */
  category?: 'memory' | 'tasks' | string;
  /** Whether this capability only reads data (no side effects) */
  readOnly?: boolean;
  /** Whether the adapter should ask for user confirmation before executing */
  confirmationRequired?: boolean;
  /** Capability version — incremented when parameter schema changes */
  version?: number;
  /** Injected into system prompt when tool is active */
  promptSnippet?: string;
  /** Guidelines for the LLM when using this tool */
  promptGuidelines?: string;
}

/**
 * Convert an extension ToolDefinition into a Capability.
 */
export function toolDefinitionToCapability(tool: ToolDefinition): Capability {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
    async execute(params: Record<string, unknown>): Promise<CapabilityResult> {
      const result = await tool.execute(params);
      return { text: result.content, details: result.details as Record<string, unknown> | undefined };
    },
  };
}

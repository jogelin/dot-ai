/**
 * @dot-ai/claude — Claude Code adapter
 *
 * Provides dot-ai workspace integration via Claude Code hooks.
 * The actual boot logic runs through prompt-based hooks.
 * This module provides programmatic utilities.
 */
export { generateBootPrompt, generateRoutingPrompt, detectOMC } from "./bridge.js";
export const version = "0.3.0";

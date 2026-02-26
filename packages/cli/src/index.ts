#!/usr/bin/env node
/**
 * @dot-ai/cli — Universal workspace management commands
 *
 * Commands:
 *   dot-ai init    — Scaffold .ai/ from templates
 *   dot-ai scan    — Regenerate indexes
 *   dot-ai doctor  — Validate workspace health
 *   dot-ai audit   — Run convention checks
 */

const command = process.argv[2];

switch (command) {
  case 'init':
    console.log('dot-ai init — not yet implemented');
    break;
  case 'scan':
    console.log('dot-ai scan — not yet implemented');
    break;
  case 'doctor':
    console.log('dot-ai doctor — not yet implemented');
    break;
  case 'audit':
    console.log('dot-ai audit — not yet implemented');
    break;
  default:
    console.log('Usage: dot-ai <init|scan|doctor|audit>');
    process.exit(1);
}

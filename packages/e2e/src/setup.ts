/**
 * Vitest global setup — runs before every test file in the e2e package.
 * Registers custom matchers so they are available in all scenarios.
 */
import { setupMatchers } from './matchers.js';

setupMatchers();

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoopLogger, JsonFileLogger, StderrLogger } from '../logger.js';
import type { LogEntry } from '../logger.js';

const makeEntry = (overrides?: Partial<LogEntry>): LogEntry => ({
  timestamp: '2026-03-04T12:00:00.000Z',
  level: 'info',
  phase: 'boot',
  event: 'test_event',
  ...overrides,
});

describe('NoopLogger', () => {
  it('log does nothing', () => {
    const logger = new NoopLogger();
    logger.log(makeEntry());
    // No error thrown
  });

  it('flush resolves immediately', async () => {
    const logger = new NoopLogger();
    await logger.flush();
  });
});

describe('JsonFileLogger', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dot-ai-logger-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes JSONL on flush', async () => {
    const logFile = join(tempDir, 'test.jsonl');
    const logger = new JsonFileLogger(logFile);

    logger.log(makeEntry({ event: 'event_1' }));
    logger.log(makeEntry({ event: 'event_2' }));
    await logger.flush();

    const content = await readFile(logFile, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('event_1');
    expect(JSON.parse(lines[1]).event).toBe('event_2');
  });

  it('does nothing on flush when buffer is empty', async () => {
    const logFile = join(tempDir, 'empty.jsonl');
    const logger = new JsonFileLogger(logFile);
    await logger.flush();
    // File should not exist (no write)
    await expect(readFile(logFile, 'utf-8')).rejects.toThrow();
  });

  it('clears buffer after flush', async () => {
    const logFile = join(tempDir, 'clear.jsonl');
    const logger = new JsonFileLogger(logFile);

    logger.log(makeEntry({ event: 'first' }));
    await logger.flush();
    logger.log(makeEntry({ event: 'second' }));
    await logger.flush();

    const content = await readFile(logFile, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('first');
    expect(JSON.parse(lines[1]).event).toBe('second');
  });

  it('includes all LogEntry fields', async () => {
    const logFile = join(tempDir, 'fields.jsonl');
    const logger = new JsonFileLogger(logFile);

    logger.log(makeEntry({
      level: 'warn',
      phase: 'enrich',
      event: 'labels_extracted',
      data: { labels: ['git', 'commit'], count: 2 },
      durationMs: 42,
    }));
    await logger.flush();

    const content = await readFile(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.level).toBe('warn');
    expect(entry.phase).toBe('enrich');
    expect(entry.event).toBe('labels_extracted');
    expect(entry.data.labels).toEqual(['git', 'commit']);
    expect(entry.durationMs).toBe(42);
  });
});

describe('StderrLogger', () => {
  it('writes to stderr', () => {
    const logger = new StderrLogger();
    // Just verify it doesn't throw
    logger.log(makeEntry());
  });

  it('flush resolves immediately', async () => {
    const logger = new StderrLogger();
    await logger.flush();
  });
});

import { appendFile } from 'node:fs/promises';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  phase: 'boot' | 'enrich' | 'learn' | 'format';
  event: string;
  data?: Record<string, unknown>;
  durationMs?: number;
}

export interface Logger {
  log(entry: LogEntry): void;
  flush(): Promise<void>;
}

export class NoopLogger implements Logger {
  log(_entry: LogEntry): void {}
  async flush(): Promise<void> {}
}

export class JsonFileLogger implements Logger {
  private buffer: string[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  log(entry: LogEntry): void {
    this.buffer.push(JSON.stringify(entry));
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const data = this.buffer.join('\n') + '\n';
    this.buffer = [];
    await appendFile(this.filePath, data, 'utf-8');
  }
}

export class StderrLogger implements Logger {
  log(entry: LogEntry): void {
    process.stderr.write(JSON.stringify(entry) + '\n');
  }
  async flush(): Promise<void> {}
}

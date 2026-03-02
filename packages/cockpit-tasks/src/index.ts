/**
 * @dot-ai/cockpit-tasks — Cockpit REST API task provider.
 *
 * Adapts kiwi's CockpitTaskProvider to the v4 TaskProvider contract.
 * Registered via:
 *   registerProvider('@dot-ai/cockpit-tasks', createCockpitTaskProvider);
 */

import type { TaskProvider, Task, TaskFilter } from '@dot-ai/core';

// ── Cockpit row shape ─────────────────────────────────────────────────────────

interface CockpitRow {
  id: string;
  text: string;
  status: string;
  priority: string | null;
  project: string | null;
  tags: string | null;
  type: string | null;
  detail: string | null;
  completed_date: string | null;
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

function toCoreTask(row: CockpitRow): Task {
  const task: Task = {
    id: row.id,
    text: row.text,
    status: fromCockpitStatus(row.status),
  };
  if (row.priority != null) task.priority = row.priority;
  if (row.project != null) task.project = row.project;
  if (row.tags) {
    task.tags = row.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  // Expose cockpit-specific fields via metadata
  const metadata: Record<string, unknown> = {};
  if (row.type != null) metadata['type'] = row.type;
  if (row.detail != null) metadata['detail'] = row.detail;
  if (row.completed_date != null) metadata['completed_date'] = row.completed_date;
  if (Object.keys(metadata).length > 0) task.metadata = metadata;
  return task;
}

function fromCockpitStatus(s: string): string {
  const map: Record<string, string> = {
    todo: 'pending',
    in_progress: 'in_progress',
    done: 'done',
    archived: 'done',
  };
  return map[s] ?? s;
}

function toCockpitStatus(s: string): string {
  const map: Record<string, string> = {
    pending: 'todo',
    in_progress: 'in_progress',
    done: 'done',
  };
  return map[s] ?? s;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class CockpitTaskProvider implements TaskProvider {
  private baseUrl: string;
  private apiKey: string | undefined;

  constructor(options: Record<string, unknown>) {
    const url = typeof options['url'] === 'string' ? options['url'] : 'http://localhost:3010';
    this.baseUrl = url.replace(/\/+$/, '');
    this.apiKey = typeof options['apiKey'] === 'string' ? options['apiKey'] : undefined;
  }

  private headers(write = false): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (write && this.apiKey) {
      h['x-api-key'] = this.apiKey;
    }
    return h;
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.project) params.set('project', filter.project);
    // tags filter: pass as comma-separated query param
    if (filter?.tags && filter.tags.length > 0) {
      params.set('tags', filter.tags.join(','));
    }

    const qs = params.toString();
    const url = `${this.baseUrl}/api/tasks${qs ? `?${qs}` : ''}`;

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Cockpit tasks list failed: ${res.status} ${res.statusText}`);
    }

    const rows = (await res.json()) as CockpitRow[];
    return rows.map(toCoreTask);
  }

  async get(id: string): Promise<Task | null> {
    const res = await fetch(
      `${this.baseUrl}/api/tasks/${encodeURIComponent(id)}`,
      { headers: this.headers() },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Cockpit task get failed: ${res.status} ${res.statusText}`);
    }
    const row = (await res.json()) as CockpitRow;
    return toCoreTask(row);
  }

  async create(task: Omit<Task, 'id'>): Promise<Task> {
    const body: Record<string, unknown> = {
      text: task.text,
      status: toCockpitStatus(task.status),
      priority: task.priority ?? 'P2',
      project: task.project ?? 'global',
      tags: task.tags?.join(',') ?? '',
    };

    const res = await fetch(`${this.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Cockpit task create failed: ${res.status} ${res.statusText}`);
    }
    const row = (await res.json()) as CockpitRow;
    return toCoreTask(row);
  }

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const body: Record<string, unknown> = {};
    if (patch.text !== undefined) body['text'] = patch.text;
    if (patch.status !== undefined) body['status'] = toCockpitStatus(patch.status);
    if (patch.priority !== undefined) body['priority'] = patch.priority;
    if (patch.project !== undefined) body['project'] = patch.project;
    if (patch.tags !== undefined) body['tags'] = patch.tags.join(',');
    if (patch.status === 'done') {
      body['completed_date'] = new Date().toISOString().slice(0, 10);
    }

    const res = await fetch(
      `${this.baseUrl}/api/tasks/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: this.headers(true),
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`Cockpit task update failed: ${res.status} ${res.statusText}`);
    }
    const row = (await res.json()) as CockpitRow;
    return toCoreTask(row);
  }
}

/**
 * Factory function for registerProvider().
 * Usage: registerProvider('@dot-ai/cockpit-tasks', createCockpitTaskProvider);
 */
export function createCockpitTaskProvider(options: Record<string, unknown>): CockpitTaskProvider {
  return new CockpitTaskProvider(options);
}

import type { TaskProvider, Task } from "../index.js";

/**
 * Cockpit API task provider.
 *
 * Connects to a Cockpit instance (D1-backed REST API) as the
 * single source of truth for task management.
 *
 * Config in .ai/config.yaml:
 *   providers:
 *     tasks:
 *       type: cockpit
 *       url: http://localhost:3010
 *       apiKey: ${COCKPIT_API_KEY}   # env var reference
 */
export class CockpitTaskProvider implements TaskProvider {
  private baseUrl: string;
  private apiKey: string | undefined;

  constructor(options: { url: string; apiKey?: string }) {
    // Strip trailing slash
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
  }

  private headers(write = false): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (write && this.apiKey) {
      h["x-api-key"] = this.apiKey;
    }
    return h;
  }

  async list(filter?: { status?: string; project?: string }): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set("status", filter.status);
    if (filter?.project) params.set("project", filter.project);

    const qs = params.toString();
    const url = `${this.baseUrl}/api/tasks${qs ? `?${qs}` : ""}`;

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Cockpit tasks list failed: ${res.status} ${res.statusText}`);
    }

    const rows = (await res.json()) as CockpitRow[];
    return rows.map(toCoreTask);
  }

  async get(id: string): Promise<Task | null> {
    const res = await fetch(`${this.baseUrl}/api/tasks/${encodeURIComponent(id)}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Cockpit task get failed: ${res.status} ${res.statusText}`);
    }
    const row = (await res.json()) as CockpitRow;
    return toCoreTask(row);
  }

  async create(task: Omit<Task, "id">): Promise<Task> {
    const body: Record<string, unknown> = {
      text: task.text,
      status: toCockpitStatus(task.status),
      priority: task.priority ?? "P2",
      project: task.project ?? "global",
      tags: task.tags?.join(",") ?? "",
    };

    const res = await fetch(`${this.baseUrl}/api/tasks`, {
      method: "POST",
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
    if (patch.text !== undefined) body.text = patch.text;
    if (patch.status !== undefined) body.status = toCockpitStatus(patch.status);
    if (patch.priority !== undefined) body.priority = patch.priority;
    if (patch.project !== undefined) body.project = patch.project;
    if (patch.tags !== undefined) body.tags = patch.tags.join(",");
    if (patch.status === "done") {
      body.completed_date = new Date().toISOString().slice(0, 10);
    }

    const res = await fetch(`${this.baseUrl}/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Cockpit task update failed: ${res.status} ${res.statusText}`);
    }
    const row = (await res.json()) as CockpitRow;
    return toCoreTask(row);
  }
}

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
  return {
    id: row.id,
    text: row.text,
    status: fromCockpitStatus(row.status),
    priority: row.priority ?? undefined,
    project: row.project ?? undefined,
    tags: row.tags ? row.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
  };
}

function fromCockpitStatus(s: string): string {
  const map: Record<string, string> = {
    todo: "pending",
    in_progress: "in_progress",
    done: "done",
    archived: "done",
  };
  return map[s] ?? s;
}

function toCockpitStatus(s: string): string {
  const map: Record<string, string> = {
    pending: "todo",
    in_progress: "in_progress",
    done: "done",
  };
  return map[s] ?? s;
}

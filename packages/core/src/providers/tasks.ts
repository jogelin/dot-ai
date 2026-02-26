import fs from "node:fs/promises";
import path from "node:path";
import type { TaskProvider, Task } from "../index.js";

/**
 * File-based task provider using BACKLOG.md format.
 *
 * BACKLOG.md format:
 * - [x] Task text {#tag1 #tag2} @project
 * - [~] In-progress task @project
 * - [ ] Pending task @project
 */
export class FileTaskProvider implements TaskProvider {
  private backlogPath: string;

  constructor(aiDir: string) {
    this.backlogPath = path.join(aiDir, "memory", "tasks", "BACKLOG.md");
  }

  async list(filter?: { status?: string; project?: string }): Promise<Task[]> {
    let content: string;
    try {
      content = await fs.readFile(this.backlogPath, "utf-8");
    } catch {
      return [];
    }

    const tasks = this.parseBacklog(content);

    if (filter?.status) {
      return tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.project) {
      return tasks.filter((t) => t.project === filter.project);
    }
    return tasks;
  }

  async get(id: string): Promise<Task | null> {
    const tasks = await this.list();
    return tasks.find((t) => t.id === id) || null;
  }

  async create(task: Omit<Task, "id">): Promise<Task> {
    const tasks = await this.list();
    const maxId = tasks.reduce(
      (max, t) => Math.max(max, parseInt(t.id) || 0),
      0,
    );
    const newTask: Task = { ...task, id: String(maxId + 1) };
    tasks.push(newTask);
    await this.writeBacklog(tasks);
    return newTask;
  }

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const tasks = await this.list();
    const index = tasks.findIndex((t) => t.id === id);
    if (index === -1) throw new Error(`Task ${id} not found`);
    tasks[index] = { ...tasks[index], ...patch };
    await this.writeBacklog(tasks);
    return tasks[index];
  }

  private parseBacklog(content: string): Task[] {
    const tasks: Task[] = [];
    let id = 0;
    for (const line of content.split("\n")) {
      const match = line.match(/^-\s*\[([ x~])\]\s*(.+)$/);
      if (!match) continue;
      id++;
      const [, marker, rest] = match;
      const status =
        marker === "x" ? "done" : marker === "~" ? "in_progress" : "pending";

      // Extract tags {#tag1 #tag2}
      const tagsMatch = rest.match(/\{([^}]+)\}/);
      const tags = tagsMatch
        ? tagsMatch[1]
            .split(/\s+/)
            .filter((t) => t.startsWith("#"))
            .map((t) => t.slice(1))
        : [];

      // Extract project @project
      const projectMatch = rest.match(/@(\S+)/);
      const project = projectMatch ? projectMatch[1] : undefined;

      // Clean text
      const text = rest
        .replace(/\{[^}]+\}/, "")
        .replace(/@\S+/, "")
        .trim();

      tasks.push({ id: String(id), text, status, tags, project });
    }
    return tasks;
  }

  private async writeBacklog(tasks: Task[]): Promise<void> {
    const dir = path.dirname(this.backlogPath);
    await fs.mkdir(dir, { recursive: true });

    const lines = tasks.map((t) => {
      const marker =
        t.status === "done" ? "x" : t.status === "in_progress" ? "~" : " ";
      let line = `- [${marker}] ${t.text}`;
      if (t.tags?.length)
        line += ` {${t.tags.map((tag) => `#${tag}`).join(" ")}}`;
      if (t.project) line += ` @${t.project}`;
      return line;
    });

    await fs.writeFile(
      this.backlogPath,
      `# BACKLOG\n\n${lines.join("\n")}\n`,
      "utf-8",
    );
  }
}

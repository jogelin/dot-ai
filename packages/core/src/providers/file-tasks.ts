import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TaskProvider } from '../contracts.js';
import type { Task, TaskFilter } from '../types.js';

// Simple file-level mutex to prevent concurrent read-modify-write races
let writeLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve!: () => void;
  writeLock = new Promise<void>(r => { resolve = r; });
  return prev.then(fn).finally(() => resolve());
}

export class FileTaskProvider implements TaskProvider {
  private filePath: string;

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    this.filePath = join(root, '.ai', 'tasks.json');
  }

  private async readTasks(): Promise<Task[]> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      return JSON.parse(content) as Task[];
    } catch {
      return [];
    }
  }

  private async writeTasks(tasks: Task[]): Promise<void> {
    await mkdir(join(this.filePath, '..'), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(tasks, null, 2), 'utf-8');
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    let tasks = await this.readTasks();
    if (filter?.status) tasks = tasks.filter(t => t.status === filter.status);
    if (filter?.project) tasks = tasks.filter(t => t.project === filter.project);
    if (filter?.tags?.length) {
      const filterTags = new Set(filter.tags);
      tasks = tasks.filter(t => t.tags?.some(tag => filterTags.has(tag)));
    }
    return tasks;
  }

  async get(id: string): Promise<Task | null> {
    const tasks = await this.readTasks();
    return tasks.find(t => t.id === id) ?? null;
  }

  async create(task: Omit<Task, 'id'>): Promise<Task> {
    return withLock(async () => {
      const tasks = await this.readTasks();
      const newTask: Task = {
        id: randomUUID(),
        ...task,
      };
      tasks.push(newTask);
      await this.writeTasks(tasks);
      return newTask;
    });
  }

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    return withLock(async () => {
      const tasks = await this.readTasks();
      const index = tasks.findIndex(t => t.id === id);
      if (index === -1) throw new Error(`Task ${id} not found`);
      tasks[index] = { ...tasks[index], ...patch, id };
      await this.writeTasks(tasks);
      return tasks[index];
    });
  }
}

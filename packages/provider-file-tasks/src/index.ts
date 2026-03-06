/**
 * @dot-ai/ext-file-tasks — File-based task management extension.
 * Stores tasks in .ai/tasks.json.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@dot-ai/core';

interface Task {
  id: string;
  text: string;
  status: string;
  priority?: string;
  project?: string;
  tags?: string[];
}

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve!: () => void;
  writeLock = new Promise<void>(r => { resolve = r; });
  return prev.then(fn).finally(() => resolve());
}

export default function extFileTasks(api: ExtensionAPI): void {
  const filePath = join(api.workspaceRoot, '.ai', 'tasks.json');

  async function readTasks(): Promise<Task[]> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as Task[];
    } catch { return []; }
  }

  async function writeTasks(tasks: Task[]): Promise<void> {
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, JSON.stringify(tasks, null, 2), 'utf-8');
  }

  api.on('context_enrich', async () => {
    const tasks = await readTasks();
    const active = tasks.filter(t => t.status === 'in_progress' || t.status === 'pending');
    if (active.length === 0) return;
    const lines = active.slice(0, 20).map(t => {
      const tags = t.tags?.length ? ` [${t.tags.join(', ')}]` : '';
      return `- [${t.status}] ${t.text}${t.priority ? ` (${t.priority})` : ''}${tags}`;
    });
    return {
      sections: [{
        id: 'tasks:active',
        title: 'Active Tasks',
        content: lines.join('\n'),
        priority: 40,
        source: 'ext-file-tasks',
        trimStrategy: 'truncate' as const,
      }],
    };
  });

  api.registerTool({
    name: 'task_list',
    description: 'List tasks with optional filters.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: pending, in_progress, done.' },
        project: { type: 'string', description: 'Filter by project name.' },
        tags: { type: 'string', description: 'Comma-separated tags to filter by.' },
      },
    },
    async execute(input) {
      let tasks = await readTasks();
      if (typeof input['status'] === 'string') tasks = tasks.filter(t => t.status === input['status']);
      if (typeof input['project'] === 'string') tasks = tasks.filter(t => t.project === input['project']);
      if (typeof input['tags'] === 'string') {
        const filterTags = new Set(input['tags'].split(',').map((s: string) => s.trim()));
        tasks = tasks.filter(t => t.tags?.some(tag => filterTags.has(tag)));
      }
      if (tasks.length === 0) return { content: 'No tasks found.' };
      const lines = tasks.map(t => `[${t.id.slice(0, 8)}] [${t.status}] ${t.text}${t.priority ? ` (${t.priority})` : ''}`);
      return { content: lines.join('\n'), details: { count: tasks.length } };
    },
  });

  api.registerTool({
    name: 'task_create',
    description: 'Create a new task.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Task description.' },
        status: { type: 'string', description: 'Status: pending (default), in_progress, done.' },
        priority: { type: 'string', description: 'Priority: low, medium, high.' },
        project: { type: 'string', description: 'Project name.' },
        tags: { type: 'string', description: 'Comma-separated tags.' },
      },
      required: ['text'],
    },
    async execute(input) {
      const text = input['text'];
      if (typeof text !== 'string') return { content: 'Error: "text" required.', isError: true };
      const task = await withLock(async () => {
        const tasks = await readTasks();
        const newTask: Task = {
          id: randomUUID(), text,
          status: (input['status'] as string) ?? 'pending',
          priority: input['priority'] as string | undefined,
          project: input['project'] as string | undefined,
          tags: typeof input['tags'] === 'string' ? input['tags'].split(',').map((s: string) => s.trim()) : undefined,
        };
        tasks.push(newTask);
        await writeTasks(tasks);
        return newTask;
      });
      return { content: `Created task ${task.id.slice(0, 8)}: ${task.text}` };
    },
  });

  api.registerTool({
    name: 'task_update',
    description: 'Update an existing task.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID (full or first 8 chars).' },
        status: { type: 'string', description: 'New status.' },
        text: { type: 'string', description: 'New text.' },
        priority: { type: 'string', description: 'New priority.' },
        project: { type: 'string', description: 'New project.' },
        tags: { type: 'string', description: 'New tags (comma-separated).' },
      },
      required: ['id'],
    },
    async execute(input) {
      const id = input['id'] as string;
      if (!id) return { content: 'Error: "id" required.', isError: true };
      const updated = await withLock(async () => {
        const tasks = await readTasks();
        const idx = tasks.findIndex(t => t.id === id || t.id.startsWith(id));
        if (idx === -1) return null;
        if (typeof input['status'] === 'string') tasks[idx].status = input['status'];
        if (typeof input['text'] === 'string') tasks[idx].text = input['text'];
        if (typeof input['priority'] === 'string') tasks[idx].priority = input['priority'];
        if (typeof input['project'] === 'string') tasks[idx].project = input['project'];
        if (typeof input['tags'] === 'string') tasks[idx].tags = input['tags'].split(',').map((s: string) => s.trim());
        await writeTasks(tasks);
        return tasks[idx];
      });
      if (!updated) return { content: `Task ${id} not found.`, isError: true };
      return { content: `Updated task ${updated.id.slice(0, 8)}: [${updated.status}] ${updated.text}` };
    },
  });
}

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTaskProvider } from '../index.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dot-ai-test-'));
});

describe('FileTaskProvider', () => {
  describe('list', () => {
    it('returns empty when no tasks file', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      const tasks = await provider.list();
      expect(tasks).toEqual([]);
    });

    it('returns all tasks without filter', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(
        join(aiDir, 'tasks.json'),
        JSON.stringify([
          { id: '1', text: 'Task A', status: 'todo' },
          { id: '2', text: 'Task B', status: 'done' },
        ]),
        'utf-8',
      );

      const provider = new FileTaskProvider({ root: testDir });
      const tasks = await provider.list();
      expect(tasks).toHaveLength(2);
    });

    it('filters by status', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(
        join(aiDir, 'tasks.json'),
        JSON.stringify([
          { id: '1', text: 'Task A', status: 'todo' },
          { id: '2', text: 'Task B', status: 'done' },
          { id: '3', text: 'Task C', status: 'todo' },
        ]),
        'utf-8',
      );

      const provider = new FileTaskProvider({ root: testDir });
      const todos = await provider.list({ status: 'todo' });
      expect(todos).toHaveLength(2);
      expect(todos.every(t => t.status === 'todo')).toBe(true);
    });

    it('filters by project', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(
        join(aiDir, 'tasks.json'),
        JSON.stringify([
          { id: '1', text: 'Task A', status: 'todo', project: 'alpha' },
          { id: '2', text: 'Task B', status: 'todo', project: 'beta' },
          { id: '3', text: 'Task C', status: 'todo', project: 'alpha' },
        ]),
        'utf-8',
      );

      const provider = new FileTaskProvider({ root: testDir });
      const alphaTasks = await provider.list({ project: 'alpha' });
      expect(alphaTasks).toHaveLength(2);
      expect(alphaTasks.every(t => t.project === 'alpha')).toBe(true);
    });

    it('filters by tags', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(
        join(aiDir, 'tasks.json'),
        JSON.stringify([
          { id: '1', text: 'Task A', status: 'todo', tags: ['urgent', 'backend'] },
          { id: '2', text: 'Task B', status: 'todo', tags: ['frontend'] },
          { id: '3', text: 'Task C', status: 'todo', tags: ['backend'] },
        ]),
        'utf-8',
      );

      const provider = new FileTaskProvider({ root: testDir });
      const backendTasks = await provider.list({ tags: ['backend'] });
      expect(backendTasks).toHaveLength(2);
    });

    it('combines status and project filters', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(
        join(aiDir, 'tasks.json'),
        JSON.stringify([
          { id: '1', text: 'Task A', status: 'todo', project: 'alpha' },
          { id: '2', text: 'Task B', status: 'done', project: 'alpha' },
          { id: '3', text: 'Task C', status: 'todo', project: 'beta' },
        ]),
        'utf-8',
      );

      const provider = new FileTaskProvider({ root: testDir });
      const tasks = await provider.list({ status: 'todo', project: 'alpha' });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('1');
    });
  });

  describe('get', () => {
    it('returns task by id', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(
        join(aiDir, 'tasks.json'),
        JSON.stringify([
          { id: '1', text: 'Task A', status: 'todo' },
          { id: '2', text: 'Task B', status: 'done' },
        ]),
        'utf-8',
      );

      const provider = new FileTaskProvider({ root: testDir });
      const task = await provider.get('2');
      expect(task).not.toBeNull();
      expect(task?.id).toBe('2');
      expect(task?.text).toBe('Task B');
    });

    it('returns null for unknown id', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      const task = await provider.get('nonexistent');
      expect(task).toBeNull();
    });

    it('returns null when tasks file does not exist', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      const task = await provider.get('1');
      expect(task).toBeNull();
    });
  });

  describe('create', () => {
    it('adds task with auto-generated id', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      const created = await provider.create({ text: 'New task', status: 'todo' });
      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(created.text).toBe('New task');
      expect(created.status).toBe('todo');
    });

    it('persists created task to file', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      await provider.create({ text: 'New task', status: 'todo' });

      const filePath = join(testDir, '.ai', 'tasks.json');
      const content = await readFile(filePath, 'utf-8');
      const tasks = JSON.parse(content);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].text).toBe('New task');
    });

    it('generates unique ids for each new task', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      const first = await provider.create({ text: 'First', status: 'todo' });
      const second = await provider.create({ text: 'Second', status: 'todo' });
      const third = await provider.create({ text: 'Third', status: 'todo' });

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      expect(first.id).toMatch(uuidRegex);
      expect(second.id).toMatch(uuidRegex);
      expect(third.id).toMatch(uuidRegex);
      expect(first.id).not.toBe(second.id);
      expect(second.id).not.toBe(third.id);
    });

    it('creates .ai directory if it does not exist', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      await provider.create({ text: 'Task', status: 'todo' });

      const filePath = join(testDir, '.ai', 'tasks.json');
      const content = await readFile(filePath, 'utf-8');
      expect(JSON.parse(content)).toHaveLength(1);
    });

    it('preserves optional task fields', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      const created = await provider.create({
        text: 'Task with extras',
        status: 'todo',
        project: 'myproject',
        priority: 'high',
        tags: ['urgent', 'backend'],
      });

      expect(created.project).toBe('myproject');
      expect(created.priority).toBe('high');
      expect(created.tags).toEqual(['urgent', 'backend']);
    });
  });

  describe('update', () => {
    it('modifies task fields', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      const created = await provider.create({ text: 'Original', status: 'todo' });

      const updated = await provider.update(created.id, { status: 'done', text: 'Updated' });
      expect(updated.status).toBe('done');
      expect(updated.text).toBe('Updated');
      expect(updated.id).toBe(created.id);
    });

    it('persists update to file', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      const created = await provider.create({ text: 'Original', status: 'todo' });
      await provider.update(created.id, { status: 'done' });

      const task = await provider.get(created.id);
      expect(task?.status).toBe('done');
    });

    it('throws when task id not found', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      await expect(provider.update('nonexistent', { status: 'done' })).rejects.toThrow('Task nonexistent not found');
    });

    it('preserves unchanged fields', async () => {
      const provider = new FileTaskProvider({ root: testDir });
      const created = await provider.create({
        text: 'Task',
        status: 'todo',
        project: 'myproject',
        tags: ['important'],
      });

      const updated = await provider.update(created.id, { status: 'done' });
      expect(updated.text).toBe('Task');
      expect(updated.project).toBe('myproject');
      expect(updated.tags).toEqual(['important']);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CockpitTaskProvider, createCockpitTaskProvider } from '../index.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('CockpitTaskProvider', () => {
  let provider: CockpitTaskProvider;

  beforeEach(() => {
    mockFetch.mockReset();
    provider = new CockpitTaskProvider({ url: 'http://localhost:3010' });
  });

  describe('list', () => {
    it('fetches tasks from /api/tasks', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: '1',
            text: 'Fix bug',
            status: 'todo',
            priority: 'P1',
            project: 'kiwi',
            tags: 'auth,backend',
            type: null,
            detail: null,
            completed_date: null,
          },
        ],
      });

      const tasks = await provider.list();
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3010/api/tasks', expect.any(Object));
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('1');
      expect(tasks[0].status).toBe('pending'); // cockpit 'todo' → v4 'pending'
      expect(tasks[0].tags).toEqual(['auth', 'backend']);
    });

    it('passes status filter as query param', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
      await provider.list({ status: 'pending' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=pending'),
        expect.any(Object),
      );
    });

    it('passes project filter as query param', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
      await provider.list({ project: 'kiwi' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('project=kiwi'),
        expect.any(Object),
      );
    });

    it('passes tags filter as comma-separated query param', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
      await provider.list({ tags: ['auth', 'backend'] });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('tags=auth%2Cbackend'),
        expect.any(Object),
      );
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
      await expect(provider.list()).rejects.toThrow('Cockpit tasks list failed: 500');
    });

    it('maps archived cockpit status to done', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: '2',
            text: 'Old task',
            status: 'archived',
            priority: null,
            project: null,
            tags: null,
            type: null,
            detail: null,
            completed_date: '2026-01-01',
          },
        ],
      });

      const tasks = await provider.list();
      expect(tasks[0].status).toBe('done');
      expect(tasks[0].metadata?.['completed_date']).toBe('2026-01-01');
    });

    it('exposes cockpit metadata fields', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: '3',
            text: 'Task with detail',
            status: 'todo',
            priority: 'P2',
            project: 'kiwi',
            tags: null,
            type: 'spike',
            detail: 'Investigate options',
            completed_date: null,
          },
        ],
      });

      const tasks = await provider.list();
      expect(tasks[0].metadata?.['type']).toBe('spike');
      expect(tasks[0].metadata?.['detail']).toBe('Investigate options');
    });
  });

  describe('get', () => {
    it('fetches a single task', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '42',
          text: 'Test task',
          status: 'in_progress',
          priority: 'P2',
          project: null,
          tags: null,
          type: null,
          detail: null,
          completed_date: null,
        }),
      });

      const task = await provider.get('42');
      expect(task?.id).toBe('42');
      expect(task?.status).toBe('in_progress');
    });

    it('returns null for 404', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      const task = await provider.get('999');
      expect(task).toBeNull();
    });

    it('throws on non-404 errors', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
      await expect(provider.get('1')).rejects.toThrow('Cockpit task get failed: 503');
    });

    it('URL-encodes the task id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'task/1',
          text: 'T',
          status: 'todo',
          priority: null,
          project: null,
          tags: null,
          type: null,
          detail: null,
          completed_date: null,
        }),
      });

      await provider.get('task/1');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3010/api/tasks/task%2F1',
        expect.any(Object),
      );
    });
  });

  describe('create', () => {
    it('posts to /api/tasks', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '100',
          text: 'New task',
          status: 'todo',
          priority: 'P2',
          project: 'global',
          tags: '',
          type: null,
          detail: null,
          completed_date: null,
        }),
      });

      const task = await provider.create({ text: 'New task', status: 'pending', tags: ['test'] });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3010/api/tasks',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(task.id).toBe('100');
    });

    it('maps pending status to cockpit todo', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '101',
          text: 'T',
          status: 'todo',
          priority: 'P2',
          project: 'global',
          tags: '',
          type: null,
          detail: null,
          completed_date: null,
        }),
      });

      await provider.create({ text: 'T', status: 'pending' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body['status']).toBe('todo');
    });

    it('uses default priority P2 and project global when not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '102',
          text: 'T',
          status: 'todo',
          priority: 'P2',
          project: 'global',
          tags: '',
          type: null,
          detail: null,
          completed_date: null,
        }),
      });

      await provider.create({ text: 'T', status: 'pending' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body['priority']).toBe('P2');
      expect(body['project']).toBe('global');
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 422, statusText: 'Unprocessable Entity' });
      await expect(provider.create({ text: 'T', status: 'pending' })).rejects.toThrow(
        'Cockpit task create failed: 422',
      );
    });
  });

  describe('update', () => {
    it('patches a task', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '1',
          text: 'Updated',
          status: 'done',
          priority: 'P1',
          project: 'kiwi',
          tags: 'auth',
          type: null,
          detail: null,
          completed_date: '2026-03-02',
        }),
      });

      const task = await provider.update('1', { status: 'done' });
      expect(task.status).toBe('done');
    });

    it('sends apiKey header on write operations', async () => {
      const authProvider = new CockpitTaskProvider({
        url: 'http://localhost:3010',
        apiKey: 'secret',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '1',
          text: 'T',
          status: 'todo',
          priority: null,
          project: null,
          tags: null,
          type: null,
          detail: null,
          completed_date: null,
        }),
      });

      await authProvider.update('1', { text: 'Updated' });
      const callHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders['x-api-key']).toBe('secret');
    });

    it('sets completed_date when status is done', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '1',
          text: 'T',
          status: 'done',
          priority: null,
          project: null,
          tags: null,
          type: null,
          detail: null,
          completed_date: '2026-03-02',
        }),
      });

      await provider.update('1', { status: 'done' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
      expect(body['completed_date']).toBeDefined();
      expect(typeof body['completed_date']).toBe('string');
    });

    it('does not send apiKey on read operations', async () => {
      const authProvider = new CockpitTaskProvider({
        url: 'http://localhost:3010',
        apiKey: 'secret',
      });
      mockFetch.mockResolvedValue({ ok: true, json: async () => [] });

      await authProvider.list();
      const callHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders['x-api-key']).toBeUndefined();
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
      await expect(provider.update('999', { text: 'X' })).rejects.toThrow(
        'Cockpit task update failed: 404',
      );
    });
  });

  describe('createCockpitTaskProvider factory', () => {
    it('returns a CockpitTaskProvider instance', () => {
      const p = createCockpitTaskProvider({ url: 'http://localhost:3010' });
      expect(p).toBeInstanceOf(CockpitTaskProvider);
    });

    it('passes options to the constructor', async () => {
      const p = createCockpitTaskProvider({ url: 'http://example.com', apiKey: 'key123' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '1',
          text: 'T',
          status: 'todo',
          priority: null,
          project: null,
          tags: null,
          type: null,
          detail: null,
          completed_date: null,
        }),
      });

      await p.update('1', { text: 'X' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/api/tasks/1',
        expect.any(Object),
      );
      const callHeaders = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(callHeaders['x-api-key']).toBe('key123');
    });
  });

  describe('contract compliance', () => {
    it('satisfies TaskProvider interface', () => {
      expect(typeof provider.list).toBe('function');
      expect(typeof provider.get).toBe('function');
      expect(typeof provider.create).toBe('function');
      expect(typeof provider.update).toBe('function');
    });

    it('strips trailing slashes from baseUrl', async () => {
      const p = new CockpitTaskProvider({ url: 'http://localhost:3010///' });
      mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
      await p.list();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3010/api/tasks',
        expect.any(Object),
      );
    });

    it('uses default url when none provided', async () => {
      const p = new CockpitTaskProvider({});
      mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
      await p.list();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3010/api/tasks',
        expect.any(Object),
      );
    });
  });
});

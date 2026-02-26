import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryProvider } from "../index.js";

export class FileMemoryProvider implements MemoryProvider {
  constructor(private aiDir: string) {}

  async readDaily(date: string): Promise<string | null> {
    const filePath = path.join(this.aiDir, "memory", `${date}.md`);
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  async writeDaily(date: string, content: string): Promise<void> {
    const dir = path.join(this.aiDir, "memory");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${date}.md`), content, "utf-8");
  }

  async search(query: string): Promise<string[]> {
    const memDir = path.join(this.aiDir, "memory");
    const results: string[] = [];
    try {
      const files = await fs.readdir(memDir);
      const mdFiles = files.filter((f: string) => f.endsWith(".md")).sort().reverse();
      const queryLower = query.toLowerCase();
      for (const file of mdFiles.slice(0, 30)) {
        const content = await fs.readFile(path.join(memDir, file), "utf-8");
        if (content.toLowerCase().includes(queryLower)) {
          results.push(file);
        }
      }
    } catch {
      /* no memory dir */
    }
    return results;
  }
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

export function writeBundledAgent(actionPath: string, extra: Record<string, unknown> = {}): void {
  writeJson(join(actionPath, 'agents', 'code-reviewer.json'), {
    name: 'code-reviewer',
    description: 'bundled',
    prompt: 'file://./code-reviewer.md',
    tools: ['read', 'grep', 'glob', '@github'],
    allowedTools: ['@github'],
    resources: ['file://CONTRIBUTING.md'],
    ...extra,
  });
}

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as core from '@actions/core';
import type { ReviewResult } from './types.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export class AcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private toolCalls: string[] = [];

  constructor(
    private readonly kiroBinary: string,
    private readonly debug: boolean,
    private readonly kiroApiKey: string,
  ) {}

  get process(): ChildProcess | null {
    return this.proc;
  }

  async start(agent?: string): Promise<void> {
    const args = ['acp'];
    if (agent) args.push('--agent', agent);

    this.proc = spawn(this.kiroBinary, args, {
      stdio: ['pipe', 'pipe', this.debug ? 'inherit' : 'pipe'],
      env: { ...process.env, KIRO_API_KEY: this.kiroApiKey },
    });

    if (!this.debug) {
      this.proc.stderr?.resume();
    }

    this.proc.on('error', (err) => core.error(`ACP process error: ${err.message}`));
    this.proc.on('exit', (code) => {
      if (this.debug) core.info(`ACP process exited with code ${code}`);
      for (const [id, p] of this.pending) {
        p.reject(new Error(`ACP process exited with code ${code}`));
        this.pending.delete(id);
      }
    });

    const stdout = this.proc.stdout;
    if (!stdout) {
      throw new Error('ACP process stdout is not available');
    }
    const rl = createInterface({ input: stdout });
    rl.on('line', (line) => this.handleLine(line));
    rl.on('error', () => {});
  }

  async initialize(): Promise<void> {
    await this.send('initialize', {
      protocolVersion: 1,
      clientInfo: {
        name: 'kiro-cli-review-action',
        version: '0.1.0',
      },
    });
  }

  async createSession(mcpServerBinary: string, githubToken: string): Promise<string> {
    const result = await this.send('session/new', {
      cwd: process.cwd(),
      mcpServers: [
        {
          name: 'github',
          command: mcpServerBinary,
          args: ['stdio', '--toolsets', 'pull_requests'],
          env: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: githubToken }],
        },
      ],
    });
    const sessionId = (result as Record<string, unknown>)?.sessionId;
    if (typeof sessionId !== 'string') {
      throw new Error('session/new response missing sessionId');
    }
    return sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<ReviewResult> {
    this.toolCalls = [];
    await this.send('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
    return { toolCalls: this.toolCalls };
  }

  kill(): void {
    if (this.proc?.pid && !this.proc.killed) {
      this.proc.kill('SIGTERM');
    }
  }

  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        reject(new Error(`ACP process not available for ${method}`));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      const body = JSON.stringify(msg);
      if (this.debug) core.info(`ACP → ${body}`);
      this.proc.stdin.write(`${body}\n`);
    });
  }

  private handleLine(raw: string): void {
    if (this.debug) core.info(`ACP ← ${raw}`);
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return;
    }

    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(`ACP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          p.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method === 'session/update' && msg.params) {
      this.handleUpdate(msg.params);
    }
  }

  private handleUpdate(params: Record<string, unknown>): void {
    const update = params.update;
    if (typeof update !== 'object' || update === null) return;
    const u = update as Record<string, unknown>;
    if (u.sessionUpdate === 'tool_call' && typeof u.title === 'string' && u.title !== '') {
      this.toolCalls.push(u.title);
      core.info(`Tool call: ${u.title}`);
    }
  }
}

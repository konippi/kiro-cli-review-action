import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as core from '@actions/core';
import type { ReviewResult, ToolCallRecord } from './types.js';

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
  private reviewText = '';
  private toolCalls: ToolCallRecord[] = [];
  private turnEnded = false;
  private turnEndResolve: (() => void) | null = null;

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

    this.proc.on('error', (err) => core.error(`ACP process error: ${err.message}`));
    this.proc.on('exit', (code) => {
      if (this.debug) core.info(`ACP process exited with code ${code}`);
      // Resolve pending turn if process exits
      this.turnEndResolve?.();
    });

    const stdout = this.proc.stdout;
    if (!stdout) {
      throw new Error('ACP process stdout is not available');
    }
    const rl = createInterface({ input: stdout });
    rl.on('line', (line) => this.handleLine(line));
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
    const result = (await this.send('session/new', {
      cwd: process.cwd(),
      mcpServers: [
        {
          name: 'github',
          command: mcpServerBinary,
          args: ['stdio', '--toolsets', 'pull_requests'],
          env: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: githubToken }],
        },
      ],
    })) as { sessionId: string };
    return result.sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    this.reviewText = '';
    this.toolCalls = [];
    this.turnEnded = false;
    await this.send('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  async waitForTurnEnd(timeoutMs: number, sessionId: string): Promise<ReviewResult> {
    if (!this.turnEnded) {
      try {
        await Promise.race([
          new Promise<void>((resolve) => {
            this.turnEndResolve = resolve;
          }),
          new Promise<void>((_, reject) => {
            const timer = setTimeout(() => reject(new Error('ACP turn timed out')), timeoutMs);
            timer.unref();
          }),
        ]);
      } catch (error) {
        await this.cancel(sessionId);
        throw error;
      }
    }
    return { success: true, reviewText: this.reviewText, toolCalls: this.toolCalls };
  }

  async cancel(sessionId: string): Promise<void> {
    try {
      await this.send('session/cancel', { sessionId });
    } catch {
      // Best effort
    }
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

    // JSON-RPC response
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

    // Notification (no id)
    if (msg.method === 'session/notification' && msg.params) {
      this.handleNotification(msg.params);
    }
  }

  private handleNotification(params: Record<string, unknown>): void {
    const type = params.type as string | undefined;
    switch (type) {
      case 'AgentMessageChunk': {
        const text = (params.data as { text?: string })?.text;
        if (text) this.reviewText += text;
        break;
      }
      case 'ToolCall': {
        const data = params.data as { name?: string; status?: string } | undefined;
        if (data?.name) {
          this.toolCalls.push({ name: data.name, status: data.status ?? 'unknown' });
          core.info(`Tool call: ${data.name} (${data.status ?? 'unknown'})`);
        }
        break;
      }
      case 'TurnEnd':
        this.turnEnded = true;
        this.turnEndResolve?.();
        break;
    }
  }
}

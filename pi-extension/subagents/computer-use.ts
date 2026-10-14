/** App-serviced coordination only. The active Codex host owns native tool permissions.
 * This module never launches Computer Use, forwards executable code, or approves access.
 */
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

export interface VisualBinding {
  task: string; session: string; checkout: string; role: string; target: string; hostThread: string;
}
export interface VisualHost { binding: VisualBinding; nonce: string; expires: number; }
export interface VisualRequest { id: string; hostNonce: string; binding: VisualBinding; observation: string; expires: number; }
export interface VisualReply { status: 'observed' | 'denied' | 'cancelled'; summary: string; nativeTool: 'mcp__cua_repl.js'; evidence: string[]; image?: string; }
const fields = ['task', 'session', 'checkout', 'role', 'target', 'hostThread'] as const;
const MAX_BYTES = 32768;
function privatePath(path: string, directory = false) {
  const s = lstatSync(path);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()) || (s.mode & 0o077) !== 0 || s.uid !== process.getuid?.())
    throw new Error('Computer Use coordination requires owner-private regular files and directory');
}
function read(dir: string, name: string): any {
  privatePath(dir, true);
  const path = join(dir, name);
  privatePath(path);
  const bytes = readFileSync(path);
  if (bytes.length > MAX_BYTES) throw new Error('Computer Use coordination payload exceeds limit');
  return JSON.parse(bytes.toString());
}
function write(dir: string, name: string, value: unknown) {
  privatePath(dir, true);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Computer Use coordination payload exceeds limit');
  writeFileSync(join(dir, name), text, { mode: 0o600, flag: 'wx' });
}
function readImage(dir: string, name?: string) {
  if (name === undefined) return;
  if (!/^[a-zA-Z0-9_-]+\.png$/.test(name)) throw new Error('Screenshot must be a private queue PNG basename');
  const path = join(dir, name);
  privatePath(path);
  if (lstatSync(path).size > 10 * 1024 * 1024) throw new Error('Screenshot exceeds ten MiB');
  const bytes = readFileSync(path);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Screenshot is not PNG');
  return { type: 'image' as const, mimeType: 'image/png', data: bytes.toString('base64') };
}
function validate(binding: VisualBinding) {
  if (fields.some(k => typeof binding[k] !== 'string' || !binding[k] || binding[k].length > 2048) || binding.role !== 'visual-tester' || realpathSync(binding.checkout) !== binding.checkout)
    throw new Error('Computer Use requires exact task/session/checkout/visual-tester/target/host binding');
}
function same(a: VisualBinding, b: VisualBinding) { return fields.every(k => a[k] === b[k]); }
function hostFor(dir: string, binding: VisualBinding, nonce?: string): VisualHost {
  validate(binding);
  let host: VisualHost;
  try { host = read(dir, 'host.json'); } catch { throw new Error('No active Codex app visual host; have the active app turn open a task-bound host lease'); }
  if (!same(host.binding, binding) || !host.nonce || (nonce && host.nonce !== nonce) || !Number.isFinite(host.expires) || host.expires <= Date.now())
    throw new Error('Codex app visual host is stale, replaced, or belongs to another task/session/target');
  return host;
}
/** Called only by an explicitly active app host. Receipt is not native approval evidence. */
export function openVisualHost(dir: string, binding: VisualBinding, lifetimeMs = 60000): VisualHost {
  validate(binding);
  if (lifetimeMs < 1 || lifetimeMs > 300000) throw new Error('Host lifetime must be bounded to five minutes');
  const host = { binding, nonce: randomUUID(), expires: Date.now() + lifetimeMs };
  write(dir, 'host.json', host);
  return host;
}
export function readVisualRequest(dir: string, host: VisualHost): VisualRequest | undefined {
  hostFor(dir, host.binding, host.nonce);
  if (existsSync(join(dir, 'cancelled.json'))) throw new Error('Pi visual request cancelled');
  if (!existsSync(join(dir, 'request.json'))) return;
  const request: VisualRequest = read(dir, 'request.json');
  if (!same(request.binding, host.binding) || request.hostNonce !== host.nonce || request.expires <= Date.now() || !/^[a-f0-9-]{36}$/.test(request.id) || typeof request.observation !== 'string' || request.observation.length > 4000)
    throw new Error('Foreign, expired, or malformed visual request');
  return request;
}
/** The host calls its OWN normal CUA harness first, then supplies bounded findings. */
export function completeVisualRequest(dir: string, host: VisualHost, id: string, reply: VisualReply) {
  const request = readVisualRequest(dir, host);
  if (!request || request.id !== id) throw new Error('No matching waiting Pi request');
  if (!['observed', 'denied', 'cancelled'].includes(reply.status) || reply.nativeTool !== 'mcp__cua_repl.js' || typeof reply.summary !== 'string' || reply.summary.length > 12000 || !Array.isArray(reply.evidence) || reply.evidence.length > 8 || reply.evidence.some(p => typeof p !== 'string' || p.length > 2048))
    throw new Error('Invalid bounded native Computer Use result');
  readImage(dir, reply.image);
  write(dir, 'result.json', { image: reply.image, id, hostNonce: host.nonce, binding: host.binding, status: reply.status, summary: reply.summary, nativeTool: reply.nativeTool, evidence: reply.evidence });
}
export async function requestVisualObservation(dir: string, binding: VisualBinding, observation: string, signal?: AbortSignal) {
  const host = hostFor(dir, binding);
  if (typeof observation !== 'string' || !observation.trim() || observation.length > 4000) throw new Error('Provide a bounded observation, not code or tool arguments');
  const request: VisualRequest = { id: randomUUID(), hostNonce: host.nonce, binding, observation, expires: host.expires };
  write(dir, 'request.json', request);
  while (true) {
    if (signal?.aborted) {
      write(dir, 'cancelled.json', { id: request.id });
      throw new Error('Pi Computer Use observation cancelled');
    }
    hostFor(dir, binding, host.nonce);
    if (existsSync(join(dir, 'result.json'))) {
      const result = read(dir, 'result.json');
      if (result.id !== request.id || result.hostNonce !== host.nonce || !same(result.binding, binding)) throw new Error('Foreign Computer Use result');
      if (result.status !== 'observed') throw new Error(`Native Computer Use ${result.status}: ${result.summary}`);
      if (result.nativeTool !== 'mcp__cua_repl.js' || typeof result.summary !== 'string' || result.summary.length > 12000 || !Array.isArray(result.evidence) || result.evidence.length > 8 || result.evidence.some((p: unknown) => typeof p !== 'string' || p.length > 2048)) throw new Error('Malformed native Computer Use result');
      return { image: readImage(dir, result.image), summary: result.summary, evidence: result.evidence, nativeTool: result.nativeTool, hostThread: binding.hostThread, task: binding.task, session: binding.session, target: binding.target, requestId: request.id };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
export function registerVisualObservation(pi: ExtensionAPI) {
  const dir = process.env.PI_CODEX_VISUAL_HOST;
  if (!dir) return;
  let binding: VisualBinding;
  try { binding = read(dir, 'host.json').binding; hostFor(dir, binding); } catch { return; }
  if (process.env.PI_SUBAGENT_AGENT !== 'visual-tester' || realpathSync(process.cwd()) !== binding.checkout) return;
  pi.registerTool({
    name: 'codex_computer_use', label: 'Codex Computer Use observation',
    description: 'Ask the explicitly active Codex app host to observe the exact leased synthetic target through its normal Computer Use permissions. This does not run code or grant app access. Missing/stale host fails closed.',
    parameters: Type.Object({ observation: Type.String({ minLength: 1, maxLength: 4000 }) }),
    async execute(_id, params, signal, _update, ctx) {
      if (ctx.sessionManager.getSessionId() !== binding.session) throw new Error('Computer Use lease belongs to another Pi session');
      const result = await requestVisualObservation(dir, binding, params.observation, signal);
      const { image, ...provenance } = result;
      return { content: [{ type: 'text' as const, text: JSON.stringify(provenance) }, ...(image ? [image] : [])], details: provenance };
    },
  });
}

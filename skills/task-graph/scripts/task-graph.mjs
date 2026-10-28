#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const help = `Task Graph local API client (Node.js 22+)
Usage: node task-graph.mjs [--url http://127.0.0.1:4310] <action> ...
  list                         List project identities (read-only)
  get PROJECT                  Read full snapshot including documents
  ready PROJECT                Show active, ready backlog, blocked and review nodes
  storage PROJECT              Read generated Markdown paths (read-only)
  export PROJECT               Print complete JSON backup to stdout (read-only)
  create --name NAME [--description TEXT]
  command PROJECT --revision N --file FILE|-
                               File/stdin contains ONE command object, not an envelope
  --confirm-destructive        Required for delete/legacy conversion commands;
                               use only with actual user authorization
  --help                       Show this help
Environment: TASK_GRAPH_URL, TASK_GRAPH_TIMEOUT_MS (100..60000, default 10000)
Successful JSON goes to stdout; errors go to stderr.
Exit codes: 0 success, 1 HTTP/API error, 2 invalid input,
            3 revision conflict (409), 4 network/uncertain response.
No automatic write retries or revision rebasing. Writes require prior user scope.
`;
const commands = new Set(['createTask', 'updateTask', 'deleteTask', 'addEdge', 'removeEdge', 'saveDocument', 'deleteDocument', 'autoLayout', 'renameProject', 'saveAcceptanceDocument', 'deleteAcceptanceDocument', 'convertAcceptanceDocument']);
const destructive = new Set(['deleteTask', 'deleteDocument', 'deleteAcceptanceDocument', 'convertAcceptanceDocument']);
class ClientError extends Error {
  constructor(code, details) { super(details.error); this.code = code; this.details = details; }
}
const invalid = message => { throw new ClientError(2, { error: message }); };
function parse(args) {
  const positional = [], options = {};
  const valued = new Set(['--url', '--name', '--description', '--revision', '--file']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (valued.has(arg)) {
      if (options[arg] !== undefined) invalid(`Duplicate option: ${arg}`);
      const next = args[++i]; if (next === undefined || next.startsWith('--')) invalid(`Missing value: ${arg}`);
      options[arg] = next;
    } else if (arg === '--confirm-destructive' || arg === '--help') options[arg] = true;
    else if (arg.startsWith('--')) invalid(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  return { positional, options };
}
function endpoint(text) {
  let url; try { url = new URL(text); } catch { invalid('Invalid service URL'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    invalid('Service URL must be a plain loopback HTTP origin, without credentials, path, query or fragment');
  }
  return url.origin;
}
function id(text) {
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(text ?? '')) invalid('Invalid or missing project ID');
  return text;
}
async function inputJSON(file) {
  if (!file) invalid('command requires --file FILE or --file -');
  let text;
  try {
    if (file === '-') {
      const chunks = []; let size = 0;
      for await (const chunk of process.stdin) { size += chunk.length; if (size > 8 * 1024 * 1024) invalid('Input exceeds 8 MB'); chunks.push(chunk); }
      text = Buffer.concat(chunks).toString('utf8');
    } else text = await readFile(file, 'utf8');
  } catch (error) { if (error instanceof ClientError) throw error; invalid('Cannot read input file'); }
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) invalid('Input exceeds 8 MB');
  let value; try { value = JSON.parse(text); } catch { invalid('Input must be valid JSON'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || !commands.has(value.type)) invalid('Input must be one supported command object; see references/api.md');
  return value;
}
async function request(base, path, payload, timeout) {
  const writing = payload !== undefined;
  let response, value;
  try {
    response = await fetch(base + path, { method: writing ? 'POST' : 'GET', redirect: 'error',
      headers: { Accept: 'application/json', ...(writing ? { 'Content-Type': 'application/json' } : {}) },
      body: writing ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(timeout) });
    value = await response.json();
  } catch {
    throw new ClientError(4, { error: writing ? 'Write response unavailable; do not retry blindly. Read and reconcile state first.' : 'Service unavailable or response invalid. Check the local service and endpoint.',
      outcome: writing ? 'unknown' : 'unavailable' });
  }
  if (!response.ok) throw new ClientError(response.status === 409 ? 3 : 1, {
    error: typeof value?.error === 'string' ? value.error : 'API request failed', status: response.status,
    ...(response.status === 409 ? { next: 'Reread the project, compare changes, rebuild the authorized command with the new revision. No automatic retry was performed.' } : {}),
  });
  return value;
}
async function main(args) {
  const { positional, options } = parse(args);
  if (options['--help']) { process.stdout.write(help); return; }
  const [action, project, ...extra] = positional;
  const allowed = {
    list: [], get: [], ready: [], storage: [], export: [], create: ['--name', '--description'],
    command: ['--revision', '--file', '--confirm-destructive'],
  };
  if (!Object.hasOwn(allowed, action ?? '')) invalid('Unknown or missing action; run --help');
  for (const key of Object.keys(options)) if (key !== '--url' && !allowed[action].includes(key)) invalid(`Option ${key} is not valid for ${action}`);
  const needsProject = ['get', 'ready', 'storage', 'export', 'command'].includes(action);
  if (extra.length || (!needsProject && project !== undefined)) invalid('Unexpected positional arguments');
  if (needsProject) id(project);
  const base = endpoint(options['--url'] ?? process.env.TASK_GRAPH_URL ?? 'http://127.0.0.1:4310');
  const timeout = Number(process.env.TASK_GRAPH_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) invalid('TASK_GRAPH_TIMEOUT_MS must be an integer from 100 to 60000');
  let path = '/api/projects', payload;
  if (needsProject) path += '/' + project;
  if (action === 'create') {
    if (!options['--name']?.trim()) invalid('create requires a nonempty --name');
    payload = { name: options['--name'], description: options['--description'] ?? '' };
  } else if (action === 'command') {
    const revision = Number(options['--revision']);
    if (!Number.isSafeInteger(revision) || revision < 1) invalid('command requires --revision from the snapshot you actually read');
    const command = await inputJSON(options['--file']);
    if (destructive.has(command.type) && !options['--confirm-destructive']) invalid('Destructive/conversion command requires user authorization and --confirm-destructive');
    path += '/commands'; payload = { revision, command };
    if (Buffer.byteLength(JSON.stringify(payload)) > 8 * 1024 * 1024) invalid('Request exceeds 8 MB');
  } else if (action === 'storage' || action === 'export') path += '/' + action;
  let value = await request(base, path, payload, timeout);
  if (action === 'ready') {
    const predecessorsDone = task => value.edges.filter(edge => edge.to === task.id).every(edge => value.tasks.some(parent => parent.id === edge.from && parent.status === 'done'));
    value = { projectId: value.id, revision: value.revision,
      active: value.tasks.filter(t => t.status === 'active'),
      ready: value.tasks.filter(t => t.status === 'backlog' && predecessorsDone(t)),
      waitingForReview: value.tasks.filter(t => t.status === 'review'), blocked: value.tasks.filter(t => t.status === 'blocked') };
  }
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
try { await main(process.argv.slice(2)); }
catch (error) {
  process.stderr.write(JSON.stringify(error instanceof ClientError ? error.details : { error: 'Unexpected client failure; no retry performed' }) + '\n');
  process.exitCode = error instanceof ClientError ? error.code : 1;
}

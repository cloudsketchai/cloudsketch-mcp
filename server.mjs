#!/usr/bin/env node
/**
 * CloudSketch AI MCP server (stdio). No dependencies; needs Node 18+.
 *
 *   CLOUDSKETCH_API_TOKEN   personal API token (Account → API tokens on cloudsketchai.com)
 *   CLOUDSKETCH_BASE_URL    optional, defaults to https://cloudsketchai.com
 *
 * Messages are newline-delimited JSON-RPC 2.0 on stdin/stdout. Logs go to stderr only.
 */
import { createInterface } from 'node:readline';
import { handleMessage, DEFAULT_BASE_URL } from './lib.mjs';

const env = {
  token: (process.env.CLOUDSKETCH_API_TOKEN || '').trim(),
  baseUrl: (process.env.CLOUDSKETCH_BASE_URL || DEFAULT_BASE_URL).trim()
};

const send = (obj) => { if (obj) process.stdout.write(`${JSON.stringify(obj)}\n`); };
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = 0;
let closing = false;

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  const batch = Array.isArray(msg) ? msg : [msg];
  pending += 1;
  try {
    const out = [];
    for (const m of batch) {
      try { out.push(await handleMessage(m, env)); } catch (error) {
        out.push(m && m.id !== undefined ? { jsonrpc: '2.0', id: m.id, error: { code: -32603, message: 'Internal error' } } : null);
        process.stderr.write(`[cloudsketch-mcp] ${error && error.stack ? error.stack : error}\n`);
      }
    }
    const replies = out.filter(Boolean);
    if (Array.isArray(msg)) { if (replies.length) send(replies); } else send(replies[0]);
  } finally {
    pending -= 1;
    if (closing && pending === 0) process.exit(0);
  }
});
rl.on('close', () => { closing = true; if (pending === 0) process.exit(0); });

if (!env.token) process.stderr.write('[cloudsketch-mcp] CLOUDSKETCH_API_TOKEN is not set: only open_in_cloudsketch and list_diagram_types will work.\n');

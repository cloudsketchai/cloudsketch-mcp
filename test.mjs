// Tests for the CloudSketch AI MCP server: protocol, tools and the real stdio process against a fake API.
import assert from 'node:assert';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { handleMessage, callTool, splitViews, deepLink, TOOLS, DIAGRAM_TYPES } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let n = 0;
const ok = (label) => console.log(`  ✔ Test ${++n}: ${label}`);
console.log('[Test Suite] CloudSketch AI MCP server...');

// ── Protocol ──
let r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
assert.strictEqual(r.result.protocolVersion, '2025-03-26');
assert.deepStrictEqual(r.result.capabilities, { tools: { listChanged: false } });
assert.strictEqual(r.result.serverInfo.name, 'cloudsketch-ai');
r = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
assert.strictEqual(r.result.protocolVersion, '2025-06-18', 'unknown version: offer the latest');
assert.strictEqual(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
assert.deepStrictEqual((await handleMessage({ jsonrpc: '2.0', id: 3, method: 'ping' })).result, {});
assert.strictEqual((await handleMessage({ jsonrpc: '2.0', id: 4, method: 'nope' })).error.code, -32601);
assert.strictEqual((await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'x' } })).error.code, -32602);
r = await handleMessage({ jsonrpc: '2.0', id: 6, method: 'tools/list' });
assert.deepStrictEqual(r.result.tools.map((t) => t.name), ['generate_diagram', 'open_in_cloudsketch', 'check_credits', 'list_diagram_types']);
for (const t of r.result.tools) assert.strictEqual(t.inputSchema.type, 'object');
assert.strictEqual(Object.keys(DIAGRAM_TYPES).length, 18);
ok('initialize (version negotiation), ping, notifications, tools/list, errors');

// ── Offline tools ──
r = await callTool('list_diagram_types');
assert.ok(r.content[0].text.includes('c4:') && r.content[0].text.includes('gantt:'));
r = await callTool('open_in_cloudsketch', { mermaid: 'erDiagram\n  USER ||--o{ ORDER : places', title: 'Shop DB' });
assert.ok(!r.isError);
const link = r.content[0].text.replace('Open in CloudSketch AI: ', '');
const u = new URL(link);
assert.strictEqual(u.origin, 'https://cloudsketchai.com');
assert.strictEqual(u.searchParams.get('type'), 'erd');
assert.strictEqual(u.searchParams.get('title'), 'Shop DB');
assert.strictEqual(Buffer.from(u.searchParams.get('code').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'), 'erDiagram\n  USER ||--o{ ORDER : places');
assert.strictEqual((await callTool('open_in_cloudsketch', { mermaid: 'graph TD\n' + 'A-->B\n'.repeat(2000) })).isError, true, 'too large for a link');
assert.strictEqual(deepLink('x'), null);
assert.deepStrictEqual(splitViews('===SYSTEM===\nC4Context\n===CONTAINER===\nC4Container\n').map((v) => v.name), ['System', 'Container']);
assert.deepStrictEqual(splitViews('flowchart TD\nA-->B'), [{ name: '', code: 'flowchart TD\nA-->B' }]);
ok('open_in_cloudsketch makes the same link as the VS Code extension; list and view splitting');

// ── No token ──
for (const name of ['generate_diagram', 'check_credits']) {
  r = await callTool(name, { description: 'x'.repeat(30), diagram_type: 'erd' }, {});
  assert.strictEqual(r.isError, true);
  assert.ok(/API token/.test(r.content[0].text));
}
ok('without a token, the account tools explain how to get one');

// ── Fake CloudSketch API ──
const seen = [];
const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== 'Bearer csk_good') return send(401, { success: false, error: 'Please sign in.' });
    if (req.url === '/api/v1/mcp/me') return send(200, { success: true, plan: 'Professional', isPaid: true, remainingToday: 18, monthlyRemaining: 140, monthlyLimit: 150 });
    if (req.url === '/api/v1/generate') {
      const b = JSON.parse(body);
      if (b.prompt.includes('quota')) return send(429, { success: false, error: 'You have used today\'s 20 credits. They reset at 05:30 IST.' });
      if (b.diagramType === 'c4') return send(200, { success: true, diagram: '===SYSTEM===\nC4Context\n  Person(u, "User")\n===CONTAINER===\nC4Container\n  Container(a, "API")\n', project: { id: 'p1' } });
      return send(200, { success: true, diagram: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places', project: { id: 'p2' }, audienceNote: b.audience === 'investor' ? 'Investors see the Managers view.' : undefined });
    }
    return send(404, { success: false, error: 'not found' });
  });
});
await new Promise((res) => api.listen(0, '127.0.0.1', res));
const baseUrl = `http://127.0.0.1:${api.address().port}`;
const env = { token: 'csk_good', baseUrl };

r = await callTool('generate_diagram', { description: 'An online shop: customers place orders with several products.', diagram_type: 'erd', audience: 'investors' }, env);
assert.ok(!r.isError, r.content[0].text);
assert.ok(r.content[0].text.includes('```mermaid\nerDiagram'));
assert.ok(r.content[0].text.includes(`Open and edit in CloudSketch AI: ${baseUrl}/?code=`));
assert.ok(r.content[0].text.includes('Note: Investors see the Managers view.'));
const g = seen.find((s) => s.url === '/api/v1/generate');
assert.deepStrictEqual({ ...g.body }, { prompt: 'An online shop: customers place orders with several products.', diagramType: 'erd', audience: 'investor', source: 'mcp' });
assert.strictEqual(g.auth, 'Bearer csk_good');
ok('generate_diagram sends the description, type and audience with the token, and returns Mermaid plus an edit link');

r = await callTool('generate_diagram', { description: 'A payments platform with a web app, an API and a database.', diagram_type: 'c4' }, env);
assert.ok(r.content[0].text.includes('### System view') && r.content[0].text.includes('### Container view'));
assert.strictEqual((r.content[0].text.match(/```mermaid/g) || []).length, 2);
ok('C4 output comes back as one block per view');

r = await callTool('generate_diagram', { description: 'quota test prompt that is long enough', diagram_type: 'erd' }, env);
assert.strictEqual(r.isError, true);
assert.ok(/20 credits/.test(r.content[0].text));
r = await callTool('generate_diagram', { description: 'An online shop with orders and products.', diagram_type: 'erd' }, { ...env, token: 'csk_bad' });
assert.ok(/did not accept the API token/.test(r.content[0].text));
assert.ok((await callTool('generate_diagram', { description: 'short', diagram_type: 'erd' }, env)).isError);
assert.ok(/Unknown diagram type/.test((await callTool('generate_diagram', { description: 'An online shop with orders and products.', diagram_type: 'pizza' }, env)).content[0].text));
r = await callTool('check_credits', {}, env);
assert.ok(r.content[0].text.includes('Plan: Professional') && r.content[0].text.includes('140 of 150'));
ok('server errors (credits used up, bad token) and bad input come back as readable tool errors; check_credits');

// ── The real stdio process ──
const child = spawn(process.execPath, [path.join(here, 'server.mjs')], { env: { ...process.env, CLOUDSKETCH_API_TOKEN: 'csk_good', CLOUDSKETCH_BASE_URL: baseUrl }, stdio: ['pipe', 'pipe', 'pipe'] });
const replies = [];
let buf = '';
child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) replies.push(JSON.parse(line)); } });
const write = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
write({ jsonrpc: '2.0', method: 'notifications/initialized' });
write({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
write({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'generate_diagram', arguments: { description: 'An online shop: customers place orders.', diagram_type: 'erd' } } });
child.stdin.write('not json\n');
child.stdin.end();
const code = await new Promise((res) => child.on('exit', res));
assert.strictEqual(code, 0);
const byId = Object.fromEntries(replies.filter((x) => x.id !== null).map((x) => [x.id, x]));
assert.strictEqual(byId[1].result.serverInfo.name, 'cloudsketch-ai');
assert.strictEqual(byId[2].result.tools.length, TOOLS.length);
assert.ok(byId[3].result.content[0].text.includes('erDiagram'));
assert.ok(replies.some((x) => x.id === null && x.error && x.error.code === -32700), 'parse error reported');
assert.strictEqual(replies.length, 4, 'no reply to the notification');
ok('the stdio server answers a real client session (initialize, list, call) and exits cleanly');

api.close();
console.log('✔ All MCP Server Tests Passed Successfully!');

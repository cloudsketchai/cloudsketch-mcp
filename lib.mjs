/**
 * CloudSketch AI MCP server: the parts that need no stdio (tested in test.mjs).
 * No dependencies: MCP over stdio is JSON-RPC 2.0, one message per line.
 */

export const SERVER_INFO = { name: 'cloudsketch-ai', title: 'CloudSketch AI', version: '0.1.0' };
export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const DEFAULT_BASE_URL = 'https://cloudsketchai.com';
const MAX_LINK_CHARS = 6000;

export const DIAGRAM_TYPES = {
  c4: 'C4 model: system context, container and component views (2 credits)',
  deployment: 'Cloud deployment / infrastructure diagram (AWS, Azure, GCP, Kubernetes)',
  network: 'Network diagram: zones, subnets, firewalls, VPNs',
  erd: 'Entity-relationship diagram for a database',
  class: 'UML class diagram',
  sequence: 'Sequence diagram: who calls whom, in order (technical view 2 credits)',
  state: 'State machine',
  dfd: 'Data flow diagram (level 0/1)',
  flowchart: 'Flowchart of a process or algorithm',
  swimlane: 'Swimlane process map across teams or roles',
  usecase: 'UML use case diagram',
  journey: 'User / customer journey map',
  quadrant: 'Prioritisation matrix (2x2 quadrant)',
  mindmap: 'Mind map (2 credits)',
  sankey: 'Sankey flow diagram (money, energy, materials)',
  chart: 'Data chart: pie, bar or line',
  gitgraph: 'Git branching strategy',
  gantt: 'Gantt chart / project plan'
};

const AUDIENCES = { technical: 'technical', managers: 'plain', investors: 'investor' };

export const TOOLS = [
  {
    name: 'generate_diagram',
    title: 'Generate a diagram',
    description: 'Turn a plain-English description of a system, database, process or plan into an accurate diagram (Mermaid code) with CloudSketch AI. Uses credits from the CloudSketch AI account that owns the API token. Describe the real system in detail: components, data stores, external services, users, and the cloud or country if relevant.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What to draw, in plain English (20-4000 characters). Be specific.' },
        diagram_type: { type: 'string', enum: Object.keys(DIAGRAM_TYPES), description: 'Which kind of diagram. Use list_diagram_types if unsure.' },
        audience: { type: 'string', enum: Object.keys(AUDIENCES), description: 'technical (default): exact technical names. managers: plain words. investors: business view.' }
      },
      required: ['description', 'diagram_type']
    },
    annotations: { readOnlyHint: false, openWorldHint: true }
  },
  {
    name: 'open_in_cloudsketch',
    title: 'Open Mermaid in CloudSketch AI',
    description: 'Make a link that opens any Mermaid diagram in the CloudSketch AI editor, to restyle it or export it to PowerPoint, Word, PNG, SVG, PDF or draw.io. Needs no account and uses no credits; the diagram travels inside the link and is not uploaded.',
    inputSchema: {
      type: 'object',
      properties: {
        mermaid: { type: 'string', description: 'The Mermaid source code.' },
        title: { type: 'string', description: 'Optional title.' }
      },
      required: ['mermaid']
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'check_credits',
    title: 'Check CloudSketch AI credits',
    description: "Show the CloudSketch AI plan and how many credits are left today and this month for the API token's account.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: 'list_diagram_types',
    title: 'List diagram types',
    description: 'List the 18 diagram types CloudSketch AI can generate, with what each is for.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }
];

export function toBase64Url(text) {
  return Buffer.from(String(text), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function guessType(code) {
  const first = (String(code).split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%')) || '').toLowerCase();
  const table = [['sequencediagram', 'sequence'], ['classdiagram', 'class'], ['statediagram', 'state'], ['erdiagram', 'erd'], ['gantt', 'gantt'],
    ['journey', 'journey'], ['quadrantchart', 'quadrant'], ['mindmap', 'mindmap'], ['gitgraph', 'gitgraph'], ['sankey', 'sankey'], ['c4', 'c4'], ['pie', 'chart'], ['xychart', 'chart']];
  const hit = table.find(([p]) => first.startsWith(p));
  return hit ? hit[1] : 'flowchart';
}

/** "Open in CloudSketch AI" link, or null when the diagram is too large for a link. */
export function deepLink(code, { baseUrl = DEFAULT_BASE_URL, title = '', type } = {}) {
  const text = String(code || '').trim();
  if (text.length < 5) return null;
  const encoded = toBase64Url(text);
  if (encoded.length > MAX_LINK_CHARS) return null;
  // Same format as integrations/shared/deeplink.mjs (the app reads code, type and title).
  const params = [`code=${encoded}`, `type=${encodeURIComponent(type || guessType(text))}`];
  if (title) params.push(`title=${encodeURIComponent(String(title).slice(0, 120))}`);
  return `${String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/?${params.join('&')}`;
}

/** Splits CloudSketch's multi-view output (===SYSTEM===, ===CONTAINER===, …) into named views. */
export function splitViews(code) {
  const text = String(code || '').replace(/\r\n/g, '\n');
  const marker = /^\s*===([A-Z]+)===\s*$/m;
  if (!marker.test(text)) return [{ name: '', code: text.trim() }];
  const parts = text.split(/^\s*===([A-Z]+)===\s*$/m);
  const views = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = (parts[i + 1] || '').trim();
    if (body) views.push({ name: parts[i].charAt(0) + parts[i].slice(1).toLowerCase(), code: body });
  }
  if (!views.length) return [{ name: '', code: text.trim() }];
  // Most types repeat the same diagram in every section: return it once, unnamed.
  if (views.every((v) => v.code === views[0].code)) return [{ name: '', code: views[0].code }];
  return views;
}

const textResult = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });

/**
 * Runs one tool. `env` = { token, baseUrl, fetch, timeoutMs }.
 * Returns an MCP CallToolResult.
 */
export async function callTool(name, args = {}, env = {}) {
  const baseUrl = (env.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch = env.fetch || fetch;
  const needToken = () => textResult('No CloudSketch AI API token is set. Create one at https://cloudsketchai.com/auth (Account → API tokens) and set it as CLOUDSKETCH_API_TOKEN in this MCP server\'s settings.', true);

  if (name === 'list_diagram_types') {
    return textResult(Object.entries(DIAGRAM_TYPES).map(([k, v]) => `- ${k}: ${v}`).join('\n'));
  }

  if (name === 'open_in_cloudsketch') {
    const code = String(args.mermaid || '').trim();
    if (code.length < 5) return textResult('Please pass the Mermaid code to open.', true);
    const link = deepLink(code, { baseUrl, title: args.title });
    return link ? textResult(`Open in CloudSketch AI: ${link}`) : textResult('This diagram is too large to fit in a link (about 4 KB of Mermaid). Paste it into the CloudSketch AI editor instead: https://cloudsketchai.com', true);
  }

  if (name === 'check_credits') {
    if (!env.token) return needToken();
    const r = await request(doFetch, `${baseUrl}/api/v1/mcp/me`, { method: 'GET', token: env.token, timeoutMs: 30000 });
    if (!r.ok) return textResult(r.error, true);
    const b = r.body;
    const lines = [`Plan: ${b.plan}`];
    if (b.remainingToday !== null && b.remainingToday !== undefined) lines.push(`Credits left today: ${b.remainingToday}`);
    if (b.monthlyRemaining !== null && b.monthlyRemaining !== undefined) lines.push(`Credits left this month: ${b.monthlyRemaining}${b.monthlyLimit ? ` of ${b.monthlyLimit}` : ''}`);
    if (!b.isPaid) lines.push('More credits and the C4 suite with Pro: https://cloudsketchai.com/pricing');
    return textResult(lines.join('\n'));
  }

  if (name === 'generate_diagram') {
    if (!env.token) return needToken();
    const description = String(args.description || '').trim();
    const type = String(args.diagram_type || '').trim().toLowerCase();
    if (description.length < 20) return textResult('Please describe the system in more detail (at least 20 characters).', true);
    if (description.length > 4000) return textResult('The description is too long (4000 characters at most). Shorten it, or split it into several diagrams.', true);
    if (!DIAGRAM_TYPES[type]) return textResult(`Unknown diagram type "${type}". Use one of: ${Object.keys(DIAGRAM_TYPES).join(', ')}.`, true);
    const audience = AUDIENCES[String(args.audience || 'technical').toLowerCase()] || 'technical';
    const r = await request(doFetch, `${baseUrl}/api/v1/generate`, {
      method: 'POST', token: env.token, timeoutMs: env.timeoutMs || 180000,
      body: { prompt: description, diagramType: type, audience, source: 'mcp' }
    });
    if (!r.ok) return textResult(r.error, true);
    const b = r.body;
    if (b.fallbackUsed || b.aiUnavailable) return textResult('CloudSketch AI could not generate this diagram right now (the AI service is busy). Please try again in a minute.', true);
    const code = typeof b.diagram === 'string' ? b.diagram : (b.diagram && (b.diagram.mermaidCode || b.diagram.code)) || '';
    if (!code.trim()) return textResult(b.error || 'CloudSketch AI returned no diagram. Please rephrase the description and try again.', true);
    const views = splitViews(code);
    const out = [];
    for (const v of views) {
      if (v.name) out.push(`### ${v.name} view`);
      out.push('```mermaid', v.code, '```');
      const link = deepLink(v.code, { baseUrl, title: v.name ? `${v.name} view` : '', type: views.length > 1 ? type : undefined });
      if (link) out.push(`Open and edit in CloudSketch AI: ${link}`);
      out.push('');
    }
    if (b.audienceNote) out.push(`Note: ${b.audienceNote}`);
    out.push(`Saved to your CloudSketch AI workspace: ${baseUrl}/workspace`);
    return textResult(out.join('\n').trim());
  }

  return textResult(`Unknown tool: ${name}`, true);
}

async function request(doFetch, url, { method, token, body, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
  try {
    const r = await doFetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': `cloudsketch-mcp/${SERVER_INFO.version}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    let json = null;
    try { json = await r.json(); } catch { /* not JSON */ }
    if (r.status === 401) return { ok: false, error: 'CloudSketch AI did not accept the API token. Check CLOUDSKETCH_API_TOKEN, or create a new token at https://cloudsketchai.com/auth (Account → API tokens).' };
    if (!r.ok || (json && json.success === false)) {
      const msg = (json && (json.error || json.message)) || `CloudSketch AI answered with HTTP ${r.status}.`;
      return { ok: false, error: msg };
    }
    return { ok: true, body: json || {} };
  } catch (error) {
    return { ok: false, error: error && error.name === 'AbortError' ? 'CloudSketch AI took too long to answer. Please try again.' : `Could not reach CloudSketch AI (${error && error.message ? error.message : 'network error'}).` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Handles one JSON-RPC message. Returns the response object, or null for notifications.
 */
export async function handleMessage(msg, env = {}) {
  const isRequest = msg && typeof msg === 'object' && msg.id !== undefined && msg.id !== null;
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: isRequest ? msg.id : null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isRequest ? fail(-32600, 'Invalid request') : null;
  if (!isRequest) return null; // notifications (initialized, cancelled …) need no answer

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params && msg.params.protocolVersion;
      return reply({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Use generate_diagram to draw architecture, database, process and planning diagrams from a description; it returns Mermaid code and a link to edit it in CloudSketch AI. Use open_in_cloudsketch to open existing Mermaid code there for export to PowerPoint, Word or images.'
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params && msg.params.name;
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      return reply(await callTool(name, (msg.params && msg.params.arguments) || {}, env));
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

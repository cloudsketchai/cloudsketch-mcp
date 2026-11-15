# CloudSketch AI MCP server

Generate accurate architecture, database and process diagrams from **Claude Desktop, Claude Code, Cursor, VS Code** or any other MCP client, with [CloudSketch AI](https://cloudsketchai.com).

Ask your assistant things like:

> *"Draw a C4 container diagram of our order service: React app, Node API, Postgres, Redis cache and Stripe."*
> *"Make an ERD for a clinic booking system with doctors, patients, slots and payments."*

You get Mermaid code back, plus a link that opens the diagram in the CloudSketch AI editor. From there you can restyle it or export it to PowerPoint, Word, PNG, SVG, PDF or draw.io.

How accurate is it? Every diagram type is tested on fresh prompts, and the method and results are public: [cloudsketchai.com/benchmark](https://cloudsketchai.com/benchmark).

## Tools

| Tool | What it does | Credits |
|---|---|---|
| `generate_diagram` | Takes a description, a diagram type and an audience, and returns Mermaid code plus an edit link. | 1 (2 for C4, mind maps and technical sequence diagrams) |
| `open_in_cloudsketch` | Turns any Mermaid code into a link that opens it in the editor. The diagram travels inside the link and is not uploaded. | none |
| `check_credits` | Shows your plan and the credits left today and this month. | none |
| `list_diagram_types` | Lists the 18 types and what each is for. | none |

`generate_diagram` supports 18 diagram types: C4 (context, container, component), cloud deployment, network, ERD, class, sequence, state, data flow (DFD), flowchart, swimlane, use case, user journey, quadrant, mind map, Sankey, data chart, gitgraph and Gantt.

The audience can be `technical` (the default), `managers` (plain words) or `investors`.

Diagrams made through the server are saved to your CloudSketch AI workspace like any other.

## 1. Get an API token

1. Sign in at [cloudsketchai.com](https://cloudsketchai.com/auth). A free account works: 20 credits to start, then 10 a month.
2. Open **Account → API tokens** and create a token. It's shown once, so copy it.

A token can only generate diagrams with your credits. It can't open your saved diagrams, billing or settings. You can delete it there at any time.

## 2. Add the server to your client

Node.js 18 or newer is all you need; the server has no dependencies.

**Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`~/.cursor/mcp.json`), Windsurf and most other clients:

```json
{
  "mcpServers": {
    "cloudsketch-ai": {
      "command": "npx",
      "args": ["-y", "cloudsketch-mcp"],
      "env": { "CLOUDSKETCH_API_TOKEN": "csk_your_token" }
    }
  }
}
```

**Claude Code**:

```
claude mcp add cloudsketch-ai -e CLOUDSKETCH_API_TOKEN=csk_your_token -- npx -y cloudsketch-mcp
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "cloudsketch-ai": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "cloudsketch-mcp"],
      "env": { "CLOUDSKETCH_API_TOKEN": "csk_your_token" }
    }
  }
}
```

**Without npm:** clone this repository, then use `"command": "node"` and `"args": ["/path/to/cloudsketch-mcp/server.mjs"]`.

Without a token, `open_in_cloudsketch` and `list_diagram_types` still work.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `CLOUDSKETCH_API_TOKEN` | (none) | Your personal API token |
| `CLOUDSKETCH_BASE_URL` | `https://cloudsketchai.com` | Only for a local or test build |

## Privacy

- The server sends your description to cloudsketchai.com to generate the diagram, the same as typing it on the website.
- `open_in_cloudsketch` sends nothing: it only builds a link.
- See the [privacy policy](https://cloudsketchai.com/privacy-policy).

## Develop

`npm test` runs the protocol and tool tests against a fake API, with no network and no credits used.

The server speaks MCP over stdio (newline-delimited JSON-RPC 2.0). It supports protocol versions 2025-06-18, 2025-03-26 and 2024-11-05.

## Support

support@cloudsketchai.com · [cloudsketchai.com](https://cloudsketchai.com)

MIT licensed.

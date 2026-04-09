# With Figma — AI-Driven Figma Design Bridge

## Architecture

```
Figma Plugin (UI chat + element selection)
    ↕ WebSocket (ws://127.0.0.1:3055)
MCP Server (Node.js, stdio transport)
    ↕ stdio
Claude Code / VS Code Copilot
```

## Project Structure

- `figma-plugin/` — Figma plugin (manifest.json, code.ts, ui.html)
- `mcp-server/` — MCP server with WebSocket bridge to Figma
- `.vscode/mcp.json` — VS Code MCP server config
- `.claude/settings.json` — Claude Code MCP server config

## How It Works

1. User opens the Figma plugin → it connects via WebSocket to `ws://127.0.0.1:3055`
2. MCP server runs as a stdio MCP server, started by Claude Code or VS Code
3. The MCP server also runs a WebSocket server on port 3055
4. User selects elements in Figma → selection data is sent to MCP server
5. AI agent uses MCP tools (`get_selection`, `create_frame`, `modify_node`, etc.) to read and manipulate the Figma document

## MCP Tools Available

- `get_selection` — Get currently selected Figma elements
- `get_node` — Get detailed info about a specific node
- `create_frame` — Create a new frame/artboard
- `create_rectangle` — Create a rectangle shape
- `create_text` — Create a text element
- `modify_node` — Modify properties of any node
- `delete_node` — Delete a node
- `export_node` — Export a node as PNG/SVG/JPG/PDF
- `send_chat_message` — Send message to Figma plugin chat UI

## Commands

- `npm install` — Install dependencies
- `npm run build` — Build everything
- `npm run dev:server` — Run MCP server in dev mode
- `npm run dev:plugin` — Watch-build the Figma plugin

## Setup

1. `npm install`
2. `npm run build:plugin`
3. In Figma: Plugins → Development → Import plugin from manifest → select `figma-plugin/manifest.json`
4. Start Claude Code or VS Code with the MCP server configured (auto via `.vscode/mcp.json`)

#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const command = process.argv[2];

const PKG_ROOT = path.resolve(__dirname, "..");

// ─── init: configure MCP settings in current project ──────────────
if (command === "init") {
  const cwd = process.cwd();
  const serverBin = "with-figma";

  // .vscode/mcp.json
  const vscodeDir = path.join(cwd, ".vscode");
  const mcpJsonPath = path.join(vscodeDir, "mcp.json");
  if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });

  let mcpJson = {};
  if (fs.existsSync(mcpJsonPath)) {
    try { mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8")); } catch {}
  }
  if (!mcpJson.servers) mcpJson.servers = {};
  mcpJson.servers["with-figma"] = {
    command: "npx",
    args: ["-y", "with-figma", "serve"],
  };
  fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2) + "\n");
  console.log("✓ .vscode/mcp.json updated");

  // .claude/settings.json
  const claudeDir = path.join(cwd, ".claude");
  const claudePath = path.join(claudeDir, "settings.json");
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

  let claudeJson = {};
  if (fs.existsSync(claudePath)) {
    try { claudeJson = JSON.parse(fs.readFileSync(claudePath, "utf-8")); } catch {}
  }
  if (!claudeJson.mcpServers) claudeJson.mcpServers = {};
  claudeJson.mcpServers["with-figma"] = {
    command: "npx",
    args: ["-y", "with-figma", "serve"],
  };
  fs.writeFileSync(claudePath, JSON.stringify(claudeJson, null, 2) + "\n");
  console.log("✓ .claude/settings.json updated");

  // Show Figma plugin path
  const manifestPath = path.join(PKG_ROOT, "figma-plugin", "manifest.json");
  console.log("");
  console.log("MCP server configured. Next steps:");
  console.log("");
  console.log("1. Import Figma plugin:");
  console.log("   Figma → Plugins → Development → Import plugin from manifest");
  console.log("   Path: " + manifestPath);
  console.log("");
  console.log("2. Restart VS Code or Claude Code");
  console.log("3. Open the plugin in Figma → select elements → chat with AI");

  process.exit(0);
}

// ─── serve: start MCP server (default) ────────────────────────────
if (!command || command === "serve") {
  require(path.join(PKG_ROOT, "mcp-server", "dist", "index.js"));
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage:");
  console.error("  npx with-figma init   — configure MCP in current project");
  console.error("  npx with-figma serve  — start MCP server");
  process.exit(1);
}

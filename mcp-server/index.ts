import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";

// ─── State ────────────────────────────────────────────────────────

let figmaSocket: WebSocket | null = null;
let currentSelection: any[] = [];
let currentPage: any = null;
let pages: any[] = [];
const pendingRequests = new Map<string, (data: any) => void>();
let requestCounter = 0;

function genRequestId(): string {
  return `req_${++requestCounter}_${Date.now()}`;
}

// ─── WebSocket Server (Figma plugin connects here) ────────────────

const wss = new WebSocketServer({ port: 3055 });
console.error("[with-figma] WebSocket server listening on ws://127.0.0.1:3055");

wss.on("connection", (socket) => {
  console.error("[with-figma] Figma plugin connected");
  figmaSocket = socket;

  // Notify plugin that we're ready
  socket.send(JSON.stringify({ type: "status", text: "MCP server connected. Ready for commands." }));

  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleFigmaMessage(msg);
    } catch (e) {
      console.error("[with-figma] Failed to parse message from Figma:", e);
    }
  });

  socket.on("close", () => {
    console.error("[with-figma] Figma plugin disconnected");
    figmaSocket = null;
  });
});

function handleFigmaMessage(msg: any) {
  switch (msg.type) {
    case "selection-update":
      currentSelection = msg.nodes || [];
      currentPage = msg.page || null;
      break;

    case "pages-list":
      pages = msg.pages || [];
      break;

    case "chat-message":
      // Chat messages from Figma UI — store context
      currentSelection = msg.selection || currentSelection;
      currentPage = msg.page || currentPage;
      // The chat message will be forwarded to AI via MCP tool calls
      // For now, acknowledge receipt
      if (figmaSocket) {
        figmaSocket.send(JSON.stringify({
          type: "chat-response",
          text: `Received: "${msg.text}". Processing via AI agent...`,
        }));
      }
      break;

    // Results from Figma plugin operations
    case "node-data":
    case "node-created":
    case "node-modified":
    case "node-deleted":
    case "node-exported": {
      const requestId = msg.requestId;
      if (requestId && pendingRequests.has(requestId)) {
        pendingRequests.get(requestId)!(msg);
        pendingRequests.delete(requestId);
      }
      break;
    }
  }
}

// ─── Helper: Send command to Figma and wait for response ──────────

function sendToFigma(command: any, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!figmaSocket || figmaSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("Figma plugin is not connected"));
      return;
    }

    const requestId = genRequestId();
    command.requestId = requestId;

    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Figma operation timed out"));
    }, timeoutMs);

    pendingRequests.set(requestId, (data) => {
      clearTimeout(timer);
      resolve(data);
    });

    figmaSocket.send(JSON.stringify({ type: "figma-command", command }));
  });
}

// ─── MCP Server ───────────────────────────────────────────────────

const server = new McpServer({
  name: "with-figma",
  version: "0.1.0",
});

// --- Resources ---

server.resource("selection", "figma://selection", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({ selection: currentSelection, page: currentPage }, null, 2),
    },
  ],
}));

server.resource("pages", "figma://pages", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({ pages }, null, 2),
    },
  ],
}));

// --- Tools ---

server.tool(
  "get_selection",
  "Get the currently selected elements in Figma. Returns node details including type, size, position, and properties.",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: currentSelection.length > 0
          ? JSON.stringify({ page: currentPage, nodes: currentSelection }, null, 2)
          : "No elements are currently selected in Figma.",
      },
    ],
  })
);

server.tool(
  "get_node",
  "Get detailed information about a specific Figma node by ID.",
  { nodeId: z.string().describe("The Figma node ID") },
  async ({ nodeId }) => {
    const result = await sendToFigma({ type: "get-node", nodeId });
    return {
      content: [{ type: "text", text: JSON.stringify(result.node, null, 2) }],
    };
  }
);

server.tool(
  "create_frame",
  "Create a new frame (artboard) in the current Figma page.",
  {
    name: z.string().describe("Frame name"),
    width: z.number().default(375).describe("Width in pixels"),
    height: z.number().default(812).describe("Height in pixels"),
    x: z.number().default(0).describe("X position"),
    y: z.number().default(0).describe("Y position"),
  },
  async (params) => {
    const result = await sendToFigma({ type: "create-frame", ...params });
    return {
      content: [{ type: "text", text: `Frame created: ${JSON.stringify(result.node, null, 2)}` }],
    };
  }
);

server.tool(
  "create_rectangle",
  "Create a rectangle shape, optionally inside a parent frame.",
  {
    name: z.string().default("Rectangle").describe("Rectangle name"),
    width: z.number().describe("Width in pixels"),
    height: z.number().describe("Height in pixels"),
    x: z.number().default(0).describe("X position"),
    y: z.number().default(0).describe("Y position"),
    parentId: z.string().optional().describe("Parent frame node ID"),
    cornerRadius: z.number().optional().describe("Corner radius"),
    fillColor: z
      .object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().default(1) })
      .optional()
      .describe("Fill color (RGBA 0-1)"),
  },
  async (params) => {
    const command: any = { type: "create-rectangle", ...params };
    if (params.fillColor) {
      command.fills = [{ type: "SOLID", color: params.fillColor }];
      delete command.fillColor;
    }
    const result = await sendToFigma(command);
    return {
      content: [{ type: "text", text: `Rectangle created: ${JSON.stringify(result.node, null, 2)}` }],
    };
  }
);

server.tool(
  "create_text",
  "Create a text element in Figma.",
  {
    characters: z.string().describe("The text content"),
    name: z.string().default("Text").describe("Layer name"),
    fontSize: z.number().default(16).describe("Font size"),
    x: z.number().default(0).describe("X position"),
    y: z.number().default(0).describe("Y position"),
    parentId: z.string().optional().describe("Parent frame node ID"),
    fillColor: z
      .object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().default(1) })
      .optional()
      .describe("Text color (RGBA 0-1)"),
  },
  async (params) => {
    const command: any = { type: "create-text", ...params };
    if (params.fillColor) {
      command.fills = [{ type: "SOLID", color: params.fillColor }];
      delete command.fillColor;
    }
    const result = await sendToFigma(command);
    return {
      content: [{ type: "text", text: `Text created: ${JSON.stringify(result.node, null, 2)}` }],
    };
  }
);

server.tool(
  "modify_node",
  "Modify properties of an existing Figma node. Can change position, size, name, fills, visibility, etc.",
  {
    nodeId: z.string().describe("The node ID to modify"),
    properties: z
      .record(z.unknown())
      .describe("Object of properties to set (e.g. { x: 10, name: 'New Name', visible: false })"),
  },
  async ({ nodeId, properties }) => {
    const result = await sendToFigma({ type: "modify-node", nodeId, properties });
    return {
      content: [{ type: "text", text: `Node modified: ${JSON.stringify(result.node, null, 2)}` }],
    };
  }
);

server.tool(
  "delete_node",
  "Delete a node from the Figma document.",
  { nodeId: z.string().describe("The node ID to delete") },
  async ({ nodeId }) => {
    const result = await sendToFigma({ type: "delete-node", nodeId });
    return {
      content: [{ type: "text", text: `Deleted node: ${result.nodeId}` }],
    };
  }
);

server.tool(
  "export_node",
  "Export a Figma node as an image (PNG, SVG, JPG, or PDF).",
  {
    nodeId: z.string().describe("The node ID to export"),
    format: z.enum(["PNG", "SVG", "JPG", "PDF"]).default("PNG"),
    scale: z.number().default(2).describe("Export scale factor"),
  },
  async ({ nodeId, format, scale }) => {
    const result = await sendToFigma({ type: "export-node", nodeId, format, scale });
    if (format === "SVG") {
      const text = new TextDecoder().decode(new Uint8Array(result.data));
      return { content: [{ type: "text", text }] };
    }
    const base64 = Buffer.from(result.data).toString("base64");
    return {
      content: [
        {
          type: "image",
          data: base64,
          mimeType: format === "JPG" ? "image/jpeg" : format === "PDF" ? "application/pdf" : "image/png",
        },
      ],
    };
  }
);

server.tool(
  "send_chat_message",
  "Send a message back to the Figma plugin chat UI to communicate with the user.",
  { text: z.string().describe("Message text to display in chat") },
  async ({ text }) => {
    if (figmaSocket && figmaSocket.readyState === WebSocket.OPEN) {
      figmaSocket.send(JSON.stringify({ type: "chat-response", text }));
      return { content: [{ type: "text", text: `Message sent to Figma chat: "${text}"` }] };
    }
    return { content: [{ type: "text", text: "Error: Figma plugin is not connected" }] };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[with-figma] MCP server running (stdio transport)");
}

main().catch((err) => {
  console.error("[with-figma] Fatal error:", err);
  process.exit(1);
});

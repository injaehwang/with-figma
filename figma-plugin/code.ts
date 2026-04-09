// Figma Plugin Main Code
// Runs in Figma's sandbox — communicates with UI via postMessage

figma.showUI(__html__, { width: 400, height: 600, themeColors: true });

// ─── Selection tracking ───────────────────────────────────────────

function serializeNode(node: SceneNode): object {
  const base: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
  };

  if ("x" in node) base.x = node.x;
  if ("y" in node) base.y = node.y;
  if ("width" in node) base.width = node.width;
  if ("height" in node) base.height = node.height;
  if ("fills" in node) base.fills = node.fills;
  if ("strokes" in node) base.strokes = node.strokes;
  if ("characters" in node) base.characters = (node as TextNode).characters;
  if ("children" in node) {
    base.childCount = (node as FrameNode).children.length;
    base.children = (node as FrameNode).children.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
    }));
  }

  return base;
}

function sendSelection() {
  const selection = figma.currentPage.selection;
  const nodes = selection.map(serializeNode);
  figma.ui.postMessage({
    type: "selection-changed",
    nodes,
    page: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
    },
  });
}

figma.on("selectionchange", sendSelection);

// Send initial selection
sendSelection();

// Send page list on startup
function sendPages() {
  const pages = figma.root.children.map((p) => ({
    id: p.id,
    name: p.name,
  }));
  figma.ui.postMessage({ type: "pages-list", pages });
}
sendPages();

// ─── Handle messages from UI (relayed from MCP server) ───────────

figma.ui.onmessage = async (msg: { type: string; [key: string]: unknown }) => {
  switch (msg.type) {
    case "get-selection":
      sendSelection();
      break;

    case "get-pages":
      sendPages();
      break;

    case "get-node": {
      const nodeId = msg.nodeId as string;
      const node = figma.getNodeById(nodeId) as SceneNode | null;
      if (node) {
        figma.ui.postMessage({
          type: "node-data",
          requestId: msg.requestId,
          node: serializeNode(node),
        });
      }
      break;
    }

    case "create-frame": {
      const frame = figma.createFrame();
      frame.name = (msg.name as string) || "New Frame";
      frame.resize(
        (msg.width as number) || 375,
        (msg.height as number) || 812
      );
      frame.x = (msg.x as number) || 0;
      frame.y = (msg.y as number) || 0;
      if (msg.fills) frame.fills = msg.fills as Paint[];
      figma.currentPage.appendChild(frame);
      figma.ui.postMessage({
        type: "node-created",
        requestId: msg.requestId,
        node: serializeNode(frame),
      });
      break;
    }

    case "create-rectangle": {
      const parent = msg.parentId
        ? (figma.getNodeById(msg.parentId as string) as FrameNode)
        : figma.currentPage;
      const rect = figma.createRectangle();
      rect.name = (msg.name as string) || "Rectangle";
      rect.resize((msg.width as number) || 100, (msg.height as number) || 100);
      rect.x = (msg.x as number) || 0;
      rect.y = (msg.y as number) || 0;
      if (msg.fills) rect.fills = msg.fills as Paint[];
      if (msg.cornerRadius) rect.cornerRadius = msg.cornerRadius as number;
      if (parent && "appendChild" in parent) parent.appendChild(rect);
      figma.ui.postMessage({
        type: "node-created",
        requestId: msg.requestId,
        node: serializeNode(rect),
      });
      break;
    }

    case "create-text": {
      const textParent = msg.parentId
        ? (figma.getNodeById(msg.parentId as string) as FrameNode)
        : figma.currentPage;
      const text = figma.createText();
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      text.name = (msg.name as string) || "Text";
      text.characters = (msg.characters as string) || "Text";
      text.fontSize = (msg.fontSize as number) || 16;
      text.x = (msg.x as number) || 0;
      text.y = (msg.y as number) || 0;
      if (msg.fills) text.fills = msg.fills as Paint[];
      if (textParent && "appendChild" in textParent)
        textParent.appendChild(text);
      figma.ui.postMessage({
        type: "node-created",
        requestId: msg.requestId,
        node: serializeNode(text),
      });
      break;
    }

    case "modify-node": {
      const target = figma.getNodeById(msg.nodeId as string) as SceneNode;
      if (!target) break;
      const props = msg.properties as Record<string, unknown>;
      for (const [key, value] of Object.entries(props)) {
        if (key === "characters" && target.type === "TEXT") {
          await figma.loadFontAsync({ family: "Inter", style: "Regular" });
          (target as TextNode).characters = value as string;
        } else if (key === "width" || key === "height") {
          const w = key === "width" ? (value as number) : (target as FrameNode).width;
          const h = key === "height" ? (value as number) : (target as FrameNode).height;
          (target as FrameNode).resize(w, h);
        } else {
          (target as any)[key] = value;
        }
      }
      figma.ui.postMessage({
        type: "node-modified",
        requestId: msg.requestId,
        node: serializeNode(target),
      });
      break;
    }

    case "delete-node": {
      const toDelete = figma.getNodeById(msg.nodeId as string) as SceneNode;
      if (toDelete) {
        toDelete.remove();
        figma.ui.postMessage({
          type: "node-deleted",
          requestId: msg.requestId,
          nodeId: msg.nodeId,
        });
      }
      break;
    }

    case "export-node": {
      const exportNode = figma.getNodeById(msg.nodeId as string) as SceneNode;
      if (exportNode) {
        const bytes = await exportNode.exportAsync({
          format: (msg.format as "PNG" | "SVG" | "JPG" | "PDF") || "PNG",
          scale: (msg.scale as number) || 2,
        } as ExportSettings);
        figma.ui.postMessage({
          type: "node-exported",
          requestId: msg.requestId,
          data: Array.from(bytes),
          format: msg.format || "PNG",
        });
      }
      break;
    }
  }
};

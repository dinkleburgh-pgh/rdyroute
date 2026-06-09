#!/usr/bin/env node
/**
 * OpenCode Shared Browser MCP Server
 *
 * Launches Chrome with remote debugging enabled. Serves a tab-picker UI at
 * localhost:9223 so the user can click any open tab to share it with OpenCode.
 *
 * Tools exposed to OpenCode:
 *   - browser_open_picker  : open the tab picker in the default browser
 *   - browser_list_tabs    : list all open Chrome tabs
 *   - browser_select_tab   : attach to a tab by id or URL fragment
 *   - browser_screenshot   : capture the currently shared tab (use only for verifying code/UI changes or form fills, not for every navigation)
 *   - browser_navigate     : navigate the shared tab to a URL
 *   - browser_click        : click a selector or x,y in the shared tab
 *   - browser_type         : type text into the shared tab
 *   - browser_get_url      : return the current URL of the shared tab
 *   - browser_close        : close Chrome and stop the server
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { exec } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CDP_PORT = 9222;   // Chrome remote debugging port
const PICKER_PORT = 9223; // Tab picker UI port

// ── State ─────────────────────────────────────────────────────────────────────
let browser = null;       // Playwright browser (connected via CDP)
let sharedPage = null;    // Currently shared tab (Playwright Page)
let pickerServer = null;  // HTTP server for the picker UI
let selectedTabId = null; // CDP target id of the selected tab

// ── Browser disconnect handler ────────────────────────────────────────────────
// Called whenever the user closes the Chrome window (or it crashes).
// Clears state so the next tool call launches a fresh browser.
function onBrowserDisconnected() {
  browser = null;
  sharedPage = null;
  selectedTabId = null;
}

// ── Launch Chrome with remote debugging ───────────────────────────────────────
async function ensureChrome() {
  if (browser) return;

  // Try to reconnect to an already-running Chrome instance first.
  // This handles the case where the MCP server was restarted but Chrome
  // is still open from a previous session.
  try {
    const res = await fetch(`http://localhost:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
      browser.on("disconnected", onBrowserDisconnected);
      // Reuse the first available page as the shared page
      const contexts = browser.contexts();
      for (const ctx of contexts) {
        const pages = ctx.pages();
        if (pages.length > 0) {
          sharedPage = pages[0];
          return;
        }
      }
      return;
    }
  } catch {
    // Chrome not running yet — launch fresh below
  }

  browser = await chromium.launch({
    headless: false,
    args: [
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  browser.on("disconnected", onBrowserDisconnected);

  // Open a blank tab so Chrome has something visible
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  await pg.goto("about:blank");
  sharedPage = pg;
}

// ── Fetch tab list from Chrome DevTools Protocol ──────────────────────────────
async function getChromeTabs() {
  try {
    const res = await fetch(`http://localhost:${CDP_PORT}/json/list`);
    const tabs = await res.json();
    // Filter to page targets only (exclude extensions, workers, etc.)
    return tabs.filter((t) => t.type === "page");
  } catch {
    return [];
  }
}

// ── Attach Playwright to a specific CDP target ────────────────────────────────
async function attachToTab(targetId) {
  const tabs = await getChromeTabs();
  const tab = tabs.find((t) => t.id === targetId);
  if (!tab) throw new Error(`Tab not found: ${targetId}`);

  // Connect Playwright to the existing Chrome instance via CDP
  const cdpBrowser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const contexts = cdpBrowser.contexts();
  for (const ctx of contexts) {
    for (const pg of ctx.pages()) {
      if (pg.url() === tab.url || (await pg.title()) === tab.title) {
        sharedPage = pg;
        selectedTabId = targetId;
        return tab;
      }
    }
  }

  // Fallback: navigate the current shared page to the tab's URL
  if (sharedPage) {
    await sharedPage.goto(tab.url, { waitUntil: "domcontentloaded" });
    selectedTabId = targetId;
    return tab;
  }

  throw new Error(`Could not attach to tab: ${tab.title}`);
}

// ── Tab picker HTTP server ────────────────────────────────────────────────────
async function startPickerServer() {
  if (pickerServer) return;

  const htmlPath = join(__dirname, "tab-picker.html");

  pickerServer = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PICKER_PORT}`);

    // Serve the picker HTML
    if (req.method === "GET" && url.pathname === "/") {
      try {
        const html = await readFile(htmlPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end("Could not load tab-picker.html");
      }
      return;
    }

    // Proxy Chrome's tab list (avoids CORS issues)
    if (req.method === "GET" && url.pathname === "/tabs") {
      try {
        const tabs = await getChromeTabs();
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(tabs));
      } catch (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Handle tab selection POST /select { id }
    if (req.method === "POST" && url.pathname === "/select") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { id } = JSON.parse(body);
          const tab = await attachToTab(id);
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ ok: true, tab }));
        } catch (err) {
          res.writeHead(500, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise((resolve) => pickerServer.listen(PICKER_PORT, "127.0.0.1", resolve));
}

function openInBrowser(url) {
  const cmd = process.platform === "win32"
    ? `start "" "${url}"`
    : process.platform === "darwin"
    ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd);
}

// ── Ensure everything is running ──────────────────────────────────────────────
async function ensureReady() {
  await ensureChrome();
  await startPickerServer();
}

async function getSharedPage() {
  await ensureReady();
  if (!sharedPage) throw new Error("No tab selected. Call browser_open_picker first.");
  return sharedPage;
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "browser_open_picker",
    description:
      "Open the tab picker UI in the user's default browser. The user can click any open Chrome tab to share it with OpenCode. Call this first if no tab is selected yet.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_list_tabs",
    description: "List all currently open Chrome tabs with their id, title, and URL.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_select_tab",
    description: "Attach OpenCode to a specific Chrome tab by its id (from browser_list_tabs) or a URL fragment to match.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The exact tab id from browser_list_tabs." },
        url_contains: { type: "string", description: "Attach to the first tab whose URL contains this string." },
      },
    },
  },
  {
    name: "browser_screenshot",
    description:
      "Take a screenshot of the currently shared browser tab. Returns the image so OpenCode can see what the user is looking at.",
    inputSchema: {
      type: "object",
      properties: {
        full_page: {
          type: "boolean",
          description: "Capture the full scrollable page instead of just the viewport. Defaults to false.",
        },
      },
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate the shared browser tab to a URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to navigate to." },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_click",
    description: "Click on an element in the shared tab by CSS selector or x,y coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the element to click." },
        x: { type: "number", description: "X coordinate (used if selector not provided)." },
        y: { type: "number", description: "Y coordinate (used if selector not provided)." },
      },
    },
  },
  {
    name: "browser_type",
    description: "Type text into the shared tab.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to type." },
        selector: { type: "string", description: "CSS selector to focus before typing." },
        clear_first: { type: "boolean", description: "Clear the field before typing. Defaults to false." },
      },
      required: ["text"],
    },
  },
  {
    name: "browser_get_url",
    description: "Return the current URL of the shared browser tab.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_close",
    description: "Close the shared Chrome browser and stop all browser tools.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {
    case "browser_open_picker": {
      await ensureReady();
      const pickerUrl = `http://localhost:${PICKER_PORT}/`;
      openInBrowser(pickerUrl);
      return {
        content: [
          {
            type: "text",
            text: `Tab picker opened at ${pickerUrl}\nClick any tab in the picker to share it with OpenCode.`,
          },
        ],
      };
    }

    case "browser_list_tabs": {
      await ensureChrome();
      const tabs = await getChromeTabs();
      if (tabs.length === 0) {
        return { content: [{ type: "text", text: "No open Chrome tabs found." }] };
      }
      const list = tabs
        .map((t, i) => `${i + 1}. [${t.id}] ${t.title}\n   ${t.url}`)
        .join("\n\n");
      return { content: [{ type: "text", text: `Open tabs:\n\n${list}` }] };
    }

    case "browser_select_tab": {
      await ensureChrome();
      let targetId = args?.id;

      if (!targetId && args?.url_contains) {
        const tabs = await getChromeTabs();
        const match = tabs.find((t) => t.url.includes(args.url_contains));
        if (!match) {
          return {
            content: [{ type: "text", text: `No tab found with URL containing: ${args.url_contains}` }],
            isError: true,
          };
        }
        targetId = match.id;
      }

      if (!targetId) {
        return { content: [{ type: "text", text: "Provide id or url_contains." }], isError: true };
      }

      const tab = await attachToTab(targetId);
      return {
        content: [{ type: "text", text: `Now sharing tab: "${tab.title}" — ${tab.url}` }],
      };
    }

    case "browser_screenshot": {
      const pg = await getSharedPage();
      const buffer = await pg.screenshot({ fullPage: args?.full_page ?? false });
      return {
        content: [
          {
            type: "image",
            data: buffer.toString("base64"),
            mimeType: "image/png",
          },
        ],
      };
    }

    case "browser_navigate": {
      const pg = await getSharedPage();
      await pg.goto(args.url, { waitUntil: "domcontentloaded" });
      return { content: [{ type: "text", text: `Navigated to: ${pg.url()}` }] };
    }

    case "browser_click": {
      const pg = await getSharedPage();
      if (args?.selector) {
        await pg.click(args.selector);
        return { content: [{ type: "text", text: `Clicked: ${args.selector}` }] };
      } else if (args?.x !== undefined && args?.y !== undefined) {
        await pg.mouse.click(args.x, args.y);
        return { content: [{ type: "text", text: `Clicked at (${args.x}, ${args.y})` }] };
      }
      return { content: [{ type: "text", text: "Provide selector or x,y." }], isError: true };
    }

    case "browser_type": {
      const pg = await getSharedPage();
      if (args?.selector) await pg.focus(args.selector);
      if (args?.clear_first) {
        await pg.keyboard.press("Control+a");
        await pg.keyboard.press("Delete");
      }
      await pg.keyboard.type(args.text);
      return { content: [{ type: "text", text: `Typed: ${args.text}` }] };
    }

    case "browser_get_url": {
      const pg = await getSharedPage();
      return { content: [{ type: "text", text: pg.url() }] };
    }

    case "browser_close": {
      if (pickerServer) {
        pickerServer.close();
        pickerServer = null;
      }
      if (browser) {
        await browser.close();
        browser = null;
        sharedPage = null;
      }
      return { content: [{ type: "text", text: "Browser closed." }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ── MCP Server setup ──────────────────────────────────────────────────────────
const server = new Server(
  { name: "browser", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await handleTool(request.params.name, request.params.arguments ?? {});
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Cleanup on exit ───────────────────────────────────────────────────────────
// NOTE: We intentionally do NOT close the browser on MCP server exit.
// This keeps the Chrome window open between OpenCode sessions so the user
// doesn't lose their tabs. Only browser_close() shuts it down explicitly.
async function cleanup() {
  if (pickerServer) pickerServer.close().catch(() => {});
  // browser is left running intentionally
}
process.on("exit", () => { cleanup(); });
process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

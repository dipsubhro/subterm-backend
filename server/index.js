require("dotenv").config();

const http = require("http");
const express = require("express");
const fs = require("fs/promises");
const { Server: SocketServer } = require("socket.io");
const pty = require("node-pty");
const path = require("path");
const cors = require("cors");
const chokidar = require("chokidar");

const ROOT_DIR = __dirname;
const USER_DIR = path.join(ROOT_DIR, "user");

console.log("Project root  :", ROOT_DIR);
console.log("Editable path :", USER_DIR);

const ptyProcess = pty.spawn("bash", ["--login"], {
  name: "xterm-color",
  cols: 80,
  rows: 30,
  cwd: USER_DIR,
  env: process.env,
});

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

// ─────────────────────────────────────────────────────────────
// File Watcher with Debounced Broadcasts
// ─────────────────────────────────────────────────────────────
let pendingEvents = [];
let debounceTimer = null;
const DEBOUNCE_MS = 100;

const watcher = chokidar.watch(USER_DIR, {
  ignored: [
    /(^|[\/\\])\.git([\/\\]|$)/,
    /(^|[\/\\])node_modules([\/\\]|$)/,
    /\.swp$/,
    /\.tmp$/,
  ],
  persistent: true,
  ignoreInitial: true,
});

function emitFsEvents() {
  if (pendingEvents.length > 0) {
    io.emit("fs-event", pendingEvents);
    console.log(`[fs-event] Broadcasted ${pendingEvents.length} event(s)`);
    pendingEvents = [];
  }
}

function queueFsEvent(type, filePath) {
  const relativePath = path.relative(USER_DIR, filePath);
  pendingEvents.push({ type, path: relativePath });

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(emitFsEvents, DEBOUNCE_MS);
}

watcher
  .on("add", (p) => queueFsEvent("add", p))
  .on("change", (p) => queueFsEvent("change", p))
  .on("unlink", (p) => queueFsEvent("unlink", p))
  .on("addDir", (p) => queueFsEvent("addDir", p))
  .on("unlinkDir", (p) => queueFsEvent("unlinkDir", p))
  .on("ready", () => console.log("[chokidar] Watching user folder for changes"))
  .on("error", (err) => console.error("[chokidar] Error:", err));

// ─────────────────────────────────────────────────────────────
// Terminal PTY
// ─────────────────────────────────────────────────────────────
ptyProcess.onData((data) => io.emit("terminal:data", data));

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
  
  ptyProcess.write("\n");
  
  socket.on("terminal:write", (d) => ptyProcess.write(d));
});

// ─────────────────────────────────────────────────────────────
// API Endpoints
// ─────────────────────────────────────────────────────────────

// Get tree for react-arborist
app.get("/api/get-tree", async (_, res) => {
  try {
    const tree = await buildArboristTree(USER_DIR, "");
    res.json(tree);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to build file tree" });
  }
});

app.get("/file", async (req, res) => {
  const rel = req.query.path;
  if (!rel) return res.status(400).json({ error: "Missing path" });

  const abs = path.resolve(USER_DIR, rel);
  console.log("Requested file path:", rel);
  console.log("Resolved absolute path:", abs);

  if (!abs.startsWith(USER_DIR)) {
    console.log("Blocked path traversal attempt");
    return res.status(400).json({ error: "Path traversal blocked" });
  }

  try {
    const content = await fs.readFile(abs, "utf8");
    res.json({ content });
  } catch (e) {
    console.error("Error reading file:", e);
    res.status(500).json({ error: "Failed to read file" });
  }
});

app.post("/file", async (req, res) => {
  const { path: rel, content } = req.body;
  if (!rel || content === undefined)
    return res.status(400).json({ error: "Missing path or content" });

  const abs = path.resolve(USER_DIR, rel);
  if (!abs.startsWith(USER_DIR))
    return res.status(400).json({ error: "Path traversal blocked" });

  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    res.json({ message: "File saved" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save file" });
  }
});

// ─────────────────────────────────────────────────────────────
// Tree Building Functions
// ─────────────────────────────────────────────────────────────

// Patterns to ignore in tree
const IGNORE_PATTERNS = [".git", "node_modules", ".DS_Store"];

function shouldIgnore(name) {
  return IGNORE_PATTERNS.includes(name) || name.endsWith(".swp") || name.endsWith(".tmp");
}

// React-arborist compatible tree format
async function buildArboristTree(dir, basePath) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes = [];

  // Sort: folders first, then files, both alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const ent of entries) {
    if (shouldIgnore(ent.name)) continue;
    const relativePath = basePath ? `${basePath}/${ent.name}` : ent.name;
    const fullPath = path.join(dir, ent.name);

    if (ent.isDirectory()) {
      const children = await buildArboristTree(fullPath, relativePath);
      nodes.push({
        id: relativePath,
        name: ent.name,
        children,
      });
    } else {
      nodes.push({
        id: relativePath,
        name: ent.name,
      });
    }
  }

  return nodes;
}

const PORT = process.env.PORT || 3334;
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Backend listening → http://${HOST}:${PORT}`);
});

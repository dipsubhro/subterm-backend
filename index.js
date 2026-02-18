require("dotenv").config();

const http = require("http");
const express = require("express");
const fs = require("fs/promises");
const { Server: SocketServer } = require("socket.io");
const pty = require("node-pty");
const path = require("path");
const cors = require("cors");
const chokidar = require("chokidar");

const USER_DIR = path.join(__dirname, "user");

console.log("Workspace root:", USER_DIR);

const ptyProcess = pty.spawn("bash", ["--login"], {
  name: "xterm-color",
  cols: 80,
  rows: 30,
  cwd: USER_DIR,
  env: process.env,
});


const app = express();
app.use(express.json());

// CORS configuration - use CORS_ORIGIN env var or allow all in dev
const allowedOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',') 
  : ['http://localhost:5173', 'https://subterm.subhro.tech'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

const server = http.createServer(app);
const io = new SocketServer(server, { 
  cors: { 
    origin: allowedOrigins,
    credentials: true
  } 
});

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

  socket.on("terminal:resize", ({ cols, rows }) => {
    ptyProcess.resize(cols, rows);
  });
});

// ─────────────────────────────────────────────────────────────
// API Endpoints
// ─────────────────────────────────────────────────────────────

app.get("/api/fs", async (req, res) => {
  try {
    const requestedPath = req.query.path || "/";

    // Resolve to an absolute path anchored at USER_DIR
    const absPath = path.resolve(USER_DIR, `.${requestedPath}`);

    // Block path-traversal: resolved path must stay inside USER_DIR
    if (!absPath.startsWith(USER_DIR)) {
      return res.status(403).json({ error: "Access denied – outside workspace" });
    }

    const children = await listDirectoryChildren(absPath, requestedPath);
    res.json({ path: requestedPath, children });
  } catch (err) {
    console.error("[api/fs]", err);
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "Directory not found" });
    }
    if (err.code === "ENOTDIR") {
      return res.status(400).json({ error: "Path is not a directory" });
    }
    res.status(500).json({ error: "Failed to read directory" });
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

// GitHub Import - Clone repository to user folder
app.post("/github/import", async (req, res) => {
  const { repoUrl, branch, repoName } = req.body;

  if (!repoUrl || !repoName) {
    return res.status(400).json({ error: "Missing repoUrl or repoName" });
  }

  const targetDir = path.join(USER_DIR, repoName);

  console.log(`[GitHub Import] Cloning ${repoUrl} (branch: ${branch || 'default'}) to ${targetDir}`);

  try {
    // Check if directory already exists
    try {
      await fs.access(targetDir);
      return res.status(400).json({ 
        error: `Directory "${repoName}" already exists. Please delete it first or use a different name.` 
      });
    } catch {
      // Directory doesn't exist, which is what we want
    }

    // Use git clone via child_process (exec/execAsync from module scope)

    const branchArg = branch ? `--branch ${branch}` : "";
    const command = `git clone ${branchArg} --depth 1 "${repoUrl}" "${targetDir}"`;

    console.log(`[GitHub Import] Running: ${command}`);

    await execAsync(command, { 
      cwd: USER_DIR,
      timeout: 120000 // 2 minute timeout
    });

    // Remove .git folder to clean up (optional - comment out if you want to keep git history)
    const gitDir = path.join(targetDir, ".git");
    try {
      await fs.rm(gitDir, { recursive: true, force: true });
      console.log(`[GitHub Import] Removed .git directory`);
    } catch (e) {
      console.log(`[GitHub Import] Note: Could not remove .git directory:`, e.message);
    }

    console.log(`[GitHub Import] Successfully cloned ${repoName}`);
    res.json({ 
      message: `Repository "${repoName}" imported successfully!`,
      path: repoName
    });

  } catch (e) {
    console.error("[GitHub Import] Error:", e);
    
    // Clean up partial clone if it exists
    try {
      await fs.rm(targetDir, { recursive: true, force: true });
    } catch {}

    // Parse error message for better user feedback
    let errorMessage = "Failed to clone repository";
    if (e.stderr) {
      if (e.stderr.includes("not found") || e.stderr.includes("does not exist")) {
        errorMessage = "Repository not found or is private";
      } else if (e.stderr.includes("branch") && e.stderr.includes("not found")) {
        errorMessage = `Branch "${branch}" not found`;
      } else {
        errorMessage = e.stderr.split("\n")[0] || errorMessage;
      }
    } else if (e.message) {
      errorMessage = e.message;
    }

    res.status(500).json({ error: errorMessage });
  }
});

// ─────────────────────────────────────────────────────────────
// Lazy Directory Listing (single level) + Git Status
// ─────────────────────────────────────────────────────────────

const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

const IGNORE_PATTERNS = [".git", "node_modules", ".DS_Store"];

function shouldIgnore(name) {
  return (
    IGNORE_PATTERNS.includes(name) ||
    name.endsWith(".swp") ||
    name.endsWith(".tmp")
  );
}

// ── Git helpers ──────────────────────────────────────────────

/**
 * Parse `git status --porcelain -uall` into a Map<relativePath, gitInfo>.
 * XY columns: X = index (staged), Y = working-tree.
 */
async function getGitStatusMap(cwd) {
  const statusMap = new Map();
  try {
    const { stdout } = await execAsync("git status --porcelain -uall", {
      cwd,
      timeout: 5000,
    });

    for (const line of stdout.split("\n")) {
      if (!line || line.length < 4) continue;

      const x = line[0]; // index status
      const y = line[1]; // working-tree status
      // Porcelain format: XY <space> path  (or XY <space> old -> new for renames)
      let filePath = line.slice(3);

      // Handle renames: "R  old -> new"
      const arrowIdx = filePath.indexOf(" -> ");
      if (arrowIdx !== -1) filePath = filePath.slice(arrowIdx + 4);

      const staged = x !== " " && x !== "?" && x !== "!";
      const conflicted = (x === "U" || y === "U") || (x === "A" && y === "A") || (x === "D" && y === "D");

      let status = "untracked";
      if (conflicted) {
        status = "conflicted";
      } else if (x === "?" && y === "?") {
        status = "untracked";
      } else if (x === "A" || y === "A") {
        status = "added";
      } else if (x === "D" || y === "D") {
        status = "deleted";
      } else if (x === "R" || y === "R") {
        status = "renamed";
      } else if (x === "M" || y === "M") {
        status = "modified";
      }

      statusMap.set(filePath, { status, staged, conflicted });
    }
  } catch {
    // Not a git repo or git not installed → return empty map
  }
  return statusMap;
}

// ── Directory listing ────────────────────────────────────────

/**
 * Return the direct children of `absDir` as a flat array.
 * Folders first, then files – both sorted alphabetically.
 * Files with git changes get a `git` object; clean files omit it.
 * Folders never include `git`.
 */
async function listDirectoryChildren(absDir, parentPath) {
  const entries = await fs.readdir(absDir, { withFileTypes: true });

  // Gather git status once for the whole workspace
  const gitMap = await getGitStatusMap(USER_DIR);

  // Sort: folders first, then files, alphabetically within each group
  entries.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });

  const children = [];

  for (const ent of entries) {
    if (shouldIgnore(ent.name)) continue;

    const childPath =
      parentPath === "/" ? `/${ent.name}` : `${parentPath}/${ent.name}`;
    const fullPath = path.join(absDir, ent.name);

    if (ent.isDirectory()) {
      let hasChildren = false;
      try {
        const sub = await fs.readdir(fullPath);
        hasChildren = sub.some((s) => !shouldIgnore(s));
      } catch {
        // unreadable → treat as empty
      }

      children.push({
        id: childPath,
        parentId: parentPath,
        name: ent.name,
        kind: "folder",
        hasChildren,
      });
    } else {
      const ext = path.extname(ent.name).slice(1);
      let size = 0;
      try {
        const stat = await fs.stat(fullPath);
        size = stat.size;
      } catch {
        // stat failed → default 0
      }

      // Git key is relative to USER_DIR (no leading slash)
      const gitKey = childPath.startsWith("/") ? childPath.slice(1) : childPath;
      const gitInfo = gitMap.get(gitKey);

      const node = {
        id: childPath,
        parentId: parentPath,
        name: ent.name,
        kind: "file",
        hasChildren: false,
        extension: ext || undefined,
        size,
      };

      // Only attach git when the file has actual changes
      if (gitInfo) node.git = gitInfo;

      children.push(node);
    }
  }

  return children;
}

const PORT = process.env.PORT || 3334;
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Backend listening → http://${HOST}:${PORT}`);
});

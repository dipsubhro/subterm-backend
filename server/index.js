require("dotenv").config();

const http = require("http");
const express = require("express");
const fs = require("fs/promises");
const { Server: SocketServer } = require("socket.io");
const pty = require("node-pty");
const path = require("path");
const cors = require("cors");

const ROOT_DIR = path.resolve(__dirname, "..");
const USER_DIR = path.join(ROOT_DIR, "user");

console.log("Project root  :", ROOT_DIR);
console.log("Editable path :", USER_DIR);

const ptyProcess = pty.spawn("bash", ["--login"], {
  name: "xterm-color",
  cols: 80,
  rows: 30,
  cwd: ROOT_DIR,
  env: process.env,
});

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

ptyProcess.onData((data) => io.emit("terminal:data", data));

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
  socket.on("terminal:write", (d) => ptyProcess.write(d));
});

app.get("/files", async (_, res) => {
  try {
    const tree = await buildTree(USER_DIR);
    res.json({ tree });
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

async function buildTree(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const tree = {};
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) tree[ent.name] = await buildTree(p);
    else tree[ent.name] = null;
  }
  return tree;
}

const PORT = process.env.PORT || 3334;
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Backend listening → http://${HOST}:${PORT}`);
});

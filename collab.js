const Y = require("yjs");
const fs = require("fs/promises");
const path = require("path");

const docs = new Map();

function setupCollab(io, USER_DIR) {
  const collab = io.of("/collab");

  collab.on("connection", (socket) => {
    socket.on("join-file", async (filePath) => {
      socket.join(filePath);
      if (!docs.has(filePath)) {
        const ydoc = new Y.Doc();
        docs.set(filePath, ydoc);
        const absPath = path.join(USER_DIR, filePath);
        const content = await fs.readFile(absPath, "utf8");
        ydoc.getText("monaco").insert(0, content);
      }
      const ydoc = docs.get(filePath);
      const update = Y.encodeStateAsUpdate(ydoc);
      socket.emit("init-doc", update);
    });

    socket.on("y-update", ({ filePath, update }) => {
      const ydoc = docs.get(filePath);
      if (!ydoc) return;
      Y.applyUpdate(ydoc, update);
      socket.to(filePath).emit("y-update", update);
    });
  });
}

module.exports = { setupCollab, docs };

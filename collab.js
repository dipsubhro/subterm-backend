const Y = require("yjs");
const fs = require("fs/promises");
const path = require("path");

const docs = new Map();

function setupCollab(io, USER_DIR) {
  const collab = io.of("/collab");
  const socketFileMap = new Map();

  collab.on("connection", (socket) => {
    collab.emit("collab-count", collab.sockets.size);

    socket.on("get-count", () => {
      socket.emit("collab-count", collab.sockets.size);
    });

    socket.on("disconnecting", () => {
      const filePath = socketFileMap.get(socket.id);
      if (filePath) socketFileMap.delete(socket.id);
    });

    socket.on("disconnect", () => {
      collab.emit("collab-count", collab.sockets.size);
    });

    socket.on("join-file", async (filePath) => {
      socket.join(filePath);
      socketFileMap.set(socket.id, filePath);
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

    socket.on("file-saved", ({ filePath }) => {
      socket.to(filePath).emit("file-saved");
    });
  });
}

module.exports = { setupCollab, docs };

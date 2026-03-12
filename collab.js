const Y = require("yjs");

const docs = new Map();

function setupCollab(io, USER_DIR) {
  const collab = io.of("/collab");

  collab.on("connection", (socket) => {
    socket.on("join-file", (filePath) => {
      socket.join(filePath);
      if (!docs.has(filePath)) {
        docs.set(filePath, new Y.Doc());
      }
    });
  });
}

module.exports = { setupCollab };

import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import makeAnalyzeRouter from "./routes/analyze.js";
import makeQueueRouter from "./routes/queue.js";
import { snapshot, setCameraOnline } from "./store/queueStore.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

function addToRoom(salonId, ws) {
  if (!rooms.has(salonId)) rooms.set(salonId, new Set());
  rooms.get(salonId).add(ws);
}

function removeFromRooms(ws) {
  for (const [salonId, set] of rooms.entries()) {
    if (set.delete(ws) && set.size === 0) {
      rooms.delete(salonId);
    }
  }
}

function broadcast(salonId, data) {
  const set = rooms.get(salonId);
  if (!set) return;
  const msg = JSON.stringify({ type: "queue_update", salonId, data });
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

wss.on("connection", (ws) => {
  ws.salonIds = new Set();
  ws.isOwner = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.warn("[ws] unparseable message:", e.message.slice(0, 120));
      return;
    }
    if (msg.type === "subscribe" && msg.salonId) {
      addToRoom(msg.salonId, ws);
      ws.salonIds.add(msg.salonId);
      if (msg.role === "owner") {
        ws.isOwner = true;
        ws.ownerSalonId = msg.salonId;
        setCameraOnline(msg.salonId, true);
        broadcast(msg.salonId, snapshot(msg.salonId));
      }
      ws.send(JSON.stringify({
        type: "queue_update",
        salonId: msg.salonId,
        data: snapshot(msg.salonId),
      }));
    } else if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  });

  ws.on("close", () => {
    if (ws.isOwner && ws.ownerSalonId) {
      setCameraOnline(ws.ownerSalonId, false);
      broadcast(ws.ownerSalonId, snapshot(ws.ownerSalonId));
    }
    removeFromRooms(ws);
  });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", makeAnalyzeRouter(broadcast));
app.use("/api", makeQueueRouter(broadcast));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`OnCue server listening on http://localhost:${PORT}`);
});

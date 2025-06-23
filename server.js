import express from "express";
import mongoose from "mongoose";
import WebSocket from "ws";
import cron from "node-cron";

const app = express();
const PORT = process.env.PORT || 3000;
const CHANNEL_ID = "1485854";

// MongoDB setup
await mongoose.connect(
  "mongodb+srv://davekekv:C4kxK3SFZkLA2CZe@cluster0.wkodygj.mongodb.net/leaderboardDB?retryWrites=true&w=majority",
  { useNewUrlParser: true, useUnifiedTopology: true }
);

// Mongoose model
const messageSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  messageCount: { type: Number, default: 0 }
});
const Message = mongoose.model("Message", messageSchema);

// Emote-only filter
function isValidMessage(content) {
  if (!content) return false;
  const t = content.trim();
  return t.length > 0 && !/^\[emote:\d+:[a-zA-Z0-9_]+\]$/.test(t);
}

// Leaderboard endpoint
app.get("/leaderboard", async (req, res) => {
  const docs = await Message.find().sort({ messageCount: -1 }).limit(100).lean();
  res.json(docs.map(d => ({ username: d.username, messageCount: d.messageCount })));
});

// Connect to Kick chat via WebSocket
function startWebSocket() {
  // This URL is what Kick’s web client uses internally.
  const ws = new WebSocket(`wss://chat.kick.com/v2?channel=${CHANNEL_ID}`);

  ws.on("open", () => {
    console.log("WebSocket connected to Kick chat");
    // If Kick requires a handshake or auth, send it here.
  });

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw);
      // Only process chat messages
      if (msg.type === "chat_message" && msg.data) {
        const content = msg.data.content;
        if (!isValidMessage(content)) return;

        const username = msg.data.sender?.username;
        if (!username) return;

        await Message.findOneAndUpdate(
          { username },
          { $inc: { messageCount: 1 } },
          { upsert: true }
        );
        console.log(`Counted message for ${username}`);
      }
    } catch (e) {
      console.error("Error parsing WS message:", e);
    }
  });

  ws.on("close", () => {
    console.warn("WebSocket closed — reconnecting in 5s");
    setTimeout(startWebSocket, 5000);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    ws.close();
  });
}

// Kick off the WebSocket connection
startWebSocket();

// Reset leaderboard every 7 days
cron.schedule("0 0 */7 * *", async () => {
  await Message.deleteMany({});
  console.log("Leaderboard reset after 7 days");
});

// Serve static frontend
app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

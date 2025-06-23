import express from "express";
import mongoose from "mongoose";
import fetch from "node-fetch";
import cron from 'node-cron';

const app = express();
const PORT = process.env.PORT || 3000;
const CHANNEL_ID = "1485854";

// MongoDB setup
await mongoose.connect(
  'mongodb+srv://davekekv:C4kxK3SFZkLA2CZe@cluster0.wkodygj.mongodb.net/leaderboardDB?retryWrites=true&w=majority',
  { useNewUrlParser: true, useUnifiedTopology: true }
);

// Schema & model
const messageSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  messageCount: { type: Number, default: 0 }
});
const Message = mongoose.model("Message", messageSchema);

// Track cursor for polling
let lastCursor = null;

// Emote-only filter
function isValidMessage(content) {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  const emoteOnly = /^\[emote:\d+:[a-zA-Z0-9_]+\]$/;
  return !emoteOnly.test(trimmed);
}

// Leaderboard endpoint
app.get("/leaderboard", async (req, res) => {
  try {
    const docs = await Message.find()
      .sort({ messageCount: -1 })
      .limit(100)
      .lean();
    res.json(docs.map(d => ({ username: d.username, messageCount: d.messageCount })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll & process new messages
async function pollKickMessages() {
  try {
    const url = new URL(`https://kick.com/api/v2/channels/${CHANNEL_ID}/messages`);
    if (lastCursor) url.searchParams.set("cursor", lastCursor);

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!response.ok) {
      console.error("Fetch failed", await response.text());
      return;
    }

    const json = await response.json();
    const { cursor, messages } = json.data;
    lastCursor = cursor;

    for (const msg of messages) {
      if (!isValidMessage(msg.content)) continue;
      const username = msg.sender?.username;
      if (!username) continue;

      await Message.findOneAndUpdate(
        { username },
        { $inc: { messageCount: 1 } },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error("Error polling messages:", err);
  }
}

// Start polling every second
setInterval(pollKickMessages, 1000);

// Reset every 7 days at midnight
cron.schedule("0 0 */7 * *", async () => {
  try {
    await Message.deleteMany({});
    lastCursor = null;
    console.log("Leaderboard reset after 7 days");
  } catch (err) {
    console.error("Error resetting leaderboard:", err);
  }
});

// Serve static frontend
app.use(express.static("public"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

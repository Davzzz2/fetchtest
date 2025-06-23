import express from "express";
import mongoose from "mongoose";
import fetch from "node-fetch";
import WebSocket from "ws";
import cron from 'node-cron';

const app = express();
const PORT = process.env.PORT || 3000;
const CHANNEL_ID = "1485854";

// MongoDB setup
mongoose.connect(
  'mongodb+srv://davekekv:C4kxK3SFZkLA2CZe@cluster0.wkodygj.mongodb.net/leaderboardDB?retryWrites=true&w=majority',
  { useNewUrlParser: true, useUnifiedTopology: true }
);

const messageSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  messageCount: { type: Number, default: 0 }
});
const Message = mongoose.model("Message", messageSchema);

// Keep track of last processed message ID
let lastMessageId = null;

// Helper: reject messages that are exactly an emote tag
function isValidMessage(content) {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  // e.g. [emote:3154482:enjayygreenapple]
  const emoteOnlyRegex = /^\[emote:\d+:[a-zA-Z0-9_]+\]$/;
  return !emoteOnlyRegex.test(trimmed);
}

// Fetch messages route (unchanged)
app.get("/messages", async (req, res) => {
  try {
    const timestamp = req.query.t || Date.now();
    const url = https://kick.com/api/v2/channels/${CHANNEL_ID}/messages?t=${timestamp};
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FetchTest/1.0)" }
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch channel info (unchanged)
app.get("/channel-status", async (req, res) => {
  try {
    const url = https://kick.com/api/v2/channels/${CHANNEL_ID};
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FetchTest/1.0)" }
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }
    const data = await response.json();
    res.json({
      is_live: data.data?.is_live || false,
      channel_name: data.data?.name || "Unknown",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Leaderboard endpoint for your frontend
app.get("/leaderboard", async (req, res) => {
  try {
    const docs = await Message.find()
      .sort({ messageCount: -1 })
      .limit(100)
      .lean();
    res.json(docs.map(d => ({
      username: d.username,
      messageCount: d.messageCount
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll Kick messages and update MongoDB, with emote-only filtering
async function pollKickMessages() {
  try {
    const url = https://kick.com/api/v2/channels/${CHANNEL_ID}/messages;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FetchTest/1.0)" }
    });
    if (!response.ok) {
      console.error("Fetch failed", await response.text());
      return;
    }
    const json = await response.json();
    const messages = json.data?.messages || [];
    for (const msg of messages) {
      if (lastMessageId && msg.id <= lastMessageId) continue;
      lastMessageId = lastMessageId || msg.id;
      // Only count valid messages
      if (!isValidMessage(msg.content)) continue;
      const username = msg.user?.username || msg.user_id.toString();
      await Message.findOneAndUpdate(
        { username },
        { $inc: { messageCount: 1 } },
        { upsert: true }
      );
      // advance lastMessageId
      if (msg.id > lastMessageId) lastMessageId = msg.id;
    }
  } catch (err) {
    console.error("Error polling messages:", err);
  }
}

// Poll every second
setInterval(pollKickMessages, 1000);

// Reset leaderboard every 7 days at midnight
cron.schedule('0 0 */7 * *', async () => {
  try {
    await Message.deleteMany({});
    lastMessageId = null;
    console.log("Leaderboard reset after 7 days");
  } catch (err) {
    console.error("Error resetting leaderboard:", err);
  }
});

// Serve your static frontend
app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(Server running on port ${PORT});
});

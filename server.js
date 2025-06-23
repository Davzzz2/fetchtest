import express from "express";
import mongoose from "mongoose";
import fetch from "node-fetch";
import WebSocket from "ws";

const app = express();
const PORT = process.env.PORT || 3000;
const CHANNEL_ID = "1485854";

// MongoDB setup
mongoose.connect('mongodb+srv://davekekv:C4kxK3SFZkLA2CZe@cluster0.wkodygj.mongodb.net/leaderboardDB?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const messageSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  messageCount: { type: Number, default: 0 }
});
const Message = mongoose.model("Message", messageSchema);

// Keep track of last processed message ID
let lastMessageId = null;

// Fetch messages route (unchanged for frontend use)
app.get("/messages", async (req, res) => {
  try {
    const timestamp = req.query.t || Date.now();
    const url = `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages?t=${timestamp}`;
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

// Fetch channel info
app.get("/channel-status", async (req, res) => {
  try {
    const url = `https://kick.com/api/v2/channels/${CHANNEL_ID}`;
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

// New: Serve leaderboard data
app.get("/leaderboard", async (req, res) => {
  const data = await Message.find().sort({ messageCount: -1 }).limit(100);
  res.json(data.map(entry => ({
    username: entry.username,
    messageCount: entry.messageCount
  })));
});

// Poll Kick messages + update MongoDB
async function pollKickMessages() {
  try {
    const url = `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FetchTest/1.0)" }
    });
    if (!response.ok) {
      console.error("Fetch failed", await response.text());
      return;
    }
    const data = await response.json();
    if (!Array.isArray(data)) return;

    for (const msg of data) {
      if (lastMessageId && msg.id <= lastMessageId) continue;

      const username = msg.sender.username;

      await Message.findOneAndUpdate(
        { username },
        { $inc: { messageCount: 1 } },
        { upsert: true }
      );

      if (!lastMessageId || msg.id > lastMessageId) {
        lastMessageId = msg.id;
      }
    }
  } catch (err) {
    console.error("Error polling messages:", err);
  }
}

// Poll every 1 second
setInterval(pollKickMessages, 1000);

// Reset leaderboard every 7 days (cron: every 7th day at midnight)
cron.schedule('0 0 */7 * *', async () => {
  try {
    await Message.deleteMany({});
    lastMessageId = null;
    console.log("Leaderboard reset after 7 days");
  } catch (err) {
    console.error("Error resetting leaderboard:", err);
  }
});

// Serve static frontend
app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

import express from "express";
import mongoose from "mongoose";
import fetch from "node-fetch";
import cron from "node-cron";

const app = express();
const PORT = process.env.PORT || 3000;
const CHANNEL_ID = "1485854";

// MongoDB setup
await mongoose.connect(
  'mongodb+srv://davekekv:C4kxK3SFZkLA2CZe@cluster0.wkodygj.mongodb.net/leaderboardDB?retryWrites=true&w=majority',
  { useNewUrlParser: true, useUnifiedTopology: true }
);

// Message model
const messageSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  messageCount: { type: Number, default: 0 }
});
const Message = mongoose.model("Message", messageSchema);

// Track the timestamp of the last processed message
let lastSeenTime = null;

// Filter out pure emotes
function isValidMessage(content) {
  if (!content) return false;
  const t = content.trim();
  return t && !/^\[emote:\d+:[^\]]+\]$/.test(t);
}

// Leaderboard endpoint
app.get("/leaderboard", async (req, res) => {
  const docs = await Message.find()
    .sort({ messageCount: -1 })
    .limit(100)
    .lean();
  res.json(docs.map(d => ({ username: d.username, messageCount: d.messageCount })));
});

// Live status endpoint
app.get("/live-status", async (req, res) => {
  try {
    const response = await fetch(`https://kick.com/api/v1/channels/roshtein`);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch live status" });
    }
    const data = await response.json();
    const isLive = data.livestream && data.livestream.is_live;
    res.json({ isLive });
  } catch (error) {
    console.error("Error fetching live status:", error);
    res.status(500).json({ error: error.message });
  }
});

// Polling loop
async function pollKickMessages() {
  try {
    const url = `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!resp.ok) {
      console.error("Fetch failed", await resp.text());
      return;
    }

    const json = await resp.json();
    const messages = (json.data?.messages || [])
      .map(m => ({
        ...m,
        time: new Date(m.created_at)
      }))
      .sort((a, b) => a.time - b.time);

    for (const msg of messages) {
      // Skip anything at or before lastSeenTime
      if (lastSeenTime && msg.time <= lastSeenTime) continue;

      // Update lastSeenTime immediately
      lastSeenTime = msg.time;

      // Filter and count
      if (!isValidMessage(msg.content)) continue;

      const username = msg.sender?.username;
      if (!username) continue;

      await Message.findOneAndUpdate(
        { username },
        { $inc: { messageCount: 1 } },
        { upsert: true }
      );
    }
  } catch (e) {
    console.error("Error in pollKickMessages:", e);
  }
}

// Bootstrap lastSeenTime without counting old messages
(async () => {
  try {
    const resp = await fetch(
      `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const json = await resp.json();
    const msgs = json.data?.messages || [];
    if (msgs.length) {
      // Find latest created_at
      lastSeenTime = msgs
        .map(m => new Date(m.created_at))
        .reduce((max, cur) => (cur > max ? cur : max), new Date(0));
    }
  } catch (_) {}
  setInterval(pollKickMessages, 1000);
})();

// Weekly reset
cron.schedule("0 0 */7 * *", async () => {
  await Message.deleteMany({});
  lastSeenTime = null;
  console.log("Leaderboard reset after 7 days");
});

// Serve frontend
app.use(express.static("public"));

app.listen(PORT, () => console.log(`Server on port ${PORT}`));

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

// Mongoose model
const messageSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  messageCount: { type: Number, default: 0 }
});
const Message = mongoose.model("Message", messageSchema);

// Track the last seen message's timestamp (ISO string) and ID
let lastSeenTimestamp = null;
let lastSeenId = null;

// Emote-only filter
function isValidMessage(content) {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  // Exclude if exactly "[emote:123:slug]"
  return !/^\[emote:\d+:[a-zA-Z0-9_]+\]$/.test(trimmed);
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

// Polling function
async function pollKickMessages() {
  try {
    // Fetch messages since a far-past timestamp; we'll filter in code
    const url = `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages?t=${Date.now()}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FetchTest/1.0)" }
    });
    if (!response.ok) {
      console.error("Fetch failed", await response.text());
      return;
    }

    const json = await response.json();
    const messages = json.data?.messages || [];

    // Sort by created_at ascending
    messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (const msg of messages) {
      const { created_at: createdAt, id, content, sender } = msg;

      // Skip messages older than last seen timestamp/id
      if (lastSeenTimestamp) {
        const cmpTime = new Date(createdAt) < new Date(lastSeenTimestamp);
        const sameTimeAndId = createdAt === lastSeenTimestamp && id <= lastSeenId;
        if (cmpTime || sameTimeAndId) continue;
      }

      // Update last seen markers
      lastSeenTimestamp = createdAt;
      lastSeenId = id;

      // Filter out emotes
      if (!isValidMessage(content)) continue;

      const username = sender?.username || sender?.slug;
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

// Bootstrap lastSeenTimestamp/ID without counting old messages
(async () => {
  try {
    const initRes = await fetch(
      `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages?t=${Date.now()}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const initJson = await initRes.json();
    const initMsgs = initJson.data?.messages || [];

    if (initMsgs.length) {
      const sorted = initMsgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const latest = sorted[sorted.length - 1];
      lastSeenTimestamp = latest.created_at;
      lastSeenId = latest.id;
    }
  } catch (err) {
    console.error("Error during initial bootstrap:", err);
  }

  // Start polling every second
  setInterval(pollKickMessages, 1000);
})();

// Reset leaderboard every 7 days
cron.schedule("0 0 */7 * *", async () => {
  try {
    await Message.deleteMany({});
    lastSeenTimestamp = null;
    lastSeenId = null;
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

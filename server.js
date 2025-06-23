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

// Track last seen message ID
let lastSeenMessageId = null;

// Track user message history for spam detection
const userLastMessages = new Map();

function isSpamMessage(username, content, timestamp) {
  const trimmed = content.trim();
  if (!trimmed) return true;

  // Filter pure emote messages
  if (/^\[emote:\d+:[^\]]+\]$/.test(trimmed)) return true;

  // Filter very short messages
  if (trimmed.length <= 2) return true;

  // Filter excessive CAPS (80%+ caps, min 6 chars)
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 6) {
    const capsCount = (letters.match(/[A-Z]/g) || []).length;
    if (capsCount / letters.length > 0.8) return true;
  }

  // Check against user's last message
  const last = userLastMessages.get(username);
  if (last) {
    // Repeated message
    if (last.content === trimmed) return true;

    // Very similar message (copy-paste variant)
    if (last.content && similarity(last.content, trimmed) > 0.9) return true;

    // Too fast
    if (timestamp - last.timestamp < 1000) return true;
  }

  // Update tracker
  userLastMessages.set(username, { content: trimmed, timestamp });
  return false;
}

// Simple similarity: Jaccard index on word sets
function similarity(a, b) {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  return intersection.size / Math.max(setA.size, setB.size);
}

// Serve leaderboard
app.get("/leaderboard", async (req, res) => {
  const docs = await Message.find()
    .sort({ messageCount: -1 })
    .limit(100)
    .lean();
  res.json(docs.map(d => ({ username: d.username, messageCount: d.messageCount })));
});

// Serve live status
app.get("/live-status", async (req, res) => {
  try {
    const live = await isStreamerLive();
    res.json({ isLive: live });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper to check live status
async function isStreamerLive() {
  try {
    const response = await fetch(`https://kick.com/api/v1/channels/enjayy`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.livestream && data.livestream.is_live;
  } catch (e) {
    console.error("Live check failed:", e.message);
    return false;
  }
}

// Polling loop
async function pollKickMessages() {
  try {
    const live = await isStreamerLive();
    if (!live) {
      console.log("Streamer is offline — skipping message polling.");
      return;
    }

    const url = `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!resp.ok) {
      console.error("Fetch failed", await resp.text());
      return;
    }

    const json = await resp.json();
    const messages = (json.data?.messages || []).sort((a, b) =>
      new Date(a.created_at) - new Date(b.created_at)
    );

    for (const msg of messages) {
      if (lastSeenMessageId === msg.id) break;

      const username = msg.sender?.username;
      const content = msg.content;
      const timestamp = new Date(msg.created_at).getTime();

      if (!username || !content) continue;
      if (isSpamMessage(username, content, timestamp)) continue;

      await Message.findOneAndUpdate(
        { username },
        { $inc: { messageCount: 1 } },
        { upsert: true }
      );
    }

    if (messages.length) {
      lastSeenMessageId = messages[messages.length - 1].id;
    }

  } catch (e) {
    console.error("Error in pollKickMessages:", e.message);
  }
}

// Bootstrap lastSeenMessageId
(async () => {
  try {
    const resp = await fetch(
      `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const json = await resp.json();
    const msgs = json.data?.messages || [];
    if (msgs.length) {
      lastSeenMessageId = msgs[msgs.length - 1].id;
    }
  } catch (_) {}
  setInterval(pollKickMessages, 1000);
})();

// Weekly reset
cron.schedule("0 0 */7 * *", async () => {
  await Message.deleteMany({});
  lastSeenMessageId = null;
  userLastMessages.clear();
  console.log("Leaderboard reset after 7 days");
});

// Serve frontend
app.use(express.static("public"));

app.listen(PORT, () => console.log(`Server on port ${PORT}`));

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

// Schema & model
const messageSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  messageCount: { type: Number, default: 0 }
});
const Message = mongoose.model("Message", messageSchema);

// Track last processed message ID
let lastMessageId = null;

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
    const url = `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages?t=${Date.now()}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!response.ok) {
      console.error("Fetch failed", await response.text());
      return;
    }
    const json = await response.json();
    const messages = json.data?.messages || [];

    // Sort oldest→newest
    messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (const msg of messages) {
      if (lastMessageId && msg.id <= lastMessageId) continue;
      // update lastMessageId
      lastMessageId = msg.id;
      // filter emotes
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

// Bootstrap lastMessageId without counting old messages, then start polling
(async () => {
  try {
    const initRes = await fetch(
      `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages?t=${Date.now()}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const initJson = await initRes.json();
    const initMsgs = initJson.data?.messages || [];
    if (initMsgs.length) {
      // Set lastMessageId to the newest message ID
      initMsgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      lastMessageId = initMsgs[initMsgs.length - 1].id;
    }
  } catch (err) {
    console.error("Error during bootstrap poll:", err);
  }

  // Poll every second
  setInterval(pollKickMessages, 1000);
})();

// Reset leaderboard every 7 days at midnight
cron.schedule("0 0 */7 * *", async () => {
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

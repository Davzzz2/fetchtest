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

// Track the last seen message's timestamp and ID
let lastSeenTimestamp = null;
let lastSeenId = null;

// Emote-only filter
function isValidMessage(content) {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
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

// Polling function with debug logs
async function pollKickMessages() {
  try {
    console.log(`Fetching messages from Kick at ${new Date().toISOString()}`);
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
    console.log(`Fetched ${messages.length} messages`);

    // Sort oldest→newest
    messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (const msg of messages) {
      console.log(`  → msg id=${msg.id} at ${msg.created_at}`);
      // Skip if already seen
      if (lastSeenTimestamp) {
        const older = new Date(msg.created_at) < new Date(lastSeenTimestamp);
        const sameAndOld = msg.created_at === lastSeenTimestamp && msg.id <= lastSeenId;
        if (older || sameAndOld) {
          console.log("    skipping (already seen)");
          continue;
        }
      }

      // Update last seen
      lastSeenTimestamp = msg.created_at;
      lastSeenId = msg.id;
      console.log(`    new message, evaluating...`);

      // Filter emotes
      if (!isValidMessage(msg.content)) {
        console.log("    filtered out (emote-only or empty)");
        continue;
      }

      const username = msg.sender?.username;
      if (!username) {
        console.log("    no sender username, skipping");
        continue;
      }

      await Message.findOneAndUpdate(
        { username },
        { $inc: { messageCount: 1 } },
        { upsert: true }
      );
      console.log(`    incremented count for ${username}`);
    }
  } catch (err) {
    console.error("Error polling messages:", err);
  }
}

// Bootstrap without counting old messages, then start polling
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
      console.log(`Bootstrapped lastSeen to id=${latest.id} at ${latest.created_at}`);
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

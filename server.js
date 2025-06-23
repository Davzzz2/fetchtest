import express from "express";
import mongoose from "mongoose";
import fetch from "node-fetch";
import cron from "node-cron";
import crypto from "crypto";

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

// Roll model for storing roll history
const rollSchema = new mongoose.Schema({
  winner: { type: String, required: true },
  prize: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  serverSeed: { type: String, required: true },
  clientSeed: { type: String, required: true },
  nonce: { type: Number, required: true },
  hash: { type: String, required: true }
});
const Roll = mongoose.model("Roll", rollSchema);

// Track last seen message ID
let lastSeenMessageId = null;

// Track user message history for spam detection
const userLastMessages = new Map();

// List of bot usernames to ignore
const IGNORED_USERS = ["BotRix", "KickBot"];

// Roll system variables
let nextRollTime = null;
let rollInterval = null;
let serverSeed = generateServerSeed();
let nonce = 0;

// Generate a random server seed
function generateServerSeed() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Provably fair hash function (SHA-256)
async function sha256(message) {
  return crypto.createHash('sha256').update(message).digest('hex');
}

// Generate roll result using provably fair system
async function generateRoll(serverSeed, clientSeed, nonce) {
  const combined = `${serverSeed}-${clientSeed}-${nonce}`;
  const hash = await sha256(combined);
  return parseInt(hash.substring(0, 8), 16) / Math.pow(2, 32);
}

// Get next roll time (same as leaderboard reset)
function getNextRollTime() {
  return getNextResetDate();
}

// Perform a roll
async function performRoll() {
  try {
    // Get top 10 users
    const topUsers = await Message.find()
      .sort({ messageCount: -1 })
      .limit(10)
      .lean();

    if (topUsers.length === 0) {
      console.log("No users available for roll");
      return;
    }

    // Generate roll result
    const clientSeed = Date.now().toString();
    const rollResult = await generateRoll(serverSeed, clientSeed, nonce);
    
    // Select winner (0-9 index)
    const winnerIndex = Math.floor(rollResult * topUsers.length);
    const winner = topUsers[winnerIndex];

    // Create roll record
    const roll = new Roll({
      winner: winner.username,
      prize: 10,
      serverSeed: serverSeed,
      clientSeed: clientSeed,
      nonce: nonce,
      hash: await sha256(`${serverSeed}-${clientSeed}-${nonce}`)
    });
    await roll.save();

    console.log(`Roll completed! Winner: ${winner.username}, Prize: $10`);
    
    // Update for next roll
    nonce++;
    nextRollTime = getNextRollTime();
    
  } catch (error) {
    console.error("Error performing roll:", error);
  }
}

// Timer functions
function getNextResetDate() {
  const now = new Date();
  let nextReset = new Date(now.getFullYear(), 6, 1, 0, 0, 0, 0); // July 1st at 12am
  
  // If we're past July 1st this year, set to next year
  if (now > nextReset) {
    nextReset = new Date(now.getFullYear() + 1, 6, 1, 0, 0, 0, 0);
  }
  
  return nextReset;
}

function getTimeUntilReset() {
  const now = new Date();
  const nextReset = getNextResetDate();
  const timeLeft = nextReset.getTime() - now.getTime();
  
  return Math.max(0, timeLeft);
}

async function resetLeaderboard() {
  try {
    await Message.deleteMany({});
    await Roll.deleteMany({}); // Clear roll history on reset
    lastSeenMessageId = null;
    userLastMessages.clear();
    
    // Reset roll system
    serverSeed = generateServerSeed();
    nonce = 0;
    nextRollTime = getNextRollTime();
    
    console.log("Leaderboard reset - 7 day cycle completed");
  } catch (error) {
    console.error("Error resetting leaderboard:", error);
  }
}

// Timer endpoint
app.get("/timer", (req, res) => {
  const timeLeft = getTimeUntilReset();
  const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
  
  res.json({
    timeLeft,
    days,
    hours,
    minutes,
    seconds,
    nextReset: getNextResetDate().toISOString()
  });
});

// Roll system endpoints
app.get("/roll-info", async (req, res) => {
  try {
    const timeUntilRoll = getTimeUntilReset();
    
    // Get latest roll
    const latestRoll = await Roll.findOne().sort({ timestamp: -1 });
    
    res.json({
      nextRollTime: getNextResetDate().toISOString(),
      timeUntilRoll: Math.max(0, timeUntilRoll),
      latestRoll: latestRoll ? {
        winner: latestRoll.winner,
        prize: latestRoll.prize,
        timestamp: latestRoll.timestamp,
        hash: latestRoll.hash
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/roll-history", async (req, res) => {
  try {
    const rolls = await Roll.find().sort({ timestamp: -1 }).limit(10);
    res.json(rolls.map(roll => ({
      winner: roll.winner,
      prize: roll.prize,
      timestamp: roll.timestamp,
      hash: roll.hash
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current server seed (for transparency)
app.get("/current-seed", (req, res) => {
  res.json({
    serverSeed: serverSeed,
    nextRollTime: nextRollTime ? nextRollTime.toISOString() : null
  });
});

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
    if (last.content === trimmed) return true;
    if (similarity(last.content, trimmed) > 0.9) return true;
    if (timestamp - last.timestamp < 1000) return true;
  }

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
      if (IGNORED_USERS.includes(username)) continue;
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

// Check timer every minute and reset when needed
cron.schedule("* * * * *", async () => {
  const timeLeft = getTimeUntilReset();
  if (timeLeft === 0) {
    await resetLeaderboard();
    await performRoll(); // Perform roll when leaderboard resets
  }
});

// Initialize roll system
(async () => {
  nextRollTime = getNextRollTime();
  console.log(`Next roll scheduled for: ${nextRollTime}`);
})();

// Serve frontend
app.use(express.static("public"));

app.listen(PORT, () => console.log(`Server on port ${PORT}`));

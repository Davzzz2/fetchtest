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

const messageSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  messageCount: { type: Number, default: 0 }
});
const Message = mongoose.model("Message", messageSchema);

let lastMessageId = null;

function isValidMessage(content) {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  return !/^\[emote:\d+:[a-zA-Z0-9_]+\]$/.test(trimmed);
}

app.get("/leaderboard", async (req, res) => {
  const docs = await Message.find().sort({ messageCount: -1 }).limit(100).lean();
  res.json(docs.map(d => ({ username: d.username, messageCount: d.messageCount })));
});

async function pollKickMessages() {
  try {
    const url = `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!response.ok) return console.error("Fetch failed", await response.text());

    const json = await response.json();
    const messages = (json.data?.messages || []).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    for (const msg of messages) {
      if (lastMessageId && msg.id <= lastMessageId) continue;

      // **Always advance first**
      lastMessageId = msg.id;

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

// Initial bootstrap: set lastMessageId to the very latest so old messages aren’t counted
(async () => {
  try {
    const init = await fetch(
      `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const js = await init.json();
    const arr = (js.data?.messages || []).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );
    if (arr.length) lastMessageId = arr[arr.length - 1].id;
  } catch {}
  setInterval(pollKickMessages, 1000);
})();

cron.schedule("0 0 */7 * *", async () => {
  await Message.deleteMany({});
  lastMessageId = null;
  console.log("Reset leaderboard after 7 days");
});

app.use(express.static("public"));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

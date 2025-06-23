// server.js
import express from "express";
import mongoose from "mongoose";
import cron from "node-cron";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 3000;
const CHANNEL_SLUG = "1485854";  // numeric or slug
const KICK_CHANNEL_URL = `https://kick.com/${CHANNEL_SLUG}`;

// MongoDB setup
await mongoose.connect(
  "mongodb+srv://davekekv:C4kxK3SFZkLA2CZe@cluster0.wkodygj.mongodb.net/leaderboardDB?retryWrites=true&w=majority",
  { useNewUrlParser: true, useUnifiedTopology: true }
);

// Mongoose model
const messageSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  messageCount: { type: Number, default: 0 }
});
const Message = mongoose.model("Message", messageSchema);

// Filter out pure emotes
function isValidMessage(text) {
  if (!text) return false;
  const t = text.trim();
  return t.length > 0 && !/^\[emote:\d+:[^\]]+\]$/.test(t);
}

// Leaderboard endpoint unchanged
app.get("/leaderboard", async (req, res) => {
  const docs = await Message.find().sort({ messageCount: -1 }).limit(100).lean();
  res.json(docs.map(d => ({ username: d.username, messageCount: d.messageCount })));
});

// Expose a function Puppeteer can call whenever a new chat line appears
app.use(express.json());
app.post("/_puppeteer/message", async (req, res) => {
  const { username, content } = req.body;
  if (!username || !isValidMessage(content)) return res.sendStatus(204);
  await Message.findOneAndUpdate(
    { username },
    { $inc: { messageCount: 1 } },
    { upsert: true }
  );
  console.log(`Counted message for ${username}: "${content}"`);
  res.sendStatus(200);
});

// Serve static frontend
app.use(express.static("public"));

// Start the server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startPuppeteer();
  // 7-day reset
  cron.schedule("0 0 */7 * *", async () => {
    await Message.deleteMany({});
    console.log("Leaderboard reset after 7 days");
  });
});


// Headless browser logic
async function startPuppeteer() {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true
  });
  const page = await browser.newPage();
  await page.goto(KICK_CHANNEL_URL, { waitUntil: "networkidle2" });
  console.log("Joined Kick channel page in headless browser");

  // Expose a function into the page context so we can POST back to our server
  await page.exposeFunction("notifyServer", async (username, content) => {
    try {
      await fetch(`http://localhost:${PORT}/_puppeteer/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, content })
      });
    } catch (e) {
      console.error("Failed to notify server:", e);
    }
  });

  // In-page script: observe chat DOM for new messages
  await page.evaluate(() => {
    const chatContainer = document.querySelector(".chat-list");
    if (!chatContainer) {
      console.error("Chat container not found!");
      return;
    }
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const line = node.querySelector(".chat-line");
          if (!line) continue;
          // Extract username & content from DOM
          const username = line.querySelector(".chat-username")?.textContent;
          const content = line.querySelector(".chat-content")?.textContent;
          if (username && content) {
            window.notifyServer(username.trim(), content.trim());
          }
        }
      }
    });
    obs.observe(chatContainer, { childList: true, subtree: true });
    console.log("Watching for new chat messages in page...");
  });
}

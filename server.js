const express = require("express");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 3000;

const CHANNEL_ID = "1485854";

// Fetch messages route
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

// New: Fetch channel info (including live status)
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
    // Send just is_live flag and channel title or name
    res.json({
      is_live: data.data?.is_live || false,
      channel_name: data.data?.name || "Unknown",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend static files
app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

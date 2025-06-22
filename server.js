const express = require("express");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Example channel ID - replace with any Kick channel ID you want
const CHANNEL_ID = "1154053";

// Fetch messages from Kick public API and proxy to client
app.get("/messages", async (req, res) => {
  try {
    // timestamp query param (optional), default to now
    const timestamp = req.query.t || Date.now();

    const url = `https://kick.com/api/v2/channels/${CHANNEL_ID}/messages?t=${timestamp}`;

    const response = await fetch(url, {
      headers: {
        // You can try adding a User-Agent header if Kick blocks default fetch UA
        "User-Agent": "Mozilla/5.0 (compatible; FetchTest/1.0)",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Kick API responded with status ${response.status}`,
        details: errText,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch messages", details: error.message });
  }
});

// Simple frontend serving
app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

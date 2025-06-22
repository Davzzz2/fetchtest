const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/messages", async (req, res) => {
  const { since } = req.query;
  const timestamp = since || Date.now();

  const apiUrl = `https://kick.com/api/v2/channels/1485854/messages?t=${timestamp}`;
  console.log(`➡ Fetching: ${apiUrl}`);

  try {
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MyKickFetcher/1.0)",
        "Accept": "application/json"
      }
    });

    console.log(`⬅ Kick status: ${response.status}`);

    const text = await response.text();
    console.log(`⬅ Kick raw response: ${text.slice(0, 300)}...`); // limit log size

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch from Kick", body: text });
    }

    // Try parse JSON
    try {
      const data = JSON.parse(text);
      res.json(data);
    } catch (jsonErr) {
      console.error("❌ Failed to parse Kick JSON:", jsonErr);
      res.status(500).json({ error: "Kick API returned non-JSON", body: text });
    }

  } catch (err) {
    console.error("❌ Error fetching Kick messages:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/", (req, res) => {
  res.send("✅ Kick backend is running.");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/messages", async (req, res) => {
  const { since } = req.query;
  const timestamp = since || Date.now();

  const apiUrl = `https://kick.com/api/v2/channels/1485854/messages?t=${timestamp}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch from Kick" });
    }

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("Error fetching Kick messages:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/", (req, res) => {
  res.send("Kick backend is running.");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

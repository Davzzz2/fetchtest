const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-memory storage of chat messages (max 100)
const messages = [];

// Webhook endpoint: receives Kick events (chat messages etc)
app.post("/kick-webhook", (req, res) => {
  const event = req.body;

  if (event.event_type === "chat_message" && event.data) {
    messages.push({
      id: event.data.id || Date.now(),
      user: event.data.user?.username || "Unknown",
      message: event.data.message || "",
      timestamp: event.data.timestamp || Date.now(),
    });

    if (messages.length > 100) messages.shift();
  }

  res.sendStatus(200);
});

// API endpoint: returns stored messages as JSON
app.get("/messages", (req, res) => {
  res.json(messages);
});

// Serve client static files from "public" folder
app.use(express.static(path.join(__dirname, "public")));

// Simple health check
app.get("/health", (req, res) => {
  res.send("OK");
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const CLIENT_ID = "01JYCWC14T90VS7SSMNBDABES0";
const CLIENT_SECRET = "6f590b911c6a817b238a150f8add7c5f887ad318b3e90810013f95d6918c867f";
const REDIRECT_URI = "https://fetchtest-g14m.onrender.com/oauth/callback"; // Set this in Kick dev portal as redirect URL
const WEBHOOK_URL = "https://fetchtest-g14m.onrender.com/kick-webhook";

let accessToken = null; // Store token in memory (demo only)

// In-memory storage of chat messages (max 100)
const messages = [];

// --- OAuth Step 1: Redirect user to Kick login ---
app.get("/login", (req, res) => {
  const scopes = [
    "subscribe_events",
    "write_chat",
    "read_channel",
    "read_user",
    "read_stream_key",
    "execute_moderation_actions"
  ].join(" ");
  const url = `https://kick.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}`;
  res.redirect(url);
});

// --- OAuth Step 2: Handle Kick redirect with code ---
app.get("/oauth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI
      })
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Token exchange error:", err);
      return res.status(500).send("Failed to get access token");
    }

    const tokenData = await tokenRes.json();
    accessToken = tokenData.access_token;
    console.log("🎉 Access token obtained:", accessToken);

    // Register webhook URL with Kick API using the access token
    const webhookRegisterRes = await fetch("https://kick.com/api/v2/webhooks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        enabled: true,
        events: [
          "chat_message",
          "follow",
          "subscribe",
          "gift",
          "ban",
          "unban",
          "stream_start",
          "stream_stop"
        ],
      }),
    });

    if (!webhookRegisterRes.ok) {
      const err = await webhookRegisterRes.text();
      console.error("Webhook registration failed:", err);
      return res.status(500).send("Failed to register webhook");
    }

    console.log("✅ Webhook registered successfully");

    res.send(`
      <h2>OAuth Successful!</h2>
      <p>Webhook registered. You can now close this window and return to the chat page:</p>
      <a href="/">View chat messages</a>
    `);
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).send("Internal Server Error");
  }
});

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
  console.log(`➡️  Visit http://localhost:${PORT}/login to start OAuth flow`);
});

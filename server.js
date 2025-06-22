const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies (Kick sends JSON)
app.use(express.json());

// Kick webhook endpoint
app.post("/kick-webhook", (req, res) => {
  console.log("✅ Kick webhook event received:");
  console.log(JSON.stringify(req.body, null, 2));

  // Always respond 200 OK to acknowledge
  res.sendStatus(200);
});

// Simple health check
app.get("/", (req, res) => {
  res.send("🚀 Kick Webhook listener is live!");
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

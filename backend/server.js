require("dotenv").config();

const express = require("express");
const askRoutes = require("./routes/askRoutes");
const { initializeDatabase } = require("./database/initDb");

const app = express();

const PORT = process.env.PORT || 3000;

// Allow Express to read JSON requests
app.use(express.json());
app.use("/api/ask", askRoutes);

// Test endpoint
app.get("/api/health", (req, res) => {
  res.json({
    message: "TrustLens backend is running!"
  });
});

// Create database tables before starting the server
initializeDatabase();

app.listen(PORT, () => {
    console.log(`TrustLens server running on port ${PORT}`);
});

// Start server
app.listen(PORT, () => {
  console.log(`TrustLens server running on port ${PORT}`);
});
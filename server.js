import express from "express";
import mysql from "mysql2";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import nodemailer from "nodemailer";
import mqtt from "mqtt";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

/* ----------------------------- STATIC FILES ----------------------------- */
// This allows Render to serve your frontend inside /public
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

/* ----------------------------- MYSQL SETUP ----------------------------- */
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: { rejectUnauthorized: false } // Important for Render + cloud DBs
});

db.connect(err => {
  if (err) console.error("DB Error:", err);
  else console.log("✅ Connected to MySQL");
});

/* ----------------------------- EMAIL SETUP ------------------------------ */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/* ----------------------------- MQTT SETUP ------------------------------- */
// Render allows outbound but blocks inbound ports.
// So MQTT MUST use WebSocket for frontend & TCP for backend.

const MQTT_URL = process.env.MQTT_BROKER_URL || "mqtt://broker.hivemq.com:1883";

const mqttClient = mqtt.connect(MQTT_URL);

mqttClient.on("connect", () => {
  console.log("📡 Connected to MQTT broker");

  // Subscribe to device topics
  mqttClient.subscribe("umbrella/gps");
  mqttClient.subscribe("umbrella/status");
  mqttClient.subscribe("umbrella/sos");
  mqttClient.subscribe("umbrella/weather");
});

/* --------------------------- MQTT MESSAGE LOGIC -------------------------- */
mqttClient.on("message", (topic, message) => {
  const msg = message.toString();
  console.log(`📥 MQTT [${topic}]: ${msg}`);

  /* ---------------- SOS ALERT ---------------- */
  if (topic === "umbrella/sos") {
    try {
      const data = JSON.parse(msg);
      const { email, lat, lon } = data;

      db.query("SELECT emergencyEmail FROM users WHERE email=?", [email], (err, rows) => {
        if (err) return console.error("DB SOS Error:", err);
        if (!rows.length) return console.log("❌ No user found:", email);

        const emergencyEmail = rows[0].emergencyEmail;
        if (emergencyEmail) {
          transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: emergencyEmail,
            subject: "🚨 Smart Umbrella SOS",
            text: `SOS triggered by ${email}.\nLocation: https://maps.google.com/?q=${lat},${lon}`
          });
          console.log(`🚨 SOS sent to ${emergencyEmail}`);
        }
      });
    } catch (err) {
      console.error("Invalid SOS JSON:", msg);
    }
  }

  /* ---------------- WEATHER ALERT ---------------- */
  if (topic === "umbrella/weather") {
    try {
      const data = JSON.parse(msg);
      const { lat, lon, rain_prob, uv_index, email } = data;

      if (!email) return;

      db.query("SELECT emergencyEmail FROM users WHERE email=?", [email], (err, rows) => {
        if (err) return console.error("Weather DB Error:", err);
        if (!rows.length) return;

        const emergencyEmail = rows[0].emergencyEmail;
        const recipient = emergencyEmail || email;

        let alerts = [];
        if (rain_prob > 50) alerts.push(`🌧 High rain probability: ${rain_prob}%`);
        if (uv_index > 7) alerts.push(`☀️ High UV index: ${uv_index}`);

        if (alerts.length === 0) return;

        transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: recipient,
          subject: "⚠️ Smart Umbrella Weather Alert",
          text: `${alerts.join("\n")}\nLocation: https://maps.google.com/?q=${lat},${lon}`
        });

        console.log(`📧 Weather alert sent to ${recipient}`);
      });
    } catch (err) {
      console.error("Invalid weather JSON:", msg);
    }
  }
});

/* ----------------------------- API ROUTES -------------------------------- */

// OTP send
app.post("/send-otp", (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpires = new Date(Date.now() + 5 * 60000);

  db.query("SELECT email, password FROM users WHERE email=?", [email], (err, result) => {
    if (err) return res.status(500).json({ error: err });

    const query = result.length
      ? "UPDATE users SET otp=?, otpExpires=? WHERE email=?"
      : "INSERT INTO users (email, otp, otpExpires) VALUES (?, ?, ?)";

    const params = result.length
      ? [otp, otpExpires, email]
      : [email, otp, otpExpires];

    db.query(query, params, err2 => {
      if (err2) return res.status(500).json({ error: err2 });

      transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Your Smart Umbrella OTP",
        text: `Your OTP: ${otp} (valid for 5 min)`
      });

      res.json({ message: "OTP sent successfully" });
    });
  });
});

// Registration
app.post("/register", (req, res) => {
  const { email, password, emergencyEmail, otp } = req.body;

  db.query("SELECT otp, otpExpires FROM users WHERE email=?", [email], (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    if (!rows.length) return res.status(400).json({ message: "No OTP found" });

    const dbOTP = rows[0].otp;
    if (otp !== dbOTP || Date.now() > new Date(rows[0].otpExpires))
      return res.status(400).json({ message: "Invalid or expired OTP" });

    db.query("UPDATE users SET password=?, emergencyEmail=? WHERE email=?", [password, emergencyEmail, email], err2 => {
      if (err2) return res.status(500).json({ error: err2 });
      res.json({ message: "Registered successfully" });
    });
  });
});

// Login
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM users WHERE email=? AND password=?", [email, password], (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    if (!rows.length) return res.status(401).json({ message: "Invalid credentials" });
    res.json(rows[0]);
  });
});

// Update emergency contact
app.post("/update-emergency", (req, res) => {
  const { email, emergencyEmail } = req.body;

  db.query(
    "UPDATE users SET emergencyEmail=? WHERE email=?",
    [emergencyEmail, email],
    (err, result) => {
      if (err) return res.status(500).json({ error: err });
      if (result.affectedRows === 0) return res.status(404).json({ message: "User not found" });
      res.json({ message: "Updated" });
    }
  );
});

// ESP POST → MQTT forward
app.post("/esp-data", (req, res) => {
  const { email, lat, lon, status } = req.body;

  mqttClient.publish("umbrella/gps", `${lat},${lon}`);
  res.json({ message: "Forwarded to MQTT" });
});

/* --------------------------- START SERVER -------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

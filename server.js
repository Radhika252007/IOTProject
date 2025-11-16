import express from "express";
import mongoose from "mongoose";
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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

/* ----------------------------- MONGOOSE SETUP ----------------------------- */

mongoose
  .connect(process.env.MONGO_URI, {
    dbName: "smartumbrella",
  })
  .then(() => console.log("✅ Connected to MongoDB (Mongoose)"))
  .catch(err => console.error("❌ MongoDB Error:", err));

/* ----------------------------- USER MODEL ----------------------------- */

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: String,
  emergencyEmail: String,
  otp: String,
  otpExpires: Date
});

const User = mongoose.model("User", userSchema);

/* ----------------------------- EMAIL SETUP ------------------------------ */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/* ----------------------------- MQTT SETUP ------------------------------- */

const MQTT_URL = process.env.MQTT_BROKER_URL || "mqtt://broker.hivemq.com:1883";
const mqttClient = mqtt.connect(MQTT_URL);

mqttClient.on("connect", () => {
  console.log("📡 Connected to MQTT broker");
  mqttClient.subscribe("umbrella/gps");
  mqttClient.subscribe("umbrella/status");
  mqttClient.subscribe("umbrella/sos");
  mqttClient.subscribe("umbrella/weather");
});

/* --------------------------- MQTT MESSAGE LOGIC -------------------------- */

mqttClient.on("message", async (topic, message) => {
  const msg = message.toString();
  console.log(`📥 MQTT [${topic}]: ${msg}`);

  /* ---------------------- SOS ---------------------- */
  if (topic === "umbrella/sos") {
    try {
      const { email, lat, lon } = JSON.parse(msg);

      const user = await User.findOne({ email });
      if (!user) return console.log("❌ No user found:", email);

      const recipient = user.emergencyEmail;
      if (!recipient) return;

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: recipient,
        subject: "🚨 Smart Umbrella SOS",
        text: `SOS triggered by ${email}.\nLocation: https://maps.google.com/?q=${lat},${lon}`
      });

      console.log(`🚨 SOS sent to ${recipient}`);

    } catch (err) {
      console.error("Invalid SOS JSON:", msg);
    }
  }

  /* -------------------- WEATHER ALERT -------------------- */
  if (topic === "umbrella/weather") {
    try {
      const { lat, lon, rain_prob, uv_index, email } = JSON.parse(msg);

      const user = await User.findOne({ email });
      if (!user) return;

      const recipient = user.emergencyEmail || user.email;

      let alerts = [];
      if (rain_prob > 50) alerts.push(`🌧 High rain probability: ${rain_prob}%`);
      if (uv_index > 7) alerts.push(`☀️ High UV index: ${uv_index}`);

      if (alerts.length === 0) return;

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: recipient,
        subject: "⚠️ Smart Umbrella Weather Alert",
        text: `${alerts.join("\n")}\nLocation: https://maps.google.com/?q=${lat},${lon}`
      });

      console.log(`📧 Weather alert sent to ${recipient}`);

    } catch (err) {
      console.error("Invalid weather JSON:", msg);
    }
  }
});

/* ----------------------------- API ROUTES -------------------------------- */

/* ---------------- SEND OTP ---------------- */
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpires = new Date(Date.now() + 5 * 60000);

  let user = await User.findOne({ email });

  if (user) {
    user.otp = otp;
    user.otpExpires = otpExpires;
    await user.save();
  } else {
    user = await User.create({ email, otp, otpExpires });
  }

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Your Smart Umbrella OTP",
    text: `Your OTP: ${otp} (valid for 5 minutes)`
  });

  res.json({ message: "OTP sent successfully" });
});

/* ---------------- REGISTER ---------------- */
app.post("/register", async (req, res) => {
  const { email, password, emergencyEmail, otp } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: "No OTP found" });

  if (otp !== user.otp || Date.now() > new Date(user.otpExpires)) {
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }

  user.password = password;
  user.emergencyEmail = emergencyEmail;
  await user.save();

  res.json({ message: "Registered successfully" });
});

/* ---------------- LOGIN ---------------- */
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email, password });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  res.json(user);
});

/* ---------------- UPDATE EMERGENCY CONTACT ---------------- */
app.post("/update-emergency", async (req, res) => {
  const { email, emergencyEmail } = req.body;

  const user = await User.findOneAndUpdate(
    { email },
    { emergencyEmail },
    { new: true }
  );

  if (!user) return res.status(404).json({ message: "User not found" });

  res.json({ message: "Updated" });
});

/* ---------------- ESP → MQTT ---------------- */
app.post("/esp-data", (req, res) => {
  const { email, lat, lon } = req.body;

  mqttClient.publish("umbrella/gps", `${lat},${lon}`);
  res.json({ message: "Forwarded to MQTT" });
});

/* --------------------------- START SERVER -------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));

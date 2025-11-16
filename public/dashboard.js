let client;

document.addEventListener("DOMContentLoaded", () => {
  const email = localStorage.getItem("userEmail");
  const emergencyEmail = localStorage.getItem("emergencyEmail");

  if (!email) {
    window.location.href = "login.html";
    return;
  }

  document.getElementById("userEmail").textContent = email;
  document.getElementById("emergencyEmail").textContent = emergencyEmail || "Not set";
  document.getElementById("emergencyEmailDisplay").textContent = emergencyEmail || "Not set";

  initDashboard();
});

function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

function updateEmergencyEmail() {
  const newEmail = document.getElementById("emergencyEmailInput").value.trim();
  const userEmail = localStorage.getItem("userEmail");

  if (!newEmail || !newEmail.includes("@")) {
    alert("⚠️ Please enter a valid email address.");
    return;
  }

  localStorage.setItem("emergencyEmail", newEmail);
  document.getElementById("emergencyEmailDisplay").textContent = newEmail;
  document.getElementById("emergencyEmail").textContent = newEmail || "Not set";

  fetch("https://smart-umbrella.onrender.com/update-emergency", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, emergencyEmail: newEmail }),
  })
    .then((res) => res.json())
    .then((data) => {
      console.log(data);
      alert("✅ Emergency contact updated successfully!");

      if (client && client.connected) {
        client.publish(
          "umbrella/emails",
          JSON.stringify({
            userEmail: userEmail,
            emergencyEmail: newEmail
          }),
  { qos: 1, retain: true }
        );
        console.log("📤 Sent updated email info to ESP32");
      }
    })
    .catch((err) => {
      console.error(err);
      alert("❌ Failed to update emergency contact in database.");
    });
}

function initDashboard() {
  const statusText = document.getElementById("status");
  const mapDiv = document.getElementById("map");
  const rainText = document.getElementById("rainProb");
  const tempText = document.getElementById("temperature");
  const uvText = document.getElementById("uvIndex");

  const map = L.map("map").setView([28.6139, 77.2090], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  let marker;

  client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt");

  client.on("connect", () => {
    console.log("📡 Connected to MQTT via WebSocket");
    client.subscribe("umbrella/gps");
    client.subscribe("umbrella/status");
    client.subscribe("umbrella/sos");
    client.subscribe("umbrella/weather"); // subscribe to weather updates

    const email = localStorage.getItem("userEmail");
    const emergencyEmail = localStorage.getItem("emergencyEmail");
    if (email && emergencyEmail) {
      client.publish(
        "umbrella/emails",
        JSON.stringify({ userEmail: email, emergencyEmail }),
        { qos: 1, retain: true }
      );
      console.log("📤 Sent user email data to ESP32");
    }
  });

  client.on("message", (topic, message) => {
    const msg = message.toString();
    console.log(`📥 ${topic}: ${msg}`);

    if (topic === "umbrella/gps") {
      const [lat, lon] = msg.split(",").map(Number);
      if (marker) map.removeLayer(marker);
      marker = L.marker([lat, lon]).addTo(map).bindPopup("☂️ Umbrella Location").openPopup();
      map.setView([lat, lon], 15);
      statusText.textContent = `📍 Live GPS: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }

    if (topic === "umbrella/status") {
      statusText.textContent = `🌦 Weather Alert: ${msg}`;
    }

    if (topic === "umbrella/sos") {
      statusText.textContent = "🚨 SOS Alert Received!";
      statusText.style.color = "red";
    }

    if (topic === "umbrella/weather") {
      const weather = JSON.parse(msg);
      rainText.textContent = `🌧 Rain Probability: ${weather.rain_prob.toFixed(1)}%`;
      tempText.textContent = `🌡 Temperature: ${weather.temperature.toFixed(1)}°C`;
      uvText.textContent = `☀️ UV Index: ${weather.uv_index.toFixed(1)}`;
    }
  });
}
const BASE_URL = "http://localhost:5000";

document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("userEmail")) {
    window.location.href = "dashboard.html";
  }
});

async function sendOTP() {
  const email = document.getElementById("email").value.trim();
  if (!email) return alert("Please enter your email.");

  const res = await fetch(`${BASE_URL}/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  const data = await res.json();
  alert(data.message || "OTP sent successfully!");
}

async function register() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const otp = document.getElementById("otp").value.trim();

  if (!email || !password || !otp) return alert("Please fill all required fields.");

  const res = await fetch(`${BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password,otp })
  });

  const data = await res.json();
  alert(data.message);

  if (res.ok) {
    localStorage.setItem("userEmail", email);
    window.location.href = "dashboard.html";
  }
}

async function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!email || !password) return alert("Please fill all fields.");

  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();

  if (res.ok) {
    localStorage.setItem("userEmail", data.email || email);
    localStorage.setItem("emergencyEmail", data.emergencyEmail || "");
    window.location.href = "dashboard.html";
  } else {
    alert(data.message || "Login failed!");
  }
}

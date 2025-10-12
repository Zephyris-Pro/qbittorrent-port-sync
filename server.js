#!/usr/bin/env node
import express from "express";
import fetch from "node-fetch";
import fetchCookie from "fetch-cookie";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const require = createRequire(import.meta.url);
const tough = require("tough-cookie");
const CookieJar = tough.CookieJar;

// const SERVER_PORT = process.env.SERVER_PORT || 5000;
const VPN_PORT_URL =
  process.env.GLUETUN_SERVER_URL ||
  "http://localhost:8000/v1/openvpn/portforwarded";
const QBIT_URL = process.env.QBIT_URL || "http://localhost:8080";
const QBIT_USER = process.env.QBIT_USER || "";
const QBIT_PASS = process.env.QBIT_PASS || "";
const UPDATE_INTERVAL = Number(process.env.UPDATE_INTERVAL || 300_000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const jar = new CookieJar();
const fetchSession = fetchCookie(fetch, jar);

let lastPort = null;
let lastUpdate = 0;

async function getVPNPort() {
  try {
    const r = await fetch(VPN_PORT_URL);
    const data = await r.json();
    return data.port;
  } catch {
    return null;
  }
}

async function loginQbit() {
  try {
    const res = await fetchSession(`${QBIT_URL}/api/v2/auth/login`, {
      method: "POST",
      body: new URLSearchParams({ username: QBIT_USER, password: QBIT_PASS }),
    });
    const text = await res.text();
    return text.trim() === "Ok.";
  } catch {
    return false;
  }
}

async function updateQbitPort(port) {
  try {
    let prefsRes = await fetchSession(`${QBIT_URL}/api/v2/app/preferences`);
    if (prefsRes.status === 403) {
      await loginQbit();
      prefsRes = await fetchSession(`${QBIT_URL}/api/v2/app/preferences`);
    }
    const prefs = await prefsRes.json();
    prefs.listen_port = port;
    await fetchSession(`${QBIT_URL}/api/v2/app/setPreferences`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "json=" + encodeURIComponent(JSON.stringify(prefs)),
    });
    console.log(`✅ Update qBittorrent on port ${port}`);
  } catch (err) {
    console.error("Failure when updating qBittorrent port:", err);
  }
}

async function updatePort() {
  const port = await getVPNPort();
  if (!port) return;
  lastPort = port;
  lastUpdate = Date.now();
  await updateQbitPort(port);
}

(async () => {
  await loginQbit();
  await updatePort();
  setInterval(updatePort, UPDATE_INTERVAL);
})();

app.get("/status", (req, res) => {
  const elapsed = (Date.now() - lastUpdate) / 1000;
  const remaining = Math.max(0, UPDATE_INTERVAL / 1000 - elapsed);
  res.json({ current_port: lastPort, next_update_in: Math.round(remaining) });
});

app.listen(5000, "0.0.0.0", () =>
  console.log(`🌐 Serving on http://localhost:5000`)
);
  
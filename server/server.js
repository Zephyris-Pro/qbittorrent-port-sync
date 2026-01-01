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

const SERVER_PORT = 5000;
const VPN_PORT_URL =
  process.env.GLUETUN_SERVER_URL ||
  "http://localhost:8000/v1/portforward";
const QBITTORRENT_URL = process.env.QBITTORRENT_URL || "http://localhost:8080";
const QBITTORRENT_USER = process.env.QBITTORRENT_USER || "";
const QBITTORRENT_PASS = process.env.QBITTORRENT_PASS || "";
const UPDATE_INTERVAL = Number(process.env.UPDATE_INTERVAL || 300_000);

const GLUETUN_AUTH_METHOD = (process.env.GLUETUN_AUTH_METHOD || "none").toLowerCase();
const GLUETUN_AUTH_USERNAME = process.env.GLUETUN_AUTH_USERNAME || "";
const GLUETUN_AUTH_PASSWORD = process.env.GLUETUN_AUTH_PASSWORD || "";
const GLUETUN_AUTH_API_KEY = process.env.GLUETUN_AUTH_API_KEY || "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());

const jar = new CookieJar();
const fetchSession = fetchCookie(fetch, jar);

let lastPort = null;
let lastCheckTime = Date.now();
let isLoggedIn = false;
let updateCount = 0;

function buildGluetunAuthHeaders() {
  const headers = {};
  switch (GLUETUN_AUTH_METHOD) {
    case "basic":
      if (!GLUETUN_AUTH_USERNAME || !GLUETUN_AUTH_PASSWORD) {
        console.warn("⚠️ Gluetun basic auth configured without username/password");
        break;
      }
      headers.Authorization = `Basic ${Buffer.from(`${GLUETUN_AUTH_USERNAME}:${GLUETUN_AUTH_PASSWORD}`).toString("base64")}`;
      break;
    case "apikey":
      if (!GLUETUN_AUTH_API_KEY) {
        console.warn("⚠️ Gluetun API key auth configured without apikey");
        break;
      }
      headers["X-API-Key"] = GLUETUN_AUTH_API_KEY;
      break;
    case "none":
      break;
    default:
      console.warn(`⚠️ Unknown Gluetun auth method "${GLUETUN_AUTH_METHOD}", falling back to none`);
  }
  return headers;
}

async function getVPNPort() {
  try {
    const r = await fetch(VPN_PORT_URL, {
      timeout: 5000,
      headers: buildGluetunAuthHeaders(),
    });
    if (r.status === 401 || r.status === 403) {
      console.error(`❌ Gluetun authentication failed with status ${r.status}`);
      return null;
    }
    if (!r.ok) {
      console.error(`❌ Gluetun returned status ${r.status}`);
      return null;
    }
    const data = await r.json();
    return data.port || null;
  } catch (err) {
    console.error(`❌ Failed to fetch VPN port: ${err.message}`);
    return null;
  }
}

async function loginQbit() {
  try {
    const res = await fetchSession(`${QBITTORRENT_URL}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: QBITTORRENT_USER,
        password: QBITTORRENT_PASS,
      }),
      timeout: 5000,
    });
    const text = await res.text();
    isLoggedIn = text.trim() === "Ok.";
    if (isLoggedIn) {
      console.log("✅ Logged into qBittorrent successfully");
    } else {
      console.error(`❌ qBittorrent login failed: ${text}`);
    }
    return isLoggedIn;
  } catch (err) {
    console.error(`❌ qBittorrent login error: ${err.message}`);
    isLoggedIn = false;
    return false;
  }
}

async function getPreferences() {
  try {
    const prefsRes = await fetchSession(
      `${QBITTORRENT_URL}/api/v2/app/preferences`,
      { timeout: 5000 }
    );

    if (prefsRes.status === 403) {
      console.log("🔄 Session expired, attempting to re-login...");
      const loginSuccess = await loginQbit();
      if (!loginSuccess) {
        throw new Error("Failed to re-authenticate");
      }

      const retryRes = await fetchSession(
        `${QBITTORRENT_URL}/api/v2/app/preferences`,
        { timeout: 5000 }
      );

      if (!retryRes.ok) {
        throw new Error(
          `Failed to get preferences after login: ${retryRes.status}`
        );
      }

      return await retryRes.json();
    }

    if (!prefsRes.ok) {
      throw new Error(`Failed to get preferences: ${prefsRes.status}`);
    }

    return await prefsRes.json();
  } catch (err) {
    console.error(`❌ Error getting qBittorrent preferences: ${err.message}`);
    throw err;
  }
}

async function updateQbitPort(port) {
  try {
    let prefs = await getPreferences();

    if (prefs.listen_port === port) {
      console.log(`ℹ️ Port already set to ${port}, no update needed`);
      return true;
    }

    prefs.listen_port = port;

    const res = await fetchSession(
      `${QBITTORRENT_URL}/api/v2/app/setPreferences`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "json=" + encodeURIComponent(JSON.stringify(prefs)),
        timeout: 5000,
      }
    );

    if (!res.ok) {
      throw new Error(`Failed to update port, status: ${res.status}`);
    }

    console.log(`✅ Updated qBittorrent to use port ${port}`);
    return true;
  } catch (err) {
    console.error(`❌ Error updating qBittorrent port: ${err.message}`);
    return false;
  }
}

async function updatePort() {
  try {
    lastCheckTime = Date.now();
    updateCount++;

    console.log(`🔍 Checking for VPN port update (#${updateCount})...`);

    const port = await getVPNPort();
    if (!port) {
      console.warn("⚠️ No VPN port available, skipping update");
      return;
    }

    const prefs = await getPreferences();
    const currentQbitPort = prefs.listen_port;

    if (currentQbitPort === port) {
      console.log(
        `ℹ️ Port already set correctly in qBittorrent (${port}), skipping update`
      );
      lastPort = port;
      return;
    }

    console.log(
      `🔄 Port needs update: qBittorrent=${currentQbitPort}, VPN=${port}`
    );

    const updateSuccess = await updateQbitPort(port);
    if (updateSuccess) {
      lastPort = port;
    }
  } catch (err) {
    console.error(`❌ Update cycle error: ${err.message}`);
  }
}

// Handle graceful shutdown
function setupGracefulShutdown() {
  process.on("SIGINT", () => {
    console.log("👋 Received SIGINT, shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("👋 Received SIGTERM, shutting down...");
    process.exit(0);
  });
}

(async () => {
  console.log("🚀 Starting qBittorrent Port Sync...");
  console.log(`📡 Gluetun: ${VPN_PORT_URL}`);
  console.log(`🌐 qBittorrent: ${QBITTORRENT_URL}`);
  console.log(`⏱️ Update interval: ${UPDATE_INTERVAL / 1000}s`);
  console.log(`🔌 Server port: ${SERVER_PORT}`);
  console.log(`🔐 Gluetun auth: ${GLUETUN_AUTH_METHOD}`);

  setupGracefulShutdown();

  const loginOk = await loginQbit();
  if (!loginOk) {
    console.warn("⚠️ Initial login failed, will retry on first update");
  }

  await updatePort();
  setInterval(updatePort, UPDATE_INTERVAL);
})();

app.get("/status", (_, res) => {
  const elapsed = (Date.now() - lastCheckTime) / 1000;
  const remaining = Math.max(0, UPDATE_INTERVAL / 1000 - elapsed);

  res.json({
    current_port: lastPort,
    next_update_in: Math.round(remaining),
    // is_logged_in: isLoggedIn,
    // update_count: updateCount,
    last_check: new Date(lastCheckTime).toISOString(),
  });
});

// TODO NEXT UPDATE
// app.get("/health", (_, res) => {
//   res.status(200).json({
//     status: "ok",
//     uptime: process.uptime(),
//     port_found: lastPort !== null,
//   });
// });

app.get("/force-update", async (_, res) => {
  console.log("🔄 Force update requested via API");
  await updatePort();

  res.json({
    success: true,
    message: "Update cycle triggered",
    port: lastPort,
  });
});

app.listen(SERVER_PORT, "0.0.0.0", () => {
  console.log(`🌐 HTTP server listening on http://0.0.0.0:${SERVER_PORT}`);
});

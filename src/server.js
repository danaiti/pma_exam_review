require("dotenv").config();

const express = require("express");
const path = require("path");
const { collectWrongQuestions } = require("./lmsCollector");
const { analyzeWrongQuestions } = require("./analyze");

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const githubDeviceSessions = new Map();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/github/device/start", async (req, res) => {
  try {
    const { clientId, scope } = req.body || {};
    const resolvedClientId = clientId || process.env.GITHUB_CLIENT_ID || process.env._COPILOT_CLIENT_ID;
    const resolvedScope = scope || process.env.GITHUB_DEVICE_SCOPE || "read:user user:email";

    if (!resolvedClientId) {
      return res.status(400).json({ error: "Missing GitHub OAuth App clientId (set GITHUB_CLIENT_ID/_COPILOT_CLIENT_ID or provide clientId)." });
    }

    const payload = new URLSearchParams();
    payload.set("client_id", resolvedClientId);
    payload.set("scope", resolvedScope);

    const response = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: payload.toString()
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      return res.status(400).json({ error: data.error_description || data.error || "Failed to start GitHub device login." });
    }

    githubDeviceSessions.set(data.device_code, {
      clientId: resolvedClientId,
      createdAt: Date.now()
    });

    return res.json({
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      verificationUriComplete: data.verification_uri_complete,
      expiresIn: data.expires_in,
      interval: data.interval
    });
  } catch (error) {
    const message = error && error.message ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/api/github/device/poll", async (req, res) => {
  try {
    const { deviceCode } = req.body || {};
    if (!deviceCode) {
      return res.status(400).json({ error: "deviceCode is required" });
    }

    const session = githubDeviceSessions.get(deviceCode);
    if (!session) {
      return res.status(404).json({ error: "Unknown or expired deviceCode. Start login again." });
    }

    const payload = new URLSearchParams();
    payload.set("client_id", session.clientId);
    payload.set("device_code", deviceCode);
    payload.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");

    const response = await fetch(GITHUB_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: payload.toString()
    });

    const data = await response.json();

    if (data.error === "authorization_pending") {
      return res.json({ status: "pending" });
    }

    if (data.error === "slow_down") {
      return res.json({ status: "slow_down" });
    }

    if (data.error) {
      githubDeviceSessions.delete(deviceCode);
      return res.status(400).json({ error: data.error_description || data.error });
    }

    githubDeviceSessions.delete(deviceCode);
    return res.json({
      status: "approved",
      accessToken: data.access_token,
      tokenType: data.token_type,
      scope: data.scope
    });
  } catch (error) {
    const message = error && error.message ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/api/collect", async (req, res) => {
  try {
    const { attemptUrl, email, password, authToken, cookies } = req.body || {};

    if (!attemptUrl) {
      return res.status(400).json({ error: "attemptUrl is required" });
    }

    const result = await collectWrongQuestions({
      attemptUrl,
      email,
      password,
      authToken,
      cookies
    });

    return res.json(result);
  } catch (error) {
    const message = error && error.message ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { wrongQuestions, apiKey, model, aiProvider, githubToken } = req.body || {};

    if (!Array.isArray(wrongQuestions) || wrongQuestions.length === 0) {
      return res.status(400).json({ error: "wrongQuestions must be a non-empty array" });
    }

    const analysis = await analyzeWrongQuestions({
      wrongQuestions,
      apiKey,
      model,
      aiProvider,
      githubToken
    });

    return res.json({ analysis });
  } catch (error) {
    const message = error && error.message ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/api/collect-analyze", async (req, res) => {
  try {
    const {
      attemptUrl,
      email,
      password,
      authToken,
      cookies,
      apiKey,
      model,
      aiProvider,
      githubToken
    } = req.body || {};

    if (!attemptUrl) {
      return res.status(400).json({ error: "attemptUrl is required" });
    }

    const collected = await collectWrongQuestions({
      attemptUrl,
      email,
      password,
      authToken,
      cookies
    });

    if (!Array.isArray(collected.wrongQuestions) || collected.wrongQuestions.length === 0) {
      return res.json({
        ...collected,
        analysis: []
      });
    }

    const analysis = await analyzeWrongQuestions({
      wrongQuestions: collected.wrongQuestions,
      apiKey,
      model,
      aiProvider,
      githubToken
    });

    return res.json({
      ...collected,
      analysis
    });
  } catch (error) {
    const message = error && error.message ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

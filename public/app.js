const form = document.getElementById("analyzerForm");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const analysisEl = document.getElementById("analysis");
const submitBtn = document.getElementById("submitBtn");
const aiProviderEl = document.getElementById("aiProvider");
const githubTokenEl = document.getElementById("githubToken");
const githubClientIdEl = document.getElementById("githubClientId");
const deviceStartBtn = document.getElementById("deviceStartBtn");
const devicePollBtn = document.getElementById("devicePollBtn");
const deviceStatusEl = document.getElementById("deviceStatus");

let currentDeviceCode = "";
let autoPollTimer = null;
const DEVICE_WAIT_TIMEOUT_MS = 3 * 60 * 1000;

function setDeviceStatus(message) {
  deviceStatusEl.textContent = message;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message) {
  statusEl.textContent = message;
}

function stopAutoPoll() {
  if (autoPollTimer) {
    clearInterval(autoPollTimer);
    autoPollTimer = null;
  }
}

function canAutoStartDeviceLogin() {
  return aiProviderEl.value === "github-copilot" && !githubTokenEl.value.trim() && !currentDeviceCode;
}

async function pollDeviceApproval() {
  if (!currentDeviceCode) {
    throw new Error("Device login not started.");
  }

  const response = await fetch("/api/github/device/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceCode: currentDeviceCode })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Device poll failed");
  }

  if (data.status === "pending" || data.status === "slow_down") {
    setDeviceStatus("Waiting for approval. Please complete authorization in browser...");
    return;
  }

  if (data.status === "approved" && data.accessToken) {
    githubTokenEl.value = data.accessToken;
    aiProviderEl.value = "github-copilot";
    currentDeviceCode = "";
    stopAutoPoll();
    setDeviceStatus("Approved. GitHub token has been filled into the form.");
    devicePollBtn.disabled = true;
    return;
  }

  setDeviceStatus("Unexpected response from server.");
}

async function startDeviceLogin({ autoPoll = true } = {}) {
  deviceStartBtn.disabled = true;
  setDeviceStatus("Starting GitHub device login...");

  try {
    const response = await fetch("/api/github/device/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: githubClientIdEl.value.trim() || undefined
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to start device login");
    }

    currentDeviceCode = data.deviceCode;
    devicePollBtn.disabled = false;

    const verifyLink = data.verificationUriComplete || data.verificationUri;
    if (verifyLink) {
      window.open(verifyLink, "_blank", "noopener,noreferrer");
    }
    setDeviceStatus(
      [
        "Open this URL and approve:",
        verifyLink,
        "",
        `User code: ${data.userCode}`,
        "",
        autoPoll ? "Auto-checking approval every 5s..." : "Then click 'Check Approval'."
      ].join("\n")
    );

    stopAutoPoll();
    if (autoPoll) {
      autoPollTimer = setInterval(async () => {
        if (!currentDeviceCode) {
          stopAutoPoll();
          return;
        }

        try {
          await pollDeviceApproval();
        } catch (error) {
          setDeviceStatus(`Error: ${error.message}`);
          stopAutoPoll();
        }
      }, 5000);
    }
  } finally {
    deviceStartBtn.disabled = false;
  }
}

async function ensureGitHubTokenReady() {
  if (aiProviderEl.value !== "github-copilot") {
    return;
  }

  if (githubTokenEl.value.trim()) {
    return;
  }

  if (!currentDeviceCode) {
    await startDeviceLogin({ autoPoll: true });
  }

  const startedAt = Date.now();
  setStatus("Waiting for GitHub approval...");

  while (!githubTokenEl.value.trim()) {
    if (Date.now() - startedAt > DEVICE_WAIT_TIMEOUT_MS) {
      throw new Error("GitHub authorization timed out. Approve in browser, then try again.");
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

function renderSummary(data) {
  summaryEl.innerHTML = `
    <div class="card">
      <p><strong>Final URL:</strong> ${escapeHtml(data.finalUrl || "N/A")}</p>
      <p><strong>Score:</strong> ${escapeHtml(data.scoreText || "N/A")}</p>
      <p><strong>Total wrong:</strong> ${Number(data.totalWrong || 0)}</p>
    </div>
  `;
}

function renderAnalysis(data) {
  if (!Array.isArray(data) || data.length === 0) {
    analysisEl.innerHTML = "<p class=\"muted\">No wrong answers found or no analysis returned.</p>";
    return;
  }

  analysisEl.innerHTML = data
    .map((item) => {
      const domains = (item.domainsToReview || []).map((d) => `<li>${escapeHtml(d)}</li>`).join("");
      const actions = (item.recommendedActions || []).map((a) => `<li>${escapeHtml(a)}</li>`).join("");

      return `
        <article class="card">
          <h3>Question ${escapeHtml(item.questionNumber ?? "?")}</h3>
          <p><strong>Why wrong:</strong> ${escapeHtml(item.whyWrong || "")}</p>
          <p><strong>Domains to review:</strong></p>
          <ul>${domains}</ul>
          <p><strong>Recommended actions:</strong></p>
          <ul>${actions}</ul>
        </article>
      `;
    })
    .join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  summaryEl.innerHTML = "";
  analysisEl.innerHTML = "";

  const payload = {
    attemptUrl: document.getElementById("attemptUrl").value.trim(),
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
    authToken: document.getElementById("authToken").value.trim(),
    cookies: document.getElementById("cookies").value.trim(),
    apiKey: document.getElementById("apiKey").value.trim(),
    model: document.getElementById("model").value.trim(),
    aiProvider: aiProviderEl.value,
    githubToken: githubTokenEl.value.trim()
  };

  submitBtn.disabled = true;
  setStatus("Preparing authentication...");

  try {
    await ensureGitHubTokenReady();
    payload.githubToken = githubTokenEl.value.trim();
    setStatus("Collecting wrong answers from LMS...");

    const response = await fetch("/api/collect-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to process request");
    }

    renderSummary(data);
    renderAnalysis(data.analysis || []);
    setStatus("Done");
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    submitBtn.disabled = false;
  }
});

deviceStartBtn.addEventListener("click", async () => {
  try {
    await startDeviceLogin({ autoPoll: true });
  } catch (error) {
    setDeviceStatus(`Error: ${error.message}`);
  }
});

devicePollBtn.addEventListener("click", async () => {
  try {
    devicePollBtn.disabled = true;
    setDeviceStatus("Checking approval status...");
    await pollDeviceApproval();
  } catch (error) {
    setDeviceStatus(`Error: ${error.message}`);
  } finally {
    devicePollBtn.disabled = !currentDeviceCode;
  }
});

aiProviderEl.addEventListener("change", async () => {
  if (!canAutoStartDeviceLogin()) {
    return;
  }

  try {
    await startDeviceLogin({ autoPoll: true });
  } catch (error) {
    setDeviceStatus(`Error: ${error.message}`);
  }
});

githubTokenEl.addEventListener("input", () => {
  if (githubTokenEl.value.trim()) {
    currentDeviceCode = "";
    stopAutoPoll();
    devicePollBtn.disabled = true;
  }
});

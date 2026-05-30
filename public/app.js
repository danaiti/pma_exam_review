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
  setStatus("Collecting wrong answers from LMS...");

  try {
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
    deviceStartBtn.disabled = true;
    setDeviceStatus("Starting GitHub device login...");

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
    setDeviceStatus(
      [
        "Open this URL and approve:",
        verifyLink,
        "",
        `User code: ${data.userCode}`,
        "",
        "Then click 'Check Approval'."
      ].join("\n")
    );
  } catch (error) {
    setDeviceStatus(`Error: ${error.message}`);
  } finally {
    deviceStartBtn.disabled = false;
  }
});

devicePollBtn.addEventListener("click", async () => {
  try {
    if (!currentDeviceCode) {
      throw new Error("Device login not started.");
    }

    devicePollBtn.disabled = true;
    setDeviceStatus("Checking approval status...");

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
      setDeviceStatus("Waiting for approval. Please complete authorization in browser, then check again.");
      return;
    }

    if (data.status === "approved" && data.accessToken) {
      githubTokenEl.value = data.accessToken;
      aiProviderEl.value = "github-copilot";
      setDeviceStatus("Approved. GitHub token has been filled into the form.");
      currentDeviceCode = "";
      return;
    }

    setDeviceStatus("Unexpected response from server.");
  } catch (error) {
    setDeviceStatus(`Error: ${error.message}`);
  } finally {
    devicePollBtn.disabled = !currentDeviceCode;
  }
});

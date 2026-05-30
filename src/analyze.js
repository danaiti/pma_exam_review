const OpenAI = require("openai");

function createPrompt(wrongQuestions) {
  return [
    "You are a learning coach for exam review.",
    "Analyze each wrong question and return strict JSON with this schema:",
    "{ items: [{ questionNumber: number|null, whyWrong: string, domainsToReview: string[], recommendedActions: string[] }] }",
    "Focus on:",
    "1) Why the selected answer is likely wrong compared with the correct answer",
    "2) Which knowledge domains the learner should review",
    "3) Concrete next actions to improve",
    "Keep each whyWrong under 80 words.",
    "",
    "Wrong questions:",
    JSON.stringify(wrongQuestions, null, 2)
  ].join("\n");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

async function analyzeWrongQuestions({ wrongQuestions, apiKey, model, aiProvider, githubToken }) {
  const resolvedModel = model || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const resolvedProvider = aiProvider || "openai";

  if (resolvedProvider === "github-copilot") {
    return analyzeWithGitHubCopilot({
      wrongQuestions,
      model: resolvedModel,
      githubToken
    });
  }

  return analyzeWithOpenAI({
    wrongQuestions,
    apiKey,
    model: resolvedModel
  });
}

async function analyzeWithOpenAI({ wrongQuestions, apiKey, model }) {
  const resolvedKey = apiKey || process.env.OPENAI_API_KEY;
  if (!resolvedKey) {
    throw new Error("OPENAI_API_KEY is missing. Provide it in UI or .env file.");
  }

  const client = new OpenAI({ apiKey: resolvedKey });

  const response = await client.responses.create({
    model,
    input: createPrompt(wrongQuestions),
    temperature: 0.2
  });

  const outputText = response.output_text || "";
  const parsed = safeJsonParse(outputText);

  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("AI did not return valid JSON. Try again or switch model.");
  }

  return parsed.items;
}

async function analyzeWithGitHubCopilot({ wrongQuestions, model, githubToken }) {
  const resolvedToken = githubToken || process.env.GITHUB_ACCESS_TOKEN;
  if (!resolvedToken) {
    throw new Error("GitHub token is missing. Use Device Login first.");
  }

  const endpoint = process.env.GITHUB_COPILOT_CHAT_URL || "https://api.githubcopilot.com/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolvedToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Copilot-Integration-Id": "lms-wrong-answer-analyzer"
    },
    body: JSON.stringify({
      model: model || process.env.GITHUB_COPILOT_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "user",
          content: createPrompt(wrongQuestions)
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const detail = data && data.error ? JSON.stringify(data.error) : "GitHub Copilot API error";
    throw new Error(detail);
  }

  const outputText = data?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(outputText);

  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("Copilot did not return valid JSON. Try again or switch model.");
  }

  return parsed.items;
}

module.exports = {
  analyzeWrongQuestions
};

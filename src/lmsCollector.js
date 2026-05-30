const { chromium } = require("playwright");

function parseCookies(rawCookieString, domain) {
  if (!rawCookieString || typeof rawCookieString !== "string") {
    return [];
  }

  return rawCookieString
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((kv) => {
      const eq = kv.indexOf("=");
      if (eq === -1) {
        return null;
      }

      const name = kv.slice(0, eq).trim();
      const value = kv.slice(eq + 1).trim();

      if (!name) {
        return null;
      }

      return {
        name,
        value,
        domain,
        path: "/"
      };
    })
    .filter(Boolean);
}

function sanitizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

async function loginIfNeeded(page, email, password) {
  const url = page.url();

  if (!url.includes("/#/auth/login")) {
    return;
  }

  if (!email || !password) {
    throw new Error("The page redirected to login, but email/password were not provided.");
  }

  await page.fill('input[type="text"], input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign In")');

  await page.waitForTimeout(1500);
}

async function extractWrongQuestions(page) {
  return page.evaluate(() => {
    function text(el) {
      return (el?.innerText || "").replace(/\s+/g, " ").trim();
    }

    function getQuestionNumber(card) {
      const heading = card.querySelector("h3");
      const match = text(heading).match(/Question\s+(\d+)/i);
      return match ? Number(match[1]) : null;
    }

    function getQuestionText(card) {
      const line = Array.from(card.querySelectorAll("*"))
        .map((node) => text(node))
        .find((value) => /^Question:/i.test(value));
      return line ? line.replace(/^Question:\s*/i, "") : "";
    }

    function getTags(card) {
      const tagsLine = Array.from(card.querySelectorAll("*"))
        .map((node) => text(node))
        .find((value) => /^Tags:/i.test(value));

      if (!tagsLine) {
        return [];
      }

      return tagsLine
        .replace(/^Tags:\s*/i, "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    function optionRows(card) {
      const rows = [];
      const candidates = card.querySelectorAll("div");

      for (const node of candidates) {
        const checkbox = node.querySelector('input[type="checkbox"]');
        if (!checkbox) {
          continue;
        }

        const rowText = text(node);
        if (!rowText || rowText.length < 2) {
          continue;
        }

        rows.push({
          text: rowText,
          checked: checkbox.checked,
          isCorrect: /Correct Answer/i.test(rowText)
        });
      }

      return rows;
    }

    const cards = Array.from(document.querySelectorAll("h3"))
      .filter((h) => /Question\s+\d+/i.test(text(h)))
      .map((h) => h.closest("div"))
      .filter(Boolean);

    const wrongQuestions = [];

    for (const card of cards) {
      const options = optionRows(card);
      if (!options.length) {
        continue;
      }

      const selected = options.find((o) => o.checked);
      const correct = options.find((o) => o.isCorrect);

      if (!selected || !correct) {
        continue;
      }

      if (selected.text === correct.text) {
        continue;
      }

      wrongQuestions.push({
        questionNumber: getQuestionNumber(card),
        questionText: getQuestionText(card),
        selectedAnswer: selected.text,
        correctAnswer: correct.text,
        tags: getTags(card)
      });
    }

    const scoreText = text(document.body).match(/Result:\s*\d+%\s*\(\d+\/\d+\)/i)?.[0] || null;

    return {
      scoreText,
      wrongQuestions,
      totalWrong: wrongQuestions.length
    };
  });
}

async function collectWrongQuestions({
  attemptUrl,
  email,
  password,
  authToken,
  cookies
}) {
  const url = new URL(attemptUrl);
  const domain = `.${url.hostname.replace(/^www\./, "")}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  if (authToken) {
    await context.setExtraHTTPHeaders({
      Authorization: `Token ${authToken}`
    });
  }

  const cookieList = parseCookies(cookies, domain);
  if (cookieList.length > 0) {
    await context.addCookies(cookieList);
  }

  const page = await context.newPage();

  try {
    await page.goto(attemptUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await loginIfNeeded(page, email, password);

    if (page.url() !== attemptUrl) {
      await page.goto(attemptUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    }

    await page.waitForTimeout(2500);

    if (page.url().includes("/#/auth/login")) {
      throw new Error("Still on login page. Check credentials/token/cookies.");
    }

    const extracted = await extractWrongQuestions(page);

    return {
      finalUrl: page.url(),
      scoreText: extracted.scoreText,
      totalWrong: extracted.totalWrong,
      wrongQuestions: extracted.wrongQuestions
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = {
  collectWrongQuestions
};

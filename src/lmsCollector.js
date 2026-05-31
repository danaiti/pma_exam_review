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
  console.log("[Login] Current URL:", url);

  // Check for multiple possible login page patterns
  const possibleLoginPatterns = [
    '/#/auth/login',
    '/login',
    'sign-in',
    'sign_in'
  ];
  
  const isOnLoginPage = possibleLoginPatterns.some(pattern => url.includes(pattern));
  
  console.log("[Login] Is on login page (URL check):", isOnLoginPage);
  console.log("[Login] URL patterns checked:", possibleLoginPatterns);

  if (!isOnLoginPage) {
    // Even if URL doesn't look like login, check if login form exists on page
    const loginFormExists = await page.$('input#email') || await page.$('input#password');
    console.log("[Login] Login form found on page:", !!loginFormExists);
    
    if (!loginFormExists) {
      console.log("[Login] Not on login page and no login form found, skipping authentication");
      return;
    }
    
    console.log("[Login] No obvious login URL, but login form found on page - attempting login");
  }

  if (!email || !password) {
    throw new Error("The page redirected to login, but email/password were not provided.");
  }

  console.log("[Login] Email provided:", email ? "yes (length: " + email.length + ")" : "no");
  console.log("[Login] Password provided:", password ? "yes (length: " + password.length + ")" : "no");

  // Prioritize ID-based selectors for this specific LMS form
  const emailSelectors = [
    'input#email',
    'input[id="email"]',
    'input[type="email"]',
    'input[name*="email"]',
    'input[id*="email"]',
    'input[placeholder*="Email"]',
    'input[placeholder*="email"]'
  ];

  const passwordSelectors = [
    'input#password',
    'input[id="password"]',
    'input[type="password"]',
    'input[name*="password"]',
    'input[id*="password"]',
    'input[placeholder*="Password"]'
  ];

  const submitSelectors = [
    'button#sign_in_button',
    'button[id="sign_in_button"]',
    'button[type="submit"]',
    'button:has-text("Sign In")',
    'button:has-text("Sign in")',
    'button:has-text("Login")',
    'input[type="submit"]'
  ];

  async function findAndFill(selectors, value, fieldName) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          console.log(`[Login] Found ${fieldName} field with selector: ${sel}`);
          const oldValue = await el.evaluate(el => el.value);
          console.log(`[Login] Current value before fill: "${oldValue}"`);
          
          await el.fill(value);
          
          const newValue = await el.evaluate(el => el.value);
          console.log(`[Login] Value after fill: "${newValue}"`);
          console.log(`[Login] Value correctly set: ${newValue === value}`);
          
          return true;
        }
      } catch (e) {
        console.log(`[Login] Selector "${sel}" failed: ${e.message}`);
      }
    }
    return false;
  }

  const filledEmail = await findAndFill(emailSelectors, email, "email");
  if (!filledEmail) {
    // Debug: Log all input fields on page
    const allInputs = await page.$$eval('input', inputs => 
      inputs.map(i => ({ id: i.id, name: i.name, type: i.type, placeholder: i.placeholder, value: i.value }))
    );
    console.log("[Login] Available input fields:", JSON.stringify(allInputs, null, 2));
    throw new Error("Could not find email input field. Check form structure. Available inputs logged above.");
  }

  const filledPassword = await findAndFill(passwordSelectors, password, "password");
  if (!filledPassword) {
    // Debug: Log all input fields on page
    const allInputs = await page.$$eval('input', inputs => 
      inputs.map(i => ({ id: i.id, name: i.name, type: i.type, placeholder: i.placeholder, value: i.value }))
    );
    console.log("[Login] Available input fields:", JSON.stringify(allInputs, null, 2));
    throw new Error("Could not find password input field. Check form structure. Available inputs logged above.");
  }

  // Find and click the submit button
  console.log("[Login] Looking for submit button...");
  let submitClicked = false;
  for (const sel of submitSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        console.log(`[Login] Found submit button with selector: ${sel}`);
        
        // Check button state
        const isEnabled = await btn.evaluate(el => !el.disabled);
        const isVisible = await btn.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
        console.log(`[Login] Button enabled: ${isEnabled}, visible: ${isVisible}`);
        
        // Capture page state before click
        const urlBefore = page.url();
        console.log("[Login] URL before submit:", urlBefore);

        // Wait for navigation/route change and button click in parallel
        try {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch((e) => {
              console.log("[Login] waitForNavigation timeout (expected for SPA):", e.message);
            }),
            page.waitForLoadState('networkidle', { timeout: 15000 }).catch((e) => {
              console.log("[Login] waitForLoadState timeout (expected for SPA):", e.message);
            }),
            btn.click()
          ]);
        } catch (e) {
          console.log("[Login] Promise.all error:", e.message);
        }

        submitClicked = true;
        break;
      }
    } catch (e) {
      console.log(`[Login] Submit selector "${sel}" error:`, e.message);
    }
  }

  if (!submitClicked) {
    // Debug: Log all buttons on page
    const allButtons = await page.$$eval('button', buttons => 
      buttons.map(b => ({ id: b.id, type: b.type, text: b.textContent?.trim(), disabled: b.disabled }))
    );
    console.log("[Login] Available buttons:", JSON.stringify(allButtons, null, 2));
    throw new Error("Could not find or click sign-in button. Available buttons logged above.");
  }

  console.log("[Login] Submit button clicked, waiting for page transition...");

  // Give the SPA more time to process the login and redirect
  await page.waitForTimeout(3000);
  const urlAfterWait = page.url();
  console.log("[Login] URL after 3s wait:", urlAfterWait);

  // Check for error messages on page
  const errorMessages = await page.$$eval('[role="alert"], .error, .alert-error, [class*="error"]', elements => 
    elements.map(el => el.textContent?.trim()).filter(Boolean)
  ).catch(() => []);
  
  if (errorMessages.length > 0) {
    console.log("[Login] Error messages found on page:", errorMessages);
  }

  // Wait for successful redirect away from login or a recognizable app shell element
  console.log("[Login] Checking for successful login...");
  try {
    await page.waitForFunction(() => {
      const url = window.location.href || '';
      const isNotLoginPage = !url.includes('/#/auth/login') && !url.includes('/login');
      const hasAppShell = !!document.querySelector('a[href="#/student/enrolls"], nav');
      
      console.log(`[Login] Check - URL no login: ${isNotLoginPage}, Has app shell: ${hasAppShell}, URL: ${url}`);
      
      return isNotLoginPage || hasAppShell;
    }, { timeout: 10000 });
    
    console.log("[Login] Login successful!");
  } catch (err) {
    console.log("[Login] Login verification failed:", err.message);
    
    // On failure, capture debug artifacts to help diagnose
    const fs = require('fs');
    const debugDir = './debug';
    try { if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir); } catch(e){}
    try { await page.screenshot({ path: `${debugDir}/login-failed.png`, fullPage: true }); console.log("[Debug] Screenshot saved"); } catch (e) { console.log("[Debug] Screenshot error:", e.message); }
    try { const html = await page.content(); fs.writeFileSync(`${debugDir}/login-failed.html`, html); console.log("[Debug] HTML saved"); } catch (e) { console.log("[Debug] HTML save error:", e.message); }
    
    // Check current URL to provide more helpful error message
    const currentUrl = page.url();
    console.log("[Login] Final URL after failed verification:", currentUrl);
    
    if (currentUrl.includes('/#/auth/login') || currentUrl.includes('/login')) {
      throw new Error('Login failed: Still on login page after submit. Check that email and password are correct. Debug artifacts saved to ./debug/');
    } else {
      throw new Error(`Login verification failed. Current URL: ${currentUrl}. Debug artifacts saved to ./debug/`);
    }
  }
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

  console.log("[Collector] Starting collection with URL:", attemptUrl);
  console.log("[Collector] Domain:", domain);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  if (authToken) {
    const headerValue = /\s/.test(authToken) ? authToken : `Token ${authToken}`;
    await context.setExtraHTTPHeaders({
      Authorization: headerValue
    });
    console.log("[Collector] Auth token set");
  }

  const cookieList = parseCookies(cookies, domain);
  if (cookieList.length > 0) {
    await context.addCookies(cookieList);
    console.log("[Collector] Cookies added:", cookieList.length);
  }

  const page = await context.newPage();

  try {
    console.log("[Collector] Navigating to attempt URL...");
    await page.goto(attemptUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    console.log("[Collector] Page loaded, URL:", page.url());
    
    // Wait a bit for any redirects to happen
    console.log("[Collector] Waiting for any redirects...");
    await page.waitForTimeout(2000);
    console.log("[Collector] URL after redirect wait:", page.url());
    
    await loginIfNeeded(page, email, password);

    if (page.url() !== attemptUrl) {
      console.log("[Collector] Current URL does not match attempt URL, navigating back...");
      console.log("[Collector] Current URL:", page.url());
      console.log("[Collector] Attempt URL:", attemptUrl);
      await page.goto(attemptUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    }

    await page.waitForTimeout(2500);

    console.log("[Collector] Final URL:", page.url());
    
    // Check if page has login form (indicating authentication failed)
    const hasLoginForm = await page.$('input#email') !== null;
    console.log("[Collector] Page has login form:", hasLoginForm);
    
    if (hasLoginForm) {
      throw new Error("Still on login page or page requires authentication. Check credentials/token/cookies.");
    }

    console.log("[Collector] Extracting wrong questions...");
    const extracted = await extractWrongQuestions(page);
    console.log("[Collector] Extracted:", extracted.totalWrong, "wrong questions");

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

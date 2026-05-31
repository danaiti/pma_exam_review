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
      // Find all checkboxes inside this card and resolve their full option row
      const checkboxes = card.querySelectorAll('input[type="checkbox"]');

      for (const checkbox of checkboxes) {
        // Climb up from the checkbox to find the nearest container that represents
        // the whole option row (a direct or near-direct child of the card).
        let rowNode = checkbox.parentElement;
        while (rowNode && rowNode !== card && rowNode.parentElement !== card) {
          rowNode = rowNode.parentElement;
        }

        // Fallback: if we didn't find a suitable row container, use the closest div
        if (!rowNode || rowNode === card) {
          rowNode = checkbox.closest('div') || checkbox.parentElement;
        }

        const rowText = text(rowNode);
        const rowHtml = (rowNode && rowNode.outerHTML) ? rowNode.outerHTML.slice(0, 800) : null;
        // Detect explicit "wrong" styling class (e.g., Tailwind's bg-red-200)
        function nodeHasClass(n, cls) {
          if (!n) return false;
          try {
            const cn = n.className || '';
            if (typeof cn === 'string' && cn.split(/\s+/).includes(cls)) return true;
          } catch (e) {}
          for (const child of Array.from(n.querySelectorAll('*'))) {
            try {
              const ccn = child.className || '';
              if (typeof ccn === 'string' && ccn.split(/\s+/).includes(cls)) return true;
            } catch (e) {}
          }
          return false;
        }
        const isWrong = nodeHasClass(rowNode, 'bg-red-200') || nodeHasClass(rowNode, '!bg-red-200');
        if (!rowText || rowText.length < 2) {
          continue;
        }

        rows.push({
          text: rowText,
          checked: checkbox.checked,
          isCorrect: /Correct Answer/i.test(rowText),
          isWrong,
          rowHtml
        });
      }

      return rows;
    }

    // Find question containers. Some LMS pages render a numbered H3 like "Question 1",
    // while others render a plain "Question:" label inside a div. Support both patterns.
    const cardsByHeader = Array.from(document.querySelectorAll("h3"))
      .filter((h) => /Question\s+\d+/i.test(text(h)))
      .map((h) => h.closest("div"))
      .filter(Boolean);

    const cardsByLabel = Array.from(document.querySelectorAll("*")).
      filter((n) => /^Question:/i.test(text(n)))
      .map((n) => n.closest("div"))
      .filter(Boolean);

    // Merge and deduplicate
    const cardsSet = new Set();
    const cards = [];
    for (const c of [...cardsByHeader, ...cardsByLabel]) {
      if (!cardsSet.has(c)) {
        cardsSet.add(c);
        cards.push(c);
      }
    }

    const wrongQuestions = [];
    const diagnostics = {
      cardsCount: cards.length,
      cardsByHeaderCount: cardsByHeader.length,
      cardsByLabelCount: cardsByLabel.length,
      totalCheckboxes: 0,
      cards: []
    };

    for (const card of cards) {
      const options = optionRows(card);
      if (!options.length) {
        continue;
      }

      const selectedIndex = options.findIndex((o) => o.checked);
      const correctIndex = options.findIndex((o) => o.isCorrect);

      diagnostics.totalCheckboxes += options.length;

      diagnostics.cards.push({
        questionNumber: getQuestionNumber(card),
        questionText: getQuestionText(card),
        optionCount: options.length,
        selectedIndex,
        correctIndex,
        cardHtml: (card && card.outerHTML) ? card.outerHTML.slice(0, 1500) : null,
        options: options.map((o) => ({ text: o.text, checked: !!o.checked, isCorrect: !!o.isCorrect, isWrong: !!o.isWrong, rowHtml: o.rowHtml }))
      });

      const selected = selectedIndex !== -1 ? options[selectedIndex] : null;
      const correct = correctIndex !== -1 ? options[correctIndex] : null;

      // Consider it wrong if the selected option is marked with the "wrong" class
      // (bg-red-200) or if we can identify a different correct option and the texts differ.
      const selectedIsWrong = selected ? !!selected.isWrong : false;
      if (!selected) {
        // nothing selected, skip
        continue;
      }

      if (selectedIsWrong || (correct && selected.text !== correct.text)) {
        wrongQuestions.push({
          questionNumber: getQuestionNumber(card),
          questionText: getQuestionText(card),
          selectedAnswer: selected.text,
          correctAnswer: correct ? correct.text : null,
          tags: getTags(card)
        });
      }
    }

    const scoreText = text(document.body).match(/Result:\s*\d+%\s*\(\d+\/\d+\)/i)?.[0] || null;

    return {
      scoreText,
      wrongQuestions,
      totalWrong: wrongQuestions.length,
      diagnostics
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
    // Verbose diagnostics to help debug parsing issues
    try {
      console.log("[Collector][DEBUG] scoreText:", extracted.scoreText);
      console.log("[Collector][DEBUG] cards found:", extracted.diagnostics?.cardsCount ?? 0);
      console.log("[Collector][DEBUG] diagnostics summary:", JSON.stringify(extracted.diagnostics, null, 2));

      // Also print a human-readable per-card summary showing Question / Selected / Correct
      if (extracted.diagnostics && Array.isArray(extracted.diagnostics.cards)) {
        for (const c of extracted.diagnostics.cards) {
          const qnum = c.questionNumber || '(no number)';
          const qtext = c.questionText || '(no question text)';
          let selected = '(none)';
          let correct = '(none)';

          if (typeof c.selectedIndex === 'number' && c.selectedIndex >= 0 && c.options && c.options[c.selectedIndex]) {
            selected = c.options[c.selectedIndex].text || '(empty)';
          } else {
            // Try to find any option with checked true
            const sel = (c.options || []).find((o) => o.checked);
            if (sel) selected = sel.text || '(empty)';
          }

          if (typeof c.correctIndex === 'number' && c.correctIndex >= 0 && c.options && c.options[c.correctIndex]) {
            correct = c.options[c.correctIndex].text || '(empty)';
          } else {
            const corr = (c.options || []).find((o) => o.isCorrect);
            if (corr) correct = corr.text || '(empty)';
          }

          // Detect if the selected option was marked wrong via styling
          let selectedIsWrong = false;
          const selObj = (c.options || []).find((o) => o.text === selected);
          if (selObj && selObj.isWrong) selectedIsWrong = true;

          console.log('[Collector][CARD] Question', qnum + ':', qtext);
          console.log('[Collector][CARD]   Selected ->', selected + (selectedIsWrong ? '  <-- MARKED WRONG' : ''));
          console.log('[Collector][CARD]   Correct  ->', correct);
        }
      }
    } catch (e) {
      console.log("[Collector][DEBUG] Failed to print diagnostics:", e && e.message);
    }

    // If nothing was found, save a debug snapshot (HTML + screenshot) to help
    // diagnose parsing mismatches on real LMS pages.
    try {
      if (extracted.totalWrong === 0) {
        const fs = require('fs');
        const debugDir = './debug';
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);
        const ts = Date.now();
        try {
          const html = await page.content();
          fs.writeFileSync(`${debugDir}/no-wrong-${ts}.html`, html);
        } catch (e) {
          console.log('[Collector] Failed to save debug HTML:', e && e.message);
        }

        try {
          await page.screenshot({ path: `${debugDir}/no-wrong-${ts}.png`, fullPage: true });
        } catch (e) {
          console.log('[Collector] Failed to save debug screenshot:', e && e.message);
        }

        console.log('[Collector] Debug snapshot saved for empty extraction:', `${debugDir}/no-wrong-${ts}.*`);
      }
    } catch (e) {
      console.log('[Collector] Debug snapshot error:', e && e.message);
    }

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

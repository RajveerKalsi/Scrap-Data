const puppeteer = require("puppeteer");
const {
  sleep,
  loginInstagramWithVerification,
  loadCredentialsFromEnv,
} = require("./common");

async function sendInstagramDM(username, message) {
  const { username: igUser, password: igPass } = loadCredentialsFromEnv();

  const browser = await puppeteer.launch({
    headless: false, // set true in production
    defaultViewport: null,
    args: ["--start-maximized"],
  });

  const page = await browser.newPage();

  console.log("🌐 Logging into Instagram...");
  await loginInstagramWithVerification(page, igUser, igPass);

  console.log("💬 Opening Instagram Direct...");
  await page.goto("https://www.instagram.com/direct/inbox/", {
    waitUntil: "networkidle2",
  });
  await sleep(6000); // give UI some breathing time

  // --- STEP 0: Handle "Turn On Notifications" popup ---
  try {
    console.log("🔍 Checking for notification popup...");
    await sleep(3000);

    const buttons = await page.$$("div._a9-z button");
    for (const btn of buttons) {
      const text = await page.evaluate((el) => el.innerText.trim(), btn);
      if (text.toLowerCase().includes("not now")) {
        await btn.click();
        console.log("⚙️ Dismissed 'Turn on Notifications' popup.");
        await sleep(2000);
        break;
      }
    }
    if (buttons.length === 0) console.log("✅ No notification popup detected.");
  } catch (err) {
    console.warn("⚠️ Could not dismiss notification popup:", err.message);
  }

  // --- STEP 1: Click “Send message” button ---
  console.log("🪄 Finding 'Send message' button...");
  await page.waitForSelector('div[role="button"]', { timeout: 30000 });
  const buttons = await page.$$('div[role="button"]');
  let sendBtnFound = false;

  for (const btn of buttons) {
    const text = await page.evaluate(
      (el) => el.innerText?.toLowerCase() || "",
      btn
    );
    if (text.includes("send message")) {
      await btn.click();
      sendBtnFound = true;
      console.log("✅ Clicked 'Send message' button");
      break;
    }
  }

  if (!sendBtnFound) {
    console.log("⚠️ Could not find 'Send message' — maybe already in DM view.");
  }

  // --- STEP 2: Search for user ---
  console.log(`🔍 Searching for user: ${username}`);
  await page.waitForSelector(
    'input[name="queryBox"], input[placeholder="Search..."]',
    { timeout: 20000 }
  );
  const searchBox =
    (await page.$('input[name="queryBox"]')) ||
    (await page.$('input[placeholder="Search..."]'));
  await searchBox.click({ clickCount: 3 });
  await searchBox.type(username, { delay: 100 });
  await sleep(3000);

  // --- STEP 3: Select user ---
  try {
    console.log(`🔍 Searching search results for user: ${username}`);

    // Wait for search results to appear
    await page.waitForSelector('div[role="dialog"] span', { timeout: 15000 });

    // Find the username in any nested span
    const userElements = await page.$$('div[role="dialog"] span');

    let userFound = false;
    for (const el of userElements) {
      const text = await page.evaluate((e) => e.textContent.trim(), el);
      if (text.toLowerCase() === username.toLowerCase()) {
        await el.click();
        console.log(`✅ Selected user: ${username}`);
        userFound = true;
        break;
      }
    }

    if (!userFound) {
      throw new Error(`User ${username} not found in search results`);
    }

    await sleep(1500);
  } catch (err) {
    console.error(`❌ Could not select user: ${username} — ${err.message}`);
    await browser.close();
    return;
  }

  // --- STEP 4: Start chat ---
  await sleep(1500);
  const chatButtons = await page.$$('div[role="button"]');
  for (const btn of chatButtons) {
    const text = await page.evaluate(
      (el) => el.innerText?.toLowerCase() || "",
      btn
    );
    if (text.includes("chat") || text.includes("next")) {
      await btn.click();
      console.log("💬 Chat window opened.");
      break;
    }
  }

  // --- STEP 5: Type and send message ---
  console.log("✍️ Typing message...");
  await sleep(3000);
  const editableSelector = 'div[contenteditable="true"][role="textbox"]';
  await page.waitForSelector(editableSelector, { timeout: 20000 });

  await page.type(editableSelector, message, { delay: 40 });
  await page.keyboard.press("Enter");

  console.log(`✅ Message sent to ${username}: "${message}"`);

  // Optional: keep browser open for review
  await browser.close();
}

sendInstagramDM(
  "rajveer_0713",
  "Hey Rajveer 👋 This is an automated test message!"
).catch(console.error);

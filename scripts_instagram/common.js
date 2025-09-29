// common.js
const Papa = require("papaparse");
const fs = require("fs");
require("dotenv").config();

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function loginInstagram(page, username, password) {
  await page.goto("https://www.instagram.com/accounts/login/", {
    waitUntil: "networkidle2",
  });

  await page.waitForSelector("input[name='username']", { timeout: 15000 });
  await page.type("input[name='username']", username, { delay: 120 });
  await page.type("input[name='password']", password, { delay: 120 });

  await Promise.all([
    page.click("button[type='submit']"),
    page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
      .catch(() => {}),
  ]);

  try {
    const [saveBtn] = await page.$x(
      "//button[contains(., 'Save') or contains(., 'Not Now')]"
    );
    if (saveBtn) {
      await saveBtn.click();
      await sleep(1200);
    }
  } catch (err) {
    console.warn("⚠️ Could not handle 'Save Login Info' prompt:", err);
  }
}

async function loginInstagramWithVerification(page, username, password) {
  await page.goto("https://www.instagram.com/accounts/login/", {
    waitUntil: "domcontentloaded", // safer than networkidle2
    timeout: 60000,
  });

  await page.waitForSelector("input[name='username']", { timeout: 20000 });
  await page.type("input[name='username']", username, { delay: 120 });
  await page.type("input[name='password']", password, { delay: 120 });

  await Promise.all([
    page.click("button[type='submit']"),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {}),
  ]);

  console.log("⏳ Waiting for possible verification code input... (you have ~60s to type it)");
  try {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 });
  } catch {
    console.warn("⚠️ No navigation detected after 60s — continuing anyway.");
  }

  try {
    const [saveBtn] = await page.$x("//button[contains(., 'Save') or contains(., 'Not Now')]");
    if (saveBtn) {
      await saveBtn.click();
      await sleep(1200);
    }
  } catch (err) {
    console.warn("⚠️ Could not handle 'Save Login Info' prompt:", err);
  }
}


function saveToCSV(data, filename = "instagram_posts.csv") {
  const csv = Papa.unparse(data);
  fs.writeFileSync(filename, csv, "utf8");
  console.log(`💾 Results saved to ${filename}`);
}

function loadKeywordsFromCSV(filepath = "keywords.csv") {
  const file = fs.readFileSync(filepath, "utf8");
  const parsed = Papa.parse(file, { header: true });
  return parsed.data.map((row) => row.keywords).filter(Boolean);
}

function loadCredentialsFromEnv() {
  const username = process.env.IG_USERNAME;
  const password = process.env.IG_PASSWORD;
  if (!username || !password) {
    throw new Error("❌ IG_USERNAME or IG_PASSWORD not found in .env");
  }
  return { username, password };
}

async function typeMultilineMessage(page, selector, message) {
  const lines = message.split("\n");
  for (let i = 0; i < lines.length; i++) {
    await page.type(selector, lines[i], { delay: 20 });
    if (i !== lines.length - 1) {
      await page.keyboard.down("Shift");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Shift");
    }
  }
}



module.exports = {
  sleep,
  loginInstagram,
  loginInstagramWithVerification,
  saveToCSV,
  loadKeywordsFromCSV,
  loadCredentialsFromEnv,
  typeMultilineMessage,
};

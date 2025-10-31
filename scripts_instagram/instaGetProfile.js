const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { loginInstagramWithVerification, loadCredentialsFromEnv, sleep } = require("./common");

(async () => {
  const { username, password } = loadCredentialsFromEnv();
  const keyword = "parentalhack";
  const OUTPUT_FILE = path.join(__dirname, "usernames.csv");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // 1️⃣ Login
  console.log("🔐 Logging into Instagram...");
  await loginInstagramWithVerification(page, username, password);

  // 2️⃣ Navigate to keyword search
  const searchUrl = `https://www.instagram.com/explore/search/keyword/?q=${keyword}`;
  console.log(`🔎 Navigating to ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "networkidle2" });

  // 3️⃣ Click the first post
  await page.waitForSelector('a[href^="/p/"], a[href^="/reel/"]', { timeout: 20000 });
  console.log("📸 Clicking the first post...");
  await page.evaluate(() => {
    const firstCard = document.querySelector('a[href^="/p/"], a[href^="/reel/"]');
    if (firstCard) firstCard.click();
  });

  // Wait for dialog to appear
  await page.waitForSelector('article, div[role="dialog"]', { timeout: 15000 });
  console.log("📄 Post dialog opened!");

  const usernames = new Set();

  // 4️⃣–6️⃣ Loop through 10 posts
  for (let i = 0; i < 10; i++) {
    try {
      // Wait for username span to appear
      await page.waitForSelector('div[role="dialog"] span', { timeout: 10000 });

      // Extract username from the dialog
      const user = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('div[role="dialog"] span'));
        const usernameSpan = spans.find(
          (el) =>
            el.innerText &&
            el.innerText.length < 30 && // filter out long captions
            !el.innerText.includes("•") &&
            !el.innerText.includes("Follow") &&
            /^[A-Za-z0-9._]+$/.test(el.innerText)
        );
        return usernameSpan ? usernameSpan.innerText.trim() : null;
      });

      if (user) {
        usernames.add(user);
        console.log(`✅ [${i + 1}] Username scraped: ${user}`);
      } else {
        console.log(`⚠️ [${i + 1}] No username found on this post.`);
      }

      // Click the "Next" button
      const nextButton = await page.$('button._abl- svg[aria-label="Next"]');
      if (!nextButton) {
        console.log("🚫 No next button found — probably last post.");
        break;
      }

      await nextButton.click();
      console.log("➡️ Moved to next post...");
      await sleep(4000); // wait for next post to load
    } catch (err) {
      console.log(`❌ Error on iteration ${i + 1}: ${err.message}`);
      break;
    }
  }

  // 7️⃣ Save results to CSV
  if (usernames.size > 0) {
    const csvData = Array.from(usernames).join("\n");
    fs.writeFileSync(OUTPUT_FILE, csvData);
    console.log(`💾 Saved ${usernames.size} usernames to ${OUTPUT_FILE}`);
  } else {
    console.log("⚠️ No usernames scraped.");
  }

  await browser.close();
})();

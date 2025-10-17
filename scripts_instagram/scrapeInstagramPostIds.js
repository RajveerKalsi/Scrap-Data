//scrapeInstagramPostIds.js
const puppeteer = require("puppeteer");
const {
  sleep,
  loginInstagram,
  saveToCSV,
  loadKeywordsFromCSV,
  loadCredentialsFromEnv,
  loginInstagramWithVerification,
} = require("./common");

const MAX_POSTS_DEFAULT = 190;

async function launchBrowser() {
  return puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

async function openSearchPage(page, keyword) {
  const searchUrl = `https://www.instagram.com/explore/search/keyword/?q=%23${encodeURIComponent(
    keyword
  )}`;
  await page.goto(searchUrl, { waitUntil: "networkidle2" });

  await page
    .waitForSelector("a[href^='/p/']", { timeout: 15000 })
    .catch(() => console.warn(`⚠️ No posts initially for #${keyword}`));
}

async function extractPosts(page, seen, keyword) {
  const newPosts = await page.$$eval("a[href^='/p/']", (anchors) =>
    anchors.map((a) => a.getAttribute("href"))
  );

  const fresh = [];
  for (const href of newPosts) {
    if (!seen.has(href)) {
      seen.add(href);
      fresh.push({
        keyword,
        postUrl: `https://www.instagram.com${href}`,
      });
    }
  }
  return fresh;
}

async function scrollPage(page) {
  const steps = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => {
      window.scrollBy({
        top: Math.floor(window.innerHeight * (0.6 + Math.random() * 0.5)),
        left: 0,
        behavior: "smooth",
      });
    });
    await sleep(500 + Math.floor(Math.random() * 900));
  }
  await sleep(1500 + Math.floor(Math.random() * 2000));
}

async function scrapeInstagramPosts(page, keyword, maxPosts) {
  await openSearchPage(page, keyword);

  const seen = new Set();
  const results = [];

  while (results.length < maxPosts) {
    const fresh = await extractPosts(page, seen, keyword);

    if (fresh.length > 0) {
      results.push(...fresh);
      console.log(`📸 [#${keyword}] +${fresh.length} new posts (total: ${results.length})`);
    } else {
      console.log(`⚠️ [#${keyword}] No fresh posts loaded.`);
      break;
    }

    if (results.length < maxPosts) {
      await scrollPage(page);
    }
  }

  console.log(`✅ Finished #${keyword}: ${results.length} posts`);
  return results;
}

// Main runner
(async () => {
  try {
    const { username, password } = loadCredentialsFromEnv();
    const keywords = loadKeywordsFromCSV();
    const browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    await loginInstagramWithVerification(page, username, password);

    let allResults = [];
    for (const keyword of keywords) {
      const posts = await scrapeInstagramPosts(page, keyword, MAX_POSTS_DEFAULT);
      allResults = allResults.concat(posts);
    }

    saveToCSV(allResults);
    await browser.close();
  } catch (err) {
    console.error("Error:", err);
  }
})();

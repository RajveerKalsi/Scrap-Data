const puppeteer = require("puppeteer");
const {
  sleep,
  loadCredentialsFromEnv,
  loginInstagramWithVerification,
} = require("./common");
const {
  addKeywordIfNotExists,
  addPost,
  getKeywordsByBrand,
  closePool,
} = require("./db.utils");

const MAX_POSTS_DEFAULT = 1000;

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

async function scrapeInstagramPosts(page, brandId, brandName, keyword, maxPosts) {
  await openSearchPage(page, keyword);
  const seen = new Set();
  let resultsCount = 0;

  // Ensure keyword exists and get its ID
  const keywordId = await addKeywordIfNotExists(brandName, keyword);

  const postsToInsert = []; // <-- store posts temporarily

  while (resultsCount < maxPosts) {
    const newPosts = await page.$$eval("a[href^='/p/']", (anchors) =>
      anchors.map((a) => a.getAttribute("href"))
    );

    let freshCount = 0;
    for (const href of newPosts) {
      if (!seen.has(href)) {
        seen.add(href);
        const fullUrl = `https://www.instagram.com${href}`;
        postsToInsert.push(fullUrl); // <-- collect instead of inserting
        freshCount++;
        resultsCount++;
      }
    }

    if (freshCount > 0) {
      console.log(
        `📸 [#${keyword}] +${freshCount} new posts (total: ${resultsCount})`
      );
    } else {
      console.log(`⚠️ [#${keyword}] No fresh posts loaded.`);
      break;
    }

    if (resultsCount < maxPosts) {
      await scrollPage(page);
    }
  }

  // Insert all posts at once
  for (const postUrl of postsToInsert) {
    await addPost(brandId, keywordId, postUrl);
  }

  console.log(`✅ Finished #${keyword}: ${resultsCount} posts (added in batch)`);
}

// Main runner
(async () => {
  try {
    const { username, password } = loadCredentialsFromEnv();

    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });
    await loginInstagramWithVerification(page, username, password);

    const scrapePlan = {
      biogrowth: [], // empty array means "all keywords for this brand"
      mothercould: [],
    };

    for (const [brandName, keywordFilter] of Object.entries(scrapePlan)) {
      // Fetch keywords from DB, optionally filtered
      const keywordsFromDB = await getKeywordsByBrand(brandName, keywordFilter);

      for (const { id: keywordId, brand_id, brand_name, keyword } of keywordsFromDB) {
        await scrapeInstagramPosts(
          page,
          brand_id, // pass brand_id
          brand_name,
          keyword,
          MAX_POSTS_DEFAULT
        );
      }
    }

    await browser.close();
    await closePool();
    console.log("✅ All done");
  } catch (err) {
    console.error("Error:", err);
  }
})();

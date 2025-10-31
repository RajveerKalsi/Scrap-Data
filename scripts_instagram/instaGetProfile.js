const puppeteer = require("puppeteer");
const {
  loginInstagramWithVerification,
  loadCredentialsFromEnv,
  sleep,
} = require("./common");
const {
  getAllKeywords,
  addPostDetails,
  getScrapedUsernamesByBrandAndKeyword,
  closePool,
} = require("./db.utils");

MAX_POST_COUNT = 5;

(async () => {
  const { username, password } = loadCredentialsFromEnv();

  // 1️⃣ Load keywords & brand info from DB
  const keywords = await getAllKeywords();
  if (!keywords.length) {
    console.log("⚠️ No keywords found in DB.");
    await closePool();
    return;
  }

  console.log(`📚 Found ${keywords.length} keywords in DB.`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });
  const page = await browser.newPage();

  // 2️⃣ Login to Instagram
  console.log("🔐 Logging into Instagram...");
  await loginInstagramWithVerification(page, username, password);

  // 3️⃣ Loop through each keyword
  for (const { id: keyword_id, brand_id, brand_name, keyword } of keywords) {
    console.log(
      `\n🚀 Starting scrape for brand: ${brand_name}, keyword: #${keyword}`
    );

    const searchUrl = `https://www.instagram.com/explore/tags/${keyword}/`;
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    await page.waitForSelector('a[href^="/p/"], a[href^="/reel/"]', {
      timeout: 20000,
    });
    console.log("📸 Posts loaded...");

    // Click first post
    await page.evaluate(() => {
      const firstPost = document.querySelector(
        'a[href^="/p/"], a[href^="/reel/"]'
      );
      if (firstPost) firstPost.click();
    });

    await page.waitForSelector('div[role="dialog"]', { timeout: 15000 });
    console.log("📄 First post dialog opened!");

    // Fetch already scraped usernames for this brand+keyword
    const existingUsernames = new Set(
      await getScrapedUsernamesByBrandAndKeyword(brand_id, keyword_id)
    );
    const newUsernames = new Set();
    let scrapedCount = 0;

    const batchPosts = [];
    const BATCH_SIZE = 10;

    while (scrapedCount < MAX_POST_COUNT) {
      try {
        await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });

        // 🧠 Extract username
        const user = await page.evaluate(() => {
          const spans = Array.from(
            document.querySelectorAll('div[role="dialog"] span')
          );
          const usernameSpan = spans.find(
            (el) =>
              el.innerText &&
              el.innerText.length < 30 &&
              !el.innerText.includes("•") &&
              !el.innerText.includes("Follow") &&
              /^[A-Za-z0-9._]+$/.test(el.innerText)
          );
          return usernameSpan ? usernameSpan.innerText.trim() : null;
        });

        if (!user) {
          console.log("⚠️ Username not found, skipping...");
          const next = await page.$('button._abl- svg[aria-label="Next"]');
          if (!next) break;
          await next.click();
          await sleep(4000);
          continue;
        }

        if (existingUsernames.has(user) || newUsernames.has(user)) {
          console.log(`⏭️ Skipping duplicate: ${user}`);
          const next = await page.$('button._abl- svg[aria-label="Next"]');
          if (!next) break;
          await next.click();
          await sleep(4000);
          continue;
        }

        newUsernames.add(user);
        scrapedCount++;
        console.log(`✅ [${scrapedCount}] New username: ${user}`);

        // Capture post details
        const postData = await page.evaluate(() => {
          const captionEl = document.querySelector("h1");
          const caption = captionEl ? captionEl.innerText.trim() : "";
          const hashtagEls = captionEl
            ? captionEl.querySelectorAll('a[href^="/explore/tags/"]')
            : [];
          const hashtags = Array.from(hashtagEls).map((a) =>
            a.innerText.trim()
          );
          const timeEl = document.querySelector("time");
          const postDate = timeEl ? timeEl.getAttribute("datetime") : null;
          const postUrl = window.location.href;
          return { caption, hashtags, postDate, postUrl };
        });

        // Push to batch array
        batchPosts.push({
          brand_id,
          keyword_id,
          postUrl: postData.postUrl,
          username: user,
          profileUrl: `https://www.instagram.com/${user}/`,
          caption: postData.caption,
          hashtags: postData.hashtags,
          likes: null,
          views: null,
          postDate: postData.postDate,
        });

        // 🧾 Save batch every 10 posts
        if (batchPosts.length >= BATCH_SIZE) {
          console.log(`💾 Saving ${batchPosts.length} posts to DB...`);
          await Promise.all(batchPosts.map((p) => addPostDetails(p)));
          batchPosts.length = 0; // clear batch
          console.log("✅ Batch saved!");
        }

        // Stop if reached MAX_POST_COUNT
        if (scrapedCount >= MAX_POST_COUNT) break;

        // ➡️ Move to next
        const nextBtn = await page.$('button._abl- svg[aria-label="Next"]');
        if (!nextBtn) {
          console.log("🚫 No next button — end of posts.");
          break;
        }

        await nextBtn.click();
        await sleep(4000);
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
        break;
      }
    }

    // 🧩 Save remaining posts
    if (batchPosts.length > 0) {
      console.log(`💾 Saving remaining ${batchPosts.length} posts...`);
      await Promise.all(batchPosts.map((p) => addPostDetails(p)));
      console.log("✅ Final batch saved!");
    }

    console.log(`\n✅ Completed ${scrapedCount} NEW usernames for #${keyword}`);
  }

  await browser.close();
  await closePool();
  console.log("🏁 Scraping completed for all keywords.");
})();

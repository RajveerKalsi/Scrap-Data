const puppeteer = require("puppeteer");
const {
  sleep,
  loginInstagramWithVerification,
  loadCredentialsFromEnv,
} = require("./common");
const {
  getAllKeywords,
  getPostUrlsByKeyword,
  getPostsWithNullUsernames,
  getScrapedUrls,
  addPostDetails,
  closePool,
} = require("./db.utils");

const BATCH_LIMIT = 250;
const EMPTY_THRESHOLD = 10;
const MIN_DELAY = 1000;
const MAX_DELAY = 3000;

async function scrapePost(page, post) {
  const { url, keyword } = post;

  console.log(`🕵️ Visiting post: ${url} (${keyword})`);
  await page.goto(url, { waitUntil: "networkidle2" });
  await sleep(MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));

  const data = await page.evaluate(() => {
    const usernameEl =
      document.querySelector("header a[href^='/' i]") ||
      document.querySelector("a[role='link']");
    const username = usernameEl ? usernameEl.textContent.trim() : null;

    const captionContainer = document.querySelector(
      "span.x193iq5w.xeuugli.x13faqbe.x1vvkbs.xt0psk2.x1i0vuye.xvs91rp.xo1l8bm.x5n08af.x10wh9bi.xpm28yp.x8viiok.x1o7cslx.x126k92a"
    );

    let caption = "";
    let hashtags = [];
    if (captionContainer) {
      const cloned = captionContainer.cloneNode(true);
      cloned.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      caption = cloned.innerText.trim();
      hashtags = Array.from(
        captionContainer.querySelectorAll("a[href*='/explore/tags/']")
      ).map((a) => a.textContent.trim());
    }

    let likes = null;
    let views = null;

    const likesEl1 =
      document.querySelector("a[href$='/liked_by/'] span") ||
      document.querySelector("section svg[aria-label='Like'] ~ span");

    if (likesEl1) {
      likes = likesEl1.textContent.replace(/[^0-9]/g, "") || null;
    } else {
      const likesEl2 = document.querySelector(
        "span[role='button']:has(svg[aria-label='Like'])"
      );
      if (likesEl2) likes = likesEl2.textContent.replace(/[^0-9]/g, "") || null;
      else {
        const viewsEl = document.querySelector(
          "section svg[aria-label='Play'] ~ span"
        );
        if (viewsEl)
          views = viewsEl.textContent.replace(/[^0-9]/g, "") || null;
      }
    }

    const timeEl = document.querySelector("time");
    const postDate = timeEl ? timeEl.getAttribute("datetime") : null;
    const profileUrl = username
      ? `https://www.instagram.com/${username}/`
      : null;

    return { username, profileUrl, caption, hashtags, likes, views, postDate };
  });

  return { postUrl: url, keyword, ...data };
}

async function scrapePostsFromDB(username, password) {
  console.log("🚀 Starting Instagram scraper...");

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1280, height: 800 });

  console.log("🔐 Logging into Instagram...");
  await loginInstagramWithVerification(page, username, password);
  console.log("✅ Login successful!");

  // STEP 1️⃣ Retry posts with NULL usernames
  const incompletePosts = await getPostsWithNullUsernames(500);
  if (incompletePosts.length > 0) {
    console.log(`🩹 Retrying ${incompletePosts.length} posts with missing usernames...`);

    for (const { post_url, keyword_id, brand_id } of incompletePosts) {
      try {
        const postData = await scrapePost(page, { url: post_url, keyword: "retry" });

        await addPostDetails({
          ...postData,
          brand_id,
          keyword_id,
        });
        console.log(`✅ Fixed missing username for: ${post_url}`);
        await sleep(MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));
      } catch (err) {
        console.warn(`⚠️ Retry failed for ${post_url}: ${err.message}`);
      }
    }

    console.log("🧹 Completed retry for missing usernames.\n");
  } else {
    console.log("✅ No incomplete posts found.");
  }

  // STEP 2️⃣ Proceed with normal scraping
  const allKeywords = await getAllKeywords();
  const scrapedUrls = await getScrapedUrls();

  let processedCount = 0;
  let consecutiveEmpty = 0;

  for (const { id: keywordId, brand_id, keyword } of allKeywords) {
    console.log(`\n🏷️ Scraping keyword: "${keyword}" (brand_id: ${brand_id})`);

    const urls = await getPostUrlsByKeyword(keywordId);
    console.log(`📥 Found ${urls.length} posts for "${keyword}".`);

    let keywordSuccess = 0;
    let keywordFail = 0;

    for (const post_url of urls) {
      if (scrapedUrls.has(post_url)) {
        console.log(`⏩ Skipping already scraped: ${post_url}`);
        continue;
      }

      try {
        const postData = await scrapePost(page, { url: post_url, keyword });

        if (!postData.username && !postData.caption) {
          consecutiveEmpty++;
          console.log(
            `⚠️ Empty data detected (${consecutiveEmpty}/${EMPTY_THRESHOLD}).`
          );
          if (consecutiveEmpty >= EMPTY_THRESHOLD) {
            console.log("🚨 Possible block detected! Pausing for 1 hour...");
            await sleep(3600_000);
            consecutiveEmpty = 0;
          }
        } else {
          consecutiveEmpty = 0;
        }

        await addPostDetails({
          ...postData,
          brand_id,
          keyword_id: keywordId,
        });
        console.log(`💾 Saved post data to DB for: ${post_url}`);

        scrapedUrls.add(post_url);
        processedCount++;
        keywordSuccess++;

        if (processedCount % BATCH_LIMIT === 0) {
          console.log(
            `🕒 Processed ${processedCount} posts total. Cooling down for 1 hour...`
          );
          await sleep(3600_000);
        }

        console.log(`✅ Successfully scraped: ${post_url}`);
        await sleep(MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));
      } catch (err) {
        keywordFail++;
        console.warn(`❌ Failed to scrape ${post_url}: ${err.message}`);
      }
    }

    console.log(
      `\n✅ Finished keyword "${keyword}": ${keywordSuccess} succeeded, ${keywordFail} failed.`
    );
  }

  await browser.close();
  console.log(`🏁 All done! Total processed posts: ${processedCount}`);
}

(async () => {
  try {
    const { username, password } = loadCredentialsFromEnv();
    await scrapePostsFromDB(username, password);
    await closePool();
  } catch (err) {
    console.error("💥 Fatal Error:", err);
    await closePool();
  }
})();

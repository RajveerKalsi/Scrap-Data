const puppeteer = require("puppeteer");
const {
  sleep,
  loadCredentialsFromEnv,
  loginInstagramWithVerification,
} = require("./common");
const {
  addKeywordIfNotExists,
  addPostDetails,
  getAllKeywords,
  closePool,
} = require("./db.utils");

const MAX_POSTS_PER_KEYWORD = 100;
const MIN_DELAY = 1000;
const MAX_DELAY = 2500;

async function launchBrowser() {
  return puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

// Open keyword page and click first post
// Open keyword page and click first post
async function openFirstPost(page, keyword) {
  const searchUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(keyword)}/`;
  await page.goto(searchUrl, { waitUntil: "networkidle2" });
  await sleep(3000);

  // Scroll slightly to ensure posts are rendered
  await page.evaluate(() => window.scrollBy(0, 300));
  await sleep(1000);

  // The current Instagram layout wraps posts inside divs, not <article>
  const postSelector = "a[href^='/p/']._a6hd"; // matches the clickable post anchors
  await page.waitForSelector(postSelector, { timeout: 8000 }).catch(() => null);

  const firstPost = await page.$(postSelector);
  if (!firstPost) {
    console.log("⚠️ No posts found on the hashtag page — structure may have changed.");
    return false;
  }

  await firstPost.click();

  // Wait for the post dialog to appear
//   await page.waitForSelector("div[role='dialog'][aria-modal='true']", {
//     timeout: 10000,
//   });

  await sleep(2000);
  return true;
}


// Scrape current popup post
async function scrapeCurrentPost(page, keyword) {
  return await page.evaluate(() => {
    const usernameEl =
      document.querySelector("header a[href^='/' i]") ||
      document.querySelector("a[role='link']");
    const username = usernameEl ? usernameEl.textContent.trim() : null;

    const captionContainer = document.querySelector("div[role='dialog'] li span");
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
    const likesEl = document.querySelector("section svg[aria-label='Like'] ~ span");
    const viewsEl = document.querySelector("section svg[aria-label='Play'] ~ span");

    if (likesEl) likes = likesEl.textContent.replace(/[^0-9]/g, "") || null;
    if (viewsEl) views = viewsEl.textContent.replace(/[^0-9]/g, "") || null;

    const timeEl = document.querySelector("time");
    const postDate = timeEl ? timeEl.getAttribute("datetime") : null;

    const profileUrl = username ? `https://www.instagram.com/${username}/` : null;

    const postUrlEl = document.querySelector("div[role='dialog'] a[href^='/p/']");
    const postUrl = postUrlEl ? postUrlEl.href : null;

    return { postUrl, username, profileUrl, caption, hashtags, likes, views, postDate };
  });
}

// Click next arrow in popup
async function clickNextPost(page) {
  const nextButton = await page.$("svg[aria-label='Next']");
  if (!nextButton) return false;
  const parentDiv = await nextButton.evaluateHandle((svg) => svg.closest("div[role='button']"));
  if (!parentDiv) return false;
  await parentDiv.click();
  await sleep(1500 + Math.random() * 1000);
  return true;
}

async function scrapeKeyword(page, brandId, brandName, keyword, maxPosts) {
  console.log(`\n🏷️ Starting scraping for keyword: "${keyword}"`);
  const keywordId = await addKeywordIfNotExists(brandName, keyword);

  const opened = await openFirstPost(page, keyword);
  if (!opened) {
    console.log(`⚠️ No posts found for #${keyword}`);
    return;
  }

  let count = 0;
  while (count < maxPosts) {
    try {
      const postData = await scrapeCurrentPost(page, keyword);
      if (!postData.postUrl) break;

      await addPostDetails({
        ...postData,
        brand_id: brandId,
        keyword_id: keywordId,
      });
      console.log(`✅ Scraped post: ${postData.postUrl}`);
      count++;

      const nextExists = await clickNextPost(page);
      if (!nextExists) break;

      await sleep(MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));
    } catch (err) {
      console.warn(`⚠️ Failed scraping post: ${err.message}`);
      break;
    }
  }

  console.log(`✅ Finished #${keyword}: scraped ${count} posts`);
}

// Main runner
(async () => {
  try {
    const { username, password } = loadCredentialsFromEnv();
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    console.log("🔐 Logging into Instagram...");
    await loginInstagramWithVerification(page, username, password);
    console.log("✅ Login successful!");

    const allKeywords = await getAllKeywords();

    for (const { id: brandId, brand_name, keyword } of allKeywords) {
      await scrapeKeyword(page, brandId, brand_name, keyword, MAX_POSTS_PER_KEYWORD);
    }

    await browser.close();
    await closePool();
    console.log("🏁 All done!");
  } catch (err) {
    console.error("💥 Fatal Error:", err);
    await closePool();
  }
})();

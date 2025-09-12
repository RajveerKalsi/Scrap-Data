// scrapeInstagramPostDetails.js
const puppeteer = require("puppeteer");
const {
  sleep,
  loginInstagram,
  saveToCSV,
  loadCredentialsFromEnv,
} = require("./common");
const fs = require("fs");
const Papa = require("papaparse");

// Load post URLs from CSV
function loadPostLinks(filename = "instagram_posts.csv") {
  const csvData = fs.readFileSync(filename, "utf8");
  const parsed = Papa.parse(csvData, { header: true });
  return parsed.data
    .map((row) => ({ url: row.postUrl, keyword: row.keyword || "" }))
    .filter((row) => row.url);
}

// Scrape single post
async function scrapePost(page, post) {
  const { url, keyword } = post;
  await page.goto(url, { waitUntil: "networkidle2" });
  await sleep(1000 + Math.random() * 2000);

  const data = await page.evaluate(() => {
    // Username
    const usernameEl =
      document.querySelector("header a[href^='/' i]") ||
      document.querySelector("a[role='link']");

    const username = usernameEl ? usernameEl.textContent.trim() : null;

    // Caption
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

    // Likes or Views
    let likes = null;
    let views = null;
    const likesEl =
      document.querySelector("a[href$='/liked_by/'] span") ||
      document.querySelector("section svg[aria-label='Like'] ~ span");
    if (likesEl) {
      likes = likesEl.textContent.replace(/[^0-9]/g, "");
    } else {
      const viewsEl = document.querySelector(
        "section svg[aria-label='Play'] ~ span"
      );
      if (viewsEl) views = viewsEl.textContent.replace(/[^0-9]/g, "");
    }

    // Post date
    const timeEl = document.querySelector("time");
    const postDate = timeEl ? timeEl.getAttribute("datetime") : null;
    const timeAgo = timeEl ? timeEl.textContent.trim() : null;

    return { username, caption, hashtags, likes, views, postDate, timeAgo };
  });

  // ✅ Add profile URL here
  const profileUrl = data.username
    ? `https://www.instagram.com/${data.username}/`
    : null;

  return { postUrl: url, keyword, profileUrl, ...data };
}

// Scrape all posts sequentially
async function scrapePosts(postLinks, username, password) {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1280, height: 800 });

  await loginInstagram(page, username, password);

  const results = [];
  for (let i = 0; i < postLinks.length; i++) {
    try {
      const data = await scrapePost(page, postLinks[i]);
      console.log(`✅ Scraped: ${postLinks[i].url}`);
      results.push(data);

      // Save progress every 10 scrapes
      if (results.length % 10 === 0) {
        const filename = "instagram_post_details.csv";
        saveToCSV(results, filename);
        console.log(`💾 Progress saved (${results.length} posts).`);
      }

      await sleep(1000 + Math.random() * 1500);
    } catch (err) {
      console.warn(`⚠️ Failed to scrape ${postLinks[i].url}:`, err.message);
    }
  }

  await browser.close();
  return results;
}

// Main runner
(async () => {
  try {
    const { username, password } = loadCredentialsFromEnv();
    const postLinks = loadPostLinks();

    if (!postLinks.length) {
      console.log("No post URLs found in CSV.");
      process.exit(0);
    }
    const postDetails = await scrapePosts(postLinks, username, password);
    saveToCSV(postDetails, "instagram_post_details.csv");
  } catch (err) {
    console.error("Error:", err);
  }
})();

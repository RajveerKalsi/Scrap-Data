const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { loginInstagramWithVerification, loadCredentialsFromEnv, sleep } = require("./common");

(async () => {
  const { username, password } = loadCredentialsFromEnv();
  const keyword = "parentalhack";
  const OUTPUT_FILE = path.join(__dirname, "hashtag_posts.csv");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // 1️⃣ Login
  console.log("🔐 Logging into Instagram...");
  await loginInstagramWithVerification(page, username, password);

  // 2️⃣ Go to hashtag explore page
  const searchUrl = `https://www.instagram.com/explore/tags/${keyword}/`;
  console.log(`🔎 Navigating to ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "networkidle2" });

  // Wait for posts to load
  await page.waitForSelector('a[href^="/p/"], a[href^="/reel/"]', { timeout: 20000 });
  console.log("📸 Posts loaded...");

  // Click first post
  await page.evaluate(() => {
    const firstPost = document.querySelector('a[href^="/p/"], a[href^="/reel/"]');
    if (firstPost) firstPost.click();
  });

  await page.waitForSelector('div[role="dialog"]', { timeout: 15000 });
  console.log("📄 First post dialog opened!");

  const scrapedData = [];

  // 3️⃣ Loop through N posts
  for (let i = 0; i < 10; i++) {
    try {
      console.log(`\n🧩 Scraping post ${i + 1}...`);
      await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });

      // Use your robust username extraction method here:
      const user = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('div[role="dialog"] span'));
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

      const caption = await page.evaluate(() => {
        const captionEl = document.querySelector("h1");
        return captionEl ? captionEl.innerText.trim() : "";
      });

      const hashtags = await page.evaluate(() => {
        const captionEl = document.querySelector("h1");
        if (!captionEl) return [];
        const hashtagEls = captionEl.querySelectorAll('a[href^="/explore/tags/"]');
        return Array.from(hashtagEls).map((a) => a.innerText.trim());
      });

      const time = await page.evaluate(() => {
        const timeEl = document.querySelector("time");
        return timeEl ? timeEl.getAttribute("datetime") : null;
      });

      const postData = {
        username: user,
        profile_url: user ? `https://www.instagram.com/${user}/` : "",
        caption,
        hashtags,
        post_date: time,
      };

      if (user) {
        scrapedData.push(postData);
        console.log(`✅ ${user} — ${caption?.slice(0, 40)}...`);
      } else {
        console.log("⚠️ Username not found for this post.");
      }

      // ⏭️ Move to next post
      const nextBtn = await page.$('button._abl- svg[aria-label="Next"]');
      if (!nextBtn) {
        console.log("🚫 No next button — end of posts.");
        break;
      }

      await nextBtn.click();
      console.log("➡️ Moving to next post...");
      await sleep(4000);
    } catch (err) {
      console.log(`❌ Error on post ${i + 1}: ${err.message}`);
      break;
    }
  }

  // 4️⃣ Save to CSV
  if (scrapedData.length > 0) {
    const csvHeader = "username,profile_url,caption,hashtags,post_date\n";
    const csvRows = scrapedData.map((d) =>
      [
        d.username,
        d.profile_url,
        `"${(d.caption || "").replace(/"/g, '""')}"`,
        `"${(d.hashtags || []).join(", ")}"`,
        d.post_date || "",
      ].join(",")
    );
    const csvContent = csvHeader + csvRows.join("\n");

    fs.writeFileSync(OUTPUT_FILE, csvContent);
    console.log(`💾 Saved ${scrapedData.length} posts → ${OUTPUT_FILE}`);
  } else {
    console.log("⚠️ No posts scraped.");
  }

  await browser.close();
})();

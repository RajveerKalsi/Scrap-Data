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

MAX_POST_COUNT = 1000;

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

async function recoverFromDuplicateLoop(page) {
  console.log("🔁 Too many duplicates — refreshing post list...");

  // 1️⃣ Try to close the current dialog
  try {
    await page.evaluate(() => {
      const closeBtn = document.querySelector(
        'div[role="button"] svg[aria-label="Close"]'
      );
      if (closeBtn) {
        const parentButton = closeBtn.closest('div[role="button"]');
        parentButton?.click();
      }
    });
    await sleep(1500);
  } catch (e) {
    console.log("⚠️ Failed to close dialog, continuing anyway...");
  }

  // 2️⃣ Scroll the page randomly
  await scrollPage(page);

  // 3️⃣ Wait for new posts to be visible
  try {
    await page.waitForSelector('a[href^="/p/"], a[href^="/reel/"]', {
      timeout: 15000,
    });
  } catch (e) {
    console.log("❌ No posts visible after scroll.");
    return false;
  }

  // 4️⃣ Click a random post to continue
  const postClicked = await page.evaluate(() => {
    const posts = Array.from(
      document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]')
    );
    if (posts.length === 0) return false;
    const randomPost = posts[Math.floor(Math.random() * posts.length)];
    randomPost.click();
    return true;
  });

  if (postClicked) {
    console.log("✅ Resumed scraping from a new post.");
    try {
      await page.waitForSelector('div[role="dialog"]', { timeout: 15000 });
      return true;
    } catch (e) {
      console.log("⚠️ Dialog didn't open after clicking random post.");
      return false;
    }
  } else {
    console.log("❌ Could not find any new posts to click.");
    return false;
  }
}

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
    const existingRows = await getScrapedUsernamesByBrandAndKeyword(
      brand_id,
      keyword_id
    ); // assume this returns array of lowercased usernames or [] 
    const existingUsernames = new Set(
      (existingRows || []).filter(Boolean).map((u) => u.toLowerCase())
    );

    const newUsernames = new Set();
    let scrapedCount = 0;

    const batchPosts = [];
    const BATCH_SIZE = 10;

    let duplicateCount = 0;
    const DUPLICATE_LIMIT = 20; // Max consecutive duplicates before refreshing

    // ADDITIONAL: total attempts cap to avoid infinite loops (can be tuned)
    let totalAttempts = 0;
    const ATTEMPT_LIMIT = 1500;

    // Use a while loop that only stops when we have required new usernames
    while (scrapedCount < MAX_POST_COUNT && totalAttempts < ATTEMPT_LIMIT) {
      totalAttempts++;

      try {
        // ensure dialog present; if not, try recovering
        try {
          await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
        } catch (e) {
          console.log("⚠️ Dialog not present; attempting recoverFromDuplicateLoop...");
          const recovered = await recoverFromDuplicateLoop(page);
          if (!recovered) {
            console.log("❌ Could not recover dialog; breaking out.");
            break;
          }
        }

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
          console.log("⚠️ Username not found, try moving to next post...");
          const next = await page.$('button._abl- svg[aria-label="Next"]');
          if (next) {
            await next.click();
            await sleep(2500 + Math.floor(Math.random() * 2500));
            continue;
          } else {
            // no next button -> recover
            const recovered = await recoverFromDuplicateLoop(page);
            if (!recovered) break;
            continue;
          }
        }

        const lowerUser = user.toLowerCase();

        // 🔍 Handle duplicates (DB or session)
        if (existingUsernames.has(lowerUser) || newUsernames.has(lowerUser)) {
          console.log(`⏭️ Skipping duplicate: ${user}`);
          duplicateCount++;

          // if too many duplicates consecutively, try to recover by closing dialog + scrolling + clicking random post
          if (duplicateCount >= DUPLICATE_LIMIT) {
            const recovered = await recoverFromDuplicateLoop(page);
            duplicateCount = 0;
            if (!recovered) {
              console.log("❌ Recover attempt failed; breaking.");
              break;
            }
            continue;
          }

          // otherwise just go to next post
          const next = await page.$('button._abl- svg[aria-label="Next"]');
          if (next) {
            await next.click();
            await sleep(2000 + Math.floor(Math.random() * 3000));
            continue;
          } else {
            // no next -> recover
            const recovered = await recoverFromDuplicateLoop(page);
            if (!recovered) break;
            continue;
          }
        }

        // ✅ Found new username
        duplicateCount = 0; // reset when new user found
        newUsernames.add(lowerUser);
        existingUsernames.add(lowerUser); // prevent hitting same username within loop
        scrapedCount++;
        console.log(`✅ [${scrapedCount}] New username: ${user}`);

        // 🧾 Capture post details
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

        // 🧩 Add to batch
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

        // 💾 Save batch every 10 posts
        if (batchPosts.length >= BATCH_SIZE) {
          console.log(`💾 Saving ${batchPosts.length} posts to DB...`);
          await Promise.all(batchPosts.map((p) => addPostDetails(p)));
          batchPosts.length = 0; // clear batch
          console.log("✅ Batch saved!");
        }

        // Stop if reached MAX_POST_COUNT
        if (scrapedCount >= MAX_POST_COUNT) break;

        // ➡️ Move to next (prefer clicking Next button)
        const nextBtn = await page.$('button._abl- svg[aria-label="Next"]');
        if (nextBtn) {
          await nextBtn.click();
          await sleep(2000 + Math.floor(Math.random() * 3000));
        } else {
          // fallback: try to recover and pick a random post
          const recovered = await recoverFromDuplicateLoop(page);
          if (!recovered) {
            console.log("❌ No next and recover failed; breaking.");
            break;
          }
        }
      } catch (err) {
        console.log(`❌ Error in scraping loop: ${err.message}`);
        // On unexpected error, try a recover and continue if possible
        const recovered = await recoverFromDuplicateLoop(page);
        if (!recovered) break;
      }
    } // end while

    // 🧩 Save remaining posts
    if (batchPosts.length > 0) {
      console.log(`💾 Saving remaining ${batchPosts.length} posts...`);
      await Promise.all(batchPosts.map((p) => addPostDetails(p)));
      console.log("✅ Final batch saved!");
    }

    console.log(`\n✅ Completed ${scrapedCount} NEW usernames for #${keyword}`);
  } // end for keywords

  await browser.close();
  await closePool();
  console.log("🏁 Scraping completed for all keywords.");
})();

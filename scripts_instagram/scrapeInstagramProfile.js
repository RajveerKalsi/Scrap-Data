// scrape_profiles.js
const puppeteer = require("puppeteer");
const { sleep, loginInstagram, loadCredentialsFromEnv } = require("./common");
const {
  getProfileUrlsFromDB,
  getScrapedProfileUrls,
  addProfileDetails,
} = require("./db.utils");
const OpenAI = require("openai");
require("dotenv").config();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function extractEmailFromBio(bio) {
  if (!bio) return "";
  const match = bio.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

async function detectCountryLLM(bio) {
  if (!bio) return "unknown";
  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Given this Instagram bio, guess the most likely country of the person. Bio: "${bio}" Reply with just the country name (e.g., "India") or "unknown".`,
        },
      ],
      temperature: 0,
    });
    return res.choices[0].message.content.trim();
  } catch (err) {
    console.error(":x: LLM detection failed:", err.message);
    return "unknown";
  }
}

async function detectIsShopLLM(bio) {
  if (!bio) return "no";
  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Given this Instagram bio, decide if it likely belongs to a shop, store, or business. Bio: "${bio}" Answer with only "yes" or "no".`,
        },
      ],
      temperature: 0,
    });
    return res.choices[0].message.content.trim().toLowerCase();
  } catch (err) {
    console.error(":x: LLM shop detection failed:", err.message);
    return "no";
  }
}

async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("header", { timeout: 60000 });
  } catch (err) {
    console.warn(`⚠️ Navigation failed for ${url}:`, err.message);
    throw err;
  }
}

async function scrapeProfile(page, profileUrl) {
  await safeGoto(page, profileUrl);
  await sleep(2000 + Math.random() * 2000);

  return await page.evaluate(() => {
    const username =
      document.querySelector("header h2")?.innerText.trim() ||
      document.querySelector("h1")?.innerText.trim() ||
      window.location.pathname.replace(/\//g, "");

    const followers =
      document.querySelector('a[href$="/followers/"] span')?.title ||
      document.querySelector('a[href$="/followers/"] span')?.innerText ||
      "";

    const following =
      document.querySelector('a[href$="/following/"] span')?.innerText || "";

    const followersEl = document.querySelector('a[href$="/followers/"] span');
    const postsEl = followersEl
      ?.closest("div")
      .previousElementSibling?.querySelector("span span");
    const posts = postsEl ? postsEl.innerText.trim() : "";

    let bio = "";
    const bioContainer = document.querySelector("div.x7a106z");
    if (bioContainer) bio = bioContainer.innerText.trim();

    return { username, posts, followers, following, bio };
  });
}

(async () => {
  const { username, password } = loadCredentialsFromEnv();
  console.log("🔐 Logging into Instagram...");
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--no-sandbox",
    ],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(60000);
  await loginInstagram(page, username, password);
  console.log("✅ Login successful!");

  // Fetch URLs
  const profiles = await getProfileUrlsFromDB();
  const scrapedProfiles = await getScrapedProfileUrls();

  let processedCount = 0;
  let consecutiveEmpty = 0;

  for (const { profile_url, brand_id, keyword_id, post_id } of profiles) {
    if (scrapedProfiles.has(profile_url)) {
      console.log(`⏩ Skipping already scraped: ${profile_url}`);
      continue;
    }

    console.log(`🔎 Scraping profile: ${profile_url}`);
    try {
      const data = await scrapeProfile(page, profile_url);
      data.profile_url = profile_url;
      data.brand_id = brand_id;
      data.keyword_id = keyword_id;
      data.post_id = post_id;
      data.email = extractEmailFromBio(data.bio);
      data.country = await detectCountryLLM(data.bio);
      data.is_shop = (await detectIsShopLLM(data.bio)) === "yes";

      if (!data.username && !data.bio) {
        consecutiveEmpty++;
        console.log(`⚠️ Empty profile detected (${consecutiveEmpty}/10)`);
        if (consecutiveEmpty >= 10) {
          console.log("🚨 Possible block detected! Pausing for 1 hour...");
          await sleep(3600_000);
          consecutiveEmpty = 0;
        }
      } else {
        consecutiveEmpty = 0;
      }

      await addProfileDetails(data);
      processedCount++;

      if (processedCount % 250 === 0) {
        console.log("⏸ Pausing for 1 hour to avoid blocks...");
        await sleep(3600_000);
      }

      await sleep(2000 + Math.random() * 2000);
      console.log(`✅ Scraped profile: ${profile_url}`);
    } catch (err) {
      console.error(`❌ Failed to scrape ${profile_url}:`, err.message);
    }
  }

  console.log(`🏁 All done! Processed ${processedCount} profiles.`);
  await browser.close();
})();

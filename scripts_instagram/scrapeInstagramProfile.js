// scrape_profiles.js
const puppeteer = require("puppeteer");
const Papa = require("papaparse");
const fs = require("fs");
const { sleep, loginInstagram, loadCredentialsFromEnv } = require("./common");
const OpenAI = require("openai");
require("dotenv").config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load profile URLs from instagram_post_details.csv
function loadProfileUrls(file = "instagram_post_details.csv") {
  const content = fs.readFileSync(file, "utf8");
  const parsed = Papa.parse(content, { header: true });
  return parsed.data.map((row) => row.profileUrl).filter(Boolean);
}

async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Instagram headers are always present
    await page.waitForSelector("header", { timeout: 60000 });
  } catch (err) {
    console.warn(`⚠️ Navigation failed for ${url}:`, err.message);
    throw err;
  }
}

function extractEmailFromBio(bio) {
  if (!bio) return "";
  const match = bio.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

// Country detection from bio text (simple heuristic)
async function detectCountryLLM(bio) {
  if (!bio) return "unknown";

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Given this Instagram bio, guess the most likely country of the person. 
Bio: "${bio}"
Reply with just the country name (e.g., "India") or "unknown".`,
        },
      ],
      temperature: 0,
    });

    return res.choices[0].message.content.trim();
  } catch (err) {
    console.error("❌ LLM detection failed:", err.message);
    return "unknown";
  }
}

async function detectCountry(bio) {
  return await detectCountryLLM(bio);
}

async function detectIsShopLLM(bio) {
  if (!bio) return "no";

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Given this Instagram bio, decide if it likely belongs to a shop, store, or business.
Bio: "${bio}"
Answer with only "yes" or "no".`,
        },
      ],
      temperature: 0,
    });

    return res.choices[0].message.content.trim().toLowerCase();
  } catch (err) {
    console.error("❌ LLM shop detection failed:", err.message);
    return "no";
  }
}

async function detectIsShop(bio) {
  return await detectIsShopLLM(bio);
}

async function scrapeProfile(page, profileUrl) {
  await safeGoto(page, profileUrl);
  await sleep(2000);

  return await page.evaluate(() => {
    // Username
    const username =
      document.querySelector("header h2")?.innerText.trim() ||
      document.querySelector("h1")?.innerText.trim() ||
      window.location.pathname.replace(/\//g, "");

    // Followers & following
    const followers =
      document.querySelector('a[href$="/followers/"] span')?.title ||
      document.querySelector('a[href$="/followers/"] span')?.innerText ||
      "";
    const following =
      document.querySelector('a[href$="/following/"] span')?.innerText || "";

    // Posts (Instagram sometimes hides "posts" text, so grab the first li/span with a number)
    let posts = "";
    const counters = document.querySelectorAll(
      "header li span, header ul li span"
    );
    if (counters.length >= 1) {
      posts = counters[0].innerText.trim();
    }

    // Bio (using the new parent container)
    let bio = "";
    const bioContainer = document.querySelector("div.x7a106z");
    if (bioContainer) {
      bio = bioContainer.innerText.trim();
    }

    return { username, posts, followers, following, bio };
  });
}

(async () => {
  const { username, password } = loadCredentialsFromEnv();
  const profileUrls = loadProfileUrls();

  const browser = await puppeteer.launch({
    headless: false, // change to true when stable
    defaultViewport: null,
    protocolTimeout: 180000,
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

  // Login
  await loginInstagram(page, username, password);

  const results = [];
  for (let i = 0; i < profileUrls.length; i++) {
    const url = profileUrls[i];
    console.log(`🔎 Scraping ${url} ...`);
    try {
      const data = await scrapeProfile(page, url);
      data.profileUrl = url;
      data.country = await detectCountry(data.bio);
      data.isShop = await detectIsShop(data.bio);
      data.email = extractEmailFromBio(data.bio);
      results.push(data);

      // Save progress every 10 scrapes
      if ((i + 1) % 5 === 0) {
        const csv = Papa.unparse(results);
        fs.writeFileSync("instagram_profiles.csv", csv, "utf8");
        console.log(`💾 Progress saved after ${i + 1} profiles.`);
      }

      await sleep(2000 + Math.random() * 2000);
    } catch (err) {
      console.error(`❌ Failed to scrape ${url}:`, err.message);
    }
  }

  const csv = Papa.unparse(results);
  fs.writeFileSync("instagram_profiles.csv", csv, "utf8");
  console.log("✅ Saved profiles to instagram_profiles.csv");

  await browser.close();
})();

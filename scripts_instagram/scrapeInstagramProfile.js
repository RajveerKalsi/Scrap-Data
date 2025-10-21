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

async function extractConnectLinks(page) {
  let links = [];

  try {
    // Find the connect link container
    const linkWrapper = await page.$$('div.x3nfvp2');
    for (const wrapper of linkWrapper) {
      const svg = await wrapper.$('svg[aria-label="Link icon"]');
      if (!svg) continue;

      const linkTextDiv = await wrapper.$('div a div');
      if (!linkTextDiv) continue;

      const text = await linkTextDiv.evaluate(el => el.innerText.trim());
      // If it says "and X more", click to expand
      if (text.toLowerCase().includes('more')) {
        try {
          await linkTextDiv.click();
          await page.waitForSelector('div.html-div a', { timeout: 5000 });

          const popupLinks = await page.$$eval('div.html-div a', anchors =>
            anchors.map(a => a.href)
          );
          links.push(...popupLinks);
        } catch (err) {
          console.warn("⚠️ Could not expand connect links popup:", err.message);
        }
      } else {
        // Single link
        const href = await linkTextDiv.$eval('a', a => a.href).catch(() => null);
        if (href) links.push(href);
      }

      break; // Found a container, no need to check further
    }
  } catch (err) {
    console.warn("⚠️ Failed to extract connect links:", err.message);
  }

  return links;
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

  try {
    // Find the bio container
    const bioWrappers = await page.$$("div.x7a106z");
    for (const wrapper of bioWrappers) {
      const bioEl = await wrapper.$("._ap3a._aaco._aacu._aacx._aad7._aade");
      if (bioEl) {
        // Look for a button/span containing text 'more'
        const buttons = await wrapper.$$("span");
        for (const btn of buttons) {
          const text = await btn.evaluate((el) => el.innerText);
          if (text.toLowerCase().includes("more")) {
            await btn.click();
            await sleep(500 + Math.random() * 500);
            break;
          }
        }
        break; // Found bio wrapper, done
      }
    }
  } catch (err) {
    console.warn("⚠️ Could not click 'more' button:", err.message);
  }

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
    const bioWrapper = Array.from(
      document.querySelectorAll("div.x7a106z")
    ).find((el) => el.querySelector("._ap3a._aaco._aacu._aacx._aad7._aade"));

    if (bioWrapper) {
      const bioEl = bioWrapper.querySelector(
        "._ap3a._aaco._aacu._aacx._aad7._aade"
      );
      if (bioEl) bio = bioEl.innerText.trim();
    }

    // Only select hrefs inside the connect link container
    let connectLink = "";
    const linkWrapper = Array.from(
      document.querySelectorAll("div.x3nfvp2")
    ).find((div) => div.querySelector('svg[aria-label="Link icon"]'));

    if (linkWrapper) {
      const linkTextDiv = linkWrapper.querySelector("div a div") || linkWrapper.querySelector("div");
      if (linkTextDiv) {
        connectLink = linkTextDiv.innerText.trim();
      }
    }

    return {
      username,
      posts,
      followers,
      following,
      bio,
      connect_link: connectLink,
    };
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
    if (!profile_url || profile_url.trim() === "") {
      console.warn("⚠️ Skipping empty or null profile_url");
      continue;
    }

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

      await addProfileDetails({
        ...data,
        connect_link: data.connect_link ? [data.connect_link] : [],
      });
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

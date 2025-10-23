const puppeteer = require("puppeteer");
const { sleep, loginInstagramWithVerification, typeMultilineMessage, loadCredentialsFromEnvForMessage } = require("./common");
const { getProfilesToMessage, markMessageSent, closePool } = require("./db.utils");

async function sendMessage(page, profile) {
  const { id, profile_url, username, brand_name, contact_name, region } = profile;

  console.log(`✉️ Visiting ${profile_url} ...`);
  await page.goto(profile_url, { waitUntil: "networkidle2" });
  await sleep(3000);

  // --- Message button handling (same as before) ---
  let messageBoxReady = false;

  try {
    const messageBtn = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll('div[role="button"]'))
           .find(el => el.innerText.trim() === "Message")
    );
    if (messageBtn) { await messageBtn.click(); messageBoxReady = true; }
  } catch {}

  if (!messageBoxReady) {
    try {
      await page.waitForSelector('svg[aria-label="Options"]', { timeout: 5000 });
      const optionsBtn = await page.evaluateHandle(() => {
        const svg = document.querySelector('svg[aria-label="Options"]');
        return svg ? svg.closest('div[role="button"]') : null;
      });
      if (optionsBtn) { 
        await optionsBtn.click(); 
        await sleep(1000);
        const sendMsgBtn = await page.evaluateHandle(() =>
          Array.from(document.querySelectorAll('div[role="dialog"] button'))
               .find(btn => btn.innerText.trim().toLowerCase() === "send message")
        );
        if (sendMsgBtn) { await sendMsgBtn.click(); messageBoxReady = true; }
      }
    } catch {}
  }

  const textboxSelector = 'div[role="textbox"][aria-label="Message"]';
  try {
    await page.waitForSelector(textboxSelector, { timeout: 15000 });
  } catch {
    console.log(`❌ Message box did not appear for ${username}`);
    return false;
  }

  // --- Select message based on region ---
  let message = "";
  if (region?.toLowerCase() === "us") {
    message = `Hi ${username},
Hope you're doing great!

I'm reaching out on behalf of ${brand_name}, a brand passionate about promoting healthier, more sustainable gardens and farms. We create natural, eco-friendly plant nutrition solutions and we're proud to be a 1% for the Planet member, contributing a portion of our annual sales to environmental causes.

We'd love to collaborate with creators who care about sustainability, gardening, home greenery, or clean living. If that sounds like you, please share your email address so we can send over more details about the collaboration.

Looking forward to connecting!
Warmly,
${contact_name}`;
  } else if (region?.toLowerCase() === "unknown") {
    message = `Hi ${username},
Hope you're doing great!

I'm reaching out on behalf of ${brand_name}, a brand passionate about promoting healthier, more sustainable gardens and farms. We create natural, eco-friendly plant nutrition solutions and are proud to be a 1% for the Planet member, contributing a portion of our annual sales to environmental causes.
We'd love to collaborate with creators who care about sustainability, gardening, home greenery, or clean living. If you're based in the USA and interested in this opportunity, please share your email address so we can send over more details about the collaboration.

Looking forward to connecting!
Warmly,
${contact_name}`;
  } else {
    // default/fallback message if other region
    message = `Hi ${username},
Hope you're doing great!

I'm reaching out on behalf of ${brand_name}, a brand passionate about promoting healthier, more sustainable gardens and farms. We'd love to connect with creators like you. 

Looking forward to connecting!
Warmly,
${contact_name}`;
  }

  await typeMultilineMessage(page, textboxSelector, message);
  await page.keyboard.press("Enter");
  await sleep(2000);

  // Click Send button fallback
  try {
    const [sendBtn] = await page.$x('//div[@role="button" and normalize-space(text())="Send"]');
    if (sendBtn) await sendBtn.click();
  } catch {}

  console.log(`✅ Finished sending to ${username}`);
  return true;
}

(async () => {
  const { username, password } = loadCredentialsFromEnvForMessage();
  const profiles = await getProfilesToMessage(); // batch limit

  if (!profiles.length) {
    console.log("✅ No profiles to message.");
    await closePool();
    return;
  }

  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();
  await loginInstagramWithVerification(page, username, password);

  for (const p of profiles) {
    try {
      const sent = await sendMessage(page, p);
      if (sent) await markMessageSent(p.id);
    } catch (err) {
      console.error(`❌ Failed for ${p.username}:`, err.message);
    }
    await sleep(5000 + Math.random() * 5000);
  }

  await browser.close();
  await closePool();
})();

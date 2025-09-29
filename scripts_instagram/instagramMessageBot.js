// message_bot.js
const puppeteer = require("puppeteer");
const Papa = require("papaparse");
const fs = require("fs");
const { sleep, loginInstagramWithVerification, loadCredentialsFromEnv, typeMultilineMessage } = require("./common");
require("dotenv").config();

// Load profiles to message
function loadProfiles(file = "profileToMessage.csv") {
  const content = fs.readFileSync(file, "utf8");
  const parsed = Papa.parse(content, { header: true });
  return parsed.data.filter((row) => row.profileUrl && row.username);
}

async function sendMessage(
  page,
  { profileUrl, username, brandName, contactName }
) {
  console.log(`✉️ Visiting ${profileUrl} ...`);
  await page.goto(profileUrl, { waitUntil: "networkidle2" });
  await sleep(3000);

  // --- Try direct "Message" button first ---
  let messageBoxReady = false;
  try {
    // Use XPath to find <div role="button">Message</div>
    const messageBtn = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('div[role="button"]')).find(
        (el) => el.innerText.trim() === "Message"
      );
    });
    console.log("messageBtn", messageBtn);
    if (messageBtn) {
      console.log("inside if of messageBtn");
      await messageBtn.click();
      messageBoxReady = true;
      console.log(`👉 Clicked direct Message button`);
    }
  } catch (err) {
    console.log(
      `⚠️ No direct "Message" button for ${username}, trying Options → Send message...`
    );
  }

  // --- If Message button is missing, try 3-dot "Options" ---
  if (!messageBoxReady) {
    try {
      // Click Options (three dots icon by aria-label)
      console.log("inside if of messageBoxReady");
      await page.waitForSelector('svg[aria-label="Options"]', {
        timeout: 5000,
      });
      const optionsBtn = await page.evaluateHandle(() => {
        const svg = document.querySelector('svg[aria-label="Options"]');
        return svg ? svg.closest('div[role="button"]') : null;
      });
      console.log("optionsBtn", optionsBtn);
      if (optionsBtn) {
        console.log("inside if of optionsBtn");
        await optionsBtn.click();
        await sleep(1000);

        // Click "Send message" from dropdown
        await page.waitForSelector('div[role="dialog"]', { timeout: 5000 });

        const sendMsgBtn = await page.evaluateHandle(() => {
          const buttons = Array.from(
            document.querySelectorAll('div[role="dialog"] button')
          );
          return buttons.find(
            (btn) => btn.innerText.trim().toLowerCase() === "send message"
          );
        });

        if (sendMsgBtn) {
          await sendMsgBtn.click();
          messageBoxReady = true;
          console.log(`👉 Clicked Options → Send message`);
        } else {
          console.log("❌ Could not find Send message button in menu");
        }
      }
    } catch (err) {
      console.log(`❌ Could not open DM composer for ${username}`);
      return;
    }
  }

  // --- Wait for DM composer text field ---
  const textboxSelector = 'div[role="textbox"][aria-label="Message"]';
  try {
    await page.waitForSelector(textboxSelector, { timeout: 15000 });
  } catch {
    console.log(`❌ Message box did not appear for ${username}`);
    return;
  }

  // Build message
  const message = `Hi ${username}, 
Hope you're doing great!

I'm reaching out on behalf of ${brandName}, a brand passionate about promoting healthier, more sustainable gardens and farms. We create natural, eco-friendly plant nutrition solutions and we're proud to be a 1% for the Planet member, contributing a portion of our annual sales to environmental causes.

We'd love to collaborate with creators who care about sustainability, gardening, home greenery, or clean living. If that sounds like you, we'd be happy to share more about how we can work together.

Looking forward to connecting!
Warmly,
${contactName}`;

  // Type & send
  await typeMultilineMessage(page, textboxSelector, message);

  // Try Enter-to-send
  await page.keyboard.press("Enter");
  await sleep(2000);

  // Fallback: click the blue "Send" button if Enter didn’t work
  try {
    const [sendBtn] = await page.$x(
      '//div[@role="button" and normalize-space(text())="Send"]'
    );
    if (sendBtn) {
      await sendBtn.click();
      console.log(`✅ Sent message by clicking Send button`);
    } else {
      console.log(`✅ Sent message by pressing Enter`);
    }
  } catch {
    console.log(`✅ Sent message (Enter key only)`);
  }

  console.log(`✅ Finished sending to ${username}`);
  await sleep(3000);
}

(async () => {
  const { username, password } = loadCredentialsFromEnv();
  const profiles = loadProfiles();

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });
  const page = await browser.newPage();

  // Login
  await loginInstagramWithVerification(page, username, password);

  for (const p of profiles) {
    try {
      await sendMessage(page, p);
    } catch (err) {
      console.error(`❌ Failed for ${p.username}:`, err.message);
    }
    await sleep(5000 + Math.random() * 5000);
  }

  await browser.close();
})();

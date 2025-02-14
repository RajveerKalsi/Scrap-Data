const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // Open browser window
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });
  const page = await browser.newPage();

  // Set user-agent to avoid bot detection
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  );

  // Navigate to the reviews page
  await page.goto('https://www.g2.com/products/freshworks/reviews#reviews', {
    waitUntil: 'networkidle2',
  });

  console.log('Please solve the CAPTCHA. Waiting for 30 seconds...');
  await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait for CAPTCHA

  // Scroll to load more reviews
  let previousHeight;
  do {
    previousHeight = await page.evaluate('document.body.scrollHeight');
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for content to load
  } while ((await page.evaluate('document.body.scrollHeight')) > previousHeight);

  // Scrape review data
  const reviews = await page.evaluate(() => {
    const reviewElements = document.querySelectorAll('div.paper__bd');
    return Array.from(reviewElements).map((review) => review.innerText.trim());
  });

  console.log('Scraped Reviews:', reviews);

  // Save the full HTML content of the page
  const pageContent = await page.content();
  fs.writeFileSync('cloned_g2_page.html', pageContent);

  await browser.close();
})();

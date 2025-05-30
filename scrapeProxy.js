const axios = require('axios');
const fs = require('fs');

const keywords = [
  "transport wheelchair",
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchData = async (keyword, retries = 3) => {
  const options = {
    method: 'POST',
    url: 'https://scraper-api.smartproxy.com/v2/scrape',
    headers: {
      'Accept': 'application/json',
      'Authorization': 'Basic VTAwMDAxNDUyNjI6RTZvanNmMmV1OGh3VlI1RGpq', 
      'Content-Type': 'application/json',
    },
    data: {
      url: `https://www.walmart.com/search?q=${encodeURIComponent(keyword)}`,
      parse: true,
      headless: 'html', 
      geo: 'US',
      device_type: 'desktop',
    }
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching data for: ${keyword} (Attempt ${attempt})`);
      const response = await axios.request(options);
      const jsonData = JSON.stringify(response.data, null, 2);

      const filename = `walmart_${keyword.replace(/\s+/g, '_')}.json`;
      fs.writeFileSync(filename, jsonData, 'utf8');
      console.log(`✅ JSON saved: ${filename}`);

      return;
    } catch (error) {
      console.error(`❌ Error fetching ${keyword} (Attempt ${attempt}):`, error.response?.status || error.message);
      if (attempt === retries) {
        console.log(`❌ Failed after ${retries} attempts. Skipping ${keyword}...`);
      } else {
        await delay(5000); 
      }
    }
  }
};

const startScraping = async () => {
  for (const keyword of keywords) {
    await fetchData(keyword);
    await delay(3000); // Wait 3 seconds before next request
  }
};

startScraping();




// const fs = require("fs");
// const puppeteer = require("puppeteer");

// const keywords = [
//   "cast iron fish shaped skillet",
//   "apple candy",
//   "cream filled cake",
//   "chocolate biscuit",
//   "mattress 14 inch",
//   "gummy bear",
//   "10 inch queen mattress",
//   "orange candy",
//   "chocolate cookie",
//   "fruit flavoured gummies",
//   "natural gummies",
//   "cast iron loaf pan",
//   "10 inch full size mattress",
//   "cast iron dutch oven",
//   "enameled cast iron bread oven",
//   "cast iron lasagna pan",
//   "4 inch memory foam mattress topper",
//   "cast iron baking tray",
//   "cookie snacks",
//   "mount it"
// ];

// // Replace these with your actual Smartproxy credentials
// const PROXY_USERNAME = "U0000145262";
// const PROXY_PASSWORD = "E6ojsf2eu8hwVR5Djj";
// const PROXY_SERVER = "proxy.smartproxy.com";
// const PROXY_PORT = "10000"; // Change this to the correct Smartproxy port 

// const scrape = async (keyword) => {
//   try {
//     const searchQuery = encodeURIComponent(keyword);
//     const browser = await puppeteer.launch({
//       headless: "new",
//       args: [
//         `--proxy-server=http://${PROXY_SERVER}:${PROXY_PORT}`,
//         "--no-sandbox",
//         "--disable-setuid-sandbox"
//       ]
//     });

//     const page = await browser.newPage();

//     // Authenticate with proxy
//     await page.authenticate({
//       username: PROXY_USERNAME,
//       password: PROXY_PASSWORD,
//     });

//     await page.setExtraHTTPHeaders({
//       "Content-Type": "application/json",
//       Authorization: "Basic VTAwMDAxNDUyNjI6RTZvanNmMmV1OGh3VlI1RGpq",
//     });

//     await page.goto(`https://www.walmart.com/search?q=${searchQuery}`, { waitUntil: "networkidle2" });

//     await autoScroll(page);

//     const htmlContent = await page.content();
//     const filename = `walmart_${searchQuery.replace(/%20/g, '_')}.html`;

//     fs.writeFileSync(filename, htmlContent, "utf8");
//     console.log(`HTML content saved to ${filename}`);

//     await browser.close();
//   } catch (error) {
//     console.error(`Error scraping Walmart for '${keyword}':`, error);
//   }
// };

// // Auto-scroll function to load all products
// async function autoScroll(page) {
//   await page.evaluate(async () => {
//     await new Promise((resolve) => {
//       let totalHeight = 0;
//       const distance = 100;
//       const timer = setInterval(() => {
//         window.scrollBy(0, distance);
//         totalHeight += distance;

//         if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
//           clearInterval(timer);
//           resolve();
//         }
//       }, 300);
//     });
//   });
// }

// const scrapeAllKeywords = async () => {
//   for (const keyword of keywords) {
//     await scrape(keyword);
//   }
// };

// scrapeAllKeywords();




// const fs = require("fs");

// const keywords = [
//   "cast iron fish shaped skillet",
//   "apple candy",
//   "cream filled cake",
//   "chocolate biscuit",
//   "mattress 14 inch",
//   "gummy bear",
//   "10 inch queen mattress",
//   "orange candy",
//   "chocolate cookie",
//   "fruit flavoured gummies",
//   "natural gummies",
//   "cast iron loaf pan",
//   "10 inch full size mattress",
//   "cast iron dutch oven",
//   "enameled cast iron bread oven",
//   "cast iron lasagna pan",
//   "4 inch memory foam mattress topper",
//   "cast iron baking tray",
//   "cookie snacks",
//   "mount it"
// ];

// const scrape = async (keyword) => {
//   try {
//     const fetch = (await import("node-fetch")).default;
//     const searchQuery = encodeURIComponent(keyword);
//     const response = await fetch("https://scraper-api.smartproxy.com/v2/scrape", {
//       method: "POST",
//       body: JSON.stringify({
//         url: `https://www.walmart.com/search?q=${searchQuery}`,
//         headless: "html",
//         render_js: true,
//         js_scroll: true,
//         js_scroll_max: 10,
//         wait_for: ".search-result-gridview-items",
//         wait_for_timeout: 10000,
//         target: "universal",
//         locale: "en-us",
//         geo: "United States",
//         device_type: "desktop",
//       }),
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: "Basic VTAwMDAxNDUyNjI6RTZvanNmMmV1OGh3VlI1RGpq",
//       },
//     });

//     if (!response.ok) {
//       throw new Error(`HTTP error! Status: ${response.status}`);
//     }

//     const data = await response.json();
//     if (data.results && data.results.length > 0) {
//       const htmlContent = data.results[0].content;
//       const filename = `walmart_${searchQuery.replace(/%20/g, '_')}.html`;

//       fs.writeFileSync(filename, htmlContent, "utf8");
//       console.log(`HTML content saved to ${filename}`);
//     } else {
//       console.log(`No content found for keyword: ${keyword}`);
//     }
//   } catch (error) {
//     console.error(`Error scraping Walmart for '${keyword}':`, error);
//   }
// };

// const scrapeAllKeywords = async () => {
//   for (const keyword of keywords) {
//     await scrape(keyword);
//   }
// };

// scrapeAllKeywords();
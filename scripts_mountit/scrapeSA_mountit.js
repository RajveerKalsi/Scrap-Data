const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const fs = require("fs");
const Papa = require("papaparse");
require("dotenv").config();

async function readUrlsFromFile(filePath) {
  const csvData = fs.readFileSync(filePath, "utf8");
  const parsedData = Papa.parse(csvData, { header: true }).data;

  return parsedData.map((row) => ({
    parentSKU: row["Parent Sku"] || null,
    marketplaceSKU: row["Marketplace SKU"] || null,
    itemId: row["SKU"],
  }));
}

async function loginAndGetPage() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 980 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });

  try {
    console.log("🧭 Navigating to login page...");
    await page.goto("https://www.staplesadvantage.com/idm", {
      waitUntil: "networkidle2",
    });

    console.log("⚠️ Please complete login manually (including CAPTCHA).");
    console.log("⏳ Waiting for login to finish...");

    // Wait until user is redirected (new page or dashboard)
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 0 });

    // Check if still on login page
    if (page.url().includes("idm")) {
      console.log("⚠️ Still on login page — login might have failed.");
      return null;
    }

    console.log("✅ Login successful, continuing to scraping...");
    return { browser, page };
  } catch (err) {
    console.error("❌ Login failed:", err.message);
    await browser.close();
    return null;
  }
}


async function fetchProductData(page, url, itemId, parentSKU, marketplaceSKU) {
  try {
    await page.goto(url, { waitUntil: "networkidle2" });
    const html = await page.content();
    const $ = cheerio.load(html);

    const productTitle = $(".product-info-ux2dot0__product_title span").first().text().trim() || "Not Found";
    const priceText = $(".price-info__final_price_sku").text().trim();
    const price = priceText || "Not Found";
    const outOfStockMessage = $(".purchasing-option-pickers__purchasing_option_text").length;
    const stockStatus = outOfStockMessage > 0 ? "True" : "False";

    return {
      itemId,
      parentSKU,
      marketplaceSKU,
      productTitle,
      price,
      stockStatus,
      url,
    };
  } catch (err) {
    console.error(`❌ Failed to fetch ${url}:`, err.message);
    return {
      itemId,
      parentSKU,
      marketplaceSKU,
      productTitle: "Not Found",
      price: "Not Found",
      stockStatus: "Not Found",
      url,
    };
  }
}

async function saveResultsToCSV(allResults) {
  const today = new Date()
    .toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(",", " -");

  const csvData = allResults.map((item) => ({
    Date: today,
    ItemId: item.itemId || "n/a",
    "Parent SKU": item.parentSKU || "Not Found",
    "Marketplace SKU": item.marketplaceSKU || "Not Found",
    ProductTitle: item.productTitle || "Not Found",
    Price: item.price || "Not Found",
    StockAvailability: item.stockStatus || "Not Found",
    url: item.url || "n/a",
  }));

  const csv = Papa.unparse(csvData);
  const filePath = "test_scraped_data_staples_mountit.csv";

  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, "\n" + csv.split("\n").slice(1).join("\n"));
  } else {
    fs.writeFileSync(filePath, csv);
  }
}

async function fetchAllProductsData(page, data) {
  let successfulFetchCount = 0;
  let unsuccessfulFetchCount = 0;
  const limit = process.env.NODE_ENV === "DEV" ? 2 : data.length;
  const batchSize = 5;
  const totalBatches = Math.ceil(limit / batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, limit);
    const batch = data.slice(batchStart, batchEnd);

    console.log(`🚀 Processing batch ${batchIndex + 1}/${totalBatches}...`);

    const batchResults = [];
    for (const item of batch) {
      if (!item.itemId || item.itemId.toLowerCase() === "n/a") continue;
      const url = `https://www.staplesadvantage.com/product_${item.itemId}`;
      const productData = await fetchProductData(page, url, item.itemId, item.parentSKU, item.marketplaceSKU);
      batchResults.push(productData);

      if (productData.productTitle !== "Not Found") successfulFetchCount++;
      else unsuccessfulFetchCount++;
    }

    await saveResultsToCSV(batchResults);
    console.log(`✅ Batch ${batchIndex + 1} done - Success: ${successfulFetchCount}, Fail: ${unsuccessfulFetchCount}`);
  }
}

async function main() {
  const loginSession = await loginAndGetPage();
  if (!loginSession) return;
  const { browser, page } = loginSession;

  const filePath = "../csvs_mountit/staplesSKUNew.csv";
  const data = await readUrlsFromFile(filePath);

  if (data.length > 0) {
    await fetchAllProductsData(page, data);
  } else {
    console.log("No data found in file.");
  }

  await browser.close();
  console.log("🎯 Scraping complete, browser closed.");
}

main();

const puppeteer = require("puppeteer");
const fs = require("fs");
const Papa = require("papaparse");
const { Client } = require("pg");
require("dotenv").config();

async function readUrlsFromFile(filePath) {
  const csvData = fs.readFileSync(filePath, "utf8");
  const parsedData = Papa.parse(csvData, { header: true }).data;

  return parsedData
    .map((row) => ({
      parentSKU: row[""] || null,
      marketplaceSKU: row["Mount-It Sku"] || null,
      itemId: row["BBY Sku"],
    }))
    .filter((product) => product.itemId);
}

async function fetchProductData(url, retries = 10) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      const browser = await puppeteer.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      await page.waitForSelector("#large-customer-price", { timeout: 15000 });

      const data = await page.evaluate(() => {
        const noResultsBlock = document
          .querySelector(".no-results-found-block h3")
          ?.innerText.includes("we didn’t find anything");
        const discontinuedMessage = [
          ...document.querySelectorAll("div.text-danger"),
        ].some((el) =>
          el.innerText.includes(
            "This item is no longer available in new condition"
          )
        );
        const soldOut = [...document.querySelectorAll("div strong")].some(
          (el) => el.innerText.trim() === "Sold Out"
        );

        const outOfStock = noResultsBlock || discontinuedMessage || soldOut;

        const title =
          document.querySelector("h1.h4")?.innerText.trim() || "Not Found";
        const price =
          document.querySelector("#large-customer-price")?.innerText.trim() ||
          "Not Found";

        return {
          title,
          price,
          stock: outOfStock ? "False" : "True",
        };
      });

      await browser.close();
      return data;
    } catch (error) {
      console.error(
        `Attempt ${attempt + 1} failed for ${url}: ${error.message}`
      );
      attempt++;
      if (attempt >= retries) {
        console.error(`Giving up on ${url} after ${retries} attempts.`);
        return { title: "Not Found", price: "Not Found", stock: "Not Found" };
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function fetchAllProductsData(productList) {
  let results = [];
  for (let i = 0; i < productList.length; i++) {
    const product = productList[i];
    const url = `https://www.bestbuy.com/product/${product.itemId}`;
    console.log(`Fetching data for: ${url}`);

    const productData = await fetchProductData(url);
    results.push({
      parentSKU: product.parentSKU,
      marketplaceSKU: product.marketplaceSKU,
      itemId: product.itemId,
      title: productData.title,
      price: productData.price,
      stock: productData.stock,
    });

    if (results.length >= 10 || i === productList.length - 1) {
      console.log("Saving batch to database...");
      await saveResultsToPostgres(results);
      //   await saveResultsToCSV(results, "test_scraped_data_bestbuy_mountit.csv");
      results = [];
    }
  }
}
async function saveResultsToCSV(data, filePath) {
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

  const csvData = data.map((item) => ({
    Date: today,
    ItemId: item.itemId || "n/a",
    "Parent SKU": item.parentSKU || "Not Found",
    "Marketplace SKU": item.marketplaceSKU || "Not Found",
    ProductTitle: item.title || "Not Found",
    Price: item.price || "Not Found",
    StockAvailability: item.stock || "Not Found",
  }));

  const csv = Papa.unparse(csvData);
  const outputFilePath = filePath || "scraped_data.csv";

  if (fs.existsSync(outputFilePath)) {
    fs.appendFileSync(
      outputFilePath,
      "\n" + csv.split("\n").slice(1).join("\n")
    );
  } else {
    fs.writeFileSync(outputFilePath, csv);
  }
  console.log(`Results saved to ${outputFilePath}`);
}

async function saveResultsToPostgres(results) {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();
    const queryText = `
            INSERT INTO "Records"."BBTracker" ("trackingDate", "parentSku", "marketplaceSku", "itemId", "productTitle", "price", "inStock", "brandName")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

    const today = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
    });
    const brandName = "Mountit";

    for (const item of results) {
      const price =
        item.price && typeof item.price === "string"
          ? parseFloat(item.price.replace(/[^0-9.-]+/g, ""))
          : null;

      const values = [
        today,
        item.parentSKU || "n/a",
        item.marketplaceSKU || null,
        item.itemId || "n/a",
        item.title || "Not Found",
        price,
        item.stock || "Not Found",
        brandName,
      ];
      await client.query(queryText, values);
    }

    console.log("Data successfully inserted into PostgreSQL.");
  } catch (error) {
    console.error("Failed to insert data into PostgreSQL:", error.message);
  } finally {
    await client.end();
  }
}

async function main() {
  const filePath = "../csvs_mountit/bbSKU.csv";

  const data = await readUrlsFromFile(filePath);
  const limit = process.env.NODE_ENV === "DEV" ? 2 : data.length;
  const limitedData = data.slice(0, limit);

  if (limitedData.length > 0) {
    await fetchAllProductsData(limitedData);
  } else {
    console.log("No valid data found in file.");
  }
}

main();

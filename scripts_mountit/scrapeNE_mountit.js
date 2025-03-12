const axios = require("axios");
const cheerio = require("cheerio");
const fs = require('fs');
const Papa = require('papaparse');
const { Client } = require('pg');
const cron = require('node-cron');

require('dotenv').config();

async function readUrlsFromFile(filePath) {
    const csvData = fs.readFileSync(filePath, 'utf8');
    const parsedData = Papa.parse(csvData, { header: true }).data;

    return parsedData.map(row => ({
        parentSKU: row['Parent Sku'] || null,
        marketplaceSKU: row['Marketplace SKU'] || null,
        itemId: row['SKU'],
        url: row['Links'] || null,
    }));
}

async function fetchData(url, retries = 10) {
    let attempt = 0;
    while (attempt < retries) {
        try {
            const response = await axios.post(
                "https://scraper-api.smartproxy.com/v2/scrape",
                {
                    target: "universal",
                    url,
                    headless: "html",
                    geo: "United States",
                    locale: "en-us",
                    domain: "com",
                    device_type: "desktop_chrome",
                    force_headers: true,
                    force_cookies: true,
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Basic VTAwMDAxNDY0ODg6UFcxYjU5NjI1NmIwNzk0ZjlkNGEyZjRhYmFkZmRkZDUzZjQ=`,
                    },
                }
            );

            if (response.data?.results?.[0]?.content) {
                return cheerio.load(response.data.results[0].content); // Load HTML into Cheerio
            } else {
                console.error("Invalid response format:", response.data);
                return null;
            }
        } catch (error) {
            if (error.response) {
                console.error(`Attempt ${attempt + 1} failed for ${url}: Status ${error.response.status}`);
                if (error.response.status === 500) {
                    return null;
                }
            } else {
                console.error(`Attempt ${attempt + 1} failed for ${url}: ${error.message}`);
            }
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    return null;
}

async function fetchTitle($) {
    return $("h1.product-title").text().trim() || null;
}

async function fetchPrice($) {
    const priceContainer = $(".price-new-right .price-current");
    const dollars = priceContainer.find("strong").first().text().trim();
    const cents = priceContainer.find("sup").first().text().trim();
    
    return dollars ? `$${dollars}${cents}` : null;
}

async function fetchStock($) {
    return $("#ProductBuy .btn-message:contains('Out of Stock')").length > 0 ? "False" : "True";
}

async function scrapeProductData(url) {
    const $ = await fetchData(url);
    if (!$) {
        console.error(`Failed to scrape data from ${url}`);
        return null;
    }

    const productData = {
        title: await fetchTitle($),
        price: await fetchPrice($),
        stock: await fetchStock($),
    };

    return productData;
}

async function fetchAllProductsData(data) {
    const totalLimit = process.env.NODE_ENV === 'DEV' ? 2 : data.length;
    const batchSize = 10;
    const allResults = [];

    console.log(`🔹 Running in ${process.env.NODE_ENV} mode. Processing up to ${totalLimit} items.`);

    for (let i = 0; i < totalLimit; i += batchSize) {
        const batch = data.slice(i, Math.min(i + batchSize, totalLimit));

        console.log(`🚀 Processing batch: ${i / batchSize + 1}`);

        const batchResults = await Promise.all(batch.map(async (item) => {
            if (!item.url) return null;

            console.log(`🔍 Scraping ${item.url} for ${item.itemId}...`);
            const productData = await scrapeProductData(item.url);

            if (productData) {
                return {
                    itemId: item.itemId,
                    parentSKU: item.parentSKU,
                    marketplaceSKU: item.marketplaceSKU,
                    productTitle: productData.title,
                    price: productData.price,
                    stockStatus: productData.stock,
                };
            }
            return null;
        }));

        const validResults = batchResults.filter(result => result !== null);
        allResults.push(...validResults);

        console.log(`✅ Scraped ${validResults.length} products in batch ${i / batchSize + 1}`);

        // Push batch to CSV after each batch
        // await saveResultsToCSV(validResults);
        await saveResultsToPostgres(validResults);
    }

    console.log(`🏁 Scraping completed for ${allResults.length} products.`);
}



async function saveResultsToCSV(allResults) {
    const today = new Date().toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(',', ' -'); 

    const csvData = allResults.map(item => ({
        Date: today,
        ItemId: item.itemId || 'n/a',
        'Parent SKU': item.parentSKU || 'Not Found',
        'Marketplace SKU': item.marketplaceSKU || 'Not Found',
        ProductTitle: item.productTitle || 'Not Found',
        Price: item.price || 'Not Found',
        StockAvailability: item.stockStatus || 'Not Found'
    }));

    const csv = Papa.unparse(csvData);

    const filePath = 'test_scraped_data_NewEgg_mountit.csv';

    // Append to the existing CSV if it exists; otherwise, create a new one
    if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, '\n' + csv.split('\n').slice(1).join('\n'));
    } else {
        fs.writeFileSync(filePath, csv);
    }
}


async function saveResultsToPostgres(batchResults) {
    const client = new Client({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        await client.connect();
        const queryText = `
            INSERT INTO "Records"."NewEggTracker" ("trackingDate", "itemId", "parentSku", "marketplaceSku", "productTitle", "price", "inStock", "brandName")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const brandName = 'Mountit';

        for (const item of batchResults) {
            const values = [
                today,
                item.itemId || 'n/a',
                item.parentSKU || null,
                item.marketplaceSKU || null,
                item.productTitle || "Not Found",
                item.price && item.price !== "n/a"
                    ? parseFloat(item.price.replace(/[^0-9.-]+/g, ""))
                    : null,
                item.stockStatus || "Not Found",
                brandName
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
    const filePath = '../csvs_mountit/newEggSKU.csv';

    const data = await readUrlsFromFile(filePath);
    if (data.length > 0) {
        data.forEach(item => {
            console.log(`ItemId: ${item.itemId} - PDP Link: ${item.url}`);
        });
        await fetchAllProductsData(data);
    } else {
        console.log("No data found in file.");
    }
}

main();


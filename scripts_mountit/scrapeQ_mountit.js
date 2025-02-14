const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const Papa = require('papaparse');
const { Client } = require('pg');
const cron = require('node-cron');

require('dotenv').config();

async function readUrlsFromFile(filePath) {
    const csvData = fs.readFileSync(filePath, 'utf8');
    const parsedData = Papa.parse(csvData, { header: true }).data;

    return parsedData.map(row => ({
        baseFindNum: row['BASE_FIND_NUM'],
        corporateSku: row['CORPORATE_SKU'],
        vItemModelNum: row['VITEM_MODEL_NUM'],
        itemId: row['ABSOLUTE_NUM'],
    }));
}

async function fetchData(url, retries = 10) {
    let attempt = 0;
    while (attempt < retries) {
        try {
            const { data } = await axios.get(url);
            return cheerio.load(data);
        } catch (error) {
            console.error(`Attempt ${attempt + 1} failed for ${url}: ${error.message}`);
            attempt++;
            if (attempt >= retries) {
                console.error(`Giving up on ${url} after ${retries} attempts.`);
                return null;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    return null;
}

async function fetchTitle($) {
    return $('h1').text().trim();
}

async function fetchPrice($) {
    return $('.h2.mb-2.savings-highlight-wrap').text().trim();
}

async function fetchStock($) {
    const outOfStockMessage = $('.promo-flag').text().includes('Out of stock');
    return outOfStockMessage ? "False" : "True"; ;
}

async function fetchAvailability($) {
    const availabilityText = $('div.h6.my-3').text().trim();

    if (availabilityText.includes("no longer available") || availabilityText.includes("Choose an alternative")) {
        return "No";  // Item is unavailable
    }
    return "Yes";  // Item is available
}


async function fetchProductData(url, itemId, baseFindNum, corporateSku, vItemModelNum) {
    const $ = await fetchData(url);
    if ($) {
        const productTitle = await fetchTitle($);
        const price = await fetchPrice($);
        const stockStatus = await fetchStock($);
        const availability = await fetchAvailability($);

        if (availability === "No") {
            return {
                itemId,
                baseFindNum,
                corporateSku,
                vItemModelNum,
                productTitle: "Not Found",
                price: "Not Found",
                stockStatus: "Not Found",
            };
        }

        return { itemId, baseFindNum, corporateSku, vItemModelNum, productTitle, price, stockStatus, availablilty: availability, html: $.html() };
    }
    return null;
}

async function fetchAllProductsData(data, retries = 50) {
    let successfulFetchCount = 0;
    let unsuccessfulFetchCount = 0;
    let unsuccessfulIds = [];
    const missingUrlIds = [];
    let missingUrlCount = 0;

    const limit = process.env.NODE_ENV === 'DEV' ? 2 : data.length;
    const batchSize = 10;
    const totalBatches = Math.ceil(limit / batchSize);

    // Processing data in batches of 10
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, limit);
        const batch = data.slice(batchStart, batchEnd);

        const batchResults = await Promise.all(batch.map(async (item) => {
            if (!item.itemId || item.itemId.toLowerCase() === 'n/a') {
                console.log(`Invalid itemId for baseFindNum: ${item.baseFindNum}, corporateSku: ${item.corporateSku}, vItemModelNum: ${item.vItemModelNum}`);
                missingUrlCount++; 
                missingUrlIds.push(item.itemId || 'n/a');
                return {
                    itemId: item.itemId || 'n/a',
                    baseFindNum: item.baseFindNum,
                    corporateSku: item.corporateSku,
                    vItemModelNum: item.vItemModelNum,
                    productTitle: "n/a",
                    price: "n/a",
                    stockStatus: "n/a"
                };
            }

            // Construct the URL using itemId
            item.url = `https://www.quill.com/${item.vitemModelNum}/cbs/${item.itemId}.html`;

            const productData = await fetchProductData(item.url, item.itemId, item.baseFindNum, item.corporateSku, item.vItemModelNum);

            if (productData && productData.productTitle !== "Not Found") {
                successfulFetchCount++;
            } else {
                unsuccessfulFetchCount++;
            }

            return productData || {
                itemId: item.itemId,
                baseFindNum: item.baseFindNum,
                corporateSku: item.corporateSku,
                vItemModelNum: item.vItemModelNum,
                productTitle: "Not Found",
                price: "Not Found",
                stockStatus: "Not Found"
            };
        }));

        const validResults = batchResults.filter(data => data);

        // Saving results to CSV and Postgres
        // await saveResultsToCSV(validResults);
        await saveResultsToPostgres(batchResults);

        // Logging batch details
        console.log(`Batch ${batchIndex + 1} processed:`);
        console.log(`Successful fetches: ${successfulFetchCount}`);
        console.log(`Unsuccessful fetches: ${unsuccessfulFetchCount}`);
        console.log(`Missing URL count: ${missingUrlCount}`);
        if (unsuccessfulIds.length > 0) {
            console.log(`Unsuccessful fetch IDs: ${unsuccessfulIds.join(', ')}`);
        }
    }
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
        'Base Find Num': item.baseFindNum || 'Not Found',
        'Corporate Sku': item.corporateSku || 'Not Found',
        'V Item Model Num': item.vItemModelNum || 'Not Found',
        ProductTitle: item.productTitle || 'Not Found',
        Price: item.price || 'Not Found',
        StockAvailability: item.stockStatus || 'Not Found'
    }));

    const csv = Papa.unparse(csvData);

    const filePath = 'test_scraped_data_quill_mountit.csv';

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
            INSERT INTO "Records"."QuillTracker" ("trackingDate", "itemId", "marketplaceSku", "productTitle", "price", "inStock", "brandName")
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const brandName = 'Mountit';

        for (const item of batchResults) {
            const values = [
                today,
                item.itemId || 'n/a',
                item.vItemModelNum,
                item.productTitle || "Not Found",
                item.price === "n/a" ? null : parseFloat(item.price.replace(/[^0-9.-]+/g, "")),
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
    const filePath = 'C:\\VS Code\\Scrap Data\\csvs_mountit\\quillSKU.csv';

    const data = await readUrlsFromFile(filePath);
    if (data.length > 0) {
        data.forEach(item => {
            console.log(`ItemId: ${item.itemId} - VItemModelNum: ${item.vItemModelNum}`);
        });
        await fetchAllProductsData(data);
    } else {
        console.log("No data found in file.");
    }
}

main();
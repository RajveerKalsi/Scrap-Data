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
        parentSKU: row['Parent Sku'] || null,
        marketplaceSKU: row['Marketplace SKU'] || null,
        itemId: row['SKU'],
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
    return $('h1[itemprop="name"]').text().trim();
}

async function fetchPrice($) {
    return $('.od-graphql-price-big-price').first().text().trim();
}

async function fetchStock($) {
    const addToCartButton = $('.call-to-action-wrapper .common-add-to-cart');
    return addToCartButton.length > 0 ? "True" : "False";
}


async function fetchProductData(url, itemId, marketplaceSKU, parentSKU, failedItems = new Set()) {
    if (failedItems.has(itemId)) {
        return {
            itemId,
            parentSKU,
            marketplaceSKU,
            productTitle: "Unsuccessful",
            price: "Unsuccessful",
            stockStatus: "Unsuccessful",
            html: "Unsuccessful"
        };
    }

    const $ = await fetchData(url);
    if ($) {
        const unavailableMessage = $('h1:contains("We are sorry, but Office Depot is currently not available in your country")').length > 0;
        const notFoundMessage = $('h1[auid="sku-failure-heading"]').length > 0;

        if (unavailableMessage || notFoundMessage) {
            failedItems.add(itemId); // Mark as failed to avoid future retries
            return {
                itemId,
                parentSKU,
                marketplaceSKU,
                productTitle: "Not Found",
                price: "Not Found",
                stockStatus: "Not Found",
                html: $.html()
            };
        }

        const productTitle = await fetchTitle($);
        const price = await fetchPrice($);
        const stockStatus = await fetchStock($);

        return { itemId, parentSKU, marketplaceSKU, productTitle, price, stockStatus, html: $.html() };
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
                console.log(`Invalid itemId for parentSKU: ${item.parentSKU}, marketplaceSKU: ${item.marketplaceSKU}`);
                missingUrlCount++; // Increment missing URL count for 'n/a'
                missingUrlIds.push(item.itemId || 'n/a');
                return {
                    itemId: item.itemId || 'n/a',
                    parentSKU: item.parentSKU,
                    marketplaceSKU: item.marketplaceSKU,
                    productTitle: "n/a",
                    price: "n/a",
                    stockStatus: "n/a"
                };
            }

            // Construct the URL using itemId
            item.url = `https://www.officedepot.com/a/products/${item.itemId}`;

            const productData = await fetchProductData(item.url, item.itemId, item.parentSKU, item.marketplaceSKU);

            if (productData && productData.productTitle !== "Not Found") {
                successfulFetchCount++; 
            } else {
                unsuccessfulFetchCount++; 
            }

            return productData || {
                itemId: item.itemId,
                parentSKU: item.parentSKU,
                marketplaceSKU: item.marketplaceSKU,
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
        'Parent SKU': item.parentSKU || 'Not Found',
        'Marketplace SKU': item.marketplaceSKU || 'Not Found',
        ProductTitle: item.productTitle || 'Not Found',
        Price: item.price || 'Not Found',
        StockAvailability: item.stockStatus || 'Not Found',
        URL: item.url || "n/a",
    }));

    const csv = Papa.unparse(csvData);

    const filePath = 'test_scraped_data_office_depot_mountit.csv';

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
            INSERT INTO "Records"."OfficeDepotTracker" ("trackingDate", "itemId", "marketplaceSku", "productTitle", "price", "inStock", "brandName")
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const brandName = 'Mountit';

        for (const item of batchResults) {
            const values = [
                today,
                item.itemId || 'n/a',
                item.marketplaceSKU || null,
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
    const filePath = '../csvs_mountit/officeDepotSKU.csv';

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

// cron.schedule('0 23 * * *', async () => {
//     console.log("Starting scheduled task...");
//     await main();
//     console.log("Scheduled task completed.");
// }, {
//     timezone: "Asia/Kolkata"
// });

main();
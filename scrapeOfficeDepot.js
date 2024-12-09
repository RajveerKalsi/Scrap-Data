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
        url: row['PDP Link'] || 'NULL',
        itemId: row['Item # (Office Depot sku #) '],
        vendorPartNo: row['Vendor Part # '] || null
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
    return addToCartButton.length > 0 ? "Available" : "Out of Stock";
}


async function fetchProductData(url, itemId, vendorPartNo, failedItems = new Set()) {
    if (failedItems.has(itemId)) {
        return {
            itemId,
            vendorPartNo,
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
                vendorPartNo,
                productTitle: "Not Found",
                price: "Not Found",
                stockStatus: "Not Found",
                html: $.html()
            };
        }

        const productTitle = await fetchTitle($);
        const price = await fetchPrice($);
        const stockStatus = await fetchStock($);

        return { itemId, vendorPartNo, productTitle, price, stockStatus, html: $.html() };
    }

    return null;
}


async function fetchAllProductsData(data, retries = 50) {
    let successfulFetchCount = 0;
    let unsuccessfulFetchCount = 0;
    let unsuccessfulIds = [];
    const missingUrlIds = [];
    let missingUrlCount = 0;

    const limit = process.env.NODE_ENV === 'DEV' ? 20 : data.length;
    const batchSize = 10;
    const totalBatches = Math.ceil(limit / batchSize);

    // Processing data in batches of 10
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, limit);
        const batch = data.slice(batchStart, batchEnd);

        const batchResults = await Promise.all(batch.map(async (item) => {
            // Handling missing URLs (check if 'NULL')
            if (item.url === 'NULL') {
                missingUrlCount++;
                missingUrlIds.push(item.itemId);
                item.url = `https://www.officedepot.com/a/products/${item.itemId}`;
            }

            const productData = await fetchProductData(item.url, item.itemId, item.vendorPartNo);
            if (productData) {
                if (productData.productTitle === "Not Found") {
                    unsuccessfulFetchCount++;
                    unsuccessfulIds.push(item.itemId);
                } else {
                    successfulFetchCount++;
                }
                return productData;
            } else {
                unsuccessfulFetchCount++;
                unsuccessfulIds.push(item.itemId);
                return { itemId: item.itemId, vendorPartNo: item.vendorPartNo, productTitle: "Not Found", price: "Not Found", stockStatus: "Not Found" };
            }
        }));

        const validResults = batchResults.filter(data => data && data.productTitle !== "Not Found");

        // Saving results to CSV and Postgres
        await saveResultsToCSV(validResults, unsuccessfulIds);
        await saveResultsToPostgres(batchResults);

        // Logging batch details
        console.log(`Batch ${batchIndex + 1} processed:`);
        console.log(`Successful fetches: ${successfulFetchCount}`);
        console.log(`Unsuccessful fetches: ${unsuccessfulFetchCount}`);
        console.log(`Missing URL count: ${missingUrlCount}`);
        if (unsuccessfulIds.length > 0) {
            console.log(`Unsuccessful fetch IDs: ${unsuccessfulIds.join(', ')}`);
        }
        if (missingUrlIds.length > 0) {
            console.log(`Missing URL IDs: ${missingUrlIds.join(', ')}`);
        }

        // Retry mechanism for failed URLs (only retry once per batch)
        if (unsuccessfulIds.length > 0) {
            console.log(`Retrying failed URLs in batch ${batchIndex + 1}, attempt 1`);

            // Fetching failed URLs again within the same batch
            const failedUrls = batch.filter(item => unsuccessfulIds.includes(item.itemId));

            const retryResults = await Promise.all(failedUrls.map(async (item) => {
                const productData = await fetchProductData(item.url, item.itemId, item.vendorPartNo);
                if (productData && productData.productTitle !== "Not Found") {
                    successfulFetchCount++;
                    return productData;
                } else {
                    return { itemId: item.itemId, vendorPartNo: item.vendorPartNo, productTitle: "Not Found", price: "Not Found", stockStatus: "Not Found" };
                }
            }));

            const successfulRetries = retryResults.filter(result => result.productTitle !== "Not Found");

            // Update unsuccessfulIds to remove successful retries
            unsuccessfulIds = unsuccessfulIds.filter(id => !successfulRetries.some(result => result.itemId === id));

            // Save retry results
            await saveResultsToCSV(successfulRetries, unsuccessfulIds);
            await saveResultsToPostgres(successfulRetries);

            if (unsuccessfulIds.length > 0) {
                console.log(`Some URLs failed after retry in batch ${batchIndex + 1}`);
            } else {
                console.log(`All failed URLs retried successfully in batch ${batchIndex + 1}`);
            }

            // If there are still failures after the retry, move to the next batch
            if (unsuccessfulIds.length > 0) {
                console.log(`Skipping further retries for batch ${batchIndex + 1}. Moving to next batch.`);
            }
        }

        console.log(`Batch ${batchIndex + 1} completed.`);
    }
}

async function saveResultsToCSV(validResults, unsuccessfulIds) {
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

    const csvData = validResults.map(item => ({
        Date: today,
        'Item # (Office Depot sku #)': item.itemId,
        'Vendor Part #': item.vendorPartNo || "Not Found",
        ProductTitle: item.productTitle === "Not Found" ? "Not Found" : item.productTitle,
        Price: item.price === "Not Found" ? "Not Found" : item.price,
        StockAvailability: item.stockStatus === "Not Found" ? "Not Found" : item.stockStatus
    }));

    // Save "Unsuccessful" entries only once
    const unsuccessfulData = [...new Set(unsuccessfulIds)].map(id => ({
        Date: today,
        'Item # (Office Depot sku #)': id,
        'Vendor Part #': "Not Found",
        ProductTitle: "Unsuccessful",
        Price: "Unsuccessful",
        StockAvailability: "Unsuccessful"
    }));

    const allData = [...csvData, ...unsuccessfulData];

    const csv = Papa.unparse(allData);

    const filePath = 'scraped_data_office_depot.csv';

    if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, '\n' + csv.split('\n').slice(1).join('\n'));
    } else {
        fs.writeFileSync(filePath, csv);
    }
}



async function saveHTML(validResults) {
    if (validResults.length > 0 && validResults[4].html) {
        const htmlData = validResults[4].html;
        fs.writeFileSync('indexOfficeDepot.html', htmlData);
    } else {
        console.log("No successful results with HTML to save.");
    }
}

async function saveResultsToPostgres(validResults) {
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
            INSERT INTO "Records"."OfficeDepotTracker" ("trackingDate", "itemId", "marketplaceSku", "productTitle", "price", "inStock")
            VALUES ($1, $2, $3, $4, $5, $6)
        `;

        const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

        for (const item of validResults) {
            const values = [
                today,
                item.itemId,
                item.vendorPartNo || null,
                item.productTitle,
                item.price === "Not Found" ? null : parseFloat(item.price.replace(/[^0-9.-]+/g, "")),
                item.stockStatus
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
    const filePath = 'PlatformCatalogsOfficeDepot.csv';

    const data = await readUrlsFromFile(filePath);
    if (data.length > 0) {
        data.forEach(item => {
            console.log(`Item # (Office Depot sku #): ${item.itemId} - PDP Link: ${item.url}`);
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
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
        itemId: row['Quill Item #'].trim(),
        vendorPartNo: row['Vendor Part # '] || null
    }));
}

async function fetchData(url, retries = 50) {
    // Skip invalid URLs (e.g., 'NULL')
    if (url === 'NULL') {
        console.error(`Invalid URL: ${url}`);
        return null;
    }
    let attempt = 0;
    while (attempt < retries) {
        try {
            const { data } = await axios.get(url);
            return cheerio.load(data);
        } catch (error) {
            console.error(`Attempt ${attempt + 1} failed for ${url}: ${error.message}`);
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    console.error(`Failed to fetch data from ${url} after multiple attempts.`);
    return null;
}

async function fetchTitle($) {
    return $('h1').text().trim();
}

async function fetchPrice($) {
    return $('.h2.mb-2.savings-highlight-wrap').text().trim();
}

function checkOutOfStock($) {
    return $('.promo-flag').text().includes('Out of stock');
}

async function fetchProductData(url, itemId, vendorPartNo) {
    const $ = await fetchData(url);
    if ($) {
        const productTitle = await fetchTitle($);
        const price = await fetchPrice($);
        const isOutOfStock = checkOutOfStock($);
        return { itemId, vendorPartNo, productTitle, price, isOutOfStock, html: $.html() };
    }
    return null;
}

async function fetchAllProductsData(data, retries = 50) {
    let successfulFetchCount = 0;
    let unsuccessfulFetchCount = 0;
    const unsuccessfulIds = [];
    const missingUrlIds = [];
    let missingUrlCount = 0;

    const limit = process.env.NODE_ENV === 'DEV' ? 5 : data.length;
    const batchSize = 10;
    const totalBatches = Math.ceil(data.length / batchSize);

    // Processing data in batches of 10
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, data.length);
        const batch = data.slice(batchStart, batchEnd);

        let batchAttempts = 0;
        let batchSuccessfulFetches = 0;
        let batchUnsuccessfulFetches = 0;
        let batchUnsuccessfulIds = [];
        let batchMissingUrlIds = [];
        let batchMissingUrlCount = 0;

        // Fetching data for this batch
        const results = await Promise.all(batch.map(async (item) => {
            // Skip invalid URLs (e.g., 'NULL')
            if (item.url === 'NULL') {
                batchMissingUrlCount++;
                batchMissingUrlIds.push(item.itemId);
                return null;
            }

            const productData = await fetchProductData(item.url, item.itemId, item.vendorPartNo);
            if (productData) {
                batchSuccessfulFetches++;
                return productData;
            } else {
                batchUnsuccessfulFetches++;
                batchUnsuccessfulIds.push(item.itemId);
                return { itemId: item.itemId, vendorPartNo: item.vendorPartNo, productTitle: "Not Found", price: "Not Found", isOutOfStock: "Not Found" };
            }
        }));

        // Collect valid results for this batch
        const validResults = results.filter(data => data !== null);
        
        // Store results in CSV and DB after processing the batch
        await saveResultsToCSV(validResults, batchUnsuccessfulIds, batchMissingUrlIds);
        await saveResultsToPostgres(validResults);

        // Log batch results
        console.log(`Batch ${batchIndex + 1} processed:`);
        console.log(`Successful fetches: ${batchSuccessfulFetches}`);
        console.log(`Unsuccessful fetches: ${batchUnsuccessfulFetches}`);
        console.log(`Missing URL count: ${batchMissingUrlCount}`);

        if (batchUnsuccessfulIds.length > 0) {
            console.log(`Unsuccessful fetch IDs in batch ${batchIndex + 1}: ${batchUnsuccessfulIds.join(', ')}`);
        }

        if (batchMissingUrlIds.length > 0) {
            console.log(`Missing URL IDs in batch ${batchIndex + 1}: ${batchMissingUrlIds.join(', ')}`);
        }

        // Retry the failed URLs up to `retries` times
        let retryAttempts = 0;
        let retryUnsuccessfulIds = [];
        while (retryAttempts < retries && batchUnsuccessfulIds.length > 0) {
            console.log(`Retrying failed URLs in batch ${batchIndex + 1}, attempt ${retryAttempts + 1}`);
            
            const failedUrls = batch.filter(item => batchUnsuccessfulIds.includes(item.itemId));

            // Retry failed URLs
            const retryResults = await Promise.all(failedUrls.map(async (item) => {
                const productData = await fetchProductData(item.url, item.itemId, item.vendorPartNo);
                if (productData) {
                    return productData;
                } else {
                    return { itemId: item.itemId, vendorPartNo: item.vendorPartNo, productTitle: "Not Found", price: "Not Found", isOutOfStock: "Not Found" };
                }
            }));

            // Collect successful retries
            const successfulRetries = retryResults.filter(result => result !== null);
            const unsuccessfulRetries = retryResults.filter(result => result === null);

            // Update counts
            retryUnsuccessfulIds = retryUnsuccessfulIds.concat(unsuccessfulRetries.map(result => result.itemId));
            batchSuccessfulFetches += successfulRetries.length;
            batchUnsuccessfulFetches += unsuccessfulRetries.length;

            // Store retry results
            await saveResultsToCSV(successfulRetries, retryUnsuccessfulIds, batchMissingUrlIds);
            await saveResultsToPostgres(successfulRetries);

            console.log(`Retry attempt ${retryAttempts + 1} completed for batch ${batchIndex + 1}.`);

            // If all failed URLs are retried or exhausted, stop retrying
            if (unsuccessfulRetries.length === 0) {
                break;
            }

            retryAttempts++;
            console.log(`Retrying for failed URLs in batch ${batchIndex + 1}...`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds before retrying
        }

        if (retryAttempts === retries) {
            console.error(`Failed to fetch data from some URLs in batch ${batchIndex + 1} after ${retries} attempts.`);
        }

        // Proceed to the next batch
    }
}

async function saveResultsToCSV(validResults, unsuccessfulIds, missingUrlIds) {
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
        'Quill Item #': item.itemId,
        'Vendor Part #': item.vendorPartNo || "N/A",
        ProductTitle: item.productTitle,
        Price: item.price,
        InStock: item.isOutOfStock ? 'Out of Stock' : 'In Stock'
    }));

    const unsuccessfulData = unsuccessfulIds.map(id => ({
        Date: today,
        'Quill Item #': id,
        'Vendor Part #': "Unsuccessful",
        ProductTitle: "Unsuccessful",
        Price: "Unsuccessful",
        InStock: "Unsuccessful"
    }));

    const missingUrlData = missingUrlIds.map(id => ({
        Date: today,
        'Quill Item #': id,
        'Vendor Part #': "Empty",
        ProductTitle: "Empty",
        Price: "Empty",
        InStock: "Empty"
    }));

    const allData = [...csvData, ...unsuccessfulData, ...missingUrlData];

    const csv = Papa.unparse(allData);

    const filePath = 'scraped_data_quill.csv';

    if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, '\n' + csv.split('\n').slice(1).join('\n'));
        console.log("Data appended in the CSV.");
    } else {
        fs.writeFileSync(filePath, csv);
        console.log("Data is in the CSV newly created.");
    }
}


async function saveHTML(validResults) {
    if (validResults.length > 0 && validResults[0].html) {
        const htmlData = validResults[0].html;
        fs.writeFileSync('indexQuill.html', htmlData);
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
            INSERT INTO "Records"."QuillTracker" ("trackingDate", "itemId", "marketplaceSku", "productTitle", "price", "inStock")
            VALUES ($1, $2, $3, $4, $5, $6)
        `;

        const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

        for (const item of validResults) {
            const values = [
                today,
                item.itemId,
                item.vendorPartNo || null, // Add "Vendor Part #" value
                item.productTitle,
                item.price === "Not Found" ? null : parseFloat(item.price.replace(/[^0-9.-]+/g, "")),
                item.isOutOfStock === "Not Found" ? "Not Found" : (item.isOutOfStock ? 'Out of Stock' : 'In Stock')
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
    const filePath = 'PlatformCatalogsQuill.csv';

    const data = await readUrlsFromFile(filePath);
    if (data.length > 0) {
        data.forEach(item => {
            console.log(`Quill Item #: ${item.itemId} - PDP Link: ${item.url}`);
        });
        await fetchAllProductsData(data);
    } else {
        console.log("No data found in file.");
    }
}

// cron.schedule('30 12 * * *', async () => {
//     console.log("Starting scheduled task...");
//     await main();
//     console.log("Scheduled task completed.");
// }, {
//     timezone: "Asia/Kolkata"
// });
main();
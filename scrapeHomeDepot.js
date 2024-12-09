const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const Papa = require('papaparse');
const { Client } = require('pg');
const cron = require('node-cron');

require('dotenv').config();

const BASE_URL = 'https://www.homedepot.com/p/';

async function readUrlsFromFile(filePath) {
    const csvData = fs.readFileSync(filePath, 'utf8');
    const parsedData = Papa.parse(csvData, { header: true }).data;

    return parsedData.map(row => {
        const itemId = row['SKU'];
        const marketplaceSku = row['Marketplace SKU'];
        const url = `${BASE_URL}${itemId}`;
        return { url, itemId, marketplaceSku };
    });
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
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retrying
        }
    }
    return null;
}


async function fetchTitle($) {
    return $('h1.sui-h4-bold').text().trim();
}

async function fetchPrice($) {
    const dollars = $('.sui-text-9xl').text().trim();
    const cents = $('.sui-font-display.sui-text-3xl').last().text().trim();
    return `$${dollars}.${cents}`;
}

async function fetchStock($) {
    const outOfStockMessage = $('div.sui-my-12.sui-mx-auto.sui-p-5.sui-text-danger.sui-font-bold').length;
    return outOfStockMessage > 0 ? "Out of Stock" : "Available";
}


async function fetchProductData(url, itemId) {
    const $ = await fetchData(url);
    if ($) {
        const productTitle = await fetchTitle($);
        const price = await fetchPrice($);
        const stockStatus = await fetchStock($);
        return { itemId, productTitle, price, stockStatus, html: $.html() };
    }
    return null;
}

async function fetchAllProductsData(data) {
    const isDev = process.env.NODE_ENV === 'DEV'; // Check if the environment is DEV
    const limit = isDev ? 5 : data.length; // Limit to 5 in DEV, process all in PROD
    const batchSize = 10;
    const totalBatches = Math.ceil(limit / batchSize);

    const unsuccessfulIds = [];

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, limit);
        const batch = data.slice(batchStart, batchEnd);

        console.log(`Processing Batch ${batchIndex + 1}...`);

        const batchResults = await Promise.all(batch.map(async (item) => {
            if (item.url === 'NULL') {
                item.url = `https://www.homedepot.com/p/${item.itemId}`;
            }

            const productData = await fetchProductData(item.url, item.itemId);

            if (!productData || productData.productTitle === "Not Found") {
                unsuccessfulIds.push(item.itemId);
            }

            return {
                ...productData,
                itemId: item.itemId,
                marketplaceSku: item.marketplaceSku, // Add this field
                productTitle: productData?.productTitle || "Not Found"
            };
        }));

        console.log(`Batch ${batchIndex + 1} results saved.`);
        
        await saveResultsToCSV(batchResults, unsuccessfulIds); // Save only current batch
        await saveResultsToPostgres(batchResults); // Save only current batch
    }
}


async function saveResultsToCSV(batchResults, unsuccessfulIds) {
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

    const csvData = batchResults.map(item => ({
        Date: today,
        'Item # (Home Depot sku #)': item.itemId,
        'Marketplace SKU': item.marketplaceSku || "Not Found", // Include Marketplace SKU
        ProductTitle: item.productTitle,
        Price: item.price || "Not Found",
        StockAvailability: item.stockStatus || "Not Found"
    }));

    const unsuccessfulData = unsuccessfulIds.map(id => ({
        Date: today,
        'Item # (Home Depot sku #)': id,
        'Marketplace SKU': "Not Found", // Handle unsuccessful entries
        ProductTitle: "Unsuccessful",
        Price: "Unsuccessful",
        StockAvailability: "Unsuccessful"
    }));

    const batchCsv = Papa.unparse([...csvData, ...unsuccessfulData]);
    const filePath = 'scraped_data_home_depot.csv';

    if (fs.existsSync(filePath)) {
        // Append only new rows
        fs.appendFileSync(filePath, '\n' + batchCsv.split('\n').slice(1).join('\n'));
    } else {
        // Create file with headers
        fs.writeFileSync(filePath, batchCsv);
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
            INSERT INTO "Records"."HomeDepotTracker" 
            ("trackingDate", "itemId", "marketplaceSku", "productTitle", "price", "inStock")
            VALUES ($1, $2, $3, $4, $5, $6)
        `;

        const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

        for (const item of validResults) {
            // Safely handle price and stockStatus
            let price = null;
            if (item.price && item.price !== "Not Found") {
                price = parseFloat(item.price.replace(/[^0-9.-]+/g, "")); // Safely handle price
            }
            let stockStatus = item.stockStatus === "Not Found" ? null : item.stockStatus;

            // Prepare the values for insertion into PostgreSQL
            const values = [
                today,
                item.itemId,
                item.marketplaceSku || null, // Add marketplaceSku value
                item.productTitle,
                price,
                stockStatus
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
    const filePath = 'PlatformCatalogsHomeDepot.csv';

    const data = await readUrlsFromFile(filePath);
    if (data.length > 0) {
        data.forEach(item => {
            console.log(`Item # (Home Depot sku #): ${item.itemId} - PDP Link: ${item.url}`);
        });
        await fetchAllProductsData(data);
    } else {
        console.log("No data found in file.");
    }
}

main();
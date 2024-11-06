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
        itemId: row['Item # (Office Depot sku #) ']
    }));
}

async function fetchData(url, retries = 100) {
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
    return $('h1[itemprop="name"]').text().trim();
}

async function fetchPrice($) {
    return $('.od-graphql-price-big-price').first().text().trim();
}

async function fetchStock($) {
    const addToCartButton = $('.call-to-action-wrapper .common-add-to-cart');
    return addToCartButton.length > 0 ? "Available" : "Out of Stock";
}


async function fetchProductData(url, itemId) {
    const $ = await fetchData(url);
    if ($) {
        const unavailableMessage = $('h1:contains("We are sorry, but Office Depot is currently not available in your country")').length > 0;

        if (unavailableMessage) {
            return { 
                itemId, 
                productTitle: "Not Found", 
                price: "Not Found", 
                stockStatus: "Not Found", 
                html: $.html() 
            };
        }

        const notFoundMessage = $('h1[auid="sku-failure-heading"]').length > 0;
        
        if (notFoundMessage) {
            return {
                itemId,
                productTitle: "Not Found",
                price: "Not Found",
                stockStatus: "Not Found",
                html: $.html()
            };
        }

        const productTitle = await fetchTitle($);
        const price = await fetchPrice($);
        const stockStatus = await fetchStock($);

        return { itemId, productTitle, price, stockStatus, html: $.html() };
    }
    return null;
}

async function fetchAllProductsData(data) {
    let successfulFetchCount = 0;
    let unsuccessfulFetchCount = 0;
    const unsuccessfulIds = [];
    const missingUrlIds = [];
    let missingUrlCount = 0;

    const limit = process.env.NODE_ENV === 'DEV' ? 5 : data.length;

    const results = await Promise.all(data.slice(0, limit).map(async (item) => {
        if (item.url === 'NULL') {
            missingUrlCount++;
            missingUrlIds.push(item.itemId);
            const newUrl = `https://www.officedepot.com/a/products/${item.itemId}`;
            const productData = await fetchProductData(newUrl, item.itemId);
            if (productData) {
                unsuccessfulFetchCount++;
                return productData;
            } else {
                unsuccessfulFetchCount++;
                unsuccessfulIds.push(item.itemId);
                return null;
            }
        }

        const productData = await fetchProductData(item.url, item.itemId);
        if (productData) {
            successfulFetchCount++;
            return productData;
        } else {
            unsuccessfulFetchCount++;
            unsuccessfulIds.push(item.itemId);
            return null;
        }
    }));

    const validResults = results.filter(data => data !== null);

    console.log("Scraped data:", validResults);
    console.log(`Successful fetches: ${successfulFetchCount}`);
    console.log(`Unsuccessful fetches: ${unsuccessfulFetchCount}`);
    console.log(`Missing URL count: ${missingUrlCount}`);

    if (unsuccessfulIds.length > 0) {
        console.log(`Unsuccessful fetch IDs: ${unsuccessfulIds.join(', ')}`);
    }

    if (missingUrlIds.length > 0) {
        console.log(`Missing URL IDs: ${missingUrlIds.join(', ')}`);
    }

    await saveResultsToCSV(validResults, unsuccessfulIds);
    // await saveHTML(validResults);
    await saveResultsToPostgres(validResults);
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
        ProductTitle: item.productTitle === "Not Found" ? "Not Found" : item.productTitle,
        Price: item.price === "Not Found" ? "Not Found" : item.price,
        StockAvailability: item.stockStatus === "Not Found" ? "Not Found" : item.stockStatus
    }));

    const unsuccessfulData = unsuccessfulIds.map(id => ({
        Date: today,
        'Item # (Office Depot sku #)': id,
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
            INSERT INTO "Records"."OfficeDepotTracker" ("trackingDate", "sku", "productTitle", "price", "inStock")
            VALUES ($1, $2, $3, $4, $5)
        `;

        const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

        for (const item of validResults) {
            const values = [
                today,
                item.itemId,
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

cron.schedule('0 23 * * *', async () => {
    console.log("Starting scheduled task...");
    await main();
    console.log("Scheduled task completed.");
}, {
    timezone: "Asia/Kolkata"
});
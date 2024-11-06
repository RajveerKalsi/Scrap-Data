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
        itemId: row['Quill Item #'].trim()
    }));
}

async function fetchData(url, retries = 50) {
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

async function fetchProductData(url, itemId) {
    const $ = await fetchData(url);
    if ($) {
        const productTitle = await fetchTitle($);
        const price = await fetchPrice($);
        const isOutOfStock = checkOutOfStock($);
        return { itemId, productTitle, price, isOutOfStock, html: $.html() };
    }
    return null;
}

async function fetchAllProductsData(data) {
    let successfulFetchCount = 0;
    let unsuccessfulFetchCount = 0;
    const unsuccessfulIds = [];
    const missingUrlIds = [];
    let missingUrlCount = 0;

    const limit = process.env.NODE_ENV === 'DEV' ? 12 : data.length;

    const results = await Promise.all(data.slice(0, limit).map(async (item) => {
        if (item.url === 'NULL') {
            missingUrlCount++;
            missingUrlIds.push(item.itemId);
            return null;
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

    validResults.forEach(item => {
        console.log(`SKU: ${item.itemId}, Out of Stock: ${item.isOutOfStock}`);
    });

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

    await saveResultsToCSV(validResults, unsuccessfulIds, missingUrlIds);
    await saveHTML(validResults);
    await saveResultsToPostgres(validResults);
}

async function saveResultsToCSV(validResults, unsuccessfulIds, missingUrlIds) {
    const today = new Date().toLocaleString('en-US', {
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
        ProductTitle: item.productTitle,
        Price: item.price,
        InStock: item.isOutOfStock ? 'Out of Stock' : 'In Stock'
    }));

    const unsuccessfulData = unsuccessfulIds.map(id => ({
        Date: today,
        'Quill Item #': id,
        ProductTitle: "Unsuccessful",
        Price: "Unsuccessful",
        InStock: "Unsuccessful"
    }));

    const missingUrlData = missingUrlIds.map(id => ({
        Date: today,
        'Quill Item #': id,
        ProductTitle: "Empty",
        Price: "Empty",
        InStock: "Empty"
    }));

    const allData = [...csvData, ...unsuccessfulData, ...missingUrlData];

    const csv = Papa.unparse(allData);

    const filePath = 'scraped_data_quill.csv';

    if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, '\n' + csv.split('\n').slice(1).join('\n'));
    } else {
        fs.writeFileSync(filePath, csv);
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
            INSERT INTO "Records"."QuillTracker" ("trackingDate", "quillItemId", "productTitle", "price", "inStock")
            VALUES ($1, $2, $3, $4, $5)
        `;

        const today = new Date().toISOString();

        for (const item of validResults) {
            const values = [
                today,
                item.itemId,
                item.productTitle,
                parseFloat(item.price.replace(/[^0-9.-]+/g,"")),
                item.isOutOfStock ? 'Out of Stock' : 'In Stock'
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

cron.schedule('*/5 * * * *', async () => {
    console.log("Starting scheduled task...");
    await main();
    console.log("Scheduled task completed.");
});
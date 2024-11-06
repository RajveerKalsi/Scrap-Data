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
        itemId: row['SKU'].trim()
    }));
}

async function fetchData(url, retries = 100) {
    let attempt = 0;
    while (attempt < retries) {
        try {
            const response = await axios.get(url);
            if (response.status !== 200) {
                console.error(`Attempt ${attempt + 1} failed for ${url}: Received status code ${response.status}`);
                return null;
            }
            return cheerio.load(response.data);
        } catch (error) {
            // Log if it's an HTTP error 500
            if (error.response) {
                console.error(`Attempt ${attempt + 1} failed for ${url}: Request failed with status code ${error.response.status}`);
                if (error.response.status === 500) {
                    return null; 
                }
            } else {
                // Log non-HTTP errors (like network issues)
                console.error(`Attempt ${attempt + 1} failed for ${url}: ${error.message}`);
            }
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    console.error(`Failed to fetch data from ${url} after multiple attempts.`);
    return null;
}


async function fetchTitle($) {
    return $('.product-info-ux2dot0__product_title span').first().text().trim();
}

async function fetchPrice($) {
    return $('.price-info__final_price_sku').text().trim();
}

function checkOutOfStock($) {
    return $('.purchasing-option-pickers__oos_message').length > 0;
}

function is404Error($) {
    const pageText = $('body').text().trim();
    return $('.sc-dxvudf-1.bmnFaj h4:contains("404")').length > 0 || pageText.includes("An error occurred while processing your request.");
}


async function fetchProductData(url, itemId) {
    const $ = await fetchData(url);
    if ($) {
        if (is404Error($)) {
            return { itemId, productTitle: "Not Found", price: "Not Found", isOutOfStock: "Not Found", html: $.html() };
        }

        const productTitle = await fetchTitle($);
        const price = await fetchPrice($);

        if (!productTitle || !price) {
            return { itemId, productTitle: "Unsucessful", price: "Unsucessful", isOutOfStock: "Unsucessful" };
        }

        const isOutOfStock = checkOutOfStock($);
        return { itemId, productTitle, price, isOutOfStock, html: $.html() };
    }
    return { itemId, productTitle: "Not Found", price: "Not Found", isOutOfStock: "Not Found" };
}




async function fetchAllProductsData(data) {
    let successfulFetchCount = 0;
    let unsuccessfulFetchCount = 0;
    const unsuccessfulIds = [];
    const missingUrlIds = [];
    let missingUrlCount = 0;

    const limit = process.env.NODE_ENV === 'DEV' ? 7 : data.length;

    // Collect both valid and "Not found" results
    const allResults = await Promise.all(data.slice(0, limit).map(async (item) => {
        if (item.url === 'NULL') {
            missingUrlCount++;
            missingUrlIds.push(item.itemId);
            item.url = `https://www.staples.com/product_${item.itemId}`;
        }

        const productData = await fetchProductData(item.url, item.itemId);
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
            return { itemId: item.itemId, productTitle: "Not Found", price: "Not Found", isOutOfStock: "Not Found" };
        }
    }));

    // Remove any null results (if any)
    const validResults = allResults.filter(data => data && data.productTitle !== "Not Found");

    allResults.forEach(item => {
        console.log(`SKU: ${item.itemId}, Product Title: ${item.productTitle}, Out of Stock: ${item.isOutOfStock}`);
    });

    console.log("Scraped data:", allResults);
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
    await saveHTML(validResults); 
    await saveResultsToPostgres(allResults); 
}



async function saveResultsToCSV(validResults, unsuccessfulIds) {
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
        'SKU': item.itemId,
        ProductTitle: item.productTitle,
        Price: item.price,
        InStock: item.isOutOfStock ? 'Out of Stock' : 'In Stock'
    }));

    const unsuccessfulData = unsuccessfulIds.map(id => ({
        Date: today,
        'SKU': id,
        ProductTitle: "Not Found",
        Price: "Not Found",
        InStock: "Not Found"
    }));

    const allData = [...csvData, ...unsuccessfulData];

    const csv = Papa.unparse(allData);

    const filePath = 'scraped_data_staples.csv';

    if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, '\n' + csv.split('\n').slice(1).join('\n'));
    } else {
        fs.writeFileSync(filePath, csv);
    }
}


async function saveHTML(validResults) {
    if (validResults.length > 0 && validResults[0].html) {
        const htmlData = validResults[0].html;
        fs.writeFileSync('indexStaples.html', htmlData);
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
            INSERT INTO "Records"."StaplesTracker" ("trackingDate", "sku", "productTitle", "price", "inStock")
            VALUES ($1, $2, $3, $4, $5)
        `;

        const today = new Date().toISOString();

        for (const item of validResults) {
            const values = [
                today,
                item.itemId,
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
    const filePath = 'C:/VS Code/Scrap Data/PlatformCatalogsStaples.csv';

    const data = await readUrlsFromFile(filePath);
    if (data.length > 0) {
        data.forEach(item => {
            console.log(`SKU: ${item.itemId} - PDP Link: ${item.url}`);
        });
        await fetchAllProductsData(data);
    } else {
        console.log("No data found in file.");
    }
}

cron.schedule('*/10 * * * *', async () => {
    console.log("Starting scheduled task...");
    await main();
    console.log("Scheduled task completed.");
});
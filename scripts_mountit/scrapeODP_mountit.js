const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const Papa = require('papaparse');
const { Client } = require('pg');
const cron = require('node-cron');
const puppeteer = require('puppeteer');

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

async function scrapeBatchWithPuppeteer(batch) {
    const browser = await puppeteer.launch({ headless: false }); // or false for debugging
    const page = await browser.newPage();
    const results = [];

    const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

    for (const item of batch) {
        try {
            if (!item.marketplaceSKU) {
                results.push({
                    itemId: item.itemId || 'n/a',
                    parentSKU: item.parentSKU,
                    marketplaceSKU: item.marketplaceSKU,
                    productTitle: "n/a",
                    price: "n/a",
                    stockStatus: "n/a",
                    url: "n/a"
                });
                continue;
            }

            // Go to homepage
            await page.goto('https://www.odpbusiness.com', { waitUntil: 'domcontentloaded' });

            // Type in the search bar
            await page.waitForSelector('#siteSearchField');
            await page.type('#siteSearchField', item.marketplaceSKU);
            await page.keyboard.press('Enter');

            // Wait for navigation to product page
            await page.waitForNavigation({ waitUntil: 'networkidle2' });

            const url = page.url(); // Get updated product URL
            const html = await page.content();

            const productTitle = await page.$eval('h1[itemprop="name"]', el => el.textContent.trim());
            const price = await page.$eval('.od-graphql-price-big-price', el => el.textContent.trim());
            const stock = await page.$('.call-to-action-wrapper .common-add-to-cart')
                ? 'True'
                : 'False';

            results.push({
                itemId: item.itemId || 'n/a',
                parentSKU: item.parentSKU,
                marketplaceSKU: item.marketplaceSKU,
                productTitle,
                price,
                stockStatus: stock,
                url
            });

        } catch (err) {
            console.error(`❌ Error scraping ${item.marketplaceSKU}: ${err.message}`);
            results.push({
                itemId: item.itemId || 'n/a',
                parentSKU: item.parentSKU,
                marketplaceSKU: item.marketplaceSKU,
                productTitle: "Not Found",
                price: "Not Found",
                stockStatus: "Not Found",
                url: "n/a"
            });
        }
    }

    await browser.close();
    return results;
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
            html: "Unsuccessful",
            url
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
                html: $.html(),
                url
            };
        }

        const productTitle = await fetchTitle($);
        const price = await fetchPrice($);
        const stockStatus = await fetchStock($);

        return { itemId, parentSKU, marketplaceSKU, productTitle, price, stockStatus, url, html: $.html(), url };
    }

    return null;
}

async function fetchAllProductsData(data, retries = 50) {
    const limit = process.env.NODE_ENV === 'DEV' ? 50 : data.length;
    const batchSize = 10;
    const totalBatches = Math.ceil(limit / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, limit);
        const batch = data.slice(batchStart, batchEnd);

        console.log(`🚀 Processing batch ${batchIndex + 1}/${totalBatches}`);
        const batchResults = await scrapeBatchWithPuppeteer(batch);

        // await saveResultsToCSV(batchResults);
        await saveResultsToPostgres(batchResults);
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
        url: item.url || "n/a",
    }));

    const csv = Papa.unparse(csvData);

    const filePath = 'test_scraped_data_odpbusiness_mountit.csv';

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
            INSERT INTO "Records"."odpBusinessTracker" ("trackingDate", "itemId","parentSku", "marketplaceSku", "productTitle", "price", "inStock","url", "brandName")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
                item.price === "n/a" ? null : parseFloat(item.price.replace(/[^0-9.-]+/g, "")),
                item.stockStatus || "Not Found",
                item.url || "n/a",
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
    const filePath = '../csvs_mountit/officeDepotBusinessSKUNew.csv';

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
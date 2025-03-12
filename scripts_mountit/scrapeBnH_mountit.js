const puppeteer = require('puppeteer');
const fs = require('fs');
const Papa = require('papaparse');
const { Client } = require('pg');
require('dotenv').config();

async function readUrlsFromFile(filePath) {
    const csvData = fs.readFileSync(filePath, 'utf8');
    const parsedData = Papa.parse(csvData, { header: true }).data;

    return parsedData.map(row => ({
        parentSKU: row['Parent Sku'] || null,
        marketplaceSKU: row['Marketplace SKU'] || null,
        link: row['Link'] || null,
    }));
}

async function fetchDataWithPuppeteer(url) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        await new Promise(resolve => setTimeout(resolve, 3000));

        const productData = await page.evaluate(() => {
            const getText = (selector) => document.querySelector(selector)?.textContent?.trim() || null;

            const usedPriceElement = document.querySelector('[data-selenium="buyingOptions"] .price_JJqzY8QbUR');
            const usedPrice = usedPriceElement ? usedPriceElement.textContent.trim() : null;

            const stockStatus = getText('[data-selenium="stockStatus"]');
            const temporarilyOutOfStockText = document.querySelector('.statusMedium_ZC_6IRXKyD')?.textContent?.trim();

            return {
                title: getText('[data-selenium="productTitle"]'),
                price: getText('[data-selenium="pricingPrice"]'),
                stock: stockStatus || temporarilyOutOfStockText,
                usedPrice,
            };
        });

        await browser.close();
        return productData;
    } catch (error) {
        console.error(`Failed to fetch data from ${url}: ${error.message}`);
        await browser.close();
        return null;
    }
}


async function fetchProductData(url, parentSKU, marketplaceSKU) {
    const productData = await fetchDataWithPuppeteer(url);
    if (productData) {
        const { title, price, stock, usedPrice } = productData;

        const stockStatus = stock?.toLowerCase().includes('no longer available') || 
            stock?.toLowerCase().includes('temporarily out of stock') ? 'False' :
            stock?.toLowerCase().includes('special order') || stock?.toLowerCase().includes('in stock') ? 'True' : 'Not Found';

        return { 
            parentSKU, 
            marketplaceSKU, 
            productTitle: title, 
            price, 
            stockStatus, 
            usedPrice, 
            url 
        };
    }

    return {
        parentSKU,
        marketplaceSKU,
        productTitle: "Not Found",
        price: "Not Found",
        stockStatus: "Not Found",
        usedPrice: "Not Found",
        url,
    };
}


async function fetchAllProductsData(data, batchSize = 10) {
    for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const results = [];

        for (const item of batch) {
            if (!item.link) {
                console.log(`Missing URL for parentSKU: ${item.parentSKU}, marketplaceSKU: ${item.marketplaceSKU}`);
                results.push({
                    parentSKU: item.parentSKU,
                    marketplaceSKU: item.marketplaceSKU,
                    productTitle: "Not Found",
                    price: "Not Found",
                    stockStatus: "Not Found",
                });
                continue;
            }

            console.log(`Fetching data for URL: ${item.link}`);
            const productData = await fetchProductData(item.link, item.parentSKU, item.marketplaceSKU);
            results.push(productData);
        }
        // await saveResultsToCSV(results);
        await saveResultsToPostgres(results);
        console.log(`Batch ${Math.floor(i / batchSize) + 1} processed.`);
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
        hour12: false,
    }).replace(',', ' -');

    const csvData = allResults.map(item => ({
        Date: today,
        'Parent SKU': item.parentSKU || 'Not Found',
        'Marketplace SKU': item.marketplaceSKU || 'Not Found',
        ProductTitle: item.productTitle || 'Not Found',
        Price: item.price || 'Not Found',
        StockAvailability: item.stockStatus || 'Not Found',
        UsedPrice: item.usedPrice || 'Not Found',
    }));

    const csv = Papa.unparse(csvData);
    const filePath = 'test_scraped_data_bhphotovideo_mountit.csv';

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
            INSERT INTO "Records"."BnHTracker" ("trackingDate", "parentSku", "marketplaceSku", "productTitle", "price", "inStock", "usedPrice", "brandName")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const brandName = 'Mountit';

        for (const item of batchResults) {
            const price = item.price && typeof item.price === 'string'
                ? parseFloat(item.price.replace(/[^0-9.-]+/g, ""))
                : null;

            const usedPrice = item.usedPrice && typeof item.usedPrice === 'string'
                ? parseFloat(item.usedPrice.replace(/[^0-9.-]+/g, ""))
                : null;

            const values = [
                today,
                item.parentSKU || 'n/a',
                item.marketplaceSKU || null,
                item.productTitle || "Not Found",
                price,
                item.stockStatus || "Not Found",
                usedPrice,
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
    const filePath = '../csvs_mountit/b&hSKU.csv';

    const data = await readUrlsFromFile(filePath);

    const limit = process.env.NODE_ENV === 'DEV' ? 2 : data.length;
    const limitedData = data.slice(0, limit); 

    if (limitedData.length > 0) {
        limitedData.forEach(item => {
            console.log(`PDP Link: ${item.link}`);
        });
        await fetchAllProductsData(limitedData, 10);
    } else {
        console.log("No data found in file.");
    }
}

main();
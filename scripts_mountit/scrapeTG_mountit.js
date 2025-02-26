const puppeteer = require('puppeteer');
const fs = require('fs');
const Papa = require('papaparse');
const { Client } = require('pg');
require('dotenv').config();

const INPUT_CSV = '../csvs_mountit/targetPlusSKU.csv'; 
const OUTPUT_CSV = 'scraped_data.csv';

async function scrapeTarget(productId, page, maxRetries = 10) {
    console.log(`🔍 Scraping Product ID: ${productId}`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await page.goto('https://www.target.com', { waitUntil: 'domcontentloaded' });

            await page.waitForSelector('input[data-test="@web/Search/SearchInput"]', { timeout: 5000 });
            await page.click('input[data-test="@web/Search/SearchInput"]', { clickCount: 3 });
            await page.type('input[data-test="@web/Search/SearchInput"]', productId);
            await page.keyboard.press('Enter');

            await page.waitForSelector(
                'div[data-test="@web/ProductCard/ProductCardVariantDefault"], div[data-test="NLRTransparentMessage"], div[data-test="productNotFound"]',
                { timeout: 10000 }
            );

            const outOfStock = await page.$('div[data-test="NLRTransparentMessage"]');
            if (outOfStock) {
                return { productId, name: "N/A", price: "N/A", stock: "False" };
            }

            const notFound = await page.$('div[data-test="productNotFound"]');
            if (notFound) {
                return { productId, name: "N/A", price: "N/A", stock: "Not Found" };
            }

            const productData = await page.evaluate(() => {
                const productCard = document.querySelector('div[data-test="@web/ProductCard/ProductCardVariantDefault"]');
                if (!productCard) return { name: "N/A", price: "N/A", stock: "Not Found" };

                const nameElem = productCard.querySelector('a[data-test="product-title"] div');
                const priceElem = productCard.querySelector('span[data-test="current-price"] span');

                const name = nameElem ? nameElem.innerText.trim() : 'N/A';
                const price = priceElem ? priceElem.innerText.trim() : 'N/A';
                const stock = price !== 'N/A' ? 'True' : 'False';

                return { name, price, stock };
            });

            return { productId, ...productData };
        } catch (error) {
            console.log(`⚠️ Attempt ${attempt} failed for Product ID: ${productId}, Retrying...`);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Delay before retrying
            } else {
                console.log(`❌ Max retries reached for Product ID: ${productId}`);
                return { productId, name: "N/A", price: "N/A", stock: "Error" };
            }
        }
    }
}


async function scrapeBatch(productBatch, page) {
    console.log(`\n🚀 Starting new batch of ${productBatch.length} products...\n`);
    
    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (const product of productBatch) {
        const scrapedData = await scrapeTarget(product.productId, page);
        if (scrapedData.stock === "Error" || scrapedData.stock === "Not Found") {
            failCount++;
        } else {
            successCount++;
        }

        results.push({
            Date: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
            ItemId: scrapedData.productId,
            'Parent SKU': product.parentSKU || 'Not Found',
            'Marketplace SKU': product.marketplaceSKU || 'Not Found',
            ProductTitle: scrapedData.name || 'Not Found',
            Price: scrapedData.price || 'Not Found',
            StockAvailability: scrapedData.stock || 'Not Found'
        });
    }

    console.log(`✅ Batch completed: ${successCount} successful, ${failCount} failed\n`);
    return results;
}

async function saveResultsToCSV(data, filePath) {
    const csvData = Papa.unparse(data);
    if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, '\n' + csvData.split('\n').slice(1).join('\n'));
    } else {
        fs.writeFileSync(filePath, csvData);
    }
    console.log(`📁 Results saved to ${filePath}`);
}

async function saveResultsToPostgres(results) {
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
            INSERT INTO "Records"."TargetTracker" 
            ("trackingDate", "itemId", "parentSku", "marketplaceSku", "productTitle", "price", "inStock", "brandName") 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        const today = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const brandName = 'Mountit';

        for (const item of results) {
            const price = item.Price && typeof item.Price === 'string'
                ? parseFloat(item.Price.replace(/[^0-9.-]+/g, ""))
                : null;

            const values = [
                today,
                item.ItemId || 'n/a',
                item['Parent SKU'] || 'n/a',
                item['Marketplace SKU'] || null,
                item.ProductTitle || "Not Found",
                price,
                item.StockAvailability || "Not Found",
                brandName
            ];

            await client.query(queryText, values);
        }

        console.log("✅ Data successfully inserted into PostgreSQL.");
    } catch (error) {
        console.error("❌ Failed to insert data into PostgreSQL:", error.message);
    } finally {
        await client.end();
    }
}

async function scrapeMultipleProducts() {
    const data = await readCSV(INPUT_CSV);
    const limit = process.env.NODE_ENV === 'DEV' ? 10 : data.length;
    const products = data.slice(0, limit);

    const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
    const page = await browser.newPage();

    const batchSize = 10;
    let totalSuccess = 0;
    let totalFail = 0;

    for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);
        const batchResults = await scrapeBatch(batch, page);

        const batchSuccess = batchResults.filter(r => r.StockAvailability !== "Error" && r.StockAvailability !== "Not Found").length;
        const batchFail = batchResults.length - batchSuccess;

        totalSuccess += batchSuccess;
        totalFail += batchFail;

        // await saveResultsToCSV(batchResults, OUTPUT_CSV);
        await saveResultsToPostgres(batchResults);
    }

    await browser.close();
    console.log(`\n📊 Scraping completed! ✅ ${totalSuccess} successful, ❌ ${totalFail} failed.\n`);
}

scrapeMultipleProducts().catch(console.error);
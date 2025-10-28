const { Client } = require("pg");
const ExcelJS = require("exceljs");
const path = require("path");
require("dotenv").config();

const OUTPUT_FILE = path.join(__dirname, `msrp_comparison_${Date.now()}.xlsx`);
const START_DATE = "2025-10-20";
const END_DATE = "2025-10-27";

const TRACKERS = [
  { table: "BBTracker", columns: ['"trackingDate"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
  { table: "OfficeDepotTracker", columns: ['"trackingDate"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
  { table: "BnHTracker", columns: ['"trackingDate"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
  { table: "HomeDepotTracker", columns: ['"trackingDate"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
  { table: "NewEggTracker", columns: ['"trackingDate"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
  { table: "odpBusinessTracker", columns: ['"trackingDate"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
  { table: "QuillTracker", columns: ['"trackingDate"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
  { table: "StaplesTracker", columns: ['"trackingDate"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
  { table: "TargetTracker", columns: ['"trackingDate"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
];

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await client.connect();
  console.log("✅ Connected to database");

  // Step 1: Load MSRP + disco data
  console.log("📦 Loading MSRP data (with disco)...");
  const msrpQuery = `
    SELECT 
      "Marketplace_SKU" AS "marketplaceSku", 
      "MSRP" AS "msrp", 
      "Disco" AS "disco"
    FROM "Records"."mountit_msrp"
    WHERE "MSRP" IS NOT NULL;
  `;
  const { rows: msrpRows } = await client.query(msrpQuery);
  const msrpMap = new Map(
    msrpRows.map(r => [
      r.marketplaceSku,
      { msrp: Number(r.msrp), disco: r.disco || null },
    ])
  );

  console.log(`✅ Loaded ${msrpMap.size} MSRP entries`);

  // Step 2: Prepare Excel workbook
  const workbook = new ExcelJS.Workbook();

  // Step 3: Process each tracker
  for (const tracker of TRACKERS) {
    console.log(`\n🔍 Processing ${tracker.table}...`);
    const sheet = workbook.addWorksheet(tracker.table);
    sheet.columns = [
      { header: "Tracking Date", key: "trackingDate", width: 18 },
      { header: "Marketplace SKU", key: "marketplaceSku", width: 20 },
      { header: "Product Title", key: "productTitle", width: 40 },
      { header: "Price", key: "price", width: 12 },
      { header: "MSRP", key: "msrp", width: 12 },
      { header: "Comparison", key: "comparison", width: 15 },
      { header: "In Stock", key: "inStock", width: 10 },
      { header: "Disco", key: "disco", width: 10 },
    ];

    const query = `
      SELECT ${tracker.columns.join(", ")}
      FROM "Records"."${tracker.table}"
      WHERE "trackingDate" BETWEEN $1 AND $2
    `;
    const { rows } = await client.query(query, [START_DATE, END_DATE]);

    let processed = 0;
    let skippedMissingMsrp = 0;
    let skippedNoPrice = 0;

    for (const row of rows) {
      const msrpData = msrpMap.get(row.marketplaceSku);
      if (!msrpData) {
        skippedMissingMsrp++;
        continue;
      }

      const { msrp, disco } = msrpData;
      const price = Number(row.price);
      if (!price || isNaN(price)) {
        skippedNoPrice++;
        continue;
      }

      let comparison = "Equal";
      if (price < msrp) comparison = "Below MSRP";
      else if (price > msrp) comparison = "Above MSRP";

      sheet.addRow({
        trackingDate: row.trackingDate,
        marketplaceSku: row.marketplaceSku,
        productTitle: row.productTitle,
        price,
        msrp,
        comparison,
        inStock: row.inStock,
        disco,
      });
      processed++;
    }

    console.log(
      `✅ ${processed} valid rows | ⚠️ ${skippedMissingMsrp} skipped (missing MSRP) | ⚠️ ${skippedNoPrice} skipped (no price)`
    );
  }

  // Step 4: Save Excel file
  await workbook.xlsx.writeFile(OUTPUT_FILE);
  console.log(`\n📊 Excel saved at: ${OUTPUT_FILE}`);

  await client.end();
  console.log("🔒 Database connection closed.");
}

main().catch(err => {
  console.error("❌ Error:", err);
});

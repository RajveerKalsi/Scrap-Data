const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { parse } = require("json2csv");
require("dotenv").config();

async function exportOfficeDepotDataToCSV(targetDate = "2025-07-11") {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();

    const query = `
      SELECT 
        TO_CHAR("trackingDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "trackingDate",
        "itemId",
        "marketplaceSku",
        "productTitle",
        "price",
        "inStock",
        "url",
        "brandName"
      FROM "Records"."OfficeDepotTracker"
      WHERE DATE("trackingDate") = $1
    `;

    const res = await client.query(query, [targetDate]);

    if (res.rows.length === 0) {
      console.log(`No data found for date ${targetDate}`);
      return;
    }

    const csv = parse(res.rows);
    const filePath = path.join(__dirname, `OfficeDepotTracker_${targetDate}.csv`);
    fs.writeFileSync(filePath, csv);

    console.log(`CSV successfully created: ${filePath}`);
  } catch (err) {
    console.error("Error exporting OfficeDepotTracker data:", err.message);
  } finally {
    await client.end();
  }
}

exportOfficeDepotDataToCSV();

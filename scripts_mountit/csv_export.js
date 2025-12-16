// const { Client } = require("pg");
// const path = require("path");
// const ExcelJS = require("exceljs");
// require("dotenv").config();

// const TRACKERS = [
//     { table: "BBTracker", columns: ['"trackingDate"', '"parentSku"', '"marketplaceSku"', '"itemId"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
//   { table: "OfficeDepotTracker", columns: ['"trackingDate"', '"itemId"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
//   { table: "BnHTracker", columns: ['"trackingDate"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"usedPrice"', '"url"'] },
//   { table: "HomeDepotTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
//   { table: "NewEggTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
//   { table: "odpBusinessTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
//   { table: "QuillTracker", columns: ['"trackingDate"', '"itemId"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
//   { table: "StaplesTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
//   { table: "TargetTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
// ];

// async function fetchTrackerData(trackerTable, columns, targetDate) {
//   const client = new Client({
//     host: process.env.DB_HOST,
//     port: process.env.DB_PORT,
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
//     database: process.env.DB_NAME,
//   });

//   try {
//     await client.connect();

//     const query = `
//       SELECT ${columns.join(", ")}
//       FROM "Records"."${trackerTable}"
//       WHERE DATE("trackingDate") = $1
//     `;

//     const res = await client.query(query, [targetDate]);
//     return res.rows;
//   } catch (err) {
//     console.error(`❌ Error fetching ${trackerTable}:`, err.message);
//     return [];
//   } finally {
//     await client.end();
//   }
// }

// async function exportAllToExcel(targetDate = new Date().toISOString().split("T")[0]) {
//   const workbook = new ExcelJS.Workbook();

//   for (const { table, columns } of TRACKERS) {
//     const rows = await fetchTrackerData(table, columns, targetDate);

//     if (rows.length === 0) {
//       console.log(`ℹ️ No data for ${table} on ${targetDate}`);
//       continue;
//     }

//     const worksheet = workbook.addWorksheet(table);

//     // Add header row (remove quotes from column names)
//     const headers = columns.map(c => c.replace(/"/g, ""));
//     worksheet.addRow(headers);

//     // Add data rows
//     rows.forEach(row => {
//       worksheet.addRow(headers.map(h => row[h]));
//     });

//     console.log(`✅ Added sheet for ${table}`);
//   }

//   const filePath = path.join(__dirname, `Trackers_${targetDate}.xlsx`);
//   await workbook.xlsx.writeFile(filePath);

//   console.log(`🎉 Export complete: ${filePath}`);
// }

// exportAllToExcel(process.argv[2]); // Run like: node csv_export.js 2025-07-29



const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { parse } = require("json2csv");
require("dotenv").config();

const TRACKERS = [
  // { table: "OfficeDepotTracker", columns: ['"trackingDate"', '"itemId"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
  // { table: "BBTracker", columns: ['"trackingDate"', '"parentSku"', '"marketplaceSku"', '"itemId"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
  // { table: "BnHTracker", columns: ['"trackingDate"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"usedPrice"', '"url"'] },
  // { table: "HomeDepotTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
  // { table: "NewEggTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
  // { table: "odpBusinessTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
  { table: "QuillTracker", columns: ['"trackingDate"', '"itemId"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
  // { table: "StaplesTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"', '"url"'] },
  // { table: "TargetTracker", columns: ['"trackingDate"', '"itemId"', '"parentSku"', '"marketplaceSku"', '"productTitle"', '"price"', '"inStock"'] },
];

async function exportTrackerDataToCSV(trackerTable, columns, targetDate) {
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
      SELECT ${columns.join(", ")}
      FROM "Records"."${trackerTable}"
      WHERE DATE("trackingDate") = $1
    `;

    const res = await client.query(query, [targetDate]);

    if (res.rows.length === 0) {
      console.log(`ℹ️ No data for ${trackerTable} on ${targetDate}`);
      return;
    }

    const csv = parse(res.rows);
    const filePath = path.join(__dirname, `${trackerTable}_${targetDate}.csv`);
    fs.writeFileSync(filePath, csv);

    console.log(`✅ ${trackerTable} exported to ${filePath}`);
  } catch (err) {
    console.error(`❌ Error exporting ${trackerTable}:`, err.message);
  } finally {
    await client.end();
  }
}

async function exportAll(targetDate = new Date().toISOString().split("T")[0]) {
  for (const { table, columns } of TRACKERS) {
    await exportTrackerDataToCSV(table, columns, targetDate);
  }
}

exportAll(process.argv[2]); // Optionally pass a date argument like: node csv_export.js 2025-07-29

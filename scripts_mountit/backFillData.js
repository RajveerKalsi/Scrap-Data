const { Client } = require("pg");
require("dotenv").config();

const TRACKERS = [
  "OfficeDepotTracker",
  "BBTracker",
  "BnHTracker",
  "HomeDepotTracker",
  "NewEggTracker",
  "odpBusinessTracker",
  "QuillTracker",
  "StaplesTracker",
  "TargetTracker",
];

async function copyTrackerData(client, table, sourceDate, targetDate) {
  try {
    // Find all columns except trackingDate
    const colRes = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'Records'
        AND table_name = $1
        AND column_name != 'trackingDate'
      ORDER BY ordinal_position;
    `,
      [table]
    );

    const columns = colRes.rows.map((r) => `"${r.column_name}"`);
    if (columns.length === 0) {
      console.log(`❌ No columns found for ${table}`);
      return;
    }

    // Insert copy
    const query = `
      INSERT INTO "Records"."${table}" ("trackingDate", ${columns.join(", ")})
      SELECT $2::timestamp, ${columns.join(", ")}
      FROM "Records"."${table}"
      WHERE DATE("trackingDate") = $1::date
    `;

    const res = await client.query(query, [sourceDate, targetDate]);
    console.log(
      `✅ Copied ${res.rowCount} rows from ${sourceDate} → ${targetDate} in ${table}`
    );
  } catch (err) {
    console.error(`❌ Error copying data for ${table}:`, err.message);
  }
}

async function bulkCopy(sourceDate, targetDates) {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();

    for (const table of TRACKERS) {
      for (const targetDate of targetDates) {
        await copyTrackerData(client, table, sourceDate, targetDate);
      }
    }
  } finally {
    await client.end();
  }
}

// Example usage
(async () => {
  const sourceDate = "2025-10-24"; // the date to copy from
  const targetDates = [
    "2025-10-23",
    "2025-10-25",
    "2025-10-26",
    "2025-10-27",
  ];// the dates to copy into

  await bulkCopy(sourceDate, targetDates);
})();

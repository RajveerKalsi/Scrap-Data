const { Client } = require("pg");
require("dotenv").config();

const TRACKERS = [
  "BBTracker",
  // "OfficeDepotTracker",
  // "BnHTracker",
  // "HomeDepotTracker",
  // "NewEggTracker",
  // "odpBusinessTracker",
  // "QuillTracker",
  // "StaplesTracker",
  // "TargetTracker",
];

async function deleteTrackerData(client, table, targetDate) {
  try {
    const query = `
      DELETE FROM "Records"."${table}"
      WHERE DATE("trackingDate") = $1::date
    `;

    const res = await client.query(query, [targetDate]);
    console.log(`🗑️ Deleted ${res.rowCount} rows from ${table} on ${targetDate}`);
  } catch (err) {
    console.error(`❌ Error deleting data for ${table}:`, err.message);
  }
}

async function bulkDelete(targetDates) {
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
        await deleteTrackerData(client, table, targetDate);
      }
    }
  } finally {
    await client.end();
  }
}

// Example usage
(async () => {
  const targetDates = [
    "2025-09-01",
    "2025-09-02",
    "2025-09-03",
    "2025-09-04",
    "2025-09-05",
    "2025-09-06",
    "2025-09-07",
    "2025-09-08",
    "2025-09-09",
    "2025-09-10",
    "2025-09-11",
    "2025-09-12",
    "2025-09-13",
    "2025-09-14",
    "2025-09-15",
    "2025-09-16",
    "2025-09-17",
    "2025-09-18",
    "2025-09-19",
    "2025-09-20",
    "2025-09-21",
  ]; // Dates you want to delete

  await bulkDelete(targetDates);
})();

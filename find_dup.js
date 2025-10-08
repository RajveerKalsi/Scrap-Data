const fs = require("fs");
const Papa = require("papaparse"); // npm install papaparse

// Read CSV file
const csvData = fs.readFileSync("findDup.csv", "utf8");

// Parse CSV
const parsed = Papa.parse(csvData, {
  header: true,
  skipEmptyLines: true,
});

const rows = parsed.data;

// Extract columns
const newItemIds = rows.map((row) => row["new item id"]?.trim()).filter(Boolean);
const currentItemIds = rows.map((row) => row["current item id"]?.trim()).filter(Boolean);

// Convert current ids into a Set for faster lookup
const currentSet = new Set(currentItemIds);

// Find items in new that are not in current
const notInCurrent = [...new Set(newItemIds)].filter((id) => !currentSet.has(id));

console.log("New Item IDs not in Current:", notInCurrent);
console.log("Count:", notInCurrent.length);

// Convert to CSV format
const output = Papa.unparse(
  notInCurrent.map((id) => ({ "missing new item id": id }))
);

// Write to a new CSV file
fs.writeFileSync("missing_ids.csv", output);

console.log("✅ Missing IDs written to missing_ids.csv");

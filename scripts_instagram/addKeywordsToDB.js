const fs = require("fs");
const Papa = require("papaparse");
const { addKeywordIfNotExists, closePool } = require("./db.utils");

async function main() {
  const csvFile = fs.readFileSync("keywords.csv", "utf8");
  const parsed = Papa.parse(csvFile, { header: true }).data;

  for (const row of parsed) {
    const brandName = row.brandName.trim();
    const keyword = row.keywords.trim();
    if (brandName && keyword) {
      const id = await addKeywordIfNotExists(brandName, keyword);
      console.log(`✅ Added or exists: [${brandName}] ${keyword} -> id=${id}`);
    }
  }

  await closePool();
}

main().catch(console.error);

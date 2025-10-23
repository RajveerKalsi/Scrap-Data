const fs = require("fs");
const Papa = require("papaparse");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Path to your CSV
const CSV_FILE = "./profiles_to_message.csv";

// Function to read CSV
function loadCSV(filePath = CSV_FILE) {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse(content, { header: true });
  return parsed.data.filter(
    (row) => row.username && row.profileUrl && row.brandName
  );
}

// Insert profile into DB
async function insertProfile(profile) {
  const client = await pool.connect();
  try {
    const { username, profileUrl, brandName, contactName, region } = profile;
    await client.query(
      `INSERT INTO scrapper.instagram_messages
      (username, profile_url, brand_name, contact_name, region)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (profile_url) DO NOTHING`,
      [username, profileUrl, brandName, contactName, region]
    );
  } finally {
    client.release();
  }
}

(async () => {
  const profiles = loadCSV();
  console.log(`📦 Found ${profiles.length} profiles in CSV`);

  for (const p of profiles) {
    await insertProfile(p);
  }

  console.log(`✅ Successfully inserted profiles into DB`);
  await pool.end();
})();

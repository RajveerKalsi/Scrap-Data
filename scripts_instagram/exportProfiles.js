const { Client } = require("pg");
const ExcelJS = require("exceljs");
require("dotenv").config();

(async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL");

    // 1️⃣ Fetch all brands
    const brandsRes = await client.query(`
      SELECT id, name 
      FROM scrapper.instagram_brands 
      ORDER BY id
    `);
    const brands = brandsRes.rows;
    console.log(`📦 Found ${brands.length} brands`);

    const workbook = new ExcelJS.Workbook();

    for (const brand of brands) {
      console.log(`🧩 Processing brand: ${brand.name}`);

      // 2️⃣ Fetch joined data for this brand
      const query = `
        SELECT 
          pr.id AS profile_id,
          b.name AS brand_name,
          k.keyword AS keyword,
          pd.post_url,
          pd.username AS post_username,
          pr.username AS profile_username,
          pr.profile_url,
          pr.posts,
          pr.followers,
          pr.following,
          pr.bio,
          pr.connect_link,
          pr.email,
          pr.country,
          pr.is_shop,
          pr.created_at
        FROM scrapper.instagram_profiles pr
        LEFT JOIN scrapper.instagram_post_details pd ON pr.post_id = pd.id
        LEFT JOIN scrapper.instagram_keywords k ON pr.keyword_id = k.id
        LEFT JOIN scrapper.instagram_brands b ON pr.brand_id = b.id
        WHERE pr.brand_id = $1
        ORDER BY pr.id;
      `;

      const res = await client.query(query, [brand.id]);
      const rows = res.rows;

      // 3️⃣ Create a sheet for each brand (max 31 chars)
      const sheet = workbook.addWorksheet(brand.name.substring(0, 31));

      // Define columns
      sheet.columns = [
        { header: "Profile ID", key: "profile_id", width: 10 },
        { header: "Brand", key: "brand_name", width: 20 },
        { header: "Keyword", key: "keyword", width: 20 },
        { header: "Post URL", key: "post_url", width: 40 },
        { header: "Post Username", key: "post_username", width: 20 },
        { header: "Profile Username", key: "profile_username", width: 20 },
        { header: "Profile URL", key: "profile_url", width: 40 },
        { header: "Posts", key: "posts", width: 10 },
        { header: "Followers", key: "followers", width: 15 },
        { header: "Following", key: "following", width: 15 },
        { header: "Bio", key: "bio", width: 50 },
        { header: "Connect Links", key: "connect_link", width: 50 },
        { header: "Email", key: "email", width: 30 },
        { header: "Country", key: "country", width: 20 },
        { header: "Is Shop", key: "is_shop", width: 10 },
        { header: "Created At", key: "created_at", width: 25 },
      ];

      // 4️⃣ Add data
      rows.forEach((r) => {
        sheet.addRow({
          ...r,
          connect_link: Array.isArray(r.connect_link)
            ? r.connect_link.join(", ")
            : r.connect_link || "",
          is_shop: r.is_shop ? "Yes" : "No",
          created_at: r.created_at
            ? new Date(r.created_at).toISOString().split("T")[0]
            : "",
        });
      });

      console.log(`📄 Added ${rows.length} rows for brand "${brand.name}"`);
    }

    // 5️⃣ Write to Excel
    const filePath = "./instagram_profiles_export.xlsx";
    await workbook.xlsx.writeFile(filePath);
    console.log(`✅ Export complete! File saved as: ${filePath}`);
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await client.end();
    console.log("🔒 Connection closed");
  }
})();

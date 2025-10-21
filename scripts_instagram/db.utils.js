const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Add brand if not exists
async function addBrandIfNotExists(brandName) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO scrapper.instagram_brands (name)
       VALUES ($1)
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
      [brandName]
    );

    if (res.rows.length) return res.rows[0].id;

    const existing = await client.query(
      `SELECT id FROM scrapper.instagram_brands WHERE name=$1`,
      [brandName]
    );
    return existing.rows[0].id;
  } finally {
    client.release();
  }
}

// Add keyword for a brand if not exists
async function addKeywordIfNotExists(brandName, keyword) {
  const client = await pool.connect();
  try {
    const brandId = await addBrandIfNotExists(brandName);

    const res = await client.query(
      `INSERT INTO scrapper.instagram_keywords (brand_id, keyword)
       VALUES ($1, $2)
       ON CONFLICT (brand_id, keyword) DO NOTHING
       RETURNING id`,
      [brandId, keyword]
    );

    if (res.rows.length) return res.rows[0].id;

    const existing = await client.query(
      `SELECT id FROM scrapper.instagram_keywords WHERE brand_id=$1 AND keyword=$2`,
      [brandId, keyword]
    );
    return existing.rows[0].id;
  } finally {
    client.release();
  }
}

// Get all keywords
async function getAllKeywords() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT k.id, b.id AS brand_id, b.name as brand_name, k.keyword
       FROM scrapper.instagram_keywords k
       JOIN scrapper.instagram_brands b ON k.brand_id = b.id`
    );
    return res.rows;
  } finally {
    client.release();
  }
}

// Get keywords by brand (optionally filter keywords)
async function getKeywordsByBrand(brandName, keywordFilter = []) {
  const client = await pool.connect();
  try {
    let query = `
      SELECT k.id, b.id AS brand_id, b.name as brand_name, k.keyword
      FROM scrapper.instagram_keywords k
      JOIN scrapper.instagram_brands b ON k.brand_id = b.id
      WHERE b.name = $1
    `;
    const params = [brandName];

    if (keywordFilter.length) {
      const placeholders = keywordFilter.map((_, i) => `$${i + 2}`).join(",");
      query += ` AND k.keyword IN (${placeholders})`;
      params.push(...keywordFilter);
    }

    const res = await client.query(query, params);
    return res.rows;
  } finally {
    client.release();
  }
}

// Add post with brand_id + keyword_id
async function addPost(brandId, keywordId, postUrl) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO scrapper.instagram_posts_urls (brand_id, keyword_id, post_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (keyword_id, post_url) DO NOTHING`,
      [brandId, keywordId, postUrl]
    );
  } finally {
    client.release();
  }
}

// Get all scraped URLs
async function getScrapedUrls() {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT post_url FROM scrapper.instagram_post_details`);
    return new Set(res.rows.map(r => r.post_url));
  } finally {
    client.release();
  }
}

// Get post URLs by keyword
async function getPostUrlsByKeyword(keywordId) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT post_url FROM scrapper.instagram_posts_urls WHERE keyword_id = $1`,
      [keywordId]
    );
    return res.rows.map(r => r.post_url);
  } finally {
    client.release();
  }
}

async function getPostsWithNullUsernames(limit = 1000) {
  const result = await client.query(
    `SELECT id, post_url, keyword_id, brand_id
     FROM scrapper.instagram_post_details
     WHERE username IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// Add post details if not exists
async function addPostDetails(post) {
  const {
    brand_id,
    keyword_id,
    postUrl,
    username,
    profileUrl,
    caption,
    hashtags,
    likes,
    views,
    postDate
  } = post;

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO scrapper.instagram_post_details
       (brand_id, keyword_id, post_url, username, profile_url, caption, hashtags, likes, post_views, post_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (post_url) DO NOTHING`,
      [
        brand_id,
        keyword_id,
        postUrl,
        username,
        profileUrl,
        caption,
        hashtags,
        likes,
        views,
        postDate
      ]
    );
  } finally {
    client.release();
  }
}

// Get all profile URLs from posts table
async function getProfileUrlsFromDB() {
    const client = await pool.connect();
    try {
        const res = await client.query(
            `SELECT id AS post_id, brand_id, keyword_id, profile_url FROM scrapper.instagram_post_details WHERE profile_url IS NOT NULL`
        );
        return res.rows;
    } finally {
        client.release();
    }
}

// Get already scraped profile URLs
async function getScrapedProfileUrls() {
    const client = await pool.connect();
    try {
        const res = await client.query(`SELECT profile_url FROM scrapper.instagram_profiles`);
        return new Set(res.rows.map(r => r.profile_url));
    } finally {
        client.release();
    }
}

// Add profile details
async function addProfileDetails(profile) {
    const {
        brand_id,
        keyword_id,
        post_id,
        profile_url,
        username,
        posts,
        followers,
        following,
        bio,
        email,
        country,
        is_shop
    } = profile;

    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO scrapper.instagram_profiles
            (brand_id, keyword_id, post_id, profile_url, username, posts, followers, following, bio, email, country, is_shop)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (profile_url) DO NOTHING`,
            [brand_id, keyword_id, post_id, profile_url, username, posts, followers, following, bio, email, country, is_shop]
        );
    } finally {
        client.release();
    }
}


async function closePool() {
  await pool.end();
}

module.exports = {
  addBrandIfNotExists,
  addKeywordIfNotExists,
  getAllKeywords,
  getKeywordsByBrand,
  addPost,
  addPostDetails,
  getScrapedUrls,
  getPostUrlsByKeyword,
  getPostsWithNullUsernames,
  getProfileUrlsFromDB,
  getScrapedProfileUrls,
  addProfileDetails,
  closePool,
};

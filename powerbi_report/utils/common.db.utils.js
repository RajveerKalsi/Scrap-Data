const { Pool } = require("pg");
require("dotenv").config();

const db = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
});

const normalizeNumeric = (value) => {
  if (value === null || value === undefined) return null;

  if (typeof value === "object" && value.result !== undefined) {
    return Number(value.result);
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[$,%\s,]/g, "");
    const num = Number(cleaned);
    return Number.isNaN(num) ? null : num;
  }

  if (typeof value === "number") {
    return value;
  }

  return null;
};

const commonDbUtils = {
  query: async (text, params = []) => {
    const client = await db.connect();
    try {
      const res = await client.query(text, params);
      return res;
    } finally {
      client.release();
    }
  },

  insertEmailTemplateRows: async (rows, week, year) => {
    if (!rows || !rows.length) return;

    const values = [];
    const placeholders = [];

    rows.forEach((r, i) => {
      const base = i * 8;

      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4},
        $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`
      );

      values.push(
        week,
        year,
        r.period,
        r.metric,
        normalizeNumeric(r.ty),
        normalizeNumeric(r.ly),
        normalizeNumeric(r.change),
        normalizeNumeric(r.lw)
      );
    });

    const query = `
    INSERT INTO walmart_powerbi_reports.email_template
      (report_week, report_year, period, metric, this_year, last_year, change, last_week)
    VALUES
      ${placeholders.join(",")}
    ON CONFLICT (report_week, report_year, period, metric)
    DO UPDATE SET
      this_year = EXCLUDED.this_year,
      last_year = EXCLUDED.last_year,
      change = EXCLUDED.change,
      last_week = EXCLUDED.last_week
  `;

    await commonDbUtils.query(query, values);
  },
};

module.exports = {
  db,
  commonDbUtils,
};

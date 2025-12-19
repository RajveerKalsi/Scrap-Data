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

  insertContentScoreRows: async (tableData, week, year) => {
    if (!tableData || !tableData.rows) return;

    const {
      rows: {
        "Prime Item Number": primeItemNbrs = [],
        "Item Desc": itemDescs = [],
        UPC: upcs = [],
        "Content Score": contentScores = [],
      },
    } = tableData;

    const values = [];
    const placeholders = [];

    primeItemNbrs.forEach((_, i) => {
      const base = i * 6;

      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3},
        $${base + 4}, $${base + 5}, $${base + 6})`
      );

      values.push(
        week,
        year,
        primeItemNbrs[i],
        itemDescs[i] ?? null,
        upcs[i] ?? null,
        normalizeNumeric(contentScores[i])
      );
    });

    const query = `
    INSERT INTO walmart_powerbi_reports.content_scores
      (report_week, report_year, prime_item_nbr, item_desc, upc, content_score)
    VALUES
      ${placeholders.join(",")}
    ON CONFLICT (report_week, report_year, prime_item_nbr)
    DO UPDATE SET
      content_score = EXCLUDED.content_score,
      item_desc = EXCLUDED.item_desc,
      upc = EXCLUDED.upc
  `;

    await commonDbUtils.query(query, values);
  },

  insertSalesSummaryRows: async (tableData, week, year) => {
    if (!tableData || !tableData.rows) return;

    const r = tableData.rows;
    const itemCount = r["Prime Item Nbr"]?.length || 0;

    const values = [];
    const placeholders = [];

    for (let i = 0; i < itemCount; i++) {
      const base = i * 37;

      placeholders.push(`
($${base + 1},  $${base + 2},  $${base + 3},  $${base + 4},  $${base + 5},
 $${base + 6},  $${base + 7},  $${base + 8},  $${base + 9},  $${base + 10},
 $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15},
 $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20},
 $${base + 21}, $${base + 22}, $${base + 23}, $${base + 24}, $${base + 25},
 $${base + 26}, $${base + 27}, $${base + 28}, $${base + 29}, $${base + 30},
 $${base + 31}, $${base + 32}, $${base + 33}, $${base + 34}, $${base + 35},
 $${base + 36}, $${base + 37})
`);

      values.push(
        week,
        year,
        r["Prime Item Nbr"][i],
        r["Prime Item Desc"]?.[i] ?? null,
        r["Vendor Stk Nbr"]?.[i]?.result ?? null,
        r["UPC"]?.[i]?.result ?? null,
        r["Effective Date"]?.[i]?.result ?? null,

        normalizeNumeric(r["Curr Repl Instock %"]?.[i]),
        normalizeNumeric(r["Curr Traited Store/Item Comb"]?.[i]),
        normalizeNumeric(r["LW Store Count Chg %"]?.[i]),

        normalizeNumeric(r["Unit Cost"]?.[i]),
        normalizeNumeric(r["Unit Retail"]?.[i]),
        normalizeNumeric(r["Avg Retail"]?.[i]),
        normalizeNumeric(r["YTD AUR"]?.[i]),
        normalizeNumeric(r["MU %"]?.[i]),

        normalizeNumeric(r["LW POS Qty"]?.[i]),
        normalizeNumeric(r["LW POS Cost"]?.[i]),
        normalizeNumeric(r["LW POS Sales"]?.[i]),
        normalizeNumeric(r["LW U/S/W"]?.[i]),
        normalizeNumeric(r["LW $/S/W"]?.[i]),
        normalizeNumeric(r["Wkly Sell Thru %"]?.[i]),

        normalizeNumeric(r["YTD POS Qty"]?.[i]),
        normalizeNumeric(r["YTD POS Sales"]?.[i]),
        normalizeNumeric(r["YTD $/P/W"]?.[i]),
        normalizeNumeric(r["YTD Sell Thru %"]?.[i]),

        normalizeNumeric(r["YTD Def Rate (sales)"]?.[i]),
        normalizeNumeric(r["YTD Total Return Rate"]?.[i]),

        normalizeNumeric(r["LW SI Total MUMD $"]?.[i]),
        normalizeNumeric(r["YTD SI Total MUMD $"]?.[i]),

        normalizeNumeric(r["52/53 WK FC Units"]?.[i]),
        normalizeNumeric(r["Frcst WOS"]?.[i]),

        normalizeNumeric(r["Curr Str On Hand Qty"]?.[i]),
        normalizeNumeric(r["Curr Str In Transit Qty"]?.[i]),
        normalizeNumeric(r["Curr Str In Whse Qty"]?.[i]),
        normalizeNumeric(r["Curr Str On Order Qty"]?.[i]),
        normalizeNumeric(r["Curr Whse On Hand Qty"]?.[i]),
        normalizeNumeric(r["Curr Whse SS Order Qty"]?.[i])
      );
    }

    const query = `
    INSERT INTO walmart_powerbi_reports.sales_summary (
      report_week, report_year,
      prime_item_nbr, prime_item_desc, vendor_stk_nbr, upc, effective_date,

      curr_repl_instock_pct, curr_traited_store_cnt, lw_store_count_chg_pct,
      unit_cost, unit_retail, avg_retail, ytd_aur, mu_pct,

      lw_pos_qty, lw_pos_cost, lw_pos_sales, lw_usw, lw_dsw, wkly_sell_thru_pct,
      ytd_pos_qty, ytd_pos_sales, ytd_dpw, ytd_sell_thru_pct,

      ytd_def_rate_sales, ytd_total_return_rate,
      lw_si_total_mumd, ytd_si_total_mumd,
      fc_52_53_wk_units, frcst_wos,

      curr_str_on_hand_qty, curr_str_in_transit_qty, curr_str_in_whse_qty,
      curr_str_on_order_qty, curr_whse_on_hand_qty, curr_whse_ss_order_qty
    )
    VALUES ${placeholders.join(",")}
    ON CONFLICT (report_week, report_year, prime_item_nbr)
    DO UPDATE SET
      lw_pos_sales = EXCLUDED.lw_pos_sales,
      ytd_pos_sales = EXCLUDED.ytd_pos_sales,
      curr_repl_instock_pct = EXCLUDED.curr_repl_instock_pct,
      wkly_sell_thru_pct = EXCLUDED.wkly_sell_thru_pct,
      frcst_wos = EXCLUDED.frcst_wos
  `;

    await commonDbUtils.query(query, values);
  },

  insertAllItemDetailRows: async (items, reportWeek, reportYear) => {
    if (!items?.length) return;

    const values = [];
    const placeholders = [];
    let idx = 1;

    items.forEach((item) => {
      Object.entries(item.dates).forEach(([weekKey, metrics]) => {
        placeholders.push(`(
        $${idx++}, $${idx++},
        $${idx++}, $${idx++}, $${idx++}, $${idx++},
        $${idx++},
        $${idx++}, $${idx++}, $${idx++}, $${idx++},
        $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}
      )`);

        values.push(
          reportYear,
          reportWeek,

          item.acct_dept_nbr,
          item.vendor_stk_nbr,
          item.prime_item_nbr,
          item.prime_item_desc,

          Number(weekKey),

          normalizeNumeric(metrics["POS Sales $"]),
          normalizeNumeric(metrics["POS Qty"]),
          normalizeNumeric(metrics["POS Qty if Instock"]),
          normalizeNumeric(metrics["Units per Store per Week (w/zeros)"]),
          normalizeNumeric(metrics["Avg Price"]),
          normalizeNumeric(metrics["Traited Stores"]),
          normalizeNumeric(metrics["Instock"]),
          normalizeNumeric(metrics["Forecast"]),
          normalizeNumeric(metrics["Variance"])
        );
      });
    });

    const query = `
INSERT INTO walmart_powerbi_reports.all_item_detail (
  report_year, report_week,
  acct_dept_nbr, vendor_stk_nbr, prime_item_nbr, prime_item_desc,
  week_key,
  pos_sales, pos_qty, pos_qty_if_instock, units_per_store_per_week,
  avg_price, traited_stores, instock, forecast, variance
)
VALUES ${placeholders.join(",")}
ON CONFLICT (prime_item_nbr, week_key, report_year, report_week)
DO UPDATE SET
  pos_sales = EXCLUDED.pos_sales,
  pos_qty = EXCLUDED.pos_qty,
  instock = EXCLUDED.instock,
  forecast = EXCLUDED.forecast,
  variance = EXCLUDED.variance
`;

    await commonDbUtils.query(query, values);
  },

  insertScorecardAquasonicRows: async (rows, reportWeek, reportYear) => {
    if (!rows?.length) return;

    const values = [];
    const placeholders = [];

    rows.forEach((r, i) => {
      const base = i * 8;

      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4},
        $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`
      );

      values.push(
        reportYear,
        reportWeek,

        r.section,
        r.metric,
        r.period,

        normalizeNumeric(r.ty), // this_year
        normalizeNumeric(r.ly), // last_year
        normalizeNumeric(r.diff) // difference
      );
    });

    const query = `
    INSERT INTO walmart_powerbi_reports.scorecard_aquasonic (
      report_year, report_week,
      section, metric, period,
      this_year, last_year, difference
    )
    VALUES ${placeholders.join(",")}
    ON CONFLICT (report_year, report_week, section, metric, period)
    DO UPDATE SET
      this_year = EXCLUDED.this_year,
      last_year = EXCLUDED.last_year,
      difference = EXCLUDED.difference
  `;

    await commonDbUtils.query(query, values);
  },

  insertBestBuy10WeekGrossRows: async (skus) => {
    if (!skus?.length) return;

    const values = [];
    const placeholders = [];
    let idx = 1;

    skus.forEach((sku) => {
      sku.weekly_sales.forEach((week) => {
        placeholders.push(`(
        $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++},
        $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++},
        $${idx++}, $${idx++}, $${idx++}, $${idx++},
        $${idx++}, $${idx++}
      )`);

        values.push(
          sku.class, // 1
          sku.sku, // 2
          sku.upc, // 3
          sku.part_number, // 4
          sku.part_description, // 5

          normalizeNumeric(sku.store_count), // 6
          sku.end_of_life, // 7
          normalizeNumeric(sku.price), // 8
          normalizeNumeric(sku.msrp), // 9
          normalizeNumeric(sku.margin_pct), // 10

          normalizeNumeric(sku.on_hand), // 11
          normalizeNumeric(sku.on_order), // 12
          normalizeNumeric(sku.wos), // 13
          normalizeNumeric(sku.tw_vs_lw_pct), // 14

          week.week_end, // 15
          normalizeNumeric(week.units) // 16
        );
      });
    });

    const query = `
    INSERT INTO bestbuy_powerbi_reports.ten_week_gross_sales (
      class, sku, upc, part_number, part_description,
      store_count, end_of_life, price, msrp, margin_pct,
      on_hand, on_order, wos, tw_vs_lw_pct,
      week_end, units
    )
    VALUES ${placeholders.join(",")}
    ON CONFLICT (sku, week_end)
    DO UPDATE SET
      units = EXCLUDED.units,
      on_hand = EXCLUDED.on_hand,
      on_order = EXCLUDED.on_order,
      wos = EXCLUDED.wos,
      tw_vs_lw_pct = EXCLUDED.tw_vs_lw_pct,
      price = EXCLUDED.price,
      msrp = EXCLUDED.msrp,
      margin_pct = EXCLUDED.margin_pct
  `;

    await commonDbUtils.query(query, values);
  },

  insertBestBuySkuInfoRows: async (rows) => {
    if (!rows?.length) return;

    const values = [];
    const placeholders = [];
    let idx = 1;

    rows.forEach((r) => {
      placeholders.push(`(
      $${idx++}, $${idx++}, $${idx++},
      $${idx++}, $${idx++},
      $${idx++}, $${idx++},
      $${idx++}, $${idx++},
      $${idx++}, $${idx++}
    )`);

      values.push(
        r.bby_sku, // 1
        r.gln, // 2
        r.upc, // 3
        r.mfg_part_number, // 4
        r.title, // 5
        normalizeNumeric(r.bby_cost), // 6
        normalizeNumeric(r.msrp), // 7
        r.online, // 8
        r.in_stock, // 9
        r.product_link, // 10
        r.notes // 11
      );
    });

    const query = `
    INSERT INTO bestbuy_powerbi_reports.sku_info (
      bby_sku, gln, upc,
      mfg_part_number, title,
      bby_cost, msrp,
      online, in_stock,
      product_link, notes
    )
    VALUES ${placeholders.join(",")}
    ON CONFLICT (bby_sku)
    DO UPDATE SET
      gln = EXCLUDED.gln,
      upc = EXCLUDED.upc,
      mfg_part_number = EXCLUDED.mfg_part_number,
      title = EXCLUDED.title,
      bby_cost = EXCLUDED.bby_cost,
      msrp = EXCLUDED.msrp,
      online = EXCLUDED.online,
      in_stock = EXCLUDED.in_stock,
      product_link = EXCLUDED.product_link,
      notes = EXCLUDED.notes
  `;

    await commonDbUtils.query(query, values);
  },

  insertBestBuyCoreShipmentRows: async (rows) => {
    if (!rows?.length) return;

    const values = [];
    const placeholders = [];
    let idx = 1;

    rows.forEach((sku) => {
      sku.weekly_shipments.forEach((week) => {
        placeholders.push(`(
        $${idx++},  -- bby_sku
        $${idx++},  -- week_end
        $${idx++}   -- units
      )`);

        values.push(sku.bby_sku, week.week_end, normalizeNumeric(week.units));
      });
    });

    const query = `
    INSERT INTO bestbuy_powerbi_reports.core_shipments (
      bby_sku,
      week_end,
      units
    )
    VALUES ${placeholders.join(",")}
    ON CONFLICT (bby_sku, week_end)
    DO UPDATE SET
      units = EXCLUDED.units,
      updated_at = NOW()
  `;

    await commonDbUtils.query(query, values);
  },

  insertBestBuySalesTotalRows: async (rows) => {
    if (!rows?.length) return;

    const BATCH_SIZE = 1000;

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);

      const values = [];
      const placeholders = [];
      let idx = 1;

      batch.forEach((r) => {
        placeholders.push(`(
        $${idx++}, $${idx++}, $${idx++}, $${idx++}
      )`);

        values.push(
          r.mfg_part_number,
          r.channel_type,
          r.week_end,
          normalizeNumeric(r.units)
        );
      });

      const query = `
      INSERT INTO bestbuy_powerbi_reports.sales_total_sell_thru (
        mfg_part_number,
        channel_type,
        week_end,
        units
      )
      VALUES ${placeholders.join(",")}
      ON CONFLICT (mfg_part_number, channel_type, week_end)
      DO UPDATE SET
        units = EXCLUDED.units,
        updated_at = NOW()
    `;

      await commonDbUtils.query(query, values);

      console.log(
        `✅ Inserted batch ${offset + 1} → ${Math.min(
          offset + BATCH_SIZE,
          rows.length
        )}`
      );
    }
  },

  insertBestBuySkuLevelRows: async (rows) => {
    if (!rows?.length) return;

    const values = [];
    const placeholders = [];
    let idx = 1;

    rows.forEach((r) => {
      placeholders.push(`(
  $${idx++}, $${idx++}, $${idx++}, $${idx++},

  $${idx++}, $${idx++},
  $${idx++}, $${idx++},

  $${idx++}, $${idx++},
  $${idx++},

  $${idx++}, $${idx++}, $${idx++},
  $${idx++}, $${idx++}, $${idx++},

  $${idx++}, $${idx++},
  $${idx++}, $${idx++}
)`);

      values.push(
        r.bby_sku,
        r.mfg_part_number,
        r.description,
        r.upc,

        normalizeNumeric(r.ca_pct),
        normalizeNumeric(r.ca_pct_ly),

        normalizeNumeric(r.demand_fill_pct),
        normalizeNumeric(r.demand_fill_pct_ly),

        normalizeNumeric(r.on_hand),
        normalizeNumeric(r.on_hand_ly),

        normalizeNumeric(r.store_count),

        normalizeNumeric(r.pos_units_ty),
        normalizeNumeric(r.pos_units_ly),
        normalizeNumeric(r.pos_units_change_pct),

        normalizeNumeric(r.pos_dollars_ty),
        normalizeNumeric(r.pos_dollars_ly),
        normalizeNumeric(r.pos_dollars_change_pct),

        normalizeNumeric(r.avg_price_ty),
        normalizeNumeric(r.avg_price_ly),
        normalizeNumeric(r.upspw),
        normalizeNumeric(r.dpspw)
      );
    });

    const query = `
    INSERT INTO bestbuy_powerbi_reports.sku_level (
  bby_sku,
  mfg_part_number, description, upc,

  ca_pct, ca_pct_ly,
  demand_fill_pct, demand_fill_pct_ly,

  on_hand, on_hand_ly,
  store_count,

  pos_units_ty, pos_units_ly, pos_units_change_pct,
  pos_dollars_ty, pos_dollars_ly, pos_dollars_change_pct,

  avg_price_ty, avg_price_ly,
  upspw, dpspw
)
    VALUES ${placeholders.join(",")}
    ON CONFLICT (bby_sku)
DO UPDATE SET
  mfg_part_number = EXCLUDED.mfg_part_number,
  description = EXCLUDED.description,
  upc = EXCLUDED.upc,

  ca_pct = EXCLUDED.ca_pct,
  ca_pct_ly = EXCLUDED.ca_pct_ly,
  demand_fill_pct = EXCLUDED.demand_fill_pct,
  demand_fill_pct_ly = EXCLUDED.demand_fill_pct_ly,

  on_hand = EXCLUDED.on_hand,
  on_hand_ly = EXCLUDED.on_hand_ly,
  store_count = EXCLUDED.store_count,

  pos_units_ty = EXCLUDED.pos_units_ty,
  pos_units_ly = EXCLUDED.pos_units_ly,
  pos_units_change_pct = EXCLUDED.pos_units_change_pct,

  pos_dollars_ty = EXCLUDED.pos_dollars_ty,
  pos_dollars_ly = EXCLUDED.pos_dollars_ly,
  pos_dollars_change_pct = EXCLUDED.pos_dollars_change_pct,

  avg_price_ty = EXCLUDED.avg_price_ty,
  avg_price_ly = EXCLUDED.avg_price_ly,
  upspw = EXCLUDED.upspw,
  dpspw = EXCLUDED.dpspw,

  updated_at = NOW();
  `;

    await commonDbUtils.query(query, values);

    console.log(`✅ Inserted ${rows.length} SKU Level rows`);
  },
};

module.exports = {
  db,
  commonDbUtils,
};

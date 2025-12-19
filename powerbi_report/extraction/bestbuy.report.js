// extraction/bestbuy.report.js
import { commonUtils } from "../utils/common.utils.js";
import { commonDbUtils } from "../utils/common.db.utils.js";

const parsePct = (val) => {
  if (val === null || val === undefined || val === "") return null;

  if (typeof val === "string") {
    return Number(val.replace("%", ""));
  }

  return Number(val);
};

const toISODate = (val) => {
  if (!(val instanceof Date)) return null;
  return val.toISOString().slice(0, 10); // YYYY-MM-DD
};

const parseCurrency = (val) => {
  if (val === null || val === undefined || val === "") return null;

  if (typeof val === "string") {
    const cleaned = val.replace(/[$,\s]/g, "");
    const num = Number(cleaned);
    return Number.isNaN(num) ? null : num;
  }

  if (typeof val === "number") return val;

  return null;
};

const parseYesNo = (val) => {
  if (!val) return null;
  if (typeof val !== "string") return null;

  const v = val.trim().toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;

  return null;
};

const parseUnits = (raw) => {
  if (raw === null || raw === undefined) return null;

  // Excel date object → NOT units
  if (raw instanceof Date) return null;

  // Excel timestamp in ms → NOT units
  if (typeof raw === "number" && raw > 10_000_000) return null;

  // String numbers
  if (typeof raw === "string") {
    const cleaned = raw.replace(/,/g, "");
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }

  return null;
};

const dedupeSalesTotalRows = (rows) => {
  const map = new Map();

  rows.forEach((r) => {
    const key = `${r.mfg_part_number}|${r.channel_type}|${r.week_end}`;

    map.set(key, r);
  });

  return Array.from(map.values());
};

const safeNumber = (cell) => {
  if (!cell) return null;

  const v = cell.value;

  // Excel error
  if (v && typeof v === "object" && v.error) return null;
  if (cell.text === "#ERROR!") return null;

  // ----------------------------
  // 1️⃣ Formula cells
  // ----------------------------
  if (v && typeof v === "object" && v.formula !== undefined) {
    // If Excel cached a numeric result
    if (typeof v.result === "number") {
      return Number.isFinite(v.result) ? v.result : null;
    }

    // If result is "-" or missing → parse visible text
    const txt = cell.text?.replace(/[$,%\s,]/g, "").trim();

    if (!txt || txt === "-") return null;

    const n = Number(txt);
    return Number.isFinite(n) ? n : null;
  }

  // ----------------------------
  // 2️⃣ Plain number
  // ----------------------------
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }

  // ----------------------------
  // 3️⃣ String (currency, percent, etc.)
  // ----------------------------
  if (typeof v === "string") {
    if (v.trim() === "-" || v.trim() === "") return null;

    const cleaned = v.replace(/[$,%\s,]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  return null;
};

export const bestBuyExtraction = {
  explore10WeekGross: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = workbook.worksheets[0]; // only one sheet

    console.log(`\n📄 Processing sheet: ${sheet.name}`);

    // ----------------------------
    // HEADER ROW (row 3)
    // ----------------------------
    const headerRow = sheet.getRow(3);
    const headers = headerRow.values.slice(1);

    console.log(
      "🧾 Headers:",
      headers.map((h) => (h instanceof Date ? h.toDateString() : h))
    );

    // ----------------------------
    // WEEK COLUMNS = Date headers
    // ----------------------------
    const weekColumns = headers
      .map((h, idx) => ({
        header: h,
        index: idx,
      }))
      .filter(({ header }) => header instanceof Date);

    console.log(
      "📅 Week columns:",
      weekColumns.map((w) => toISODate(w.header))
    );

    // ----------------------------
    // DATA ROWS
    // ----------------------------
    const results = [];

    for (let rowNum = 4; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      const firstCell = row.getCell(1).value;

      if (!firstCell) continue;

      const rowData = {};
      headers.forEach((h, i) => {
        const key = h instanceof Date ? toISODate(h) : h?.toString().trim();
        rowData[key] = row.getCell(i + 1).value;
      });

      const weekly_sales = weekColumns.map(({ header, index }) => ({
        week_end: toISODate(header),
        units: Number(row.getCell(index + 1).value ?? 0),
      }));

      const skuObj = {
        class: Number(rowData["Class"]),
        sku: Number(rowData["SKU"]),
        upc: rowData["UPC Code"]?.toString(),
        part_number: rowData["Part Number"],
        part_description: rowData["Part Description"],
        store_count: Number(rowData["Store Ct."]),
        end_of_life: rowData["End of Life"] === "Yes",
        price: Number(rowData["Price"]),
        msrp: Number(rowData["MSRP"]),
        margin_pct: parsePct(rowData["Margin %"]),
        on_hand: Number(rowData["On Hand"]),
        on_order: Number(rowData["On Order"]),
        wos: Number(rowData["WOS"]),
        tw_vs_lw_pct: parsePct(rowData["TW vs LW"]),
        weekly_sales,
      };

      results.push(skuObj);
    }

    console.log(`✅ Parsed ${results.length} SKUs`);

    // ----------------------------
    // INSERT INTO DB
    // ----------------------------
    await commonDbUtils.insertBestBuy10WeekGrossRows(results);

    console.log(
      `✅ Inserted ${results.length} SKUs into bestbuy_powerbi_reports.ten_week_gross_sales`
    );

    return results;
  },
  exploreSkuInfo: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "SKU Info");

    if (!sheet) {
      throw new Error(`Sheet "SKU Info" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);

    // ----------------------------
    // HEADER ROW (row 1)
    // ----------------------------
    const headerRow = sheet.getRow(1);
    const headers = headerRow.values.slice(1).map((h) => h?.toString().trim());

    console.log("🧾 Headers:", headers);

    // ----------------------------
    // DATA ROWS
    // ----------------------------
    const results = [];

    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      const bbySkuRaw = row.getCell(1).value;

      // Skip brand headers / placeholders
      if (!bbySkuRaw || isNaN(Number(bbySkuRaw))) continue;

      const rowData = {};
      headers.forEach((h, i) => {
        rowData[h] = row.getCell(i + 1).value;
      });

      const skuObj = {
        bby_sku: Number(rowData["BBY SKU"]),
        gln: rowData["GLN"]?.toString(),
        upc: rowData["UPC"]?.toString(),
        mfg_part_number: rowData["MFG"],
        title: rowData["Title"],

        bby_cost: parseCurrency(rowData["BBY Cost"]),
        msrp: parseCurrency(rowData["MSRP"]),

        online: parseYesNo(rowData["Online"]),
        in_stock: parseYesNo(rowData["In Stock"]),

        product_link: rowData["Link"] ?? null,
        notes: rowData["Notes"] ?? null,
      };

      results.push(skuObj);
    }

    // ----------------------------
    // INSPECTION
    // ----------------------------
    console.log(`\n🧪 Parsed ${results.length} SKU Info rows\n`);
    await commonDbUtils.insertBestBuySkuInfoRows(results);

    console.log(
      `✅ Inserted ${results.length} rows into bestbuy_powerbi_reports.sku_info`
    );

    return results;
  },

  exploreCoreShipments: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Core Shipments");

    if (!sheet) {
      throw new Error(`Sheet "Core Shipments" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);

    // ----------------------------
    // HEADER ROW (row 1)
    // ----------------------------
    const headerRow = sheet.getRow(1);
    const headers = headerRow.values.slice(1);

    // ----------------------------
    // DATE COLUMNS
    // ----------------------------
    const dateColumns = headers
      .map((h, idx) => {
        if (h instanceof Date) {
          return {
            header: h,
            index: idx + 1,
            iso: toISODate(h),
          };
        }

        if (typeof h === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(h)) {
          const parsed = new Date(h);
          return {
            header: h,
            index: idx + 1,
            iso: toISODate(parsed),
          };
        }

        return null;
      })
      .filter(Boolean);

    console.log(
      "📅 Shipment weeks:",
      dateColumns.map((d) => d.iso)
    );

    // ----------------------------
    // DATA ROWS
    // ----------------------------
    const results = [];

    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);

      const bbySkuRaw = row.getCell(2).value; // "BBY SKU"
      const title = row.getCell(5).text?.toLowerCase();

      // ❌ Skip invalid rows
      if (!bbySkuRaw || isNaN(Number(bbySkuRaw))) continue;
      if (title?.includes("special cost")) continue;

      const weekly_shipments = [];

      dateColumns.forEach(({ index, iso }) => {
        const raw = row.getCell(index).value;

        const units =
          typeof raw === "string"
            ? Number(raw.replace(/,/g, ""))
            : Number(raw ?? 0);

        if (!Number.isNaN(units) && units !== 0) {
          weekly_shipments.push({
            week_end: iso,
            units,
          });
        }
      });

      // ❌ Skip rows with no shipments
      if (!weekly_shipments.length) continue;

      results.push({
        bby_sku: Number(bbySkuRaw),
        weekly_shipments,
      });
    }

    // ----------------------------
    // INSPECTION
    // ----------------------------
    console.log(`\n🧪 Parsed ${results.length} Core Shipment SKUs\n`);

    await commonDbUtils.insertBestBuyCoreShipmentRows(results);

    console.log(
      `✅ Inserted Core Shipments into bestbuy_powerbi_reports.core_shipments`
    );

    return results;
  },

  exploreSalesTotalTable1: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Sales TOTAL");

    if (!sheet) {
      throw new Error(`Sheet "Sales TOTAL" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);
    console.log("🔍 Extracting: SDF Sell Thru (Online)");

    // ----------------------------
    // FIND HEADER ROW
    // ----------------------------
    let headerRowNum = null;

    for (let i = 1; i <= sheet.rowCount; i++) {
      const cellText = sheet.getRow(i).getCell(3).text;
      if (cellText?.includes("SDF Sell Thru")) {
        headerRowNum = i;
        break;
      }
    }

    if (!headerRowNum) {
      throw new Error("SDF Sell Thru (Online) table not found");
    }

    const headerRow = sheet.getRow(headerRowNum);
    const headers = headerRow.values.slice(1);

    // ----------------------------
    // DATE COLUMNS
    // ----------------------------
    const dateColumns = headers
      .map((h, idx) => {
        if (h instanceof Date) {
          return {
            index: idx + 1,
            week_end: toISODate(h),
          };
        }

        if (typeof h === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(h)) {
          return {
            index: idx + 1,
            week_end: toISODate(new Date(h)),
          };
        }

        return null;
      })
      .filter(Boolean);

    console.log(
      "📅 Weeks:",
      dateColumns.map((d) => d.week_end)
    );

    // ----------------------------
    // DATA ROWS
    // ----------------------------
    const results = [];

    for (let rowNum = headerRowNum + 1; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);

      const mfgPart = row.getCell(3).value; // "SDF Sell Thru (Online)" column
      const title = row.getCell(4).text?.toLowerCase();

      // ❌ Skip invalid / placeholder rows
      if (!mfgPart || typeof mfgPart !== "string") continue;
      if (title?.includes("bundle")) continue;
      if (title?.includes("ultimate")) continue;
      if (title?.includes("vlookup")) continue;

      dateColumns.forEach(({ index, week_end }) => {
        const raw = row.getCell(index).value;

        const units = parseUnits(raw);

        if (!Number.isNaN(units) && units !== 0) {
          results.push({
            mfg_part_number: mfgPart,
            channel_type: "SDF_ONLINE",
            week_end,
            units,
          });
        }
      });
    }

    // ----------------------------
    // INSPECTION
    // ----------------------------
    console.log(`\n🧪 Parsed ${results.length} SDF Sell Thru rows\n`);
    results.slice(0, 10).forEach((r, i) => {
      console.log(`📦 Row ${i + 1}`, r);
    });

    return results;
  },

  exploreSalesTotalTable2: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Sales TOTAL");

    if (!sheet) {
      throw new Error(`Sheet "Sales TOTAL" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);
    console.log("🔍 Extracting: Core Sell thru (TOTAL)");

    // ----------------------------
    // FIND HEADER ROW
    // ----------------------------
    let headerRowNum = null;

    for (let i = 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);

      const rowText = row.values
        .slice(1)
        .map((v) => {
          if (!v) return "";
          if (typeof v === "string") return v.toLowerCase();
          if (v.richText)
            return v.richText
              .map((r) => r.text)
              .join("")
              .toLowerCase();
          return v.toString().toLowerCase();
        })
        .join(" ");

      if (rowText.includes("core sell thru") && rowText.includes("total")) {
        headerRowNum = i;
        break;
      }
    }

    if (!headerRowNum) {
      throw new Error("Core Sell thru (TOTAL) table not found");
    }

    if (!headerRowNum) {
      throw new Error("Core Sell thru (TOTAL) table not found");
    }

    const headerRow = sheet.getRow(headerRowNum);

    // ----------------------------
    // DATE COLUMNS
    // ----------------------------
    const dateColumns = [];

    headerRow.eachCell((cell, colNumber) => {
      const v = cell.value;

      if (v instanceof Date) {
        dateColumns.push({
          col: colNumber, // ✅ real column index
          week_end: toISODate(v),
        });
        return;
      }

      if (typeof v === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
        dateColumns.push({
          col: colNumber,
          week_end: toISODate(new Date(v)),
        });
      }
    });

    console.log(
      "📅 Weeks:",
      dateColumns.map((d) => d.week_end)
    );

    // ----------------------------
    // DATA ROWS
    // ----------------------------
    const results = [];

    for (let rowNum = headerRowNum + 1; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);

      let mfgPart = null;
      let title = "";

      // Scan first 3 columns (BBY SKU may be blank)
      for (let c = 1; c <= 3; c++) {
        const val = row.getCell(c).value;
        if (typeof val === "string" && val.trim()) {
          mfgPart = val.trim();
          title = row.getCell(c + 1).text?.toLowerCase() ?? "";
          break;
        }
      }

      // Skip garbage rows
      if (!mfgPart) continue;
      if (mfgPart.toLowerCase().includes("sku")) continue;

      dateColumns.forEach(({ col, week_end }) => {
        const raw = row.getCell(col).value;

        const units = parseUnits(raw);

        if (units !== null && !Number.isNaN(units)) {
          results.push({
            mfg_part_number: mfgPart,
            channel_type: "CORE_TOTAL",
            week_end,
            units,
          });
        }
      });
    }

    // ----------------------------
    // INSPECTION
    // ----------------------------
    console.log(`\n🧪 Parsed ${results.length} Core TOTAL Sell Thru rows\n`);
    results.slice(0, 10).forEach((r, i) => {
      console.log(`📦 Row ${i + 1}`, r);
    });

    return results;
  },

  exploreSalesTotalTable3: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Sales TOTAL");

    if (!sheet) {
      throw new Error(`Sheet "Sales TOTAL" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);
    console.log("🔍 Extracting: Core Sell thru (Brick & Mortar)");

    // ----------------------------
    // FIND HEADER ROW
    // ----------------------------
    let headerRowNum = null;

    for (let i = 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);

      const rowText = row.values
        .slice(1)
        .map((v) => {
          if (!v) return "";
          if (typeof v === "string") return v.toLowerCase();
          if (v.richText)
            return v.richText
              .map((r) => r.text)
              .join("")
              .toLowerCase();
          return v.toString().toLowerCase();
        })
        .join(" ");

      if (
        rowText.includes("core sell thru") &&
        rowText.includes("brick") &&
        rowText.includes("mortar")
      ) {
        headerRowNum = i;
        break;
      }
    }

    if (!headerRowNum) {
      throw new Error("Core Sell thru (Brick & Mortar) table not found");
    }

    const headerRow = sheet.getRow(headerRowNum);

    // ----------------------------
    // DATE COLUMNS
    // ----------------------------
    const dateColumns = [];

    headerRow.eachCell((cell, colNumber) => {
      const v = cell.value;

      if (v instanceof Date) {
        dateColumns.push({
          col: colNumber,
          week_end: toISODate(v),
        });
        return;
      }

      if (typeof v === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
        dateColumns.push({
          col: colNumber,
          week_end: toISODate(new Date(v)),
        });
      }
    });

    console.log(
      "📅 Weeks:",
      dateColumns.map((d) => d.week_end)
    );

    // ----------------------------
    // DATA ROWS
    // ----------------------------
    const results = [];

    for (let rowNum = headerRowNum + 1; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);

      let mfgPart = null;
      let title = "";

      // Scan first 3 columns:
      // [BBY SKU] [MFG PART] [TITLE]
      for (let c = 1; c <= 3; c++) {
        const val = row.getCell(c).value;
        if (typeof val === "string" && val.trim()) {
          mfgPart = val.trim();
          title = row.getCell(c + 1).text?.toLowerCase() ?? "";
          break;
        }
      }

      // ❌ Skip junk rows
      if (!mfgPart) continue;
      if (mfgPart.toLowerCase().includes("sku")) continue;

      dateColumns.forEach(({ col, week_end }) => {
        const raw = row.getCell(col).value;

        const units = parseUnits(raw);

        if (units !== null && !Number.isNaN(units)) {
          results.push({
            mfg_part_number: mfgPart,
            channel_type: "CORE_BM",
            week_end,
            units,
          });
        }
      });
    }

    // ----------------------------
    // INSPECTION
    // ----------------------------
    console.log(`\n🧪 Parsed ${results.length} Core Brick & Mortar rows\n`);
    results.slice(0, 10).forEach((r, i) => {
      console.log(`📦 Row ${i + 1}`, r);
    });

    return results;
  },

  exploreSalesTotalTable4: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Sales TOTAL");

    if (!sheet) {
      throw new Error(`Sheet "Sales TOTAL" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);
    console.log("🔍 Extracting: Core Sell thru (Online)");

    // ----------------------------
    // FIND HEADER ROW
    // ----------------------------
    let headerRowNum = null;

    for (let i = 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);

      const rowText = row.values
        .slice(1)
        .map((v) => {
          if (!v) return "";
          if (typeof v === "string") return v.toLowerCase();
          if (v.richText)
            return v.richText
              .map((r) => r.text)
              .join("")
              .toLowerCase();
          return v.toString().toLowerCase();
        })
        .join(" ");

      if (rowText.includes("core sell thru") && rowText.includes("online")) {
        headerRowNum = i;
        break;
      }
    }

    if (!headerRowNum) {
      throw new Error("Core Sell thru (Online) table not found");
    }

    const headerRow = sheet.getRow(headerRowNum);

    // ----------------------------
    // DATE COLUMNS
    // ----------------------------
    const dateColumns = [];

    headerRow.eachCell((cell, colNumber) => {
      const v = cell.value;

      if (v instanceof Date) {
        dateColumns.push({
          col: colNumber,
          week_end: toISODate(v),
        });
        return;
      }

      if (typeof v === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
        dateColumns.push({
          col: colNumber,
          week_end: toISODate(new Date(v)),
        });
      }
    });

    console.log(
      "📅 Weeks:",
      dateColumns.map((d) => d.week_end)
    );

    // ----------------------------
    // DATA ROWS
    // ----------------------------
    const results = [];

    for (let rowNum = headerRowNum + 1; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);

      let mfgPart = null;
      let title = "";

      // Scan first 3 columns
      for (let c = 1; c <= 3; c++) {
        const val = row.getCell(c).value;
        if (typeof val === "string" && val.trim()) {
          mfgPart = val.trim();
          title = row.getCell(c + 1).text?.toLowerCase() ?? "";
          break;
        }
      }

      // ❌ Skip junk rows
      if (!mfgPart) continue;
      if (mfgPart.toLowerCase().includes("sku")) continue;

      dateColumns.forEach(({ col, week_end }) => {
        const raw = row.getCell(col).value;

        const units = parseUnits(raw);

        if (units !== null && !Number.isNaN(units)) {
          results.push({
            mfg_part_number: mfgPart,
            channel_type: "CORE_ONLINE",
            week_end,
            units,
          });
        }
      });
    }

    // ----------------------------
    // INSPECTION
    // ----------------------------
    console.log(`\n🧪 Parsed ${results.length} Core Online rows\n`);
    results.slice(0, 10).forEach((r, i) => {
      console.log(`📦 Row ${i + 1}`, r);
    });

    return results;
  },

  runSalesTotalExtractors: async (filePath) => {
    console.log("\n🚀 Starting Sales TOTAL extraction pipeline\n");

    // ----------------------------
    // Extract
    // ----------------------------
    const sdf_online = await bestBuyExtraction.exploreSalesTotalTable1(
      filePath
    );
    const core_total = await bestBuyExtraction.exploreSalesTotalTable2(
      filePath
    );
    const core_bm = await bestBuyExtraction.exploreSalesTotalTable3(filePath);
    const core_online = await bestBuyExtraction.exploreSalesTotalTable4(
      filePath
    );

    // ----------------------------
    // Combine
    // ----------------------------
    const allRowsRaw = [
      ...sdf_online,
      ...core_total,
      ...core_bm,
      ...core_online,
    ];

    console.log(`📦 Raw rows: ${allRowsRaw.length}`);

    const allRows = dedupeSalesTotalRows(allRowsRaw);

    console.log(`🧹 Deduped rows: ${allRows.length}`);

    await commonDbUtils.insertBestBuySalesTotalRows(allRows);

    console.log("\n✅ Sales TOTAL rows stored successfully\n");

    console.log("📊 Summary:");
    console.log("• SDF Online:", sdf_online.length);
    console.log("• Core Total:", core_total.length);
    console.log("• Core Brick & Mortar:", core_bm.length);
    console.log("• Core Online:", core_online.length);

    return {
      sdf_online,
      core_total,
      core_bm,
      core_online,
    };
  },

  exploreSalesYearly: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Sales (YEARLY)");

    if (!sheet) {
      throw new Error(`Sheet "Sales (YEARLY)" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);
    console.log("🔍 Extracting: Yearly SDF + CORE (excluding totals)");

    const results = [];

    const YEAR_COLUMNS = {
      2021: { u: "D", c: "E", sc: "F", m: "G", sm: "H" },
      2022: { u: "J", c: "K", sc: "L", m: "M", sm: "N" },
      2023: { u: "P", c: "Q", sc: "R", m: "S", sm: "T" },
      2024: { u: "V", c: "W", sc: "X", m: "Y", sm: "Z" },
      2025: { u: "AB", c: "AC", sc: "AD", m: "AE", sm: "AF" },
    };

    const num = (cell) => {
      if (!cell) return null;

      const v = cell.value;

      // ----------------------------
      // 1️⃣ Formula cell
      // ----------------------------
      if (v && typeof v === "object" && v.formula !== undefined) {
        // Prefer cached result if present (0 is valid)
        if (v.result !== null && v.result !== undefined) {
          return Number.isFinite(v.result) ? v.result : null;
        }

        // 🔥 FALLBACK: parse displayed text
        const txt = cell.text?.replace(/[$,]/g, "").trim();
        if (txt === "") return null;

        const n = Number(txt);
        return Number.isFinite(n) ? n : null;
      }

      // ----------------------------
      // 2️⃣ Plain number
      // ----------------------------
      if (typeof v === "number") {
        return Number.isFinite(v) ? v : null;
      }

      // ----------------------------
      // 3️⃣ String number / currency
      // ----------------------------
      if (typeof v === "string") {
        const cleaned = v.replace(/[$,]/g, "").trim();
        if (cleaned === "") return null;

        const n = Number(cleaned);
        return Number.isFinite(n) ? n : null;
      }

      return null;
    };

    const extractRange = (startRow, endRow, channel) => {
      for (let row = startRow; row <= endRow; row++) {
        const mfg = sheet.getCell(`A${row}`).text?.trim();
        if (!mfg) continue;

        for (const [year, cols] of Object.entries(YEAR_COLUMNS)) {
          const units = num(sheet.getCell(`${cols.u}${row}`));
          const bby_cost = num(sheet.getCell(`${cols.c}${row}`));
          const sales_at_cost = num(sheet.getCell(`${cols.sc}${row}`));
          const msrp = num(sheet.getCell(`${cols.m}${row}`));
          const sales_at_msrp = num(sheet.getCell(`${cols.sm}${row}`));

          const hasAnyData =
            units !== null ||
            bby_cost !== null ||
            sales_at_cost !== null ||
            msrp !== null ||
            sales_at_msrp !== null;

          if (!hasAnyData) continue;

          results.push({
            mfg_part_number: mfg,
            channel_type: channel,
            year: Number(year),
            units,
            bby_cost,
            sales_at_cost,
            msrp,
            sales_at_msrp,
          });
        }
      }
    };

    // ✅ SDF
    extractRange(3, 56, "SDF");

    // ✅ CORE
    extractRange(61, 67, "CORE");

    console.log(`\n🧪 Parsed ${results.length} yearly rows\n`);
    results.slice(0, 10).forEach((r, i) => {
      console.log(`📦 Row ${i + 1}`, r);
    });

    return results;
  },

  exploreSkuLevel: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Sku Level");

    if (!sheet) {
      throw new Error(`Sheet "Sku Level" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);
    console.log("🔍 Extracting: SKU Level Detail (clean rows only)");

    // ----------------------------
    // FIND HEADER ROW
    // ----------------------------
    let headerRowNum = null;
    let headers = [];

    for (let i = 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      const text = row.values
        .slice(1)
        .map((v) => (typeof v === "string" ? v.toLowerCase() : ""))
        .join(" ");

      if (
        text.includes("sku") &&
        text.includes("description") &&
        text.includes("model")
      ) {
        headerRowNum = i;
        headers = row.values
          .slice(1)
          .map((h) =>
            typeof h === "string"
              ? h.replace(/\s+/g, " ").replace(/\n/g, " ").trim().toLowerCase()
              : ""
          );

        break;
      }
    }

    if (!headerRowNum) {
      throw new Error("SKU Level header row not found");
    }

    console.log("🧾 Headers:", headers);

    const col = (name) => {
      const target = name.replace(/\s+/g, " ").trim().toLowerCase();

      const idx = headers.findIndex((h) => h === target);
      return idx === -1 ? -1 : idx + 1;
    };

    // ----------------------------
    // DATA ROWS
    // ----------------------------
    const results = [];

    const colNth = (name, nth = 1) => {
      const target = name.replace(/\s+/g, " ").trim().toLowerCase();

      let count = 0;
      for (let i = 0; i < headers.length; i++) {
        if (headers[i] === target) {
          count++;
          if (count === nth) return i + 1;
        }
      }
      return -1;
    };

    for (let rowNum = headerRowNum + 1; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);

      const skuCell = row.getCell(col("Sku"));
      const sku = safeNumber(skuCell);

      // ❌ Skip totals / garbage
      if (!sku) continue;

      const mfg = row.getCell(col("Model")).text?.trim();
      if (!mfg) continue;

      results.push({
        bby_sku: sku,
        description: row.getCell(col("Description")).text?.trim() ?? null,
        upc: row.getCell(col("UPC")).text?.trim() ?? null,
        mfg_part_number: mfg,

        // ---- CA / Demand Fill ----
        ca_pct: safeNumber(row.getCell(col("CA %"))),
        ca_pct_ly: safeNumber(row.getCell(col("CA % LY"))),

        demand_fill_pct: safeNumber(row.getCell(col("Demand Fill %"))),
        demand_fill_pct_ly: safeNumber(row.getCell(col("Demand Fill % LY"))),

        // ---- On Hand ----
        on_hand: safeNumber(row.getCell(col("OH"))),
        on_hand_ly: safeNumber(row.getCell(col("OH LY"))),

        store_count: safeNumber(row.getCell(col("# Store"))),

        // ---- POS UNITS ----
        pos_units_ty: safeNumber(row.getCell(colNth("LW TY", 1))),
        pos_units_ly: safeNumber(row.getCell(colNth("LW LY", 1))),
        pos_units_change_pct: safeNumber(row.getCell(colNth("% Chg", 1))),

        // ---- POS DOLLARS ----
        pos_dollars_ty: safeNumber(row.getCell(colNth("LW TY", 2))),
        pos_dollars_ly: safeNumber(row.getCell(colNth("LW LY", 2))),
        pos_dollars_change_pct: safeNumber(row.getCell(colNth("% Chg", 2))),

        // ---- AVERAGES ----
        avg_price_ty: safeNumber(row.getCell(col("Avg Price TY"))),
        avg_price_ly: safeNumber(row.getCell(col("Avg Price LY"))),
        upspw: safeNumber(row.getCell(col("UPSPW"))),
        dpspw: safeNumber(row.getCell(col("DPSPW"))),
      });
    }

    console.log(`\n🧪 Parsed ${results.length} SKU Level rows`);
    await commonDbUtils.insertBestBuySkuLevelRows(results);

    // results.slice(0, 10).forEach((r, i) => {
    //   console.log(`📦 Row ${i + 1}`, r);
    // });

    console.log(
      `✅ Inserted ${results.length} rows into bestbuy_powerbi_reports.sku_level`
    );

    return results;
  },

  exploreSkuDetail: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Sku Detail");

    if (!sheet) throw new Error(`Sheet "Sku Detail" not found`);

    console.log(`\n📄 Processing sheet: ${sheet.name}`);

    // ---------------- HEADER ROW ----------------
    let headerRowNum = null;
    let headers = [];

    for (let i = 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      const text = row.values
        .slice(1)
        .map((v) => (typeof v === "string" ? v.toLowerCase() : ""))
        .join(" ");

      if (
        text.includes("sku") &&
        text.includes("description") &&
        text.includes("upc")
      ) {
        headerRowNum = i;
        headers = row.values
          .slice(1)
          .map((h) =>
            typeof h === "string"
              ? h.replace(/\s+/g, " ").trim().toLowerCase()
              : ""
          );
        break;
      }
    }

    if (!headerRowNum) throw new Error("Sku Detail header row not found");

    const col = (name) => {
      const idx = headers.findIndex((h) => h === name.toLowerCase());
      return idx === -1 ? -1 : idx + 1;
    };

    const colNth = (name, nth = 1) => {
      const target = name.toLowerCase();
      let count = 0;
      for (let i = 0; i < headers.length; i++) {
        if (headers[i] === target) {
          count++;
          if (count === nth) return i + 1;
        }
      }
      return -1;
    };

    // ---- HARD VALIDATION ----
    ["sku", "description", "upc code", "model"].forEach((h) => {
      if (col(h) === -1) {
        throw new Error(`❌ Missing required column: ${h}`);
      }
    });

    const results = [];

    const PERIODS = [
      { period: "LATEST_WEEK", nth: 1 },
      { period: "LAST_4_WEEKS", nth: 2 },
      { period: "LAST_12_WEEKS", nth: 3 },
      { period: "TOTAL", nth: 4 },
    ];

    // ---------------- DATA ROWS ----------------
    for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);

      const sku = safeNumber(row.getCell(col("sku")));
      const desc = row.getCell(col("description")).text?.trim() ?? "";

      // ❌ Skip class headers, junk rows, totals
      if (!sku || sku < 100000) continue;
      if (!desc) continue;

      const base = {
        bby_sku: sku,
        description: desc,
        upc: row.getCell(col("upc code")).text?.trim() ?? null,
        mfg_part_number: row.getCell(col("model")).text?.trim() ?? null,
      };

      PERIODS.forEach(({ period, nth }) => {
        // ❌ Ignore TOTAL period
        if (period === "TOTAL") return;

        const start = colNth("ty $", nth);
        if (start === -1) return;

        const record = {
          ...base,
          period,
          ty_dollars: safeNumber(row.getCell(start)),
          ly_dollars: safeNumber(row.getCell(start + 1)),
          dollars_change_pct: safeNumber(row.getCell(start + 2)),
          ty_units: safeNumber(row.getCell(start + 3)),
          ly_units: safeNumber(row.getCell(start + 4)),
          units_change_pct: safeNumber(row.getCell(start + 5)),
        };

        const hasData =
          record.ty_dollars !== null ||
          record.ly_dollars !== null ||
          record.ty_units !== null ||
          record.ly_units !== null;

        if (hasData) results.push(record);
      });
    }

    console.log(`🧪 Parsed ${results.length} SKU Detail rows`);
    await commonDbUtils.insertBestBuySkuDetailRows(results);

    return results;
  },

  exploreForecasting: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Forecasting");

    if (!sheet) throw new Error(`Sheet "Forecasting" not found`);

    console.log(`\n📄 Processing sheet: ${sheet.name}`);

    // ---------------- HEADER ROW ----------------
    const headerRowNum = 2;
    const headers = sheet
      .getRow(headerRowNum)
      .values.slice(1)
      .map((h) =>
        h instanceof Date
          ? h
          : typeof h === "string"
          ? h.replace(/\s+/g, " ").trim()
          : ""
      );

    // ---------------- DATE COLS ----------------
    const dateCols = [];
    let avgSalesCol = -1;

    headers.forEach((h, i) => {
      const col = i + 1;

      if (h instanceof Date) {
        dateCols.push({ col, date: toISODate(h) });
        return;
      }

      if (typeof h === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(h)) {
        dateCols.push({ col, date: toISODate(new Date(h)) });
        return;
      }

      if (typeof h === "string" && h.toLowerCase() === "average sales") {
        avgSalesCol = col;
      }
    });

    if (avgSalesCol === -1) {
      throw new Error("Average Sales column not found");
    }

    const salesCols = dateCols.filter((d) => d.col < avgSalesCol);
    const receiptCols = dateCols.filter((d) => d.col > avgSalesCol);

    // ---------------- WOS COLS (AUTO) ----------------
    const wosCols = [];

    headers.forEach((h, i) => {
      if (!h || typeof h !== "string") return;

      const match = h.match(/^(\d+)\s+weeks$/i);
      if (!match) return;

      const weeks = Number(match[1]);
      const unitsCol = i + 1;

      const wosCol =
        headers.findIndex(
          (x) =>
            typeof x === "string" &&
            x.toLowerCase() === `${weeks} weeks - weeks of supply`
        ) + 1;

      if (wosCol > 0) {
        wosCols.push({ weeks, unitsCol, wosCol });
      }
    });

    // ---------------- DATA ----------------
    const results = [];

    for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const sku = safeNumber(row.getCell(3));
      if (!sku) continue;

      const record = {
        class: row.getCell(1).text?.trim(),
        upc: row.getCell(2).text?.trim(),
        bby_sku: sku,
        item_description: row.getCell(4).text?.trim(),
        mfg_part_number: row.getCell(5).text?.trim(),
        perf: row.getCell(6).text?.trim(),

        store_count: safeNumber(row.getCell(7)),
        ca_pct: safeNumber(row.getCell(8)),
        on_hand: safeNumber(row.getCell(9)),

        sales: [],
        receipt_forecast: [],
        wos: [],
      };

      salesCols.forEach(({ col, date }) => {
        const units = safeNumber(row.getCell(col));
        if (units !== null) record.sales.push({ week_end: date, units });
      });

      receiptCols.forEach(({ col, date }) => {
        const units = safeNumber(row.getCell(col));
        if (units !== null)
          record.receipt_forecast.push({ week_end: date, units });
      });

      wosCols.forEach(({ weeks, unitsCol, wosCol }) => {
        const units = safeNumber(row.getCell(unitsCol));
        const wos = safeNumber(row.getCell(wosCol));

        if (units !== null || wos !== null) {
          record.wos.push({ weeks, units, wos });
        }
      });

      results.push(record);
    }

    console.log(`🧪 Parsed ${results.length} Forecasting rows`);
    await commonDbUtils.insertBestBuyForecastingRows(results);

    // results.slice(0, 10).forEach((r, i) => {
    //   console.log(`📦 Row ${i + 1}`, r);
    // });
    return results;
  },

  exploreChartData: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Chart Data");

    if (!sheet) throw new Error(`Sheet "Chart Data" not found`);

    console.log(`\n📄 Processing sheet: ${sheet.name}`);
    console.log("🔍 Extracting: Chart Data");

    // -----------------------------------
    // FIND HEADER ROW (dates row)
    // -----------------------------------
    let headerRowNum = null;
    let dateCols = [];

    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);

      const dates = [];
      row.eachCell((cell, col) => {
        if (cell.value instanceof Date) {
          dates.push({ col, week_end: toISODate(cell.value) });
        }
      });

      if (dates.length >= 6) {
        headerRowNum = r;
        dateCols = dates;
        break;
      }
    }

    if (!headerRowNum) {
      throw new Error("❌ Date header row not found in Chart Data");
    }

    console.log(
      "📅 Weeks:",
      dateCols.map((d) => d.week_end)
    );

    // -----------------------------------
    // DATA ROWS
    // -----------------------------------
    const results = [];

    for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const label = row.getCell(1).text?.trim();

      if (!label) continue;
      if (!label.toLowerCase().includes("dept:")) continue;

      // Example:
      // Dept: 6-Computers  Class: 158-Input Devices
      const match = label.match(
        /Dept:\s*(\d+)-([^\s]+)\s+Class:\s*(\d+)-(.+)/i
      );

      if (!match) continue;

      const [, deptCode, deptName, classCode, className] = match;

      dateCols.forEach(({ col, week_end }) => {
        const val = safeNumber(row.getCell(col));

        if (val === null) return;

        results.push({
          dept_code: Number(deptCode),
          dept_name: deptName.trim(),
          class_code: Number(classCode),
          class_name: className.trim(),

          metric_name: "INSTOCK_PCT",
          week_end,
          metric_value: val,
        });
      });
    }

    console.log(`🧪 Parsed ${results.length} Chart Data rows`);

    // await commonDbUtils.insertChartDataRows(results);

    results.slice(0, 10).forEach((r, i) => {
      console.log(`📦 Row ${i + 1}`, r);
    });

    console.log(
      `✅ Inserted ${results.length} rows into bestbuy_powerbi_reports.chart_data`
    );

    return results;
  },
};

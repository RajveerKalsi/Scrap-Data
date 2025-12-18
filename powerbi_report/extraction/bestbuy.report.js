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
};

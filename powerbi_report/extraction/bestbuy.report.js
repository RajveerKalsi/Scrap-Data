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
  
};

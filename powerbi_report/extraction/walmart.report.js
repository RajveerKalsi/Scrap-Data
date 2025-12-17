import { commonUtils } from "../utils/common.utils.js";
import { commonDbUtils } from "../utils/common.db.utils.js";

const processSheetByName = async (workbook, sheetName) => {
  const sheet = commonUtils.getSheetByName(workbook, sheetName);

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }

  console.log(`\n📄 Processing sheet: ${sheet.name}`);

  const detectedTables = commonUtils.detectTablesInSheet(sheet);

  const result = detectedTables.map((table, index) => {
    const { headers, rows } = commonUtils.extractTableData(sheet, table);

    console.log(`📦 Table ${index + 1}`);
    console.log(`Headers:`, headers);
    console.log(`Total Rows: ${Object.values(rows)[0]?.length ?? 0}`);
    console.log(`Rows:`, rows);
    console.log("--------------------------------------------------");

    return {
      sheetName,
      tableIndex: index + 1,
      headerRow: table.headerRow,
      startRow: table.startRow,
      endRow: table.endRow,
      headers,
      rows,
    };
  });

  return result;
};

export const walmartExtraction = {
  processContentScoresSheet: async (filePath, weekInfo) => {
    const workbook = await commonUtils.readWorkbook(filePath);

    const result = await processSheetByName(workbook, "Content Scores");

    if (!result.length) return [];

    const tableData = result[0];

    await commonDbUtils.insertContentScoreRows(
      tableData,
      weekInfo.week,
      weekInfo.year
    );

    console.log(`✅ Inserted content scores for Wk ${weekInfo.week}`);

    return tableData;
  },

  processEmailTemplateSheet: async (filePath, weekInfo) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheet = commonUtils.getSheetByName(workbook, "Email Template");

    if (!sheet) {
      throw new Error(`Sheet "Email Template" not found`);
    }

    console.log(`\n📄 Processing sheet: Email Template`);

    const rawRows = commonUtils.extractPivotTableData(sheet, {
      periodHeaderRow: 1,
      subHeaderRow: 3,
      dataStartRow: 4,
      metricColumnIndex: 1,
    });

    const mergedRows = commonUtils.mergeMetricPeriodRows(rawRows);

    await commonDbUtils.insertEmailTemplateRows(
      mergedRows,
      weekInfo.week,
      weekInfo.year
    );

    console.log(
      `✅ Inserted ${mergedRows.length} email template rows for Wk ${weekInfo.week}`
    );

    return mergedRows;
  },

  processSalesSummarySheet: async (filePath, weekInfo) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheetName = "Sales Summary";

    const sheet = commonUtils.getSheetByName(workbook, sheetName);
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

    console.log(`\n📄 Processing sheet: ${sheet.name}`);

    const detectedTables = commonUtils.detectTablesInSheet(sheet);
    const table = detectedTables[0];

    const tableData = commonUtils.extractTableData(sheet, table, {
      ignoreRowIf: ({ rowTextValues }) =>
        rowTextValues.some((t) => t.includes("grand total")),
    });

    await commonDbUtils.insertSalesSummaryRows(
      tableData,
      weekInfo.week,
      weekInfo.year
    );

    console.log(`✅ Inserted sales summary for Wk ${weekInfo.week}`);

    return tableData;
  },

  processAllItemDetailSheet: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheetName = "All Item Detail";

    const sheet = commonUtils.getSheetByName(workbook, sheetName);

    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);

    const headerRow = commonUtils.findHeaderRowByColumns(sheet, [
      "Acct Dept Nbr",
      "Vendor Stk Nbr",
      "Prime Item Nbr",
      "Prime Item Desc",
      "Data Type",
    ]);

    if (!headerRow) {
      throw new Error("Could not locate header row for All Item Detail");
    }

    const table = {
      headerRow,
      headers: sheet.getRow(headerRow).values.slice(1),
      startRow: headerRow + 1,
      endRow: sheet.rowCount,
    };

    const items = commonUtils.extractAllItemDetailData(sheet, table);

    console.log(`📦 Items extracted: ${items.length}`);
    console.log(items[0]);

    // items.forEach((item, index) => {
    //   console.log(`\n📦 Item ${index + 1}`);
    //   console.log(JSON.stringify(item, null, 2));
    // });

    return items;
  },

  processScorecardAquasonicSheet: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    const sheetName = "Scorecard Aquasonic";

    const sheet = commonUtils.getSheetByName(workbook, sheetName);

    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    console.log(`\n📄 Processing sheet: ${sheet.name}`);

    const rawRows = commonUtils.extractScorecardData(sheet);
    const mergedRows = commonUtils.mergeMetricPeriodRows(rawRows);

    console.log(`📊 Scorecard rows: ${mergedRows.length}`);
    console.log(mergedRows);

    return mergedRows;
  },
};

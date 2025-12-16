import { commonUtils } from "../utils/common.utils.js";

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
  processContentScoresSheet: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);
    return processSheetByName(workbook, "Content Scores");
  },

  processEmailTemplateSheet: async (filePath) => {
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

    console.log(`📊 Final rows: ${mergedRows.length}`);
    console.log(mergedRows);

    return mergedRows;
  },
};

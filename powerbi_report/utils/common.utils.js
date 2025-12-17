import ExcelJS from "exceljs";
import fs from "fs";

export const commonUtils = {
  readWorkbook: async (filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    return workbook;
  },

  getSheetsFromExcel: async (filePath) => {
    const workbook = await commonUtils.readWorkbook(filePath);

    return workbook.worksheets.map((sheet) => ({
      sheetName: sheet.name,
      sheetId: sheet.id,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
    }));
  },

  getSheetByName: (workbook, sheetName) => {
    return workbook.worksheets.find(
      (sheet) =>
        sheet.name.trim().toLowerCase() === sheetName.trim().toLowerCase()
    );
  },

  isHeaderRow: (rowValues) => {
    const values = rowValues.filter(
      (v) => v !== null && v !== undefined && v !== ""
    );

    if (values.length < 2) return false;

    return values.every((v) => typeof v === "string");
  },

  detectTablesInSheet: (sheet) => {
    const tables = [];
    let currentTable = null;

    sheet.eachRow((row, rowNumber) => {
      const rowValues = row.values.slice(1);

      const isHeader = commonUtils.isHeaderRow(rowValues);
      const isEmptyRow = rowValues.every(
        (v) => v === null || v === undefined || v === ""
      );

      if (isHeader) {
        if (currentTable) {
          currentTable.endRow = rowNumber - 1;
          tables.push(currentTable);
        }

        currentTable = {
          headerRow: rowNumber,
          headers: rowValues,
          startRow: rowNumber + 1,
          endRow: null,
        };
      }

      if (currentTable && isEmptyRow) {
        currentTable.endRow = rowNumber - 1;
        tables.push(currentTable);
        currentTable = null;
      }
    });

    if (currentTable) {
      currentTable.endRow = sheet.rowCount;
      tables.push(currentTable);
    }

    return tables;
  },

  extractTableData: (sheet, table, options = {}) => {
    const { ignoreRowIf } = options;

    const headers = table.headers.map((h) =>
      typeof h === "string" ? h.trim() : String(h)
    );

    const columnData = {};
    headers.forEach((header) => {
      columnData[header] = [];
    });

    for (let rowNum = table.startRow; rowNum <= table.endRow; rowNum++) {
      const row = sheet.getRow(rowNum);
      const rowValues = row.values.slice(1);

      const rowTextValues = rowValues
        .map((v, idx) => row.getCell(idx + 1).text)
        .filter(Boolean)
        .map((v) => v.trim().toLowerCase());

      if (
        ignoreRowIf &&
        ignoreRowIf({
          rowTextValues,
        })
      ) {
        continue;
      }

      let hasData = false;

      headers.forEach((header, index) => {
        const cellValue = rowValues[index] ?? null;

        if (cellValue !== null && cellValue !== "") {
          hasData = true;
        }

        columnData[header].push(cellValue);
      });

      if (!hasData) {
        headers.forEach((header) => {
          columnData[header].pop();
        });
      }
    }

    return {
      headers,
      rows: columnData,
    };
  },

  extractPivotTableData: (sheet, config) => {
    const { periodHeaderRow, subHeaderRow, dataStartRow, metricColumnIndex } =
      config;

    const periodRow = sheet.getRow(periodHeaderRow).values.slice(1);
    const subHeaderRowValues = sheet.getRow(subHeaderRow).values.slice(1);

    const columns = [];
    let currentPeriod = null;

    periodRow.forEach((cell, index) => {
      if (cell) {
        currentPeriod = cell.toString().trim();
      }

      const subHeader = subHeaderRowValues[index];
      if (currentPeriod && subHeader) {
        columns.push({
          period: currentPeriod,
          key: subHeader.toString().trim().toLowerCase(),
          columnIndex: index + 1,
        });
      }
    });

    const rows = [];

    for (let rowNum = dataStartRow; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      const metricName = row.getCell(metricColumnIndex).value;

      if (!metricName) continue;

      columns.forEach((col) => {
        const value = row.getCell(col.columnIndex).value;

        rows.push({
          metric: metricName,
          period: col.period,
          [col.key]: value ?? null,
        });
      });
    }

    return rows;
  },

  mergeMetricPeriodRows: (rows) => {
    const map = new Map();

    rows.forEach((row) => {
      const { metric, period, ...values } = row;
      const key = `${metric}__${period}`;

      if (!map.has(key)) {
        map.set(key, {
          metric,
          period,
        });
      }

      const existing = map.get(key);

      Object.entries(values).forEach(([k, v]) => {
        existing[k] = v;
      });
    });

    return Array.from(map.values());
  },

  findHeaderRowByColumns: (sheet, requiredHeaders) => {
    for (let rowNum = 1; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      const rowTexts = row.values
        .slice(1)
        .map((v, idx) => row.getCell(idx + 1).text?.trim());

      const matchCount = requiredHeaders.filter((h) =>
        rowTexts.includes(h)
      ).length;

      if (matchCount >= requiredHeaders.length) {
        return rowNum;
      }
    }

    return null;
  },

  extractAllItemDetailData: (sheet, table) => {
    const headers = table.headers.map((h) =>
      typeof h === "string" ? h.trim() : String(h)
    );

    // Identify column indexes
    const colIndex = {};
    headers.forEach((h, i) => {
      colIndex[h] = i;
    });

    // Static columns
    const STATIC_COLS = [
      "Acct Dept Nbr",
      "Vendor Stk Nbr",
      "Prime Item Nbr",
      "Prime Item Desc",
      "Data Type",
    ];

    // Date columns = headers that look like YYYYWW
    const dateColumns = headers.filter((h) => /^\d{6}$/.test(h));

    const itemsMap = new Map();

    for (let rowNum = table.startRow; rowNum <= table.endRow; rowNum++) {
      const row = sheet.getRow(rowNum);
      const rowValues = row.values.slice(1);

      const acctDeptNbr = rowValues[colIndex["Acct Dept Nbr"]];
      const vendorStkNbr = rowValues[colIndex["Vendor Stk Nbr"]];
      const primeItemNbr = rowValues[colIndex["Prime Item Nbr"]];
      const primeItemDesc = rowValues[colIndex["Prime Item Desc"]];
      const dataType = rowValues[colIndex["Data Type"]];

      if (!primeItemNbr || !dataType) continue;

      const key = `${acctDeptNbr}__${vendorStkNbr}__${primeItemNbr}`;

      if (!itemsMap.has(key)) {
        itemsMap.set(key, {
          acct_dept_nbr: acctDeptNbr,
          vendor_stk_nbr: vendorStkNbr,
          prime_item_nbr: primeItemNbr,
          prime_item_desc: primeItemDesc,
          dates: {},
        });
      }

      const item = itemsMap.get(key);

      dateColumns.forEach((dateCol) => {
        const value = rowValues[colIndex[dateCol]] ?? null;

        if (!item.dates[dateCol]) {
          item.dates[dateCol] = {};
        }

        item.dates[dateCol][dataType] = value;
      });
    }

    return Array.from(itemsMap.values());
  },
};

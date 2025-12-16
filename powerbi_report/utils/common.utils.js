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

  extractTableData: (sheet, table) => {
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
};

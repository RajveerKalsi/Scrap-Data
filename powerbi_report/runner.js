import path from "path";
import { walmartExtraction } from "./extraction/walmart.report.js";

const run = async () => {
  const filePath = path.join(
    process.cwd(),
    "files",
    "walmart",
    "AquaSonic WM Report Wk40-2025 (1).xlsx"
  );

  await walmartExtraction.processContentScoresSheet(filePath);
  await walmartExtraction.processEmailTemplateSheet(filePath);
  await walmartExtraction.processSalesSummarySheet(filePath);
};

run();

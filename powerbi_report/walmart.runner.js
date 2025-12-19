import path from "path";
import fs from "fs";
import { walmartExtraction } from "./extraction/walmart.report.js";

const WALMART_FILES_DIR = path.join(process.cwd(), "files", "walmart");

const extractWeekFromFilename = (filename) => {
  const match = filename.match(/Wk(\d+)-(\d{4})/i);
  if (!match) return null;

  return {
    week: Number(match[1]),
    year: Number(match[2]),
  };
};

const run = async () => {
  const files = fs
    .readdirSync(WALMART_FILES_DIR)
    .filter((file) => file.endsWith(".xlsx"));

  console.log(`📂 Found ${files.length} Walmart files\n`);

  for (const file of files) {
    const filePath = path.join(WALMART_FILES_DIR, file);
    const weekInfo = extractWeekFromFilename(file);

    console.log("========================================");
    console.log(`📄 Processing file: ${file}`);
    console.log(`📅 Week info:`, weekInfo);
    console.log("========================================");

    try {
      //   await walmartExtraction.processContentScoresSheet(filePath, weekInfo);
      //   await walmartExtraction.processEmailTemplateSheet(filePath, weekInfo);
        await walmartExtraction.processSalesSummarySheet(filePath, weekInfo);
      //   await walmartExtraction.processAllItemDetailSheet(filePath, weekInfo);
      // await walmartExtraction.processScorecardAquasonicSheet(filePath, weekInfo);

      console.log(`✅ Finished: ${file}\n`);
    } catch (error) {
      console.error(`❌ Failed processing ${file}`);
      console.error(error);
    }
  }

  console.log("🎉 All files processed");
};

run();

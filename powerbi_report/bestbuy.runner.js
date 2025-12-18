// import path from "path";
// import fs from "fs";
// import { bestBuyExtraction } from "./extraction/bestbuy.report.js";

// const BESTBUY_FILES_DIR = path.join(process.cwd(), "files", "bestbuy");

// const run = async () => {
//   const files = fs
//     .readdirSync(BESTBUY_FILES_DIR)
//     .filter((file) => file.endsWith(".xlsx"));

//   console.log(`📂 Found ${files.length} Best Buy files\n`);

//   for (const file of files) {
//     console.log("========================================");
//     console.log(`📄 File: ${file}`);
//     console.log("========================================");

//     try {
//       await bestBuyExtraction.exploreFile(path.join(BESTBUY_FILES_DIR, file));
//     } catch (err) {
//       console.error(`❌ Failed exploring ${file}`);
//       console.error(err);
//     }
//   }
// };

// run();

import path from "path";
import { bestBuyExtraction } from "./extraction/bestbuy.report.js";

const filePath = path.join(
  process.cwd(),
  "files",
  "bestbuy",
  "Aquasonic Master-  SKUs and Sales.xlsx"
);

await bestBuyExtraction.exploreSkuInfo(filePath);

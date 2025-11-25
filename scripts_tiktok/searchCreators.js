require("dotenv").config();
const fetch = require("node-fetch");

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;

async function searchCreators(keyword = "skincare") {
  const url = "https://open.tiktokapis.com/v2/tcm/creator/search/";

  const body = {
    filter: {
      keyword,
      region_code: ["US"],
    },
    page_info: {
      page: 1,
      page_size: 10,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log("RAW RESPONSE:\n", text);

  try {
    const data = JSON.parse(text);
    console.log("Parsed JSON:\n", JSON.stringify(data, null, 2));
  } catch {
    console.error("❌ Response was not valid JSON — check your token or permissions.");
  }
}

searchCreators("makeup");

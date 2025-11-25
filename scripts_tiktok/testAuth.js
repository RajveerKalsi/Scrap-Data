require("dotenv").config();
const fetch = require("node-fetch");

const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN_SANDBOX;
const ADVERTISER_ID = process.env.TIKTOK_ADVERTISER_ID;

const testAuth = async () => {
  const url = `https://sandbox-ads.tiktok.com/open_api/v1.3/advertiser/info/?advertiser_ids=["${ADVERTISER_ID}"]`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Access-Token": ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  console.log(text);
};

testAuth();
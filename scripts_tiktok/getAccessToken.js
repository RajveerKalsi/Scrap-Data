const fetch = require("node-fetch");
require("dotenv").config();

const APP_ID = process.env.TIKTOK_APP_ID;
const APP_SECRET = process.env.TIKTOK_APP_SECRET; // use your actual secret
const AUTH_CODE = process.env.TIKTOK_AUTH_CODE; // from your redirect URL

async function getAccessToken() {
  const url = "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/";
  const body = {
    app_id: APP_ID,
    secret: APP_SECRET,
    auth_code: AUTH_CODE,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

getAccessToken();

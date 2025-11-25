require("dotenv").config();
const fetch = require("node-fetch");

const APP_ID = process.env.TIKTOK_APP_ID;
const APP_SECRET = process.env.TIKTOK_APP_SECRET;
const AUTH_CODE = "580bc30e5eb37dbf41ac9dfb4164bfcb2baed77a"; // The 'code' param from redirect
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI; // Must match the redirect used in auth URL

async function getAccessToken() {
  const url = "https://open.tiktokapis.com/v2/oauth/token/";

  const body = {
    client_key: APP_ID,
    client_secret: APP_SECRET,
    code: AUTH_CODE,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("Access Token Response:", data);
  return data.access_token;
}

// Example usage
getAccessToken().then(token => console.log("Access Token:", token));

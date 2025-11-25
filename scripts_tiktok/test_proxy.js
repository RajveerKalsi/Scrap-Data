import fs from "fs";

const scrape = async () => {
  try {
    const response = await fetch("https://scraper-api.decodo.com/v2/scrape", {
      method: "POST",
      body: JSON.stringify({
        target: "tiktok_shop_search",
        query: "ball",
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic VTAwMDAxNDUyNjI6RTZvanNmMmV1OGh3VlI1RGpq",
      },
    });

    const data = await response.json();

    // TikTok HTML is here
    const html = data?.results?.[0]?.content;

    if (!html) {
      console.error("Could not find HTML in data.results[0].content");
      console.log(data);
      return;
    }

    // Extract all <script type="application/ld+json">...</script>
    const ldJsonBlocks = [...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
    )];

    let productList = null;

    for (const match of ldJsonBlocks) {
      try {
        const jsonText = match[1];
        const parsed = JSON.parse(jsonText.trim());

        // This is where TikTok stores the search results
        if (parsed["@type"] === "ItemList" && parsed.itemListElement) {
          productList = parsed.itemListElement;
          break;
        }
      } catch (err) {
        // Ignore invalid JSON (some blocks are not item lists)
      }
    }

    if (!productList) {
      console.error("Did not find ItemList in ld+json blocks");
      return;
    }

    // Save the 30 items to a text file
    const filePath = "tiktok_products.txt";
    fs.writeFileSync(filePath, JSON.stringify(productList, null, 2));

    console.log(`Extracted ${productList.length} items`);
    console.log("Saved →", filePath);

  } catch (error) {
    console.error("Error:", error);
  }
};

scrape();

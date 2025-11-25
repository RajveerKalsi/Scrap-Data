const fetch = require("node-fetch");
const fs = require("fs");

const SHOP_URL = process.env.SHOP_URL;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

async function getOrders() {
  const url = `https://${SHOP_URL}/admin/api/2024-01/orders.json?status=any&limit=250&fields=*`;

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": ADMIN_TOKEN,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();

  if (!data.orders) {
    console.error("❌ No orders returned:", data);
    return [];
  }

  return data.orders;
}

function extractFinancialInfo(order) {
  const subtotal = parseFloat(order.subtotal_price || 0);
  const discounts = parseFloat(order.total_discounts || 0);
  const shipping = parseFloat(order.total_shipping_price_set?.shop_money.amount || 0);
  const taxes = parseFloat(order.total_tax || 0);
  const duties = parseFloat(order.total_duties || 0);
  const total = parseFloat(order.total_price || 0);
  const outstanding = parseFloat(order.total_outstanding || 0);

  // Refunds calculation (safe)
  let refundAmount = 0;
  const refunds = order.refunds || [];

  refunds.forEach((refund) => {
    const txns = refund.transactions || [];
    txns.forEach((txn) => {
      refundAmount += Math.abs(parseFloat(txn.amount || 0));
    });
  });

  // Payment gateway used
  const paymentGateway =
    order.payment_gateway_names?.length > 0
      ? order.payment_gateway_names.join(", ")
      : "N/A";

  // Financial status (paid, pending, refunded, etc)
  const financialStatus = order.financial_status || "N/A";

  // Net payout
  const netPayment = total - refundAmount;

  return {
    order_id: order.id,
    name: order.name,
    created_at: order.created_at,
    financialStatus,
    paymentGateway,
    subtotal,
    discounts,
    shipping,
    duties,
    taxes,
    refundAmount,
    total,
    outstanding,
    netPayment,
  };
}

async function run() {
  console.log("⏳ Fetching raw orders data from Shopify...");
  const orders = await getOrders();

  console.log(`\n✅ Retrieved ${orders.length} orders\n`);

  // 1️⃣ Save full raw JSON dump
  fs.writeFileSync(
    "shopify_raw_orders.json",
    JSON.stringify(orders, null, 2)
  );
  console.log("📁 Saved full raw data → shopify_raw_orders.json\n");

  // 2️⃣ Extract summary table
  const financialSummaries = orders.map(extractFinancialInfo);

  console.log("📊 Financial Summary Preview:\n");
  console.table(financialSummaries, [
    "order_id",
    "name",
    "created_at",
    "financialStatus",
    "paymentGateway",
    "subtotal",
    "discounts",
    "shipping",
    "duties",
    "taxes",
    "refundAmount",
    "total",
    "outstanding",
    "netPayment",
  ]);

  // 3️⃣ Save summary JSON
  fs.writeFileSync(
    "shopify_order_financial_summary.json",
    JSON.stringify(financialSummaries, null, 2)
  );

  console.log("\n📁 Saved summary → shopify_order_financial_summary.json");
}

run();

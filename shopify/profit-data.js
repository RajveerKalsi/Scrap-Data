const fetch = require("node-fetch");
const ExcelJS = require("exceljs");
require("dotenv").config();

const SHOP_URL = process.env.SHOP_URL;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

async function getOrders() {
  const url = `https://${SHOP_URL}/admin/api/2024-01/orders.json?status=any&limit=250`;

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": ADMIN_TOKEN,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();
  return data.orders || [];
}

// --------------------------
// CALCULATE ORDER METRICS
// --------------------------
function calculateOrderMetrics(order) {
  const grossSales = order.line_items.reduce((sum, item) => {
    return sum + parseFloat(item.quantity) * parseFloat(item.price);
  }, 0);

  const discount = parseFloat(order.total_discounts || 0);

  const shipping = order.shipping_lines.reduce((sum, s) => {
    return sum + parseFloat(s.price || 0);
  }, 0);

  const taxes = parseFloat(order.total_tax || 0);

  // Refunds / Returns
  const refundAmount = order.refunds.reduce((sum, refund) => {
    return (
      sum +
      refund.transactions.reduce(
        (tSum, t) => tSum + Math.abs(parseFloat(t.amount)),
        0
      )
    );
  }, 0);

  const netSales = grossSales - discount - refundAmount;
  const totalSales = netSales + shipping + taxes;

  return {
    order_id: order.id,
    name: order.name,
    created_at: order.created_at,
    grossSales,
    discount,
    refundAmount,
    netSales,
    shipping,
    taxes,
    totalSales,
  };
}

// --------------------------
// PRODUCT LEVEL AGGREGATION
// --------------------------
function aggregateProductLevel(orders) {
  const productMap = {};

  orders.forEach((order) => {
    order.line_items.forEach((item) => {
      const key = item.product_id || item.title;

      if (!productMap[key]) {
        productMap[key] = {
          product_id: item.product_id,
          title: item.title,
          quantity: 0,
          grossSales: 0,
        };
      }

      productMap[key].quantity += item.quantity;
      productMap[key].grossSales += item.quantity * parseFloat(item.price);
    });
  });

  return Object.values(productMap);
}

// --------------------------
// BRAND LEVEL SUMMARY
// --------------------------
function aggregateBrandLevel(orderMetricsList) {
  return orderMetricsList.reduce(
    (acc, o) => {
      acc.grossSales += o.grossSales;
      acc.discount += o.discount;
      acc.returns += o.refundAmount;
      acc.netSales += o.netSales;
      acc.shipping += o.shipping;
      acc.taxes += o.taxes;
      acc.totalSales += o.totalSales;
      return acc;
    },
    {
      grossSales: 0,
      discount: 0,
      returns: 0,
      netSales: 0,
      shipping: 0,
      taxes: 0,
      totalSales: 0,
    }
  );
}

// --------------------------
// CREATE EXCEL FILE
// --------------------------
async function createExcel(orderMetrics, productMetrics, brandSummary) {
  const workbook = new ExcelJS.Workbook();

  // ORDER LEVEL
  const orderSheet = workbook.addWorksheet("Order Level");
  orderSheet.columns = [
    { header: "Order ID", key: "order_id" },
    { header: "Name", key: "name" },
    { header: "Created At", key: "created_at" },
    { header: "Gross Sales", key: "grossSales" },
    { header: "Discount", key: "discount" },
    { header: "Refunds", key: "refundAmount" },
    { header: "Net Sales", key: "netSales" },
    { header: "Shipping", key: "shipping" },
    { header: "Taxes", key: "taxes" },
    { header: "Total Sales", key: "totalSales" },
  ];

  orderMetrics.forEach((row) => orderSheet.addRow(row));

  // PRODUCT LEVEL
  const productSheet = workbook.addWorksheet("Product Level");
  productSheet.columns = [
    { header: "Product ID", key: "product_id" },
    { header: "Title", key: "title" },
    { header: "Quantity Sold", key: "quantity" },
    { header: "Gross Sales", key: "grossSales" },
  ];

  productMetrics.forEach((row) => productSheet.addRow(row));

  // BRAND LEVEL
  const brandSheet = workbook.addWorksheet("Brand Level");
  brandSheet.addRow(["Metric", "Value"]);
  brandSheet.addRow(["Gross Sales", brandSummary.grossSales]);
  brandSheet.addRow(["Discount", brandSummary.discount]);
  brandSheet.addRow(["Returns", brandSummary.returns]);
  brandSheet.addRow(["Net Sales", brandSummary.netSales]);
  brandSheet.addRow(["Shipping", brandSummary.shipping]);
  brandSheet.addRow(["Taxes", brandSummary.taxes]);
  brandSheet.addRow(["Total Sales", brandSummary.totalSales]);

  // SAVE FILE
  await workbook.xlsx.writeFile("shopify_report.xlsx");

  console.log("✅ Excel file created: shopify_report.xlsx");
}

// --------------------------
// MAIN
// --------------------------
async function run() {
  const orders = await getOrders();
  const orderMetrics = orders.map(calculateOrderMetrics);
  const productMetrics = aggregateProductLevel(orders);
  const brandSummary = aggregateBrandLevel(orderMetrics);

  await createExcel(orderMetrics, productMetrics, brandSummary);
}

run();

const { backfillInventoryCosting } = require("../lib/inventoryCosting");
const { prisma } = require("../lib/prisma");

async function main() {
  await backfillInventoryCosting();
  console.log("Finance costing backfill completed.");
}

main()
  .catch((error) => {
    console.error("Finance costing backfill failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

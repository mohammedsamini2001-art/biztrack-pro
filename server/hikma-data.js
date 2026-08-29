require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    console.log("\n========================================");
    console.log("       HIKMA LABS — DATABASE PULSE");
    console.log("========================================");
    console.log("MongoDB: CONNECTED\n");

    const admin = client.db().admin();
    const result = await admin.listDatabases();

    for (const database of result.databases) {
      console.log(`DATABASE: ${database.name}`);
      console.log("----------------------------------------");

      const db = client.db(database.name);
      const collections = await db.listCollections().toArray();

      if (collections.length === 0) {
        console.log("  No collections");
      } else {
        let total = 0;

        for (const collection of collections) {
          const count = await db.collection(collection.name).countDocuments();
          total += count;
          console.log(`  ${collection.name.padEnd(20)} ${count} documents`);
        }

        console.log("----------------------------------------");
        console.log(`  TOTAL                 ${total} documents`);
      }

      console.log("");
    }

    console.log("========================================");
    console.log("        INSPECTION COMPLETE");
    console.log("        No data was modified.");
    console.log("========================================\n");

  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error("\nERROR:", error.message);
  process.exit(1);
});

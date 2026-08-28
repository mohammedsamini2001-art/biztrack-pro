import { MongoClient, Db } from "mongodb";

// Workers reuse global scope across requests within the same isolate,
// so we cache the client/connection promise on globalThis to avoid
// reconnecting on every request.
let cached: { client: MongoClient; db: Db } | null = null;
let connecting: Promise<{ client: MongoClient; db: Db }> | null = null;

export async function getMongoClient(uri: string): Promise<MongoClient> {
  if (cached) return cached.client;
  if (connecting) {
    const connection = await connecting;
    return connection.client;
  }

  const db = await getDb(uri);
  void db;

  if (!cached) throw new Error("MongoDB client is not initialized");
  return (cached as { client: MongoClient; db: Db }).client;
}

export async function getDb(uri: string, dbName = "hikma_business_os"): Promise<Db> {
  if (cached) return cached.db;
  if (connecting) return (await connecting).db;

  connecting = (async () => {
    const client = new MongoClient(uri, {
      maxPoolSize: 5,
      minPoolSize: 0,
    } as ConstructorParameters<typeof MongoClient>[1]);
    await client.connect();
    const db = client.db(dbName);
    cached = { client, db };
    return cached;
  })();

  const result = await connecting;
  connecting = null;
  return result.db;
}

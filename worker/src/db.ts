import { MongoClient, Db } from "mongodb";

// Workers reuse global scope across requests within the same isolate,
// so we cache the client/connection promise on globalThis to avoid
// reconnecting on every request.
let cached: { client: MongoClient; db: Db } | null = null;
let connecting: Promise<{ client: MongoClient; db: Db }> | null = null;

export async function getDb(uri: string, dbName = "biztrack"): Promise<Db> {
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

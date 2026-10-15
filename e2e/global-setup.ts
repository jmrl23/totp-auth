import { resetDatabase, closeDb } from "./db";

/** Start every run from an empty e2e database (tables exist once the server has migrated). */
export default async function globalSetup() {
  await resetDatabase();
  await closeDb();
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startServer } = await import("./lib/server/startup");
  await startServer();
}

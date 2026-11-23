// Starts the single serial transaction worker with the server process.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./server/jobs");
    startWorker();
  }
}

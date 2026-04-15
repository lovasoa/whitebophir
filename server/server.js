void import("./server.mjs").catch((error) => {
  console.error("server.start_failed", error);
  process.exit(1);
});

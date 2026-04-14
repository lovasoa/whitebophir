const { execFileSync } = require("node:child_process");

const patterns = ["waitForTimeout\\(", "\\bsleep\\(", "\\bpause\\("];

try {
  execFileSync("rg", ["-n", patterns.join("|"), "playwright/tests"], {
    stdio: "pipe",
  });
  process.stderr.write(
    "Forbidden fixed-delay helper found in Playwright test files. Use web-first waits or expect.poll instead.\n",
  );
  process.exit(1);
} catch (err) {
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    err.status === 1
  ) {
    process.exit(0);
  }
  throw err;
}

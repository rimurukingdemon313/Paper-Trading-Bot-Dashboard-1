import app from "./app";
import { logger } from "./lib/logger";
import { runTradingCycle } from "./routes/trading";
import { startTradingScheduler } from "./lib/trading-scheduler";
import { getPersistedSchedulerEnabled } from "./routes/trading";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  getPersistedSchedulerEnabled()
    .then((enabled) => {
      startTradingScheduler(async (source) => {
        await runTradingCycle(source);
      }, enabled);
    })
    .catch((error) => {
      logger.error({ err: error }, "Unable to load scheduler state; starting enabled");
      startTradingScheduler(async (source) => {
        await runTradingCycle(source);
      });
    });
});

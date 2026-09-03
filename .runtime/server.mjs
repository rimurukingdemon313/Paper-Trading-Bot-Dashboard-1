// server/app.ts
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path2 from "node:path";

// server/routes/index.ts
import { Router as Router3 } from "express";

// server/routes/health.ts
import { Router } from "express";
var router = Router();
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});
var health_default = router;

// server/routes/trading.ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Router as Router2 } from "express";

// server/lib/logger.ts
import pino from "pino";
var isProduction = process.env.NODE_ENV === "production";
var logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']"
  ],
  ...isProduction ? {} : {
    transport: {
      target: "pino-pretty",
      options: { colorize: true }
    }
  }
});

// server/lib/trading-scheduler.ts
var timer = null;
var cycleRunning = false;
var state = {
  enabled: true,
  running: false,
  lastRunAt: null,
  lastStatus: "idle",
  lastError: null,
  nextRunAt: null
};
function nextQuarterHour(now = /* @__PURE__ */ new Date()) {
  const next = new Date(now);
  next.setUTCSeconds(5, 0);
  next.setUTCMinutes(Math.floor(now.getUTCMinutes() / 15) * 15 + 15);
  return next;
}
function scheduleNext(runCycle) {
  if (timer) clearTimeout(timer);
  const next = nextQuarterHour();
  state.nextRunAt = next.toISOString();
  timer = setTimeout(async () => {
    if (state.enabled && !cycleRunning) {
      cycleRunning = true;
      state.running = true;
      state.lastStatus = "running";
      state.lastRunAt = (/* @__PURE__ */ new Date()).toISOString();
      state.lastError = null;
      try {
        await runCycle("scheduled");
        state.lastStatus = "completed";
        logger.info({ candleSchedule: state.lastRunAt }, "Scheduled paper scan completed");
      } catch (error) {
        state.lastStatus = "failed";
        state.lastError = error instanceof Error ? error.message : "Scheduled scan failed";
        logger.error({ err: error }, "Scheduled paper scan failed");
      } finally {
        cycleRunning = false;
        state.running = false;
      }
    }
    scheduleNext(runCycle);
  }, Math.max(1e3, next.getTime() - Date.now()));
  timer.unref?.();
}
function startTradingScheduler(runCycle, enabled = true) {
  state.enabled = enabled;
  scheduleNext(runCycle);
  logger.info({ nextRunAt: state.nextRunAt }, "Paper trading scheduler started");
}
function setTradingSchedulerEnabled(enabled, runCycle) {
  state.enabled = enabled;
  if (!enabled) {
    state.running = false;
    state.lastStatus = "idle";
  }
  scheduleNext(runCycle);
  return { ...state };
}
function getTradingSchedulerState() {
  return { ...state };
}

// server/routes/trading.ts
var execFileAsync = promisify(execFile);
var router2 = Router2();
var finiteOrNull = (value) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
var clampConfidence = (value) => {
  const parsed = finiteOrNull(value);
  if (parsed === null) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
};
var workspaceFile = (name) => {
  const candidates = [
    path.resolve(process.cwd(), name),
    path.resolve(process.cwd(), "../../", name),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../", name)
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Unable to locate ${name}`);
  return found;
};
async function database(action, payload = {}) {
  const script = workspaceFile("trading_bot_db.py");
  const { stdout } = await execFileAsync(
    "python3",
    [script, action, JSON.stringify(payload)],
    { cwd: path.dirname(script), maxBuffer: 4 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}
async function getPersistedSchedulerEnabled() {
  const stored = await database("state");
  return stored.schedulerEnabled !== false;
}
async function loadSmcAnalysis() {
  const script = workspaceFile("run_smc_demo.py");
  const { stdout } = await execFileAsync("python3", [script, "--live"], {
    cwd: path.dirname(script),
    maxBuffer: 2 * 1024 * 1024
  });
  const parsed = JSON.parse(stdout);
  return {
    timeframe: parsed.timeframe,
    symbol: parsed.symbol,
    live: parsed.live,
    dataSource: parsed.data_source,
    latestPrice: parsed.latest_price,
    candleCount: parsed.candle_count,
    latestCandle: parsed.latest_candle,
    marketStructure: parsed.market_structure,
    liquiditySweeps: parsed.liquidity_sweeps?.slice(-5) ?? [],
    structureBreaks: parsed.structure_breaks?.slice(-5) ?? [],
    fairValueGaps: parsed.fair_value_gaps?.slice(-5) ?? [],
    orderBlocks: parsed.order_blocks?.slice(-5) ?? [],
    momentum: parsed.momentum,
    overallContext: parsed.overall_context
  };
}
function parseGeminiJson(rawText) {
  const withoutFence = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(withoutFence);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemini returned a non-object decision");
  }
  return parsed;
}
async function askGemini(smc) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the API server");
  const prompt = [
    "You are a paper-trading SMC decision analyst. This is analysis only: never mention broker execution and never assume live market data.",
    "Use only the supplied M15 SMC findings. Return JSON only, with no markdown.",
    "Choose exactly one decision: BUY, SELL, or NO TRADE.",
    "For BUY or SELL, provide entryPrice, stopLoss, takeProfit, riskRewardRatio, and riskAmount. riskAmount must be exactly 5.",
    "When evidence is mixed or insufficient, choose NO TRADE. Confidence must be an integer from 0 to 100.",
    'JSON shape: {"decision":"BUY|SELL|NO TRADE","confidence":0,"reasoning":"detailed evidence-based explanation","entryPrice":0,"stopLoss":0,"takeProfit":0,"riskRewardRatio":0,"riskAmount":5}',
    "SMC findings:",
    JSON.stringify(smc)
  ].join("\n");
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 8192
        }
      })
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  const body = await response.json();
  const rawText = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!rawText) throw new Error("Gemini returned an empty decision");
  const parsed = parseGeminiJson(rawText);
  const decision = String(parsed.decision ?? "NO TRADE").toUpperCase();
  return {
    decision: decision === "BUY" || decision === "SELL" ? decision : "NO TRADE",
    confidence: clampConfidence(parsed.confidence),
    reasoning: String(parsed.reasoning ?? "Gemini did not provide reasoning."),
    entryPrice: finiteOrNull(parsed.entryPrice),
    stopLoss: finiteOrNull(parsed.stopLoss),
    takeProfit: finiteOrNull(parsed.takeProfit),
    riskRewardRatio: finiteOrNull(parsed.riskRewardRatio),
    riskAmount: finiteOrNull(parsed.riskAmount)
  };
}
async function runRiskEngine(proposal, account) {
  const script = workspaceFile("risk_engine.py");
  const payload = JSON.stringify({
    proposal: {
      decision: proposal.decision,
      entry_price: proposal.entryPrice,
      stop_loss: proposal.stopLoss,
      take_profit: proposal.takeProfit,
      risk_reward_ratio: proposal.riskRewardRatio,
      risk_amount: proposal.riskAmount
    },
    account: {
      balance: account.balance,
      daily_pnl: account.dailyPnl,
      open_positions: account.openPositions
    }
  });
  const { stdout } = await execFileAsync("python3", [script, payload], {
    cwd: path.dirname(script),
    maxBuffer: 64 * 1024
  });
  return JSON.parse(stdout);
}
async function executeTradingCycle(source) {
  const smc = await loadSmcAnalysis();
  const latestCandle = smc.latestCandle;
  const settled = await database("settle", {
    latestPrice: smc.latestPrice,
    latestCandle
  });
  const account = settled.account;
  const aiDecision = await askGemini(smc);
  const risk = await runRiskEngine(aiDecision, account);
  const recorded = await database("record-cycle", {
    scan: {
      candleTimestamp: latestCandle?.timestamp,
      scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
      symbol: smc.symbol,
      timeframe: smc.timeframe,
      live: smc.live,
      dataSource: smc.dataSource,
      latestPrice: smc.latestPrice,
      candleCount: smc.candleCount,
      latestCandle,
      smc
    },
    ai: aiDecision,
    risk
  });
  const effectiveAiDecision = recorded.duplicate && recorded.latestAiDecision ? recorded.latestAiDecision : aiDecision;
  const effectiveRisk = recorded.duplicate && recorded.latestRiskDecision ? recorded.latestRiskDecision : risk;
  return {
    decision: effectiveRisk.state,
    aiDecision: effectiveAiDecision,
    risk: effectiveRisk,
    smc,
    paperTrade: recorded.paperTrade ?? null,
    closedTrades: settled.closedTrades ?? [],
    account: recorded.account,
    openTrade: recorded.openTrade ?? null,
    trades: recorded.trades ?? [],
    paperOnly: true,
    source,
    duplicate: recorded.duplicate ?? false
  };
}
var activeCycle = null;
async function runTradingCycle(source = "manual") {
  if (activeCycle) return activeCycle;
  activeCycle = executeTradingCycle(source);
  try {
    return await activeCycle;
  } finally {
    activeCycle = null;
  }
}
function schedulerResponse() {
  return { ...getTradingSchedulerState(), paperOnly: true };
}
router2.get("/trading/state", async (_req, res) => {
  try {
    const stored = await database("state");
    return res.json({ ...stored, scheduler: schedulerResponse(), paperOnly: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load trading state";
    return res.status(502).json({ error: message, paperOnly: true });
  }
});
router2.post("/trading/analyze", async (req, res) => {
  try {
    if (req.body?.smcEnabled === false) {
      return res.status(409).json({
        decision: "NO TRADE",
        risk: { approved: false, state: "NO TRADE", reasons: ["SMC engine is paused"], rules: {} },
        paperOnly: true
      });
    }
    return res.json({ ...await runTradingCycle("manual"), scheduler: schedulerResponse() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trading analysis failed";
    req.log?.error?.({ err: error }, "Trading analysis failed");
    return res.status(502).json({
      decision: "NO TRADE",
      risk: {
        approved: false,
        state: "NO TRADE",
        reasons: [`No trade: ${message}`],
        rules: {}
      },
      paperOnly: true
    });
  }
});
router2.post("/trading/scheduler", (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }
  return database("scheduler", { enabled }).then(() => ({
    scheduler: setTradingSchedulerEnabled(enabled, async (source) => runTradingCycle(source)),
    paperOnly: true
  })).then((payload) => res.json(payload)).catch((error) => {
    const message = error instanceof Error ? error.message : "Unable to update scheduler";
    return res.status(502).json({ error: message, paperOnly: true });
  });
});
router2.post("/trading/reset", async (_req, res) => {
  try {
    return res.json({
      ...await database("reset"),
      scheduler: schedulerResponse(),
      paperOnly: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset paper account";
    return res.status(502).json({ error: message, paperOnly: true });
  }
});
var trading_default = router2;

// server/routes/index.ts
var router3 = Router3();
router3.use(health_default);
router3.use(trading_default);
var routes_default = router3;

// server/app.ts
var app = express();
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode
        };
      }
    }
  })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api", routes_default);
var publicDirectory = path2.resolve(process.cwd(), "dist");
app.use(express.static(publicDirectory));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api")) {
    return res.sendFile(path2.join(publicDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  }
  return next();
});
var app_default = app;

// server/index.ts
var rawPort = process.env["PORT"] ?? "5000";
var port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}
app_default.listen(port, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  getPersistedSchedulerEnabled().then((enabled) => {
    startTradingScheduler(async (source) => {
      await runTradingCycle(source);
    }, enabled);
  }).catch((error) => {
    logger.error({ err: error }, "Unable to load scheduler state; starting enabled");
    startTradingScheduler(async (source) => {
      await runTradingCycle(source);
    });
  });
});
//# sourceMappingURL=server.mjs.map

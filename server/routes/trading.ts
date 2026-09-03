import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Router, type Request, type Response } from "express";
import {
  getTradingSchedulerState,
  setTradingSchedulerEnabled,
} from "../lib/trading-scheduler";

const execFileAsync = promisify(execFile);
const router = Router();

// All symbols the bot scans, analyzes, and can hold paper positions in.
export const TRADED_SYMBOLS = [
  "EURUSD",
  "USDJPY",
  "USDCHF",
  "AUDJPY",
  "AUDCHF",
  "XAUUSD",
] as const;
export type TradedSymbol = (typeof TRADED_SYMBOLS)[number];

type AccountSnapshot = {
  balance: number;
  dailyPnl: number;
  openPositions: number;
};

export type GeminiDecision = {
  decision: "BUY" | "SELL" | "NO TRADE";
  confidence: number;
  reasoning: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  riskAmount: number | null;
};

export type RiskDecision = {
  approved: boolean;
  state: "BUY" | "SELL" | "NO TRADE";
  reasons: string[];
  rules: Record<string, number>;
};

type SymbolCycleResult = {
  symbol: TradedSymbol;
  decision: string;
  aiDecision: GeminiDecision;
  risk: RiskDecision;
  smc: Record<string, unknown>;
  paperTrade: Record<string, unknown> | null;
  duplicate: boolean;
};

type TradingCycleResult = {
  decision: string;
  aiDecision: GeminiDecision;
  risk: RiskDecision;
  smc: Record<string, unknown>;
  paperTrade: Record<string, unknown> | null;
  closedTrades: Array<Record<string, unknown>>;
  account: Record<string, unknown>;
  openTrade: Record<string, unknown> | null;
  trades: Array<Record<string, unknown>>;
  paperOnly: true;
  source: "manual" | "scheduled";
  duplicate: boolean;
  bySymbol: SymbolCycleResult[];
};

type DatabaseResponse = {
  account: Record<string, unknown>;
  openTrade?: Record<string, unknown> | null;
  trades?: Array<Record<string, unknown>>;
  paperTrade?: Record<string, unknown> | null;
  closedTrades?: Array<Record<string, unknown>>;
  duplicate?: boolean;
  latestScan?: Record<string, unknown> | null;
  latestAiDecision?: GeminiDecision | null;
  latestRiskDecision?: RiskDecision | null;
  schedulerEnabled?: boolean;
};

const finiteOrNull = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampConfidence = (value: unknown): number => {
  const parsed = finiteOrNull(value);
  if (parsed === null) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

const workspaceFile = (name: string): string => {
  const candidates = [
    path.resolve(process.cwd(), name),
    path.resolve(process.cwd(), "../../", name),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../", name),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Unable to locate ${name}`);
  return found;
};

async function database(
  action: "state" | "settle" | "record-cycle" | "scheduler" | "reset",
  payload: Record<string, unknown> = {},
): Promise<DatabaseResponse> {
  const script = workspaceFile("trading_bot_db.py");
  const { stdout } = await execFileAsync(
    "python3",
    [script, action, JSON.stringify(payload)],
    { cwd: path.dirname(script), maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as DatabaseResponse;
}

export async function getPersistedSchedulerEnabled(): Promise<boolean> {
  const stored = await database("state");
  return stored.schedulerEnabled !== false;
}

async function loadSmcAnalysis(symbol: TradedSymbol): Promise<Record<string, unknown>> {
  const script = workspaceFile("run_smc_demo.py");
  const { stdout } = await execFileAsync(
    "python3",
    [script, "--live", "--symbol", symbol],
    { cwd: path.dirname(script), maxBuffer: 2 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as Record<string, any>;
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
    overallContext: parsed.overall_context,
  };
}

function parseGeminiJson(rawText: string): Record<string, unknown> {
  const withoutFence = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(withoutFence) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemini returned a non-object decision");
  }
  return parsed as Record<string, unknown>;
}

async function askGemini(
  symbol: TradedSymbol,
  smc: Record<string, unknown>,
): Promise<GeminiDecision> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the API server");

  const prompt = [
    `You are a paper-trading SMC decision analyst for ${symbol}. This is analysis only: never mention broker execution and never assume live market data.`,
    "Use only the supplied M15 SMC findings. Return JSON only, with no markdown.",
    "Choose exactly one decision: BUY, SELL, or NO TRADE.",
    "For BUY or SELL, provide entryPrice, stopLoss, takeProfit, riskRewardRatio, and riskAmount. riskAmount must be exactly 5.",
    "When evidence is mixed or insufficient, choose NO TRADE. Confidence must be an integer from 0 to 100.",
    'JSON shape: {"decision":"BUY|SELL|NO TRADE","confidence":0,"reasoning":"detailed evidence-based explanation","entryPrice":0,"stopLoss":0,"takeProfit":0,"riskRewardRatio":0,"riskAmount":5}',
    `SMC findings for ${symbol}:`,
    JSON.stringify(smc),
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
          maxOutputTokens: 8192,
        },
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText = body.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
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
    riskAmount: finiteOrNull(parsed.riskAmount),
  };
}

async function runRiskEngine(
  proposal: GeminiDecision,
  account: AccountSnapshot,
): Promise<RiskDecision> {
  const script = workspaceFile("risk_engine.py");
  const payload = JSON.stringify({
    proposal: {
      decision: proposal.decision,
      entry_price: proposal.entryPrice,
      stop_loss: proposal.stopLoss,
      take_profit: proposal.takeProfit,
      risk_reward_ratio: proposal.riskRewardRatio,
      risk_amount: proposal.riskAmount,
    },
    account: {
      balance: account.balance,
      daily_pnl: account.dailyPnl,
      open_positions: account.openPositions,
    },
  });
  const { stdout } = await execFileAsync("python3", [script, payload], {
    cwd: path.dirname(script),
    maxBuffer: 64 * 1024,
  });
  return JSON.parse(stdout) as RiskDecision;
}

async function symbolHasOpenPosition(symbol: TradedSymbol): Promise<boolean> {
  const state = await database("state");
  const trades = (state.trades ?? []) as Array<Record<string, unknown>>;
  return trades.some(
    (trade) => trade.symbol === symbol && trade.result === "OPEN",
  );
}

async function executeSymbolCycle(symbol: TradedSymbol): Promise<{
  result: SymbolCycleResult;
  quote: { latestPrice: unknown; latestCandle: unknown };
}> {
  const smc = await loadSmcAnalysis(symbol);
  const latestCandle = smc.latestCandle as Record<string, unknown> | undefined;
  const hasOpen = await symbolHasOpenPosition(symbol);
  const stateNow = await database("state");
  const account = stateNow.account as unknown as AccountSnapshot;
  const accountForSymbol: AccountSnapshot = {
    ...account,
    openPositions: hasOpen ? 1 : 0,
  };
  const aiDecision = await askGemini(symbol, smc);
  const risk = await runRiskEngine(aiDecision, accountForSymbol);
  const recorded = await database("record-cycle", {
    scan: {
      candleTimestamp: latestCandle?.timestamp,
      scannedAt: new Date().toISOString(),
      symbol,
      timeframe: smc.timeframe,
      live: smc.live,
      dataSource: smc.dataSource,
      latestPrice: smc.latestPrice,
      candleCount: smc.candleCount,
      latestCandle,
      smc,
    },
    ai: aiDecision,
    risk,
  });
  const effectiveAiDecision =
    recorded.duplicate && recorded.latestAiDecision
      ? recorded.latestAiDecision
      : aiDecision;
  const effectiveRisk =
    recorded.duplicate && recorded.latestRiskDecision
      ? recorded.latestRiskDecision
      : risk;
  return {
    result: {
      symbol,
      decision: effectiveRisk.state,
      aiDecision: effectiveAiDecision,
      risk: effectiveRisk,
      smc,
      paperTrade: recorded.paperTrade ?? null,
      duplicate: recorded.duplicate ?? false,
    },
    quote: { latestPrice: smc.latestPrice, latestCandle },
  };
}

let activeCycle: Promise<TradingCycleResult> | null = null;

async function executeTradingCycle(
  source: "manual" | "scheduled",
): Promise<TradingCycleResult> {
  const bySymbol: SymbolCycleResult[] = [];
  const quotes: Record<string, { latestPrice: unknown; latestCandle: unknown }> = {};

  // Scan every symbol sequentially. Sequential (not parallel) keeps each
  // python3 subprocess call simple and avoids SQLite write contention.
  for (const symbol of TRADED_SYMBOLS) {
    try {
      const { result, quote } = await executeSymbolCycle(symbol);
      bySymbol.push(result);
      quotes[symbol] = quote;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      bySymbol.push({
        symbol,
        decision: "NO TRADE",
        aiDecision: {
          decision: "NO TRADE",
          confidence: 0,
          reasoning: `Scan failed: ${message}`,
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
          riskAmount: null,
        },
        risk: {
          approved: false,
          state: "NO TRADE",
          reasons: [`No trade: ${message}`],
          rules: {},
        },
        smc: {},
        paperTrade: null,
        duplicate: false,
      });
    }
  }

  // Settle all open positions across every symbol using each symbol's own
  // latest quote, then fetch the final combined state.
  const settled = await database("settle", { quotes });
  const finalState = await database("state");

  const primary = bySymbol.find((entry) => entry.paperTrade) ?? bySymbol[0];

  return {
    decision: primary.decision,
    aiDecision: primary.aiDecision,
    risk: primary.risk,
    smc: primary.smc,
    paperTrade: primary.paperTrade,
    closedTrades: settled.closedTrades ?? [],
    account: finalState.account ?? settled.account,
    openTrade: finalState.openTrade ?? null,
    trades: finalState.trades ?? [],
    paperOnly: true,
    source,
    duplicate: bySymbol.every((entry) => entry.duplicate),
    bySymbol,
  };
}

export async function runTradingCycle(
  source: "manual" | "scheduled" = "manual",
): Promise<TradingCycleResult> {
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

router.get("/trading/state", async (_req: Request, res: Response) => {
  try {
    const stored = await database("state");
    return res.json({ ...stored, scheduler: schedulerResponse(), paperOnly: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load trading state";
    return res.status(502).json({ error: message, paperOnly: true });
  }
});

router.post("/trading/analyze", async (req: Request, res: Response) => {
  try {
    if (req.body?.smcEnabled === false) {
      return res.status(409).json({
        decision: "NO TRADE",
        risk: { approved: false, state: "NO TRADE", reasons: ["SMC engine is paused"], rules: {} },
        paperOnly: true,
      });
    }
    return res.json({ ...(await runTradingCycle("manual")), scheduler: schedulerResponse() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trading analysis failed";
    req.log?.error?.({ err: error }, "Trading analysis failed");
    return res.status(502).json({
      decision: "NO TRADE",
      risk: {
        approved: false,
        state: "NO TRADE",
        reasons: [`No trade: ${message}`],
        rules: {},
      },
      paperOnly: true,
    });
  }
});

router.post("/trading/scheduler", (req: Request, res: Response) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }
  return database("scheduler", { enabled })
    .then(() => ({
      scheduler: setTradingSchedulerEnabled(enabled, async (source) => runTradingCycle(source)),
      paperOnly: true,
    }))
    .then((payload) => res.json(payload))
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Unable to update scheduler";
      return res.status(502).json({ error: message, paperOnly: true });
    });
});

router.post("/trading/reset", async (_req: Request, res: Response) => {
  try {
    return res.json({
      ...(await database("reset")),
      scheduler: schedulerResponse(),
      paperOnly: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset paper account";
    return res.status(502).json({ error: message, paperOnly: true });
  }
});

export default router;

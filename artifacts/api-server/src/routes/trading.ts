import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Router, type Request, type Response } from "express";

const execFileAsync = promisify(execFile);
const router = Router();

type AccountSnapshot = {
  balance: number;
  dailyPnl: number;
  openPositions: number;
};

type GeminiDecision = {
  decision: "BUY" | "SELL" | "NO TRADE";
  confidence: number;
  reasoning: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  riskAmount: number | null;
};

type RiskDecision = {
  approved: boolean;
  state: "BUY" | "SELL" | "NO TRADE";
  reasons: string[];
  rules: {
    account_balance: number;
    risk_per_trade: number;
    risk_amount: number;
    max_open_positions: number;
    max_daily_loss: number;
    min_risk_reward: number;
  };
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
  if (!found) {
    throw new Error(`Unable to locate ${name}`);
  }
  return found;
};

async function loadSmcAnalysis(): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync("python3", [workspaceFile("run_smc_demo.py"), "--live"], {
    cwd: path.dirname(workspaceFile("run_smc_demo.py")),
    maxBuffer: 2 * 1024 * 1024,
  });
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

async function askGemini(smc: Record<string, unknown>): Promise<GeminiDecision> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the API server");
  }

  const prompt = [
    "You are a paper-trading SMC decision analyst. This is analysis only: never mention broker execution and never assume live market data.",
    "Use only the supplied M15 SMC findings. Return JSON only, with no markdown.",
    "Choose exactly one decision: BUY, SELL, or NO TRADE.",
    "For BUY or SELL, provide entryPrice, stopLoss, takeProfit, riskRewardRatio, and riskAmount. riskAmount must be exactly 5.",
    "When evidence is mixed or insufficient, choose NO TRADE. Confidence must be an integer from 0 to 100.",
    'JSON shape: {"decision":"BUY|SELL|NO TRADE","confidence":0,"reasoning":"detailed evidence-based explanation","entryPrice":0,"stopLoss":0,"takeProfit":0,"riskRewardRatio":0,"riskAmount":5}',
    "SMC findings:",
    JSON.stringify(smc),
  ].join("\n");

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
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
  if (!rawText) {
    throw new Error("Gemini returned an empty decision");
  }

  const parsed = parseGeminiJson(rawText);
  const decision = String(parsed.decision ?? "NO TRADE").toUpperCase();
  const normalizedDecision =
    decision === "BUY" || decision === "SELL" ? decision : "NO TRADE";
  return {
    decision: normalizedDecision,
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
  const { stdout } = await execFileAsync("python3", [workspaceFile("risk_engine.py"), payload], {
    cwd: path.dirname(workspaceFile("risk_engine.py")),
    maxBuffer: 64 * 1024,
  });
  return JSON.parse(stdout) as RiskDecision;
}

function parseAccount(value: unknown): AccountSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("account snapshot is required");
  }
  const candidate = value as Record<string, unknown>;
  const balance = finiteOrNull(candidate.balance);
  const dailyPnl = finiteOrNull(candidate.dailyPnl);
  const openPositions = finiteOrNull(candidate.openPositions);
  if (balance === null || dailyPnl === null || openPositions === null || openPositions < 0) {
    throw new Error("account snapshot contains invalid values");
  }
  return { balance, dailyPnl, openPositions: Math.floor(openPositions) };
}

router.post("/trading/analyze", async (req: Request, res: Response) => {
  try {
    const account = parseAccount(req.body?.account);
    if (req.body?.smcEnabled === false) {
      return res.status(409).json({
        decision: "NO TRADE",
        risk: { approved: false, state: "NO TRADE", reasons: ["SMC engine is paused"], rules: {} },
        error: "SMC engine is paused",
      });
    }

    const smc = await loadSmcAnalysis();
    const aiDecision = await askGemini(smc);
    const risk = await runRiskEngine(aiDecision, account);
    const paperTrade = risk.approved
      ? {
          id: `paper-${Date.now()}`,
          symbol: "EURUSD",
          side: aiDecision.decision,
          status: "OPEN",
          entryPrice: aiDecision.entryPrice,
          stopLoss: aiDecision.stopLoss,
          takeProfit: aiDecision.takeProfit,
          riskAmount: 5,
        }
      : null;

    return res.json({
      decision: risk.state,
      aiDecision,
      risk,
      paperTrade,
      smc,
      paperOnly: true,
    });
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

export default router;
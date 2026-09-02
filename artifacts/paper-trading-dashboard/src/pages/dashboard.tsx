import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  BrainCircuit,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  Gauge,
  LineChart,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
  X,
  Zap,
} from 'lucide-react';

type BotState = 'running' | 'paused';
type EngineState = 'running' | 'paused';
type TradeSide = 'LONG' | 'SHORT';
type TradeResult = 'WIN' | 'LOSS' | 'OPEN' | 'REJECTED';

type Trade = {
  id: string;
  time: string;
  symbol: string;
  side: TradeSide;
  setup: string;
  result: TradeResult;
  pnl: number;
  pnlPct: number;
  confidence: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt?: string;
  closedAt?: string | null;
};

type AccountModel = {
  balance: number;
  dailyPnl: number;
  monthlyPnl: number;
  trades: number;
  wins: number;
  losses: number;
  drawdown: number;
  peak: number;
};

type AiDecision = {
  decision: 'BUY' | 'SELL' | 'NO TRADE';
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
  state: 'BUY' | 'SELL' | 'NO TRADE';
  reasons: string[];
  rules: {
    account_balance?: number;
    risk_per_trade?: number;
    risk_amount?: number;
    max_open_positions?: number;
    max_daily_loss?: number;
    min_risk_reward?: number;
  };
};

type PaperTrade = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  status: 'OPEN';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  quantity?: number;
  openedAt?: string;
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
};

type SchedulerState = {
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastStatus: 'idle' | 'running' | 'completed' | 'failed';
  lastError: string | null;
  nextRunAt: string | null;
};

type TradingState = {
  account?: AccountModel & { openPositions?: number };
  openTrade?: PaperTrade | null;
  trades?: Trade[];
  equityCurve?: number[];
  latestAiDecision?: AiDecision | null;
  latestRiskDecision?: RiskDecision | null;
  scheduler?: SchedulerState;
  latestScan?: {
    candleTimestamp: string;
    scannedAt: string;
    latestPrice: number;
    dataSource: string;
    live: boolean;
  } | null;
};

type SmcSnapshot = {
  symbol?: string;
  live?: boolean;
  dataSource?: string;
  latestPrice?: number;
  overallContext?: { direction?: string; score?: number };
  liquiditySweeps?: unknown[];
  structureBreaks?: unknown[];
  fairValueGaps?: unknown[];
  orderBlocks?: unknown[];
};

const startingAccount: AccountModel = {
  balance: 1000,
  dailyPnl: 0,
  monthlyPnl: 0,
  trades: 0,
  wins: 0,
  losses: 0,
  drawdown: 0,
  peak: 1000,
};

const startingTrades: Trade[] = [];

const startingTrend = [1000, 1000, 1000, 1000, 1000, 1000];
const initialAiDecision: AiDecision = {
  decision: 'NO TRADE',
  confidence: 0,
  reasoning: 'Run Gemini analysis to evaluate the latest M15 SMC evidence.',
  entryPrice: null,
  stopLoss: null,
  takeProfit: null,
  riskRewardRatio: null,
  riskAmount: null,
};
const initialRiskDecision: RiskDecision = {
  approved: false,
  state: 'NO TRADE',
  reasons: ['Risk review pending'],
  rules: {
    account_balance: 1000,
    risk_per_trade: 0.005,
    risk_amount: 5,
    max_open_positions: 1,
    max_daily_loss: 20,
    min_risk_reward: 2,
  },
};

const formatMoney = (value: number) => `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatPct = (value: number) => `${value.toFixed(1)}%`;
const formatSignedMoney = (value: number) => `${value >= 0 ? '+' : ''}${formatMoney(value)}`;
const formatDateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', timeZone: 'UTC' })
  : '—';

function StatusDot({ color = 'bg-[#c8ed45]' }: { color?: string }) {
  return <span className={`pulse-dot inline-block h-2 w-2 rounded-full ${color}`} aria-hidden="true" />;
}

function Sidebar() {
  const nav = [
    { label: 'Overview', icon: Gauge, active: true },
    { label: 'Market Data', icon: LineChart },
    { label: 'SMC Analysis', icon: BarChart3 },
    { label: 'Gemini AI', icon: BrainCircuit },
    { label: 'Risk Engine', icon: ShieldCheck },
    { label: 'Paper Trading', icon: WalletCards },
    { label: 'Trade Logs', icon: Database },
    { label: 'Notifications', icon: Bell },
  ];
  return (
    <aside className="hidden min-h-[100dvh] w-[244px] shrink-0 flex-col bg-sidebar px-4 py-5 text-sidebar-foreground md:flex">
      <div className="flex items-center gap-3 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sidebar-primary text-sidebar-primary-foreground">
          <Activity size={19} strokeWidth={2.5} />
        </div>
        <div>
          <div className="display text-[17px] font-semibold tracking-[-.03em]">Fieldwork</div>
          <div className="mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/45">paper lab / 01</div>
        </div>
      </div>

      <div className="mt-10 px-2 text-[10px] font-semibold uppercase tracking-[.16em] text-sidebar-foreground/35">Command center</div>
      <nav className="mt-3 space-y-1">
        {nav.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            type="button"
            onClick={() => undefined}
            data-testid={`button-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
            className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] transition-colors ${active ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/58 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}
          >
            <Icon size={16} strokeWidth={active ? 2.2 : 1.7} className={active ? 'text-sidebar-primary' : 'text-sidebar-foreground/45 group-hover:text-sidebar-primary'} />
            <span>{label}</span>
            {label === 'Paper Trading' && <span className="ml-auto rounded bg-sidebar-primary/15 px-1.5 py-0.5 mono text-[8px] text-sidebar-primary">LIVE SIM</span>}
          </button>
        ))}
      </nav>

      <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3.5">
        <div className="flex items-center justify-between">
          <span className="mono text-[9px] uppercase tracking-[.14em] text-sidebar-foreground/45">Environment</span>
          <StatusDot />
        </div>
        <div className="mt-2 text-[12px] font-medium">Isolated sandbox</div>
        <div className="mt-1 text-[10px] leading-4 text-sidebar-foreground/45">No broker credentials. No market orders. Ever.</div>
        <div className="mt-3 border-t border-sidebar-border pt-3">
          <div className="flex justify-between text-[10px] text-sidebar-foreground/45"><span>Engine uptime</span><span className="mono text-sidebar-foreground/70">04:18:32</span></div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 px-2 text-[10px] text-sidebar-foreground/35">
        <CircleHelp size={13} />
        <span>Docs & safety notes</span>
        <ChevronDown size={12} className="ml-auto" />
      </div>
    </aside>
  );
}

function MetricCard({ label, value, detail, tone = 'neutral', icon: Icon, testId }: { label: string; value: string; detail: string; tone?: 'positive' | 'negative' | 'neutral'; icon: typeof TrendingUp; testId: string }) {
  const toneClass = tone === 'positive' ? 'text-[#177b69]' : tone === 'negative' ? 'text-[#c84e3d]' : 'text-foreground';
  return (
    <div className="dashboard-in delay-1 group rounded-xl border border-card-border bg-card p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md" data-testid={`card-${testId}`}>
      <div className="flex items-start justify-between">
        <div className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">{label}</div>
        <Icon size={15} className="text-muted-foreground/55 transition-colors group-hover:text-primary" />
      </div>
      <div className={`display mt-3 text-[24px] font-semibold tracking-[-.04em] ${toneClass}`} data-testid={`text-${testId}`}>{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground" data-testid={`detail-${testId}`}>{detail}</div>
    </div>
  );
}

function TrendChart({ values }: { values: number[] }) {
  const min = Math.min(...values) - 8;
  const max = Math.max(...values) + 8;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 100 - ((value - min) / (max - min)) * 78 - 8;
    return `${x},${y}`;
  }).join(' ');
  const areaPoints = `0,100 ${points} 100,100`;
  return (
    <div className="relative mt-5 h-[218px] w-full overflow-hidden rounded-lg border border-border/70 bg-background/35 px-1 pt-2" data-testid="chart-performance">
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between px-3 py-5">
        {[0, 1, 2, 3].map((line) => <div key={line} className="border-t border-dashed border-border/60" />)}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-[48px] mono text-[9px] text-muted-foreground/60">
        <span>$1,100</span><span>$1,050</span><span>$1,000</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-x-3 bottom-8 top-5 h-[165px] w-[calc(100%-24px)] overflow-visible">
        <polygon points={areaPoints} fill="hsl(72 77% 57% / .12)" />
        <polyline points={points} fill="none" stroke="hsl(72 77% 43%)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="100" cy={points.split(' ').at(-1)?.split(',')[1]} r="2.2" fill="hsl(72 77% 43%)" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute bottom-2 left-3 right-3 flex justify-between mono text-[9px] text-muted-foreground/65">
        <span>01 MAY</span><span>08 MAY</span><span>15 MAY</span><span>22 MAY</span><span>NOW</span>
      </div>
    </div>
  );
}

function ActivityRow({ trade }: { trade: Trade }) {
  const isWin = trade.result === 'WIN';
  const isOpen = trade.result === 'OPEN';
  const isRejected = trade.result === 'REJECTED';
  return (
    <div className="grid grid-cols-[72px_1fr_68px_76px] items-center gap-2 border-b border-border/60 py-3 last:border-0 sm:grid-cols-[82px_1fr_100px_82px_82px] sm:gap-3" data-testid={`row-trade-${trade.id}`}>
      <div className="mono text-[10px] text-muted-foreground">{trade.time}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold">{trade.symbol}</span>
          <span className={`rounded px-1.5 py-0.5 mono text-[8px] font-medium ${trade.side === 'LONG' ? 'bg-[#177b69]/10 text-[#177b69]' : 'bg-[#c84e3d]/10 text-[#c84e3d]'}`}>{trade.side}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{trade.setup}</div>
      </div>
      <div className="hidden text-[11px] text-muted-foreground sm:block">{trade.confidence}% <span className="text-[9px]">AI</span></div>
      <div className={`text-right ${isWin ? 'text-[#177b69]' : isOpen ? 'text-muted-foreground' : 'text-[#c84e3d]'}`}>
        <div className="mono text-[11px] font-medium">{isWin ? '+' : ''}{formatMoney(trade.pnl)}</div>
        <div className="mono mt-0.5 text-[9px] opacity-70">{trade.pnlPct >= 0 ? '+' : ''}{formatPct(trade.pnlPct)}</div>
      </div>
      <div className={`hidden justify-self-end rounded-full border px-2 py-1 mono text-[8px] uppercase tracking-[.08em] sm:block ${isWin ? 'border-[#177b69]/25 bg-[#177b69]/7 text-[#177b69]' : isOpen ? 'border-border bg-muted text-muted-foreground' : isRejected ? 'border-[#c84e3d]/25 bg-[#c84e3d]/7 text-[#c84e3d]' : 'border-[#c84e3d]/25 bg-[#c84e3d]/7 text-[#c84e3d]'}`}>{trade.result}</div>
    </div>
  );
}

export default function Dashboard() {
  const [botState, setBotState] = useState<BotState>('running');
  const [scheduler, setScheduler] = useState<SchedulerState | null>(null);
  const [smcState, setSmcState] = useState<EngineState>('running');
  const [account, setAccount] = useState<AccountModel>(startingAccount);
  const [trades, setTrades] = useState<Trade[]>(startingTrades);
  const [trend, setTrend] = useState(startingTrend);
  const [aiDecision, setAiDecision] = useState<AiDecision>(initialAiDecision);
  const [riskDecision, setRiskDecision] = useState<RiskDecision>(initialRiskDecision);
  const [openTrade, setOpenTrade] = useState<PaperTrade | null>(null);
  const [smcSnapshot, setSmcSnapshot] = useState<SmcSnapshot | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [notice, setNotice] = useState('System nominal');
  const winRate = useMemo(() => account.trades ? (account.wins / account.trades) * 100 : 0, [account.trades, account.wins]);

  const applyTradingState = useCallback((payload: TradingState) => {
    if (payload.account) setAccount(payload.account);
    if (payload.trades) setTrades(payload.trades);
    if (payload.equityCurve && payload.equityCurve.length > 1) setTrend(payload.equityCurve);
    if ('openTrade' in payload) setOpenTrade(payload.openTrade ?? null);
    if (payload.latestAiDecision) setAiDecision(payload.latestAiDecision);
    if (payload.latestRiskDecision) setRiskDecision(payload.latestRiskDecision);
    if (payload.latestScan) {
      setSmcSnapshot((current) => ({
        ...current,
        symbol: 'EURUSD',
        live: payload.latestScan?.live,
        latestPrice: payload.latestScan?.latestPrice,
        dataSource: payload.latestScan?.dataSource,
      }));
    }
    if (payload.scheduler) {
      setScheduler(payload.scheduler);
      setBotState(payload.scheduler.enabled ? 'running' : 'paused');
    }
  }, []);

  const syncTradingState = useCallback(async () => {
    const response = await fetch('/api/trading/state');
    if (!response.ok) throw new Error('Unable to load saved trading state');
    const payload = await response.json() as TradingState;
    applyTradingState(payload);
  }, [applyTradingState]);

  useEffect(() => {
    void syncTradingState().catch(() => setNotice('Waiting for the paper trading service'));
    const interval = window.setInterval(() => {
      void syncTradingState().catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [syncTradingState]);

  const toggleBot = async () => {
    const enabled = botState === 'paused';
    setNotice(enabled ? 'Resuming automatic M15 scans…' : 'Pausing automatic scans safely…');
    try {
      const response = await fetch('/api/trading/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json() as { scheduler?: SchedulerState; error?: string };
      if (!response.ok || !payload.scheduler) throw new Error(payload.error ?? 'Scheduler update failed');
      setScheduler(payload.scheduler);
      setBotState(payload.scheduler.enabled ? 'running' : 'paused');
      setNotice(enabled ? 'Automatic M15 scans resumed' : 'Automatic scans paused safely');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to update scheduler');
    }
  };

  const toggleSmc = () => {
    setSmcState((current) => {
      const next = current === 'running' ? 'paused' : 'running';
      setNotice(next === 'running' ? 'M15 SMC analysis resumed' : 'M15 SMC analysis paused safely');
      return next;
    });
  };

  const resetAccount = async () => {
    try {
      const response = await fetch('/api/trading/reset', { method: 'POST' });
      const payload = await response.json() as TradingState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to reset paper account');
      applyTradingState(payload);
      setTrend(startingTrend);
      setAiDecision(initialAiDecision);
      setRiskDecision(initialRiskDecision);
      setSmcSnapshot(null);
      setNotice('Paper account reset to $1,000');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to reset paper account');
    } finally {
      setShowReset(false);
    }
  };

  const runAiDecision = async () => {
    if (botState === 'paused') {
      setNotice('Resume the bot before requesting an AI decision');
      return;
    }
    if (smcState === 'paused') {
      setNotice('Resume M15 SMC analysis before requesting an AI decision');
      return;
    }
    setIsAnalyzing(true);
    setNotice('Running M15 SMC analysis and Gemini review…');
    try {
      const response = await fetch('/api/trading/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smcEnabled: true }),
      });
      const payload = await response.json() as TradingState & {
        aiDecision?: AiDecision;
        risk?: RiskDecision;
        paperTrade?: PaperTrade | null;
        smc?: SmcSnapshot;
      };
      if (payload.aiDecision) setAiDecision(payload.aiDecision);
      if (payload.risk) setRiskDecision(payload.risk);
      if (payload.smc) setSmcSnapshot(payload.smc);
      applyTradingState(payload);

      if (!response.ok || !payload.risk) {
        setNotice(payload.risk?.reasons?.[0] ?? 'No trade: analysis service unavailable');
        return;
      }

      if (payload.paperTrade && payload.risk.approved) {
        setNotice(`Approved ${payload.paperTrade.side}: paper trade logged at $5 risk`);
      } else {
        const reason = payload.risk.reasons[0] ?? 'Risk Engine rejected the proposal';
        setNotice(`NO TRADE — ${reason}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reach analysis service';
      setRiskDecision({ ...initialRiskDecision, reasons: [`No trade: ${message}`] });
      setNotice(`NO TRADE — ${message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="noise min-h-[100dvh] bg-background text-foreground">
      <div className="flex min-h-[100dvh]">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur-md">
            <div className="flex min-h-[70px] items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-10">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#177b69]" />
                  <span className="mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Wednesday, 22 May 2024</span>
                </div>
                <h1 className="display mt-1 text-[23px] font-semibold tracking-[-.045em] sm:text-[26px]">Overview</h1>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden items-center gap-2 rounded-full border border-[#177b69]/20 bg-[#177b69]/7 px-3 py-2 sm:flex" data-testid="status-paper-only">
                  <ShieldCheck size={14} className="text-[#177b69]" />
                  <span className="text-[11px] font-semibold text-[#177b69]">PAPER TRADING ONLY</span>
                </div>
                <button type="button" onClick={() => setNotice('No new alerts')} data-testid="button-notifications" className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                  <Bell size={16} />
                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#d77a2e]" />
                </button>
                <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-primary display text-[13px] font-semibold text-primary-foreground sm:flex" data-testid="avatar-user">AR</div>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] px-5 pb-12 pt-6 sm:px-8 lg:px-10">
            <div className="mb-5 flex items-center gap-2 rounded-lg border border-[#d77a2e]/25 bg-[#d77a2e]/7 px-3 py-2.5 text-[11px] text-[#8f531d] dashboard-in" data-testid="banner-simulation">
              <Zap size={14} className="shrink-0" />
              <span><strong>Sandbox active.</strong> All values are simulated with virtual funds. This workspace cannot connect to a broker or place live orders.</span>
              <button type="button" onClick={() => setNotice('Safety policy: broker connection disabled')} data-testid="button-safety-info" className="ml-auto shrink-0 underline decoration-[#d77a2e]/40 underline-offset-2 hover:text-foreground">Safety policy</button>
            </div>

            <section className="grid-paper relative overflow-hidden rounded-2xl border border-primary/20 bg-primary px-5 py-5 text-primary-foreground shadow-md sm:px-7 sm:py-6 dashboard-in" data-testid="card-account-summary">
              <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border-[24px] border-accent/10" />
              <div className="pointer-events-none absolute -bottom-24 right-36 h-48 w-48 rounded-full border border-accent/10" />
              <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="mono text-[10px] uppercase tracking-[.16em] text-primary-foreground/55">Paper account balance</span>
                    <span className="rounded border border-accent/30 bg-accent/15 px-1.5 py-0.5 mono text-[8px] uppercase tracking-[.08em] text-accent">virtual USD</span>
                  </div>
                  <div className="display mt-2 text-[38px] font-semibold tracking-[-.06em] sm:text-[46px]" data-testid="text-balance">{formatMoney(account.balance)}</div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-primary-foreground/60">
                    <span className="inline-flex items-center gap-1 text-accent"><ArrowUpRight size={13} /> {formatMoney(account.balance - 1000)}</span>
                    <span>since paper account start</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6 border-t border-primary-foreground/12 pt-4 md:min-w-[310px] md:border-l md:border-t-0 md:pl-6 md:pt-0">
                  <div><div className="mono text-[9px] uppercase tracking-[.13em] text-primary-foreground/45">Starting capital</div><div className="mt-1 mono text-[15px]">$1,000.00</div></div>
                  <div><div className="mono text-[9px] uppercase tracking-[.13em] text-primary-foreground/45">Account state</div><div className="mt-1 flex items-center gap-1.5 text-[12px]"><StatusDot /><span>Isolated sandbox</span></div></div>
                </div>
              </div>
            </section>

             <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-10">
               <MetricCard label="Total P/L" value={formatSignedMoney(account.balance - 1000)} detail="since paper account start" tone={account.balance >= 1000 ? 'positive' : 'negative'} icon={TrendingUp} testId="total-pnl" />
               <MetricCard label="Daily P/L" value={formatSignedMoney(account.dailyPnl)} detail="max loss $20.00" tone={account.dailyPnl < 0 ? 'negative' : 'positive'} icon={ArrowUpRight} testId="daily-pnl" />
               <MetricCard label="Monthly P/L" value={formatSignedMoney(account.monthlyPnl)} detail="paper account" tone={account.monthlyPnl < 0 ? 'negative' : 'positive'} icon={TrendingUp} testId="monthly-pnl" />
              <MetricCard label="Trades" value={String(account.trades)} detail="all simulated" icon={Activity} testId="trades" />
              <MetricCard label="Wins" value={String(account.wins)} detail={`${formatPct(winRate)} of trades`} tone="positive" icon={Target} testId="wins" />
              <MetricCard label="Losses" value={String(account.losses)} detail="risk contained" tone="negative" icon={ArrowDownRight} testId="losses" />
              <MetricCard label="Win rate" value={formatPct(winRate)} detail="target ≥ 55.0%" tone="positive" icon={Sparkles} testId="win-rate" />
              <MetricCard label="Drawdown" value={formatPct(account.drawdown)} detail="from account peak" tone="neutral" icon={BarChart3} testId="drawdown" />
               <MetricCard label="Open trade" value={openTrade ? '1' : '0'} detail="max 1 permitted" tone={openTrade ? 'positive' : 'neutral'} icon={WalletCards} testId="open-trades" />
              <MetricCard label="Bot status" value={botState === 'running' ? 'Running' : 'Paused'} detail={botState === 'running' ? 'learning in sandbox' : 'no new decisions'} tone={botState === 'running' ? 'positive' : 'neutral'} icon={Bot} testId="bot-status" />
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.55fr)]">
              <div className="rounded-xl border border-card-border bg-card p-5 shadow-xs sm:p-6 dashboard-in delay-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex items-center gap-2"><LineChart size={15} className="text-primary" /><h2 className="display text-[17px] font-semibold tracking-[-.025em]">Simulated performance</h2></div><p className="mt-1 text-[11px] text-muted-foreground">Account equity · virtual funds only</p></div>
                  <div className="flex rounded-lg border border-border bg-background p-0.5 mono text-[9px] text-muted-foreground"><button type="button" onClick={() => setNotice('Showing 30 day simulation')} data-testid="button-range-30d" className="rounded-md bg-primary px-2.5 py-1.5 text-primary-foreground">30D</button><button type="button" onClick={() => setNotice('Showing all simulation history')} data-testid="button-range-all" className="px-2.5 py-1.5 hover:text-foreground">ALL</button></div>
                </div>
                <TrendChart values={trend} />
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" /> equity curve</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#d77a2e]" /> starting capital</span><span className="ml-auto mono text-[9px]">UPDATED 09:42:18 UTC</span></div>
              </div>

              <div className="rounded-xl border border-card-border bg-card p-5 shadow-xs sm:p-6 dashboard-in delay-3">
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Bot size={15} className="text-primary" /><h2 className="display text-[17px] font-semibold tracking-[-.025em]">Bot console</h2></div><span className={`flex items-center gap-1.5 rounded-full px-2 py-1 mono text-[9px] uppercase tracking-[.08em] ${botState === 'running' ? 'bg-[#177b69]/10 text-[#177b69]' : 'bg-muted text-muted-foreground'}`} data-testid="status-bot"><StatusDot color={botState === 'running' ? 'bg-[#177b69]' : 'bg-muted-foreground'} />{botState}</span></div>
                <div className="mt-5 rounded-lg bg-primary p-4 text-primary-foreground">
                  <div className="flex items-center gap-2 text-[10px] text-primary-foreground/55"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> DECISION LOOP</div>
                   <div className="mt-2 flex items-end justify-between gap-3"><span className="display text-[22px] font-semibold" data-testid="text-ai-decision">{aiDecision.decision}</span><span className="mono text-[10px] text-accent" data-testid="text-gemini-confidence">{aiDecision.confidence}% conf.</span></div>
                   <div className="mt-4 h-1 rounded-full bg-primary-foreground/10"><div className="h-1 rounded-full bg-accent transition-all" style={{ width: `${aiDecision.confidence}%` }} /></div>
                   <div className="mt-2 flex justify-between gap-3 mono text-[9px] text-primary-foreground/45"><span>GEMINI AI · LIVE EURUSD · M15</span><span>{smcSnapshot?.latestPrice ? `price ${smcSnapshot.latestPrice.toFixed(5)}` : 'waiting for live scan'}</span></div>
                </div>
                  <div className="mt-4 rounded-lg border border-border bg-background/45 p-3" data-testid="panel-ai-reasoning">
                    <div className="mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Trade reasons</div>
                     <p className="mt-1.5 text-[11px] leading-5 text-foreground/80">{aiDecision.reasoning}</p>
                     <div className="mt-2 border-t border-border/70 pt-2 mono text-[9px] text-muted-foreground">Live EURUSD price: {smcSnapshot?.latestPrice ? smcSnapshot.latestPrice.toFixed(5) : '—'} · {smcSnapshot?.dataSource ?? 'Awaiting live market data'}</div>
                  </div>
                  <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[10px] ${riskDecision.approved ? 'bg-[#177b69]/7 text-[#177b69]' : 'bg-[#c84e3d]/7 text-[#c84e3d]'}`} data-testid="status-risk-engine">
                    <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                    <span><strong>{riskDecision.approved ? 'Risk Engine approved' : 'Risk Engine: NO TRADE'}</strong><br />{riskDecision.reasons[0]}</span>
                  </div>
                  <div className="mt-4 space-y-3">
                   {[['Strategy', 'SMC v2.4 + Gemini'], ['Risk per trade', '$5.00 exactly'], ['Max open positions', '1'], ['Daily loss limit', '$20.00'], ['Minimum RR', '1:2']].map(([label, value]) => <div key={label} className="flex items-center justify-between border-b border-border/60 pb-2.5 text-[11px] last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="mono text-[10px] font-medium">{value}</span></div>)}
                </div>
                 <div className="mt-5 flex items-center justify-between rounded-lg border border-border bg-background/45 px-3 py-2.5" data-testid="status-smc-engine">
                   <div className="flex items-center gap-2">
                     <span className={`h-2 w-2 rounded-full ${smcState === 'running' ? 'bg-[#177b69] pulse-dot' : 'bg-muted-foreground'}`} />
                     <div>
                       <div className="text-[11px] font-semibold">M15 SMC engine</div>
                        <div className="mt-0.5 text-[9px] text-muted-foreground">analysis-only · Live EURUSD Data</div>
                     </div>
                   </div>
                   <button type="button" onClick={toggleSmc} data-testid="button-toggle-smc" className={`rounded-md px-2.5 py-1.5 mono text-[9px] font-semibold uppercase tracking-[.08em] transition ${smcState === 'running' ? 'bg-[#177b69]/10 text-[#177b69] hover:bg-[#177b69]/15' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                     {smcState === 'running' ? 'On' : 'Off'}
                   </button>
                 </div>
                 <div className="mt-5 flex gap-2">
                  <button type="button" onClick={toggleBot} data-testid="button-toggle-bot" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-[11px] font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[.98]">{botState === 'running' ? <Pause size={14} /> : <Play size={14} />}{botState === 'running' ? 'Pause bot' : 'Resume bot'}</button>
                   <button type="button" onClick={() => void runAiDecision()} disabled={isAnalyzing} data-testid="button-run-ai" className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-[10px] font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:cursor-wait disabled:opacity-60" aria-label="Run Gemini AI decision"><Sparkles size={14} />{isAnalyzing ? 'Analyzing…' : 'Run AI'}</button>
                </div>
                 <div className="mt-3 flex items-center justify-between mono text-[9px] text-muted-foreground">
                   <span>Auto scan {botState === 'running' ? 'every 15 min' : 'paused'}</span>
                   <span>{scheduler?.nextRunAt ? `next ${formatDateTime(scheduler.nextRunAt)} UTC` : 'UTC candle close'}</span>
                 </div>
              </div>
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.55fr)]">
              <div className="rounded-xl border border-card-border bg-card p-5 shadow-xs sm:p-6 dashboard-in delay-4">
                <div className="flex items-center justify-between"><div><div className="flex items-center gap-2"><Clock3 size={15} className="text-primary" /><h2 className="display text-[17px] font-semibold tracking-[-.025em]">Recent activity</h2></div><p className="mt-1 text-[11px] text-muted-foreground">Latest simulated decisions and fills</p></div><button type="button" onClick={() => setNotice('Trade log is local to this session')} data-testid="button-view-trade-log" className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground transition hover:text-primary">View trade log <ArrowUpRight size={13} /></button></div>
                <div className="mt-5 grid grid-cols-[72px_1fr_68px_76px] gap-2 border-b border-border pb-2 mono text-[9px] uppercase tracking-[.1em] text-muted-foreground sm:grid-cols-[82px_1fr_100px_82px_82px] sm:gap-3"><span>Time</span><span>Instrument / setup</span><span className="hidden sm:block">Confidence</span><span className="text-right">P/L</span><span className="hidden text-right sm:block">Result</span></div>
                <div>{trades.length ? trades.map((trade) => <ActivityRow key={trade.id} trade={trade} />) : <div className="flex flex-col items-center justify-center py-10 text-center"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Activity size={17} /></div><div className="mt-3 text-[12px] font-semibold">No activity yet</div><div className="mt-1 text-[10px] text-muted-foreground">Resume the bot when you are ready to run the simulation.</div></div>}</div>
              </div>
               <div className="rounded-xl border border-card-border bg-card p-5 shadow-xs sm:p-6 dashboard-in delay-5">
                 <div className="flex items-center justify-between"><div className="flex items-center gap-2"><WalletCards size={15} className="text-primary" /><h2 className="display text-[17px] font-semibold tracking-[-.025em]">Current position</h2></div><span className={`rounded-full px-2 py-1 mono text-[9px] uppercase tracking-[.08em] ${openTrade ? 'bg-[#177b69]/10 text-[#177b69]' : 'bg-muted text-muted-foreground'}`}>{openTrade ? 'OPEN' : 'FLAT'}</span></div>
                 {openTrade ? <div className="mt-4 rounded-lg border border-border bg-background/60 p-4">
                    <div className="flex items-center justify-between"><div><div className="text-[17px] font-semibold">{openTrade.symbol}</div><div className="mt-1 flex items-center gap-2 mono text-[9px] text-muted-foreground"><span className={`rounded px-1.5 py-0.5 ${openTrade.side === 'BUY' ? 'bg-[#177b69]/10 text-[#177b69]' : 'bg-[#c84e3d]/10 text-[#c84e3d]'}`}>{openTrade.side}</span> M15 · Gemini + SMC</div></div><div className="text-right"><div className={`mono text-[15px] font-medium ${(openTrade.unrealizedPnl ?? 0) >= 0 ? 'text-[#177b69]' : 'text-[#c84e3d]'}`}>{formatSignedMoney(openTrade.unrealizedPnl ?? 0)}</div><div className="mt-1 mono text-[9px] text-muted-foreground">{openTrade.currentPrice ? `now ${openTrade.currentPrice.toFixed(5)}` : 'unrealized'}</div></div></div>
                   <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-3"><div><div className="mono text-[9px] text-muted-foreground">Entry</div><div className="mt-1 mono text-[10px]">{openTrade.entryPrice}</div></div><div><div className="mono text-[9px] text-muted-foreground">Stop</div><div className="mt-1 mono text-[10px]">{openTrade.stopLoss}</div></div><div><div className="mono text-[9px] text-muted-foreground">Target</div><div className="mt-1 mono text-[10px]">{openTrade.takeProfit}</div></div></div>
                 </div> : <div className="mt-4 flex min-h-[130px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/40 p-4 text-center"><WalletCards size={20} className="text-muted-foreground/60" /><div className="mt-3 text-[12px] font-semibold">No active paper trade</div><div className="mt-1 text-[10px] leading-4 text-muted-foreground">Gemini proposals are opened only after the Risk Engine approves them.</div></div>}
                 <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2.5 text-[10px] ${openTrade ? 'bg-[#177b69]/7 text-[#177b69]' : 'bg-muted text-muted-foreground'}`}><ShieldCheck size={14} /><span>{openTrade ? 'Within risk limits · $5.00 at risk' : 'Flat · ready for one approved trade'}</span></div>
                 <button type="button" onClick={() => setNotice(openTrade ? 'Position management is simulation-only' : 'No open paper trade')} data-testid="button-position-details" className="mt-4 flex w-full items-center justify-center gap-1 rounded-lg border border-border py-2.5 text-[10px] font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground">Position details <ArrowUpRight size={13} /></button>
              </div>
            </section>

            <section className="mt-5 flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5 dashboard-in delay-5">
              <div className="flex items-start gap-3"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><SlidersHorizontal size={15} /></div><div><div className="text-[12px] font-semibold">Paper account controls</div><div className="mt-1 text-[10px] text-muted-foreground" data-testid="status-notice">{notice}</div></div></div>
              <div className="flex gap-2 sm:shrink-0"><button type="button" onClick={() => setNotice('Settings are local to this sandbox')} data-testid="button-risk-settings" className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-[10px] font-semibold transition hover:border-primary/40 hover:text-primary"><SlidersHorizontal size={13} /> Risk settings</button><button type="button" onClick={() => setShowReset(true)} data-testid="button-reset-account" className="flex items-center gap-2 rounded-lg border border-[#c84e3d]/25 px-3 py-2.5 text-[10px] font-semibold text-[#c84e3d] transition hover:bg-[#c84e3d]/7"><RotateCcw size={13} /> Reset account</button></div>
            </section>
          </div>
        </main>
      </div>

      {showReset && <div className="fixed inset-0 z-40 flex items-center justify-center bg-primary/35 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="reset-title" data-testid="dialog-reset-account">
        <div className="w-full max-w-[390px] rounded-2xl border border-border bg-card p-6 shadow-xl dashboard-in">
          <div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#c84e3d]/10 text-[#c84e3d]"><RotateCcw size={18} /></div><button type="button" onClick={() => setShowReset(false)} data-testid="button-close-reset" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"><X size={16} /></button></div>
          <h2 id="reset-title" className="display mt-5 text-[21px] font-semibold tracking-[-.035em]">Reset paper account?</h2>
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">This clears the local simulation history and returns the account to its original <span className="mono text-foreground">$1,000.00</span> virtual balance. No broker or live account is affected.</p>
          <div className="mt-5 flex gap-2"><button type="button" onClick={() => setShowReset(false)} data-testid="button-cancel-reset" className="flex-1 rounded-lg border border-border py-2.5 text-[11px] font-semibold transition hover:bg-muted">Keep account</button><button type="button" onClick={resetAccount} data-testid="button-confirm-reset" className="flex-1 rounded-lg bg-[#c84e3d] py-2.5 text-[11px] font-semibold text-white transition hover:opacity-90">Reset simulation</button></div>
        </div>
      </div>}
    </div>
  );
}
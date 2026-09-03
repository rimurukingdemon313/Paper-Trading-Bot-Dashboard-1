"""Strict, analysis-only risk gate for the paper-trading loop.

This module deliberately has no broker or order-routing dependencies. It
accepts an AI proposal plus the current paper-account snapshot and returns a
decision that the caller must honor before logging an open paper trade.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import asdict, dataclass
from typing import Any, Mapping


ACCOUNT_BALANCE = 1000.0
RISK_PER_TRADE = 0.005
RISK_AMOUNT = 5.0
MAX_OPEN_POSITIONS_PER_SYMBOL = 1
MAX_TOTAL_OPEN_POSITIONS = 6
MAX_DAILY_LOSS = 20.0
MIN_RISK_REWARD = 2.0


@dataclass(frozen=True, slots=True)
class TradeProposal:
    """The minimum trade shape the AI must provide for risk review."""

    decision: str
    entry_price: float | None
    stop_loss: float | None
    take_profit: float | None
    risk_reward_ratio: float | None
    risk_amount: float | None

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "TradeProposal":
        def number(name: str) -> float | None:
            raw = value.get(name)
            if raw is None or raw == "":
                return None
            try:
                result = float(raw)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{name} must be numeric") from exc
            return result if math.isfinite(result) else None

        return cls(
            decision=str(value.get("decision", "NO TRADE")).upper(),
            entry_price=number("entry_price"),
            stop_loss=number("stop_loss"),
            take_profit=number("take_profit"),
            risk_reward_ratio=number("risk_reward_ratio"),
            risk_amount=number("risk_amount"),
        )


@dataclass(frozen=True, slots=True)
class AccountSnapshot:
    """Current paper-account values used by the risk gate."""

    balance: float
    daily_pnl: float
    open_positions: int

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "AccountSnapshot":
        try:
            balance = float(value.get("balance", ACCOUNT_BALANCE))
            daily_pnl = float(value.get("daily_pnl", 0.0))
            open_positions = int(value.get("open_positions", 0))
        except (TypeError, ValueError) as exc:
            raise ValueError("account snapshot contains invalid numeric values") from exc
        if not math.isfinite(balance) or not math.isfinite(daily_pnl):
            raise ValueError("account snapshot values must be finite")
        return cls(balance, daily_pnl, open_positions)


@dataclass(frozen=True, slots=True)
class RiskDecision:
    """The only output a trading loop needs from the risk engine."""

    approved: bool
    state: str
    reasons: tuple[str, ...]
    rules: dict[str, float | int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "approved": self.approved,
            "state": self.state,
            "reasons": list(self.reasons),
            "rules": self.rules,
        }


class RiskEngine:
    """Apply every paper-trading rule with no AI override path."""

    def evaluate(
        self,
        proposal: TradeProposal | Mapping[str, Any],
        account: AccountSnapshot | Mapping[str, Any],
    ) -> RiskDecision:
        candidate = (
            proposal
            if isinstance(proposal, TradeProposal)
            else TradeProposal.from_mapping(proposal)
        )
        snapshot = (
            account
            if isinstance(account, AccountSnapshot)
            else AccountSnapshot.from_mapping(account)
        )
        reasons: list[str] = []

        if candidate.decision not in {"BUY", "SELL"}:
            reasons.append("AI decision is NO TRADE")
        if snapshot.balance <= 0:
            reasons.append("Account balance must be positive")
        if snapshot.open_positions >= MAX_OPEN_POSITIONS_PER_SYMBOL:
            reasons.append(
                f"Open position limit reached for this symbol "
                f"({MAX_OPEN_POSITIONS_PER_SYMBOL} maximum)"
            )
        if snapshot.daily_pnl <= -MAX_DAILY_LOSS:
            reasons.append(
                f"Daily Loss Exceeded: {abs(snapshot.daily_pnl):.2f} is at or above "
                f"the ${MAX_DAILY_LOSS:.2f} limit"
            )

        if candidate.decision in {"BUY", "SELL"}:
            if candidate.risk_amount is None:
                reasons.append("Risk amount is missing; exactly $5.00 is required")
            elif not math.isclose(candidate.risk_amount, RISK_AMOUNT, abs_tol=1e-9):
                reasons.append(
                    f"Risk amount ${candidate.risk_amount:.2f} is not exactly "
                    f"${RISK_AMOUNT:.2f}"
                )

            if candidate.risk_reward_ratio is None:
                reasons.append("Risk/Reward ratio is missing; minimum is 1:2")
            elif candidate.risk_reward_ratio < MIN_RISK_REWARD:
                reasons.append(
                    f"Rejected: RR 1:{candidate.risk_reward_ratio:g} is below min 1:2"
                )

            if (
                candidate.entry_price is None
                or candidate.stop_loss is None
                or candidate.take_profit is None
            ):
                reasons.append(
                    "Entry, stop loss, and take profit are required for risk review"
                )
            elif candidate.decision == "BUY" and not (
                candidate.stop_loss < candidate.entry_price < candidate.take_profit
            ):
                reasons.append(
                    "BUY levels invalid: stop loss < entry < take profit is required"
                )
            elif candidate.decision == "SELL" and not (
                candidate.take_profit < candidate.entry_price < candidate.stop_loss
            ):
                reasons.append(
                    "SELL levels invalid: take profit < entry < stop loss is required"
                )

        rules = {
            "account_balance": ACCOUNT_BALANCE,
            "risk_per_trade": RISK_PER_TRADE,
            "risk_amount": RISK_AMOUNT,
            "max_open_positions_per_symbol": MAX_OPEN_POSITIONS_PER_SYMBOL,
            "max_total_open_positions": MAX_TOTAL_OPEN_POSITIONS,
            "max_daily_loss": MAX_DAILY_LOSS,
            "min_risk_reward": MIN_RISK_REWARD,
        }
        return RiskDecision(
            approved=not reasons,
            state=candidate.decision if not reasons else "NO TRADE",
            reasons=tuple(reasons) if reasons else ("All risk rules passed",),
            rules=rules,
        )


def _main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 risk_engine.py '<json payload>'")
    payload = json.loads(sys.argv[1])
    decision = RiskEngine().evaluate(payload["proposal"], payload["account"])
    print(json.dumps(decision.to_dict()))


if __name__ == "__main__":
    _main()

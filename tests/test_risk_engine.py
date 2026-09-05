from __future__ import annotations

import unittest

from risk_engine import RiskEngine


APPROVED_BUY = {
    "decision": "BUY",
    "entry_price": 100.0,
    "stop_loss": 99.0,
    "take_profit": 102.0,
    "risk_reward_ratio": 2.0,
    "risk_amount": 20.0,  # 2% of the $1000 test account balance
    "confidence": 80,  # above the 75% minimum
}


class RiskEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = RiskEngine()
        self.account = {"balance": 1000, "daily_pnl": 0, "open_positions": 0}

    def test_approves_exactly_compliant_trade(self) -> None:
        result = self.engine.evaluate(APPROVED_BUY, self.account)
        self.assertTrue(result.approved)
        self.assertEqual(result.state, "BUY")

    def test_rejects_rr_below_two(self) -> None:
        proposal = {**APPROVED_BUY, "risk_reward_ratio": 1.5}
        result = self.engine.evaluate(proposal, self.account)
        self.assertFalse(result.approved)
        self.assertEqual(result.state, "NO TRADE")
        self.assertIn("RR 1:1.5 is below min 1:2", result.reasons[0])

    def test_rejects_existing_open_trade(self) -> None:
        result = self.engine.evaluate(
            APPROVED_BUY, {**self.account, "open_positions": 1}
        )
        self.assertFalse(result.approved)
        self.assertTrue(any("Open position limit reached" in reason for reason in result.reasons))

    def test_rejects_daily_loss_limit(self) -> None:
        # 12% of the $1000 test account balance
        result = self.engine.evaluate(
            APPROVED_BUY, {**self.account, "daily_pnl": -120}
        )
        self.assertFalse(result.approved)
        self.assertTrue(any("Daily Loss Exceeded" in reason for reason in result.reasons))

    def test_rejects_risk_amount_not_matching_balance_pct(self) -> None:
        result = self.engine.evaluate(
            {**APPROVED_BUY, "risk_amount": 5.0}, self.account
        )
        self.assertFalse(result.approved)
        self.assertTrue(any("does not match the required" in reason for reason in result.reasons))

    def test_risk_amount_scales_with_balance(self) -> None:
        # Balance doubled to $2000 -> required risk amount doubles to $40
        result = self.engine.evaluate(
            {**APPROVED_BUY, "risk_amount": 40.0},
            {**self.account, "balance": 2000},
        )
        self.assertTrue(result.approved)

    def test_rejects_confidence_below_75(self) -> None:
        result = self.engine.evaluate(
            {**APPROVED_BUY, "confidence": 60}, self.account
        )
        self.assertFalse(result.approved)
        self.assertTrue(any("below the required 75%" in reason for reason in result.reasons))

    def test_rejects_missing_confidence(self) -> None:
        proposal = {k: v for k, v in APPROVED_BUY.items() if k != "confidence"}
        result = self.engine.evaluate(proposal, self.account)
        self.assertFalse(result.approved)
        self.assertTrue(any("below the required 75%" in reason for reason in result.reasons))

    def test_approves_at_exactly_75_confidence(self) -> None:
        result = self.engine.evaluate(
            {**APPROVED_BUY, "confidence": 75}, self.account
        )
        self.assertTrue(result.approved)

    def test_rejects_volatility_spike(self) -> None:
        result = self.engine.evaluate(
            {**APPROVED_BUY, "candle_range": 3.5, "average_range": 1.0},
            self.account,
        )
        self.assertFalse(result.approved)
        self.assertTrue(any("Volatility spike" in reason for reason in result.reasons))

    def test_no_trade_always_remains_no_trade(self) -> None:
        result = self.engine.evaluate(
            {"decision": "NO TRADE"}, self.account
        )
        self.assertFalse(result.approved)
        self.assertEqual(result.state, "NO TRADE")


if __name__ == "__main__":
    unittest.main()

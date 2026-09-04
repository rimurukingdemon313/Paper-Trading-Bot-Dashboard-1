from __future__ import annotations

import unittest

from risk_engine import RiskEngine


APPROVED_BUY = {
    "decision": "BUY",
    "entry_price": 100.0,
    "stop_loss": 99.0,
    "take_profit": 102.0,
    "risk_reward_ratio": 2.0,
    "risk_amount": 5.0,
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
        result = self.engine.evaluate(
            APPROVED_BUY, {**self.account, "daily_pnl": -20}
        )
        self.assertFalse(result.approved)
        self.assertTrue(any("Daily Loss Exceeded" in reason for reason in result.reasons))

    def test_rejects_non_exact_risk_amount(self) -> None:
        result = self.engine.evaluate(
            {**APPROVED_BUY, "risk_amount": 4.99}, self.account
        )
        self.assertFalse(result.approved)
        self.assertTrue(any("not exactly $5.00" in reason for reason in result.reasons))

    def test_no_trade_always_remains_no_trade(self) -> None:
        result = self.engine.evaluate(
            {"decision": "NO TRADE"}, self.account
        )
        self.assertFalse(result.approved)
        self.assertEqual(result.state, "NO TRADE")


if __name__ == "__main__":
    unittest.main()

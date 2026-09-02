"""Run M15 SMC analysis against live EURUSD data or a test fixture."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from analysis_engine import Candle, SMCAnalyzer
from market_data import fetch_live_eur_usd_m15


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fixture",
        action="store_true",
        help="use deterministic verification candles instead of live EURUSD data",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="explicitly request live EURUSD data (the default)",
    )
    args = parser.parse_args()

    if args.fixture:
        fixture = Path(__file__).parent / "analysis_engine" / "fixtures" / "m15_sample.json"
        rows = json.loads(fixture.read_text())
        data_source = "Synthetic verification fixture"
        live = False
    else:
        rows = fetch_live_eur_usd_m15()
        data_source = "Yahoo Finance live chart data"
        live = True

    analysis = SMCAnalyzer().analyze(Candle.from_mapping(row) for row in rows)
    output = analysis.to_dict()
    output.update(
        {
            "symbol": "EURUSD",
            "data_source": data_source,
            "live": live,
            "latest_price": output["latest_candle"]["close"],
        }
    )
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
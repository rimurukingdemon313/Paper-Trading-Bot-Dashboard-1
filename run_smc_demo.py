"""Print the deterministic sample M15 analysis as JSON."""

from __future__ import annotations

import json
from pathlib import Path

from analysis_engine import Candle, SMCAnalyzer


def main() -> None:
    fixture = Path(__file__).parent / "analysis_engine" / "fixtures" / "m15_sample.json"
    rows = json.loads(fixture.read_text())
    analysis = SMCAnalyzer().analyze(Candle.from_mapping(row) for row in rows)
    print(json.dumps(analysis.to_dict(), indent=2))


if __name__ == "__main__":
    main()
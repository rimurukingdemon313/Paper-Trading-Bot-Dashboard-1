"""Free live market-data adapter for the paper-trading SMC loop."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from math import isfinite
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart"

# Symbol -> Yahoo Finance ticker. Add pairs here; everything else in the
# system reads from this map, so this is the single source of truth.
SUPPORTED_SYMBOLS: dict[str, str] = {
    "EURUSD": "EURUSD=X",
    "USDJPY": "USDJPY=X",
    "USDCHF": "USDCHF=X",
    "AUDJPY": "AUDJPY=X",
    "AUDCHF": "AUDCHF=X",
    "XAUUSD": "XAUUSD=X",
}


class MarketDataError(RuntimeError):
    """Raised when the live source cannot provide valid M15 candles."""


def _finite_number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if isfinite(result) else None


def parse_yahoo_chart_payload(
    payload: Mapping[str, Any],
    *,
    symbol: str = "EURUSD",
    timeframe: str = "M15",
    closed_only: bool = False,
) -> list[dict[str, Any]]:
    """Convert Yahoo's chart response into SMC-engine candle mappings."""

    if timeframe.upper() != "M15":
        raise MarketDataError("live market adapter only supports M15")

    chart = payload.get("chart")
    result = chart.get("result") if isinstance(chart, Mapping) else None
    if not isinstance(result, list) or not result or not isinstance(result[0], Mapping):
        error = chart.get("error") if isinstance(chart, Mapping) else None
        raise MarketDataError(f"Yahoo returned no chart data for {symbol}: {error or 'empty result'}")

    chart_result = result[0]
    timestamps = chart_result.get("timestamp")
    indicators = chart_result.get("indicators")
    quotes = indicators.get("quote") if isinstance(indicators, Mapping) else None
    quote = quotes[0] if isinstance(quotes, list) and quotes and isinstance(quotes[0], Mapping) else None
    if not isinstance(timestamps, list) or quote is None:
        raise MarketDataError("Yahoo response is missing timestamps or OHLCV quote data")

    candles: list[dict[str, Any]] = []
    fields = ("open", "high", "low", "close")
    for index, timestamp in enumerate(timestamps):
        values = {field: quote.get(field, [None] * len(timestamps))[index] for field in fields}
        numbers = {field: _finite_number(value) for field, value in values.items()}
        if any(value is None for value in numbers.values()):
            continue
        try:
            timestamp_value = datetime.fromtimestamp(float(timestamp), tz=timezone.utc)
        except (TypeError, ValueError, OverflowError) as exc:
            raise MarketDataError("Yahoo returned an invalid candle timestamp") from exc
        if closed_only and (
            timestamp_value.minute % 15 != 0
            or timestamp_value.second != 0
            or timestamp_value.microsecond != 0
        ):
            continue
        volume_values = quote.get("volume", [])
        volume = _finite_number(volume_values[index]) if index < len(volume_values) else None
        candles.append(
            {
                "timestamp": timestamp_value.isoformat(),
                "timeframe": "M15",
                "open": numbers["open"],
                "high": numbers["high"],
                "low": numbers["low"],
                "close": numbers["close"],
                # Yahoo reports zero/null volume for some FX feeds; preserve
                # the feed value as zero rather than inventing tick volume.
                "volume": volume if volume is not None else 0.0,
            }
        )

    if len(candles) < 7:
        raise MarketDataError(f"Yahoo returned only {len(candles)} valid M15 candles; at least 7 are required")
    return candles


def fetch_live_m15(symbol: str, *, range_value: str = "5d", timeout: int = 20) -> list[dict[str, Any]]:
    """Fetch the latest M15 candles for a supported symbol from Yahoo Finance."""

    normalized = symbol.upper()
    ticker = SUPPORTED_SYMBOLS.get(normalized)
    if ticker is None:
        supported = ", ".join(sorted(SUPPORTED_SYMBOLS))
        raise MarketDataError(f"unsupported symbol {symbol!r}; supported symbols: {supported}")

    query = urlencode(
        {
            "range": range_value,
            "interval": "15m",
            "includePrePost": "false",
            "events": "div,splits",
        }
    )
    request = Request(
        f"{YAHOO_CHART_URL}/{ticker}?{query}",
        headers={"User-Agent": "FieldworkPaperTrading/1.0"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise MarketDataError(f"Yahoo HTTP error {exc.code} for {normalized}") from exc
    except URLError as exc:
        raise MarketDataError(f"Yahoo network error for {normalized}: {exc.reason}") from exc
    except (TimeoutError, json.JSONDecodeError) as exc:
        raise MarketDataError(f"Yahoo returned an unreadable market-data response for {normalized}") from exc

    return parse_yahoo_chart_payload(
        payload,
        symbol=normalized,
        timeframe="M15",
        closed_only=True,
    )


def fetch_live_eur_usd_m15(*, range_value: str = "5d", timeout: int = 20) -> list[dict[str, Any]]:
    """Backward-compatible EURUSD-only helper. Kept so nothing else breaks."""

    return fetch_live_m15("EURUSD", range_value=range_value, timeout=timeout)

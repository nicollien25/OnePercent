# PDYN CRT + MEXC Signal Engine

This package adds a market-data-driven CRT signal monitor to the existing PDYN Discord bot.

## What it does

- MEXC Spot and Futures public market data
- 5m, 15m, 30m, 1h, 4h and 1D candles
- Standard two-candle CRT sweep/re-entry detection
- Closed-candle confirmation only
- Last closed CRT candle price in the alert
- RSI(14)
- Oversold <= 30 and overbought >= 70
- Strong signal when CRT direction agrees with RSI extreme
- Signal deduplication so the same candle is not repeatedly posted
- Existing PDYN Discord channel mapping is preserved
- No MEXC API key is required for public market-data scanning

## Important Rachel_T note

The uploaded PDYN sources do not contain the Rachel_T TradingView indicator source. Therefore this implementation uses the standard CRT interpretation: a signal candle sweeps the previous candle's high/low and closes back inside the previous candle's range.

If the exact Rachel_T Pine Script or TradingView source is provided later, `crtEngine.js` can be changed to reproduce its exact rules.

## Files

- `src/services/crt/crtService.js` - scanner + Discord alerts
- `src/services/crt/mexcService.js` - MEXC market data
- `src/services/crt/crtEngine.js` - CRT + RSI signal logic
- `src/services/crt/rsi.js` - Wilder RSI
- `src/services/crt/signalManager.js` - duplicate protection
- `src/config/bot.js` - CRT configuration integrated into PDYN config
- `src/events/ready.js` - existing ready event, starts the CRT monitor
- `.env.crt.example` - environment variables to copy into your `.env`

## Install

The implementation uses Node 20's built-in `fetch`, so no additional npm dependency is required.

Copy the files into the matching paths in the PDYN repository. Do not replace unrelated PDYN services.

Add the variables from `.env.crt.example` to the existing `.env`.

Then run:

```bash
npm install
npm start
```

## First test recommendation

Do not start by scanning hundreds of markets. Use a small explicit list:

```env
CRT_MARKETS=spot,futures
MEXC_SPOT_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT
MEXC_FUTURES_SYMBOLS=BTC_USDT,ETH_USDT,SOL_USDT
CRT_MAX_SYMBOLS_PER_MARKET=10
CRT_SCAN_INTERVAL_MS=30000
```

Once the bot is stable, increase the symbol list.

## Forex

MEXC Futures can provide market data for futures contracts, but the bot can only scan instruments that MEXC actually exposes. Put any currently listed forex contracts in `MEXC_FUTURES_SYMBOLS` using the exact MEXC symbol, for example:

```env
MEXC_FUTURES_SYMBOLS=EUR_USDT,GBP_USDT,USDJPY_USDT
```

Only use symbols that exist in MEXC's current contract list. The scanner logs discovered contracts at startup/refresh.

## Discord alert

A confirmed signal looks like:

`🟢 CRT BUY • BTC_USDT • 15m`

The embed includes:

- signal price = last closed CRT candle close
- RSI(14)
- RSI state
- CRT high
- CRT low
- market type
- candle timestamp

A CRT + RSI agreement is labeled `STRONG`.

## Railway

The bot is a normal Node.js process. Deploy the existing PDYN repository to Railway and add the environment variables from `.env.crt.example` to Railway Variables. No MEXC API credentials are needed for the public market-data endpoints used here.

## Safety

This package is signal-only. It does not place MEXC orders and does not contain trading credentials.

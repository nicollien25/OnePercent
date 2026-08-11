# Integration checklist

1. Replace `src/config/bot.js` with the included version.
2. Replace `src/events/ready.js` with the included version.
3. Add the included `src/services/crt/` directory.
4. Copy `.env.crt.example` entries into the repository's existing `.env`.
5. Keep MEXC API keys out of GitHub. This signal engine uses public market data only.
6. Start PDYN and look for:
   - `[CRT] Service loaded`
   - `[CRT] Signal monitor started`
   - `[CRT] spot symbols:`
   - `[CRT] futures symbols:`
7. Wait for closed candles before judging signal behavior.

The existing Discord channel IDs from the uploaded `bot.js` are preserved.

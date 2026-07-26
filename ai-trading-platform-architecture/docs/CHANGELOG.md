# Changelog

## v1.0.0 — Initial platform
- Database schema for identity, trading accounts, risk settings, positions, orders, trades, strategies, backtests, watchlist, alerts, notifications, subscriptions, and audit logs.
- Authentication system with bcrypt password hashing and revocable server-side sessions.
- Deterministic synthetic market data engine covering 10 crypto perpetual-style markets.
- Technical indicator library (SMA, EMA, RSI, ATR, Bollinger Bands, MACD, Donchian Channel, drawdown, Sharpe ratio).
- Strategy framework with SMA Crossover, RSI Mean Reversion, Donchian Breakout, and Momentum strategies.
- Backtesting engine with realistic fees/slippage and full performance metrics.
- Risk engine enforcing leverage, position size, open-position count, daily loss, and drawdown limits on every order.
- REST API covering auth, market data, orders, positions, strategies, backtests, risk settings, watchlist, alerts, and admin user directory.
- Full dashboard UI: overview, markets + trading, positions, order history, strategy management, backtest results with equity curve charting, risk settings, price alerts, and an admin console.
- Architecture, decision log, roadmap, and in-app documentation page.

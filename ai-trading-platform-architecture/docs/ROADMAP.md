# Development Roadmap

## Shipped (v1)
- [x] Authentication (register/login/logout, hashed passwords, revocable sessions)
- [x] Paper trading accounts with $100k starting balance
- [x] Deterministic multi-symbol synthetic market data (10 perpetual-style markets)
- [x] Technical indicator library (SMA/EMA/RSI/ATR/Bollinger/MACD/Donchian)
- [x] Strategy framework with 4 strategies across trend/mean-reversion/breakout/momentum
- [x] Backtesting engine with fees, slippage, Sharpe/CAGR/drawdown/win-rate/profit-factor
- [x] Risk engine enforcing leverage, position size, open-position, and drawdown limits
- [x] Order placement, position management (open/close), order history
- [x] Watchlist and price alerts
- [x] Admin console (read-only user directory)
- [x] In-app architecture documentation page

## Near-term (v1.1)
- [ ] Daily realized PnL aggregate to make the daily-loss circuit breaker fully live
- [ ] Strategy "active" mode: scheduled evaluation against latest candles, auto-order placement
- [ ] Notification delivery (in-app bell + email) wired to the existing `notifications` table
- [ ] WebSocket price streaming to replace polling for the ticker and charts
- [ ] Walk-forward validation (rolling train/test windows) in the backtest UI

## Mid-term (v2)
- [ ] Pluggable live `ExchangeAdapter` (Binance/Bybit) behind a feature flag, reusing the exact same strategy/risk/portfolio code paths
- [ ] Multi-account support per user + team/RBAC roles beyond trader/admin
- [ ] Stripe billing integration for Pro/Institutional subscription tiers
- [ ] Strategy optimizer: parameter grid/Bayesian search over backtest metrics
- [ ] Portfolio-level correlation & diversification analytics

## Long-term
- [ ] Kubernetes deployment manifests + horizontal scaling of the market-data/backtest workers
- [ ] Machine-learning-assisted signal research module (only promoted to production after the same out-of-sample validation bar as rule-based strategies)
- [ ] Disaster recovery runbooks + automated failover for exchange connectivity
- [ ] SOC2-oriented audit logging coverage across all mutating endpoints

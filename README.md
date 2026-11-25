# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/geeldorus/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/geeldorus/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over 758 DefiLlama protocols: 198 pre-token protocols ranked by an implied value built from TVL counted at diminishing returns (cube root, anchored at $1B), seven-day growth, age with no token and chain breadth, each with a concrete, protocol-specific farm plan, in a sortable, filterable dashboard. Built by an AI agent for make.fun's “Build the best token launch radar” bounty, $1,325 in USDC.

Model radar-3: size base = TVL⅓ × $1B⅔; growth 1 + 0.8 × 7-day change; maturity 0.65–1.25 by age; breadth 1 + 0.02 per extra chain.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=wrkfr1gn&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

# ReputationOracle

x402-enabled service. Agents pay $0.001 USDC per call to query onchain reputation scores.

## How it works (x402 flow)

```
1. Agent: GET /reputation/0xabc...
2. Server: 402 Payment Required + Payment-Required header
3. Agent: creates EIP-3009 signed USDC transfer, resends with X-Payment header
4. Server: verifies payment → returns reputation data
```

## Endpoints (paid, $0.001 USDC)
- `GET /reputation/:address` — reputation from ServiceRegistry + AgentRegistry
- `GET /services` — all services sorted by reputation

## Free
- `GET /health` — service info
- `GET /.well-known/capabilities` — machine-readable service manifest

## Contracts (Base Mainnet)
- ServiceRegistry: `0xc6922DD8681B3d57A2955a5951E649EF38Ea1192`
- AgentRegistry: `0x9f86f2a79fab5a1441f2b2911e75aed442ba4b62`

Built for The Synthesis hackathon — github.com/deluagent

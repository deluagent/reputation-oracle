/**
 * ReputationOracle — x402-enabled service
 *
 * Agents pay per call to query reputation scores from ServiceRegistry + AgentRegistry.
 * Implements the full x402 payment flow:
 *   1. Agent hits /reputation/:address
 *   2. Server returns 402 + PaymentRequired header
 *   3. Agent pays 0.001 USDC on Base
 *   4. Server verifies via facilitator, returns reputation data
 *
 * This service is registered in ServiceRegistry (id=1).
 */

import express from 'express';
import { createPublicClient, http, formatEther } from 'viem';
import { base } from 'viem/chains';
import { x402Middleware } from './x402.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVICE_REGISTRY = '0xc6922DD8681B3d57A2955a5951E649EF38Ea1192';
const AGENT_REGISTRY   = '0x9f86f2a79fab5a1441f2b2911e75aed442ba4b62';
const RECEIVER         = '0xed2ceca9de162c4f2337d7c1ab44ee9c427709da';
const PORT             = process.env.PORT || 4000;

const client = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
});

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const SERVICE_REGISTRY_ABI = [
  {
    type: 'function', name: 'getService', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'owner', type: 'address' },
        { name: 'name', type: 'string' },
        { name: 'capabilitiesURI', type: 'string' },
        { name: 'pricePerCallWei', type: 'uint256' },
        { name: 'category', type: 'uint8' },
        { name: 'stakedETH', type: 'uint256' },
        { name: 'reputationScore', type: 'uint256' },
        { name: 'totalCalls', type: 'uint256' },
        { name: 'goodResponses', type: 'uint256' },
        { name: 'badResponses', type: 'uint256' },
        { name: 'registeredAt', type: 'uint256' },
        { name: 'active', type: 'bool' },
        { name: 'slashed', type: 'bool' },
      ]
    }]
  },
  {
    type: 'function', name: 'serviceCount', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }]
  },
];

const AGENT_REGISTRY_ABI = [{
  type: 'function', name: 'getAgent', stateMutability: 'view',
  inputs: [{ name: 'agent', type: 'address' }],
  outputs: [{
    type: 'tuple',
    components: [
      { name: 'owner', type: 'address' },
      { name: 'stakedETH', type: 'uint256' },
      { name: 'reputationScore', type: 'uint256' },
      { name: 'completedJobs', type: 'uint256' },
      { name: 'disputedJobs', type: 'uint256' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'lastActiveAt', type: 'uint256' },
      { name: 'slashed', type: 'bool' },
      { name: 'active', type: 'bool' },
      { name: 'metadataURI', type: 'string' },
    ]
  }]
}];

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// x402 payment middleware — gates paid routes
app.use(x402Middleware(RECEIVER, {
  'GET /reputation/:address': 'Onchain reputation score for any address',
  'GET /services': 'All registered services sorted by reputation',
}));

// ─── Free Routes ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    service: 'ReputationOracle',
    version: '1.0.0',
    x402: true,
    price: '$0.001 USDC per call',
    receiver: RECEIVER,
    network: 'base (eip155:8453)',
    contracts: { serviceRegistry: SERVICE_REGISTRY, agentRegistry: AGENT_REGISTRY },
  });
});

app.get('/.well-known/capabilities', (req, res) => {
  res.json({
    name: 'ReputationOracle',
    description: 'Query onchain reputation scores for agents and services on Base',
    version: '1.0.0',
    paymentStandard: 'x402',
    pricePerCall: '$0.001 USDC',
    network: 'base',
    chainId: 8453,
    receiver: RECEIVER,
    endpoints: [
      { path: '/reputation/:address', method: 'GET', description: 'Reputation for any address' },
      { path: '/services', method: 'GET', description: 'All services by reputation' },
    ],
  });
});

// ─── Paid Routes ──────────────────────────────────────────────────────────────

app.get('/reputation/:address', async (req, res) => {
  const { address } = req.params;
  const result = { address, timestamp: Date.now(), serviceRegistry: null, agentRegistry: null };

  // ServiceRegistry lookup
  try {
    const count = await client.readContract({
      address: SERVICE_REGISTRY, abi: SERVICE_REGISTRY_ABI, functionName: 'serviceCount',
    });
    const services = [];
    for (let i = 0n; i < count; i++) {
      const svc = await client.readContract({
        address: SERVICE_REGISTRY, abi: SERVICE_REGISTRY_ABI, functionName: 'getService', args: [i],
      });
      if (svc.owner.toLowerCase() === address.toLowerCase()) {
        services.push({
          id: Number(i), name: svc.name,
          reputationScore: Number(svc.reputationScore),
          reputationPct: (Number(svc.reputationScore) / 100).toFixed(1) + '%',
          totalCalls: Number(svc.totalCalls),
          stakedETH: formatEther(svc.stakedETH),
          active: svc.active, slashed: svc.slashed,
        });
      }
    }
    result.serviceRegistry = { services };
  } catch (e) {
    result.serviceRegistry = { error: e.message };
  }

  // AgentRegistry lookup
  try {
    const agent = await client.readContract({
      address: AGENT_REGISTRY, abi: AGENT_REGISTRY_ABI, functionName: 'getAgent', args: [address],
    });
    result.agentRegistry = agent.active || agent.reputationScore > 0n ? {
      reputationScore: Number(agent.reputationScore),
      reputationPct: (Number(agent.reputationScore) / 100).toFixed(1) + '%',
      completedJobs: Number(agent.completedJobs),
      disputedJobs: Number(agent.disputedJobs),
      stakedETH: formatEther(agent.stakedETH),
      active: agent.active, slashed: agent.slashed,
    } : { registered: false };
  } catch {
    result.agentRegistry = { registered: false };
  }

  // Aggregate
  const scores = [
    ...(result.serviceRegistry?.services?.map(s => s.reputationScore) ?? []),
    ...(result.agentRegistry?.reputationScore ? [result.agentRegistry.reputationScore] : []),
  ];
  result.aggregateScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  result.aggregatePct = result.aggregateScore
    ? (result.aggregateScore / 100).toFixed(1) + '%' : 'unregistered';

  res.json(result);
});

app.get('/services', async (req, res) => {
  try {
    const count = await client.readContract({
      address: SERVICE_REGISTRY, abi: SERVICE_REGISTRY_ABI, functionName: 'serviceCount',
    });
    const services = [];
    for (let i = 0n; i < count; i++) {
      const svc = await client.readContract({
        address: SERVICE_REGISTRY, abi: SERVICE_REGISTRY_ABI, functionName: 'getService', args: [i],
      });
      if (svc.active) services.push({
        id: Number(i), owner: svc.owner, name: svc.name,
        capabilitiesURI: svc.capabilitiesURI,
        pricePerCallETH: formatEther(svc.pricePerCallWei),
        reputationScore: Number(svc.reputationScore),
        reputationPct: (Number(svc.reputationScore) / 100).toFixed(1) + '%',
        totalCalls: Number(svc.totalCalls), stakedETH: formatEther(svc.stakedETH),
      });
    }
    services.sort((a, b) => b.reputationScore - a.reputationScore);
    res.json({ count: services.length, services });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`ReputationOracle :${PORT}`);
  console.log(`x402 — $0.001/call → ${RECEIVER}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

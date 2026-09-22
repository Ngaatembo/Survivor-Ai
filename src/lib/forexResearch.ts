export type ForexSourceType = 'TEMBO_TARGET'|'COMPARABLE'|'RISK'|'MARKET';

export interface ForexResearchFinding {
  query: string;
  title: string;
  snippet: string;
  sourceUrl: string;
  sourceType: ForexSourceType;
}

export interface TemboResearchBridge {
  system: 'TEMBO_FOREX_BOT';
  repository: string;
  repositoryUrl: string;
  currentPhase: 'PHASE_0_ARCHITECTURE';
  executionMode: 'RESEARCH_ONLY';
  liveExecutionEnabled: false;
  brokerAdapterAvailable: false;
  researchPipeline: string[];
  survivorRole: string;
  temboRole: string;
  handoffContract: {
    survivorToTembo: string[];
    temboToSurvivor: string[];
  };
  nextEvidenceGate: string;
}

export interface ForexResearchPackage {
  target: string;
  status: 'FOUND'|'PARTIAL'|'NOT_FOUND';
  findings: ForexResearchFinding[];
  verificationNotes: string[];
  nextStep: string;
  tembo: TemboResearchBridge;
}

const TEMBO_REPO = 'Ngaatembo/Tembo-forex-bot';
const TEMBO_REPO_URL = 'https://github.com/Ngaatembo/Tembo-forex-bot';

export function buildTemboResearchBridge(): TemboResearchBridge {
  return {
    system: 'TEMBO_FOREX_BOT',
    repository: TEMBO_REPO,
    repositoryUrl: TEMBO_REPO_URL,
    currentPhase: 'PHASE_0_ARCHITECTURE',
    executionMode: 'RESEARCH_ONLY',
    liveExecutionEnabled: false,
    brokerAdapterAvailable: false,
    researchPipeline: [
      'market data',
      'data storage',
      'technical/regime analysis',
      'news and macro analysis',
      'AI interpretation',
      'strategy engine',
      'signal engine',
      'risk management',
      'backtesting',
      'paper trading',
      'performance analytics',
    ],
    survivorRole: 'Economic opportunity controller: decide whether forex research is worth another evidence-gathering experiment, preserve evidence, and learn from observed outcomes.',
    temboRole: 'Specialized forex research engine: produce market, strategy, backtest and paper-trading evidence without autonomous live-money execution.',
    handoffContract: {
      survivorToTembo: [
        'research objective',
        'instrument/symbol scope',
        'time window',
        'strategy hypothesis',
        'required validation checks',
      ],
      temboToSurvivor: [
        'market/regime evidence',
        'strategy rules',
        'backtest metrics and assumptions',
        'paper-trading results',
        'risk-gate state',
        'invalidating conditions',
        'evidence sources and timestamps',
      ],
    },
    nextEvidenceGate: 'Do not consider the channel proven until independently reproducible backtest and paper-trading evidence exists after realistic costs and risk checks.',
  };
}

export function classifyForexSource(query: string, title: string): ForexSourceType {
  const s = (query + ' ' + title).toLowerCase();
  if (s.includes('tembo')) return 'TEMBO_TARGET';
  if (s.includes('risk') || s.includes('regulat')) return 'RISK';
  if (s.includes('bot') || s.includes('mt5') || s.includes('forex')) return 'COMPARABLE';
  return 'MARKET';
}

export function buildForexResearchPackage(findings: ForexResearchFinding[]): ForexResearchPackage {
  const target = findings.filter((x) => x.sourceType === 'TEMBO_TARGET');
  const tembo = buildTemboResearchBridge();

  return {
    target: 'Tembo Forex Bot',
    status: target.length ? 'FOUND' : findings.length ? 'PARTIAL' : 'NOT_FOUND',
    findings: findings.slice(0, 30),
    verificationNotes: target.length
      ? [
          'Live research found references containing “Tembo”. Survivor must still verify that each reference refers to the intended Tembo system.',
          'The connected Tembo repository is the source of truth for its implementation status; Survivor must not infer completed trading features from search results.',
        ]
      : [
          'No independently verified Tembo reference was found in the current live research set.',
          'The known Tembo repository is still treated as the implementation source of truth; Survivor must not invent specifications, performance or ownership.',
        ],
    nextStep: 'Use the Tembo research contract: validate strategy rules, backtests and paper-trading evidence first; keep live-money execution disabled.',
    tembo,
  };
}

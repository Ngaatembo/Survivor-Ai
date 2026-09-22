export interface ForexResearchFinding {
  query: string; title: string; snippet: string; sourceUrl: string;
  sourceType: 'TEMBO_TARGET'|'COMPARABLE'|'RISK'|'MARKET';
}
export interface ForexResearchPackage {
  target: string; status: 'FOUND'|'PARTIAL'|'NOT_FOUND'; findings: ForexResearchFinding[];
  verificationNotes: string[]; nextStep: string;
}
export function classifyForexSource(query:string,title:string): ForexResearchFinding['sourceType'] {
  const s=(query+' '+title).toLowerCase();
  if(s.includes('tembo')) return 'TEMBO_TARGET';
  if(s.includes('risk')||s.includes('regulat')) return 'RISK';
  if(s.includes('bot')||s.includes('mt5')||s.includes('forex')) return 'COMPARABLE';
  return 'MARKET';
}
export function buildForexResearchPackage(findings: ForexResearchFinding[]): ForexResearchPackage {
  const target=findings.filter(x=>x.sourceType==='TEMBO_TARGET');
  return {
    target:'Tembo Forex Bot',status:target.length?'FOUND':findings.length?'PARTIAL':'NOT_FOUND',findings:findings.slice(0,30),
    verificationNotes:target.length
      ? ['Tembo references were found in live research; Survivor must verify that the source actually refers to the intended forex bot before treating it as the same product.']
      : ['No independently verified Tembo Forex Bot source was found in the current research set. Do not invent specifications, performance or ownership.'],
    nextStep:'Compare any identified strategy/rules with backtesting and paper-trading evidence before any real-money decision.'
  };
}

  const prospects = useStore((s) => s.prospects);
  const offers = useStore((s) => s.offers);
  const projects = useStore((s) => s.projects);
  const realRevenue = useStore((s) => s.realRevenue);
  const actions = useStore((s) => s.actions);
  const backendConnected = useStore((s) => s.backend.connected);
  const economicEfficiency = useStore((s) => s.economicEfficiency);
  const incomeIntelligence = useStore((s) => s.incomeIntelligence);
  const researchIncomeChannels = useStore((s) => s.researchIncomeChannels);
  const backendSyncing = useStore((s) => s.backend.syncing);
  const [finivex, setFinivex] = useState<{ configured: boolean; canCreatePaymentLinks: boolean; note: string } | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentForm, setPaymentForm] = useState({ clientName: '', amount: '', description: '', paymentMethod: 'OTHER' as PaymentRequest['payment_method'] });
  const [channelBusy, setChannelBusy] = useState<string | null>(null);
  const [windsor, setWindsor] = useState<WindsorIncomeSummary | null>(null);
  const [windsorBusy, setWindsorBusy] = useState(false);
  const [channelResults, setChannelResults] = useState<Record<string, typeof incomeIntelligence>>({});
  const [strategy, setStrategy] = useState<IncomeStrategyResponse | null>(null);
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [selectedPlanKind, setSelectedPlanKind] = useState<string | null>(null);
  const runChannelResearch = async (channel: string) => {
    if (!backendConnected || channelBusy) return;
    setChannelBusy(channel);
    try {
      const result = await apiResearchIncomeChannels(channel);
      setChannelResults((current) => ({ ...current, [channel]: result.opportunities.filter((o) => o.channel === channel).slice(0, 8) }));
    } catch (e) {
      setPaymentError((e as Error).message);
    } finally {
      setChannelBusy(null);
    }
  };

  const runChannelStrategy = async (kind: string) => {
    if (!backendConnected || strategyBusy) return;
    setStrategyBusy(true);
    try {
      const result = await fetchIncomeStrategy(kind);
      setSelectedPlanKind(kind);
      setStrategy((current) => {
        if (!current) return result;
        const next = [...current.strategies];
        for (const item of result.strategies) {
          const index = next.findIndex((s) => s.kind === item.kind);
          if (index >= 0) next[index] = item;
          else next.push(item);
        }
        return { ...current, generatedAt: result.generatedAt, strategies: next, evidence: [...current.evidence, ...result.evidence], forex: result.forex };
      });
    } catch (e) { setPaymentError((e as Error).message); }
    finally { setStrategyBusy(false); }
  };

  const refreshStrategy = async () => {
    if (!backendConnected) return;
    setStrategyBusy(true);
export type WindsorConnector =
  | 'searchconsole'
  | 'googleanalytics4'
  | 'facebook_organic'
  | 'instagram'
  | 'tiktok_organic'
  | 'youtube'
  | 'linkedin_organic';

export type WindsorConfig = {
  apiKey?: string;
  accounts?: Partial<Record<WindsorConnector, string>>;
  baseUrl?: string;
};

export type WindsorMetricRow = Record<string, unknown>;

const DEFAULT_BASE_URL = 'https://connectors.windsor.ai';

function csv(values: string[]) {
  return values.filter(Boolean).join(',');
}

async function query(
  config: WindsorConfig,
  connector: WindsorConnector,
  fields: string[],
  datePreset = 'last_30d',
): Promise<WindsorMetricRow[]> {
  if (!config.apiKey) throw new Error('WINDSOR_API_KEY is not configured');

  const params = new URLSearchParams({
    api_key: config.apiKey,
    fields: csv(fields),
    date_preset: datePreset,
    _renderer: 'json',
  });

  const account = config.accounts?.[connector];
  if (account) params.set('select_accounts', account);

  const response = await fetch(
    `${config.baseUrl ?? DEFAULT_BASE_URL}/${connector}?${params.toString()}`,
    { headers: { accept: 'application/json', 'user-agent': 'Survivor-Ai/1.0' } },
  );

  const body = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    if (response.status === 429) {
      throw new Error(
        `RATE_LIMITED: ${connector} returned HTTP 429. Windsor or the upstream source has temporarily throttled requests.` +
        (retryAfter ? ` Retry-After: ${retryAfter}.` : ' Retry later; Survivor will not retry aggressively.')
      );
    }
    throw new Error(body?.error ?? `Windsor ${connector} returned HTTP ${response.status}`);
  }

  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.results)) return body.results;
  return [];
}

export async function getWindsorIncomeSummary(config: WindsorConfig) {
  const errors: Record<string, string> = {};
  const result: Record<string, any> = {};

  const jobs: Array<[WindsorConnector, string[], string]> = [
    ['searchconsole', ['date', 'site', 'query', 'page', 'clicks', 'impressions', 'ctr', 'position'], 'searchConsole'],
    ['googleanalytics4', ['date', 'account_name', 'sessions', 'active_users', 'engaged_sessions', 'conversions', 'total_revenue'], 'analytics'],
    ['facebook_organic', ['date', 'account_name', 'page_fans', 'page_daily_follows', 'page_daily_unfollows', 'page_actions_post_reactions_total'], 'facebook'],
    ['instagram', ['date', 'account_name', 'follower_count_1d', 'accounts_engaged', 'comments', 'likes', 'shares', 'saves'], 'instagram'],
    ['tiktok_organic', ['date', 'account_name', 'followers_count', 'engaged_audience', 'likes', 'comments', 'shares', 'video_views'], 'tiktok'],
    ['youtube', ['date', 'account_id', 'account_name', 'video_title', 'views', 'likes', 'comments', 'shares', 'subscribers_gained', 'estimated_minutes_watched'], 'youtube'],
    ['linkedin_organic', ['date', 'organization_id', 'organization_name', 'page_followers', 'page_daily_follows', 'page_daily_unfollows', 'all_page_views', 'comments', 'likes', 'shares'], 'linkedin'],
  ];

  await Promise.all(jobs.map(async ([connector, fields, key]) => {
    try {
      result[key] = await query(config, connector, fields);
    } catch (e) {
      errors[key] = (e as Error).message;
      result[key] = [];
    }
  }));

  return {
    configured: Boolean(config.apiKey),
    generatedAt: new Date().toISOString(),
    datePreset: 'last_30d',
    data: result,
    errors,
  };
}

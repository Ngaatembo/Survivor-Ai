import type { MarketContext } from '../types';

export const MARKET_CONTEXTS: MarketContext[] = [
  {
    id: 'ZW',
    countryCode: 'ZW',
    countryName: 'Zimbabwe',
    currency: 'USD',
    languages: ['English', 'Shona', 'Ndebele'],
    paymentMethods: ['EcoCash', 'OneMoney', 'InnBucks', 'O-mari', 'Bank transfer', 'Card'],
    active: true,
  },
  {
    id: 'ZA',
    countryCode: 'ZA',
    countryName: 'South Africa',
    currency: 'ZAR',
    languages: ['English'],
    paymentMethods: ['Bank transfer', 'Card', 'Instant EFT', 'Mobile payment'],
    active: false,
  },
  {
    id: 'GB',
    countryCode: 'GB',
    countryName: 'United Kingdom',
    currency: 'GBP',
    languages: ['English'],
    paymentMethods: ['Bank transfer', 'Card', 'Direct Debit'],
    active: false,
  },
];

export const DEFAULT_MARKET_ID = 'ZW';

export function getMarketContext(id = DEFAULT_MARKET_ID): MarketContext {
  return MARKET_CONTEXTS.find((market) => market.id === id) ?? MARKET_CONTEXTS[0];
}

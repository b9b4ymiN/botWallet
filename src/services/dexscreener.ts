import axios from "axios";

export interface DexTokenInfo {
  address: string;
  name: string;
  symbol: string;
}

export interface Pair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  pairCreatedAt?: number;
  baseToken: DexTokenInfo;
  quoteToken: DexTokenInfo;
  priceNative?: string;
  priceUsd?: string;
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
}

interface DexScreenerResponse {
  pairs: Pair[];
}

export const getDexScreener = async (
  mintAddress: string
): Promise<Pair | null> => {
  try {
    const link_api = `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`;
    const { data } = await axios.get<DexScreenerResponse>(link_api);
    return data?.pairs?.[0] ?? null;
  } catch (err) {
    return null;
  }
};

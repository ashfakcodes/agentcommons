export class BnbPriceService {
  private cachedPrice: number;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 60_000; // Cache price for 60 seconds

  constructor(private fallbackPrice: number = 650) {
    this.cachedPrice = fallbackPrice;
  }

  public async getBnbPriceUsd(): Promise<number> {
    const now = Date.now();
    if (now - this.lastFetchTime < this.CACHE_TTL_MS && this.cachedPrice > 0) {
      return this.cachedPrice;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT", {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = (await res.json()) as { price?: string };
        const price = parseFloat(data.price || "0");
        if (!isNaN(price) && price > 0) {
          this.cachedPrice = price;
          this.lastFetchTime = now;
          return price;
        }
      }
    } catch {
      // Safe fallback if offline or sandboxed
    }

    return this.cachedPrice || this.fallbackPrice;
  }
}

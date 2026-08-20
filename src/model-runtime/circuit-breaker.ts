export class ModelCircuitBreaker {
  private failures: number[] = []
  private openUntil = 0
  private halfOpenProbeActive = false

  constructor(
    private readonly failureThreshold = 5,
    private readonly windowMs = 60_000,
    private readonly cooldownMs = 15_000,
  ) {}

  beforeRequest(now = Date.now()): void {
    if (now < this.openUntil) throw new Error("MODEL_PROVIDER_CIRCUIT_OPEN")
    if (this.openUntil > 0 && !this.halfOpenProbeActive) {
      this.halfOpenProbeActive = true
      return
    }
    if (this.openUntil > 0 && this.halfOpenProbeActive) throw new Error("MODEL_PROVIDER_CIRCUIT_HALF_OPEN")
  }

  recordSuccess(): void {
    this.failures = []
    this.openUntil = 0
    this.halfOpenProbeActive = false
  }

  recordRetriableFailure(now = Date.now()): void {
    this.halfOpenProbeActive = false
    this.failures = this.failures.filter((value) => now - value <= this.windowMs)
    this.failures.push(now)
    if (this.failures.length >= this.failureThreshold) this.openUntil = now + this.cooldownMs
  }
}

export const sharedModelCircuitBreaker = new ModelCircuitBreaker()

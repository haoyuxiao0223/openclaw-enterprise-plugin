import type { HealthChecker, HealthProbe, HealthReport, ProbeResult } from "./health-checker.ts";

export class HealthCheckerImpl implements HealthChecker {
  private probes = new Map<string, HealthProbe>();
  private startTime = Date.now();

  registerProbe(name: string, probe: HealthProbe): void {
    this.probes.set(name, probe);
  }

  async check(): Promise<HealthReport> {
    const probeResults: Record<string, ProbeResult> = {};
    let worstStatus: HealthReport["status"] = "healthy";

    for (const [name, probe] of this.probes) {
      const result = await this.checkProbe(name);
      probeResults[name] = result;
      if (!result.healthy) {
        worstStatus = "unhealthy";
      }
    }

    return {
      status: worstStatus,
      version: "0.1.0",
      uptime: Date.now() - this.startTime,
      probes: probeResults,
      timestamp: new Date(),
    };
  }

  async checkProbe(name: string): Promise<ProbeResult> {
    const probe = this.probes.get(name);
    if (!probe) {
      return { healthy: false, latencyMs: 0, message: `Probe '${name}' not found` };
    }

    const start = Date.now();
    try {
      const result = await probe.check();
      return result;
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: `Probe failed: ${String(err)}`,
      };
    }
  }
}

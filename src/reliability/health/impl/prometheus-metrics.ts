/**
 * Prometheus metrics provider — exposes openclaw_* metrics.
 *
 * Pre-defined metrics:
 *   openclaw_api_requests_total (Counter)
 *   openclaw_api_request_duration_seconds (Histogram)
 *   openclaw_queue_depth (Gauge)
 *   openclaw_circuit_breaker_state (Gauge)
 *   openclaw_audit_events_total (Counter)
 */

import promClient from "prom-client";

export interface MetricsProvider {
  counter(name: string, help: string, labels?: string[]): CounterMetric;
  histogram(name: string, help: string, buckets?: number[]): HistogramMetric;
  gauge(name: string, help: string): GaugeMetric;
  serialize(): Promise<string>;
}

export interface CounterMetric {
  inc(labels?: Record<string, string>, value?: number): void;
}

export interface HistogramMetric {
  observe(labels: Record<string, string>, value: number): void;
}

export interface GaugeMetric {
  set(value: number): void;
  inc(value?: number): void;
  dec(value?: number): void;
}

export class PrometheusMetricsProvider implements MetricsProvider {
  private registry = new promClient.Registry();

  constructor() {
    promClient.collectDefaultMetrics({ register: this.registry });
  }

  counter(name: string, help: string, labelNames?: string[]): CounterMetric {
    const counter = new promClient.Counter({
      name: `openclaw_${name}`,
      help,
      labelNames: labelNames ?? [],
      registers: [this.registry],
    });
    return {
      inc: (labels, value = 1) => counter.inc(labels ?? {}, value),
    };
  }

  histogram(name: string, help: string, buckets?: number[]): HistogramMetric {
    const hist = new promClient.Histogram({
      name: `openclaw_${name}`,
      help,
      buckets: buckets ?? [0.01, 0.05, 0.1, 0.5, 1, 5, 10],
      labelNames: ["method", "path", "status"],
      registers: [this.registry],
    });
    return {
      observe: (labels, value) => hist.observe(labels, value),
    };
  }

  gauge(name: string, help: string): GaugeMetric {
    const gauge = new promClient.Gauge({
      name: `openclaw_${name}`,
      help,
      registers: [this.registry],
    });
    return {
      set: (value) => gauge.set(value),
      inc: (value = 1) => gauge.inc(value),
      dec: (value = 1) => gauge.dec(value),
    };
  }

  async serialize(): Promise<string> {
    return this.registry.metrics();
  }
}

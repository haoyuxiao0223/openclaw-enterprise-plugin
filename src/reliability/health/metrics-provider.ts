export interface CounterMetric {
  inc(value?: number): void;
}

export interface HistogramMetric {
  observe(value: number): void;
}

export interface GaugeMetric {
  set(value: number): void;
  inc(value?: number): void;
  dec(value?: number): void;
}

export interface MetricsProvider {
  counter(name: string, labels?: Record<string, string>): CounterMetric;
  histogram(name: string, buckets?: number[], labels?: Record<string, string>): HistogramMetric;
  gauge(name: string, labels?: Record<string, string>): GaugeMetric;
  serialize(): Promise<string>;
}

const noopCounter: CounterMetric = { inc() {} };
const noopHistogram: HistogramMetric = { observe() {} };
const noopGauge: GaugeMetric = {
  set() {},
  inc() {},
  dec() {},
};

export class NoopMetricsProvider implements MetricsProvider {
  counter(_name: string, _labels?: Record<string, string>): CounterMetric {
    return noopCounter;
  }

  histogram(
    _name: string,
    _buckets?: number[],
    _labels?: Record<string, string>,
  ): HistogramMetric {
    return noopHistogram;
  }

  gauge(_name: string, _labels?: Record<string, string>): GaugeMetric {
    return noopGauge;
  }

  async serialize(): Promise<string> {
    return "";
  }
}

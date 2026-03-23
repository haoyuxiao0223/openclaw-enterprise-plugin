export interface NetworkPolicyProvider {
  applyPolicy(instanceId: string, spec: NetworkPolicySpec): Promise<void>;
  removePolicy(instanceId: string): Promise<void>;
  checkEgress(instanceId: string, host: string, port: number): Promise<boolean>;
}

export interface NetworkPolicySpec {
  mode: "none" | "allowlist" | "full";
  allowedHosts?: string[];
  allowedPorts?: number[];
}

export class NoopNetworkPolicy implements NetworkPolicyProvider {
  async applyPolicy(_instanceId: string, _spec: NetworkPolicySpec): Promise<void> {}

  async removePolicy(_instanceId: string): Promise<void> {}

  async checkEgress(_instanceId: string, _host: string, _port: number): Promise<boolean> {
    return true;
  }
}

export class AllowlistNetworkPolicy implements NetworkPolicyProvider {
  private readonly policies = new Map<string, NetworkPolicySpec>();

  async applyPolicy(instanceId: string, spec: NetworkPolicySpec): Promise<void> {
    this.policies.set(instanceId, spec);
  }

  async removePolicy(instanceId: string): Promise<void> {
    this.policies.delete(instanceId);
  }

  async checkEgress(instanceId: string, host: string, port: number): Promise<boolean> {
    const spec = this.policies.get(instanceId);
    if (!spec) {
      return false;
    }
    if (spec.mode === "full") {
      return true;
    }
    if (spec.mode === "none") {
      return false;
    }
    const hosts = spec.allowedHosts ?? [];
    if (!hosts.includes(host)) {
      return false;
    }
    const ports = spec.allowedPorts;
    if (ports && ports.length > 0 && !ports.includes(port)) {
      return false;
    }
    return true;
  }
}

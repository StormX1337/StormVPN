import type { ProviderType } from '@stormvpn/database';
import { serviceUnavailable } from '../../lib/errors';
import type { VPNProvider } from './vpn-provider';

export class ProviderRegistry {
  private readonly providers = new Map<ProviderType, VPNProvider>();

  register(provider: VPNProvider): this {
    this.providers.set(provider.type, provider);
    return this;
  }

  get(type: ProviderType): VPNProvider {
    const provider = this.providers.get(type);
    if (!provider || !provider.isConfigured()) {
      throw serviceUnavailable('provider_unavailable', 'This location is currently not available');
    }
    return provider;
  }

  list(): VPNProvider[] {
    return [...this.providers.values()];
  }
}

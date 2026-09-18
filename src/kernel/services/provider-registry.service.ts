import { Injectable, Logger } from '@nestjs/common';
import { SentimentProvider, EscalationPolicy, DomainNotifier } from '../../contracts';

export interface DomainPlugins {
    sentimentProvider: SentimentProvider;
    escalationPolicy: EscalationPolicy;
    domainNotifier: DomainNotifier;
}

@Injectable()
export class ProviderRegistry {
    private readonly logger = new Logger(ProviderRegistry.name);
    private readonly registry = new Map<string, DomainPlugins>();

    register(domain: string, plugins: DomainPlugins) {
        this.logger.log(`Registering plugins for domain: ${domain}`);
        this.registry.set(domain.toLowerCase(), plugins);
    }

    getPlugins(domain: string): DomainPlugins | undefined {
        return this.registry.get(domain.toLowerCase());
    }

    getDomains(): string[] {
        return Array.from(this.registry.keys());
    }
}

import { JanmasethuRepository } from '../janmasethu.repository';

export class ContextExtractor {
    constructor(private readonly repository: JanmasethuRepository) { }

    async extract(threadId: string): Promise<string> {
        const messages = await this.repository.findRecentMessages(threadId, 5);
        return messages
            .map((m) => `${m.sender_type}: ${m.content}`)
            .join('\n');
    }
}

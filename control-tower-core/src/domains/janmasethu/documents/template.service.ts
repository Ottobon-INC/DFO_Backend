import { Injectable, Logger } from '@nestjs/common';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TemplateService {
    private readonly logger = new Logger(TemplateService.name);

    /**
     * Renders an HTML template with the provided data.
     */
    async renderTemplate(templateName: string, data: any): Promise<string> {
        const candidatePaths = [
            path.join(process.cwd(), 'dist', 'domains', 'janmasethu', 'documents', 'templates', `${templateName}.html`),
            path.join(process.cwd(), 'dist', 'src', 'domains', 'janmasethu', 'documents', 'templates', `${templateName}.html`),
            path.join(__dirname, 'templates', `${templateName}.html`),
            path.join(process.cwd(), 'src', 'domains', 'janmasethu', 'documents', 'templates', `${templateName}.html`),
        ];

        let filePath = candidatePaths.find(p => fs.existsSync(p));

        if (!filePath) {
            this.logger.error(`Template not found among checked locations: ${candidatePaths.join(', ')}`);
            throw new Error(`Template not found: ${templateName}.html`);
        }

        const templateSource = fs.readFileSync(filePath, 'utf8');
        const template = handlebars.compile(templateSource);

        return template(data);
    }
}

import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer-core';
import { platform } from 'os';

@Injectable()
export class PdfService {
    private readonly logger = new Logger(PdfService.name);

    /**
     * Converts HTML string to a PDF Buffer.
     */
    async generatePdf(html: string): Promise<Buffer> {
        let browser;
        try {
            // Attempt to find a local browser install
            const executablePath = this.getExecutablePath();
            this.logger.log(`Launching browser from: ${executablePath}`);

            browser = await puppeteer.launch({
                executablePath,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });

            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle2' });

            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '20px',
                    right: '20px',
                    bottom: '20px',
                    left: '20px',
                },
            });

            return Buffer.from(pdfBuffer);
        } catch (error) {
            this.logger.error(`Failed to generate PDF: ${error.message}`);
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    private getExecutablePath(): string {
        const plat = platform();
        if (plat === 'win32') {
            return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        } else if (plat === 'linux') {
            return '/usr/bin/google-chrome';
        } else if (plat === 'darwin') {
            return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        }
        throw new Error(`Platform ${plat} not supported for PDF generation automatically. Please provide an executablePath.`);
    }
}

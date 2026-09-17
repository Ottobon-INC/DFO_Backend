import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer-core';
import { platform } from 'os';

import * as fs from 'fs';
import * as path from 'path';

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
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
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
        if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            return process.env.PUPPETEER_EXECUTABLE_PATH;
        }

        const plat = platform();
        if (plat === 'win32') {
            const candidates = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            ].filter(Boolean);
            for (const p of candidates) {
                if (fs.existsSync(p)) return p;
            }
            return candidates[0];
        } else if (plat === 'linux') {
            const candidates = [
                process.env.PUPPETEER_EXECUTABLE_PATH,
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
            ].filter(Boolean) as string[];
            for (const p of candidates) {
                if (fs.existsSync(p)) return p;
            }
            return '/usr/bin/chromium';
        } else if (plat === 'darwin') {
            return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        }
        throw new Error(`Platform ${plat} not supported for PDF generation automatically. Please provide an executablePath.`);
    }
}

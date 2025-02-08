import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { WeChatScraper } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BatchProcessor {
    constructor() {
        this.progressFile = path.join(__dirname, '..', 'data', 'progress.json');
        this.batchSize = 10; // Process 10 articles per run
        this.maxRetries = 3; // Maximum number of retries per article
        this.retryDelay = 5000; // 5 seconds between retries
        this.maxRunTime = 8 * 60 * 1000; // 8 minutes maximum run time
        this.startTime = Date.now();
        this.scraper = new WeChatScraper();
    }

    async initialize() {
        await fs.ensureDir(path.dirname(this.progressFile));
        
        if (!await fs.pathExists(this.progressFile)) {
            // Initialize progress file
            await fs.writeJson(this.progressFile, {
                lastProcessedId: null,
                totalArticles: 0,
                processedCount: 0,
                remainingCount: 0,
                lastUpdate: new Date().toISOString()
            }, { spaces: 2 });
        }
    }

    async loadProgress() {
        return await fs.readJson(this.progressFile);
    }

    async saveProgress(progress) {
        progress.lastUpdate = new Date().toISOString();
        await fs.writeJson(this.progressFile, progress, { spaces: 2 });
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async processWithRetry(fn, retries = 0) {
        try {
            return await fn();
        } catch (error) {
            if (retries < this.maxRetries) {
                console.log(`Retry attempt ${retries + 1} after error:`, error.message);
                await this.sleep(this.retryDelay);
                return this.processWithRetry(fn, retries + 1);
            }
            throw error;
        }
    }

    isTimeExceeded() {
        return Date.now() - this.startTime > this.maxRunTime;
    }

    async processBatch() {
        await this.initialize();
        let progress = await this.loadProgress();
        console.log('Current progress:', {
            processedCount: progress.processedCount,
            remainingCount: progress.remainingCount,
            totalArticles: progress.totalArticles,
            lastProcessedId: progress.lastProcessedId
        });

        try {
            // If we haven't started yet, get the total count
            if (!progress.totalArticles) {
                const firstBatch = await this.scraper.fetchArticles(0, 1);
                const publishPage = JSON.parse(firstBatch.publish_page);
                progress.totalArticles = publishPage.total_count;
                progress.remainingCount = progress.totalArticles;
                await this.saveProgress(progress);
            }

            // Calculate where to start
            const begin = progress.processedCount;
            console.log(`Processing batch starting from article ${begin}`);

            // Fetch and process batch
            const data = await this.processWithRetry(() => 
                this.scraper.fetchArticles(begin, this.batchSize)
            );
            const publishPage = JSON.parse(data.publish_page);

            for (const item of publishPage.publish_list) {
                if (this.isTimeExceeded()) {
                    console.log('Time limit exceeded, stopping batch processing');
                    return true; // indicate there's more to process
                }

                const articles = this.scraper.parseArticleInfo(item.publish_info);
                await this.processWithRetry(() => this.scraper.updateArchive(articles));
                
                console.log(`Processed article batch: ${articles.map(a => a.id).join(', ')}`);
                console.log(`Article titles: ${articles.map(a => a.title).join(', ')}`);

                
                // Update progress
                progress.processedCount += articles.length;
                progress.remainingCount = progress.totalArticles - progress.processedCount;
                progress.lastProcessedId = articles[articles.length - 1].id;
                await this.saveProgress(progress);
            }

            console.log(`Batch complete. Processed ${progress.processedCount}/${progress.totalArticles} articles`);
            
            // Return true if there are more articles to process
            return progress.remainingCount > 0;

        } catch (error) {
            console.error('Error processing batch:', error);
            throw error;
        }
    }
}

// Main execution
const processor = new BatchProcessor();
processor.processBatch().catch(console.error);

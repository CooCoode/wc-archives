import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { SiteGenerator } from './generate-site.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BatchProcessor {
    constructor() {
        this.progressFile = path.join(__dirname, '..', 'data', 'progress.json');
        this.archiveFile = path.join(__dirname, '..', 'data', 'archive.json');
        this.batchSize = 10; // Process 10 articles per run
        this.maxRetries = 3; // Maximum number of retries per article
        this.retryDelay = 5000; // 5 seconds between retries
        this.maxRunTime = 8 * 60 * 1000; // 8 minutes maximum run time
        this.startTime = Date.now();
        this.generator = new SiteGenerator();
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

        try {
            // Load the archive file to get the list of articles
            const archive = await fs.readJson(this.archiveFile);
            const articles = archive.articles;

            // If we haven't started yet, initialize progress
            if (!progress.totalArticles) {
                progress.totalArticles = articles.length;
                progress.remainingCount = articles.length;
                progress.processedCount = 0;
                await this.saveProgress(progress);
            }

            console.log('Current progress:', {
                processedCount: progress.processedCount,
                remainingCount: progress.remainingCount,
                totalArticles: progress.totalArticles,
                lastProcessedId: progress.lastProcessedId
            });

            // Get the batch of articles to process
            const startIndex = progress.processedCount;
            const endIndex = Math.min(startIndex + this.batchSize, progress.totalArticles);
            const batch = articles.slice(startIndex, endIndex);

            console.log(`Processing batch from index ${startIndex} to ${endIndex}`);

            // Process each article in the batch
            for (const article of batch) {
                if (this.isTimeExceeded()) {
                    console.log('Time limit exceeded, stopping batch processing');
                    return true; // indicate there's more to process
                }

                try {
                    await this.processWithRetry(() => this.generator.generateArticlePage(article));
                    console.log(`Generated page for article: ${article.id} - ${article.title}`);

                    // Update progress
                    progress.processedCount++;
                    progress.remainingCount--;
                    progress.lastProcessedId = article.id;
                    await this.saveProgress(progress);
                } catch (error) {
                    console.error(`Error generating page for article ${article.id}:`, error);
                    // Continue with next article even if one fails
                }
            }

            // Generate index page if we've processed all articles
            if (progress.remainingCount === 0) {
                await this.generator.generateIndexPage(articles);
                console.log('Generated index page');
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

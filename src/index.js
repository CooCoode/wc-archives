import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dayjs from 'dayjs';
import winston from 'winston';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';

// Custom error for invalid session
class InvalidSessionError extends Error {
    constructor(message = 'API error: invalid session') {
        super(message);
        this.name = 'InvalidSessionError';
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

class WeChatScraper {
    constructor() {
        // Load environment variables
        const envPath = path.join(__dirname, '..', '.env');
        dotenv.config({ path: envPath });

        this.bizId = process.env.WECHAT_BIZ_ID;
        this.token = process.env.WECHAT_TOKEN;
        this.cookie = process.env.WECHAT_COOKIE;
        
        if (!this.bizId || !this.token || !this.cookie) {
            throw new Error('Missing required environment variables');
        }

        this.baseUrl = 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish';
        this.outputDir = path.join(__dirname, '..', 'data');
        this.articlesDir = path.join(this.outputDir, 'articles');
        this.archiveFile = path.join(this.outputDir, 'archive.json');

        // Configure axios defaults
        this.axiosInstance = axios.create({
            headers: {
                'Cookie': this.cookie,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Referer': 'https://mp.weixin.qq.com/',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Host': 'mp.weixin.qq.com',
                'Origin': 'https://mp.weixin.qq.com',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
                'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"macOS"'
            },
            maxRedirects: 5,
            timeout: 10000
        });
    }

    async initialize() {
        await fs.ensureDir(this.outputDir);
        await fs.ensureDir(this.articlesDir);
        
        // Initialize archive if it doesn't exist
        if (!await fs.pathExists(this.archiveFile)) {
            await fs.writeJson(this.archiveFile, {
                lastUpdate: null,
                articles: []
            });
        }
    }

    async fetchArticles(begin = 0, count = 5) {
        try {
            // Using URLSearchParams to exactly match the working URL format
            const params = new URLSearchParams({
                sub: 'list',
                search_field: 'null',
                begin: begin.toString(),
                count: count.toString(),
                query: '',
                fakeid: this.bizId,
                type: '101_1',
                free_publish_type: '1',
                sub_action: 'list_ex',
                token: this.token,
                lang: 'zh_CN',
                f: 'json',
                ajax: '1'
            });

            const response = await this.axiosInstance.get(
                `${this.baseUrl}?${params.toString()}`,
                {
                    headers: {
                        'Accept': '*/*',
                        'Host': 'mp.weixin.qq.com',
                        'Origin': 'https://mp.weixin.qq.com',
                        'Sec-Fetch-Site': 'same-origin',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Dest': 'empty'
                    }
                }
            );

            if (!response.data || response.data.base_resp?.ret !== 0) {
                const errorMsg = response.data?.base_resp?.err_msg || 'Unknown error';
                if (errorMsg.includes('invalid session')) {
                    throw new InvalidSessionError();
                }
                throw new Error(`API error: ${errorMsg}`);
            }

            return response.data;
        } catch (error) {
            if (error instanceof InvalidSessionError) {
                logger.error('Session is invalid - authentication required');
                throw error; // Propagate the invalid session error
            }
            
            logger.error('Error fetching articles:', error.message);
            logger.error('Full error:', error);
            throw error;
        }
    }

    parseArticleInfo(publishInfo) {
        const info = JSON.parse(publishInfo);
        const articles = [];

        for (const article of info.appmsgex) {
            articles.push({
                id: article.aid,
                title: article.title,
                author: article.author_name,
                link: article.link,
                cover: article.cover,
                digest: article.digest,
                publishTime: dayjs(article.update_time * 1000).format('YYYY-MM-DD HH:mm:ss'),
                categories: article.appmsg_album_infos.map(cat => cat.title)
            });
        }

        return articles;
    }

    // We don't fetch content in index.js anymore, only metadata
    async getArticleUrl(article) {
        return `https://mp.weixin.qq.com/s?__biz=${this.bizId}&mid=${article.mid}&idx=${article.idx}&sn=${article.sn}`;
    }



    async saveArticle(article) {
        const articleDir = path.join(this.articlesDir, article.id);
        const articleFile = path.join(articleDir, 'article.json');

        try {
            // Create article directory
            await fs.ensureDir(articleDir);

            // Save only metadata and URL
            const articleData = { 
                ...article,
                url: await this.getArticleUrl(article)
            };

            // Save article metadata
            await fs.writeJson(articleFile, articleData, { spaces: 2 });

            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));

            return article.id;
        } catch (error) {
            logger.error(`Error saving article ${article.id}:`, error);
            throw error;
        }
    }

    async updateArchive(articles) {
        const archive = await fs.readJson(this.archiveFile);
        const existingIds = new Set(archive.articles.map(a => a.id));
        let newArticlesCount = 0;

        for (const article of articles) {
            if (!existingIds.has(article.id)) {
                await this.saveArticle(article);
                archive.articles.push({
                    id: article.id,
                    title: article.title,
                    author: article.author,
                    publishTime: article.publishTime,
                    categories: article.categories,
                    link: article.link,
                    cover: article.cover,
                    digest: article.digest
                });
                newArticlesCount++;
            }
        }

        if (newArticlesCount > 0) {
            archive.lastUpdate = dayjs().format('YYYY-MM-DD HH:mm:ss');
            archive.articles.sort((a, b) => dayjs(b.publishTime).unix() - dayjs(a.publishTime).unix());
            await fs.writeJson(this.archiveFile, archive, { spaces: 2 });
        }

        return { archive, newArticlesCount };
    }

    async fetchNewArticles() {
        await this.initialize();
        logger.info('Starting to fetch new WeChat articles...');

        try {
            // Read archive to get existing IDs
            const archive = await fs.readJson(this.archiveFile);
            const existingIds = new Set(archive.articles.map(a => a.id));
            
            // Fetch first batch
            const firstBatch = await this.fetchArticles(0, 20);
            const publishPage = JSON.parse(firstBatch.publish_page);
            const totalCount = publishPage.total_count;
            let newArticlesFound = 0;
            let shouldContinue = true;

            // Process first batch
            for (const item of publishPage.publish_list) {
                const articles = this.parseArticleInfo(item.publish_info);
                // Check if any article in this batch already exists
                if (articles.some(article => existingIds.has(article.id))) {
                    logger.info('Found existing article, stopping fetch since articles are time-ordered');
                    shouldContinue = false;
                    break;
                }
                const { newArticlesCount } = await this.updateArchive(articles);
                newArticlesFound += newArticlesCount;
            }

            // If all articles in first batch were new and there are more batches
            if (shouldContinue && newArticlesFound > 0) {
                const batchSize = 20;
                const totalBatches = Math.ceil(totalCount / batchSize);
                logger.info(`Found ${newArticlesFound} new articles, checking remaining batches...`);

                // Fetch remaining batches
                for (let batch = 1; batch < totalBatches; batch++) {
                    const begin = batch * batchSize;
                    logger.info(`Checking batch ${batch + 1}/${totalBatches}...`);
                    
                    try {
                        const data = await this.fetchArticles(begin, batchSize);
                        const batchPage = JSON.parse(data.publish_page);

                        for (const item of batchPage.publish_list) {
                            const articles = this.parseArticleInfo(item.publish_info);
                            // Check if any article in this batch already exists
                            if (articles.some(article => existingIds.has(article.id))) {
                                logger.info('Found existing article, stopping fetch since articles are time-ordered');
                                return newArticlesFound;
                            }
                            const { newArticlesCount } = await this.updateArchive(articles);
                            newArticlesFound += newArticlesCount;
                        }

                        // Add a small delay between requests
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (error) {
                        if (error instanceof InvalidSessionError) {
                            logger.error('Invalid session detected - exiting process');
                            process.exit(1);
                        }
                        logger.error(`Error fetching batch ${batch + 1}:`, error);
                        break;
                    }
                }
            }

            logger.info(`Fetch completed. Found ${newArticlesFound} new articles.`);
            return newArticlesFound;
        } catch (error) {
            if (error instanceof InvalidSessionError) {
                logger.error('Invalid session detected - exiting process');
                process.exit(1);
            }
            logger.error('Error during new articles fetch:', error);
            throw error;
        }
    }

    async fetchAllArticles() {
        await this.initialize();
        logger.info('Starting WeChat article fetch...');

        try {
            // Fetch first batch to get total count
            const firstBatch = await this.fetchArticles(0, 20);
            const publishPage = JSON.parse(firstBatch.publish_page);
            const totalCount = publishPage.total_count;
            logger.info(`Found ${totalCount} total articles`);

            // Process first batch
            for (const item of publishPage.publish_list) {
                const articles = this.parseArticleInfo(item.publish_info);
                await this.updateArchive(articles);
            }

            // Calculate remaining batches
            const batchSize = 20;
            const totalBatches = Math.ceil(totalCount / batchSize);
            logger.info(`Will fetch ${totalBatches} batches in total`);

            // Fetch remaining batches
            for (let batch = 1; batch < totalBatches; batch++) {
                const begin = batch * batchSize;
                logger.info(`Fetching batch ${batch + 1}/${totalBatches} (articles ${begin}-${begin + batchSize})`);
                
                try {
                    const data = await this.fetchArticles(begin, batchSize);
                    const batchPage = JSON.parse(data.publish_page);

                    for (const item of batchPage.publish_list) {
                        const articles = this.parseArticleInfo(item.publish_info);
                        await this.updateArchive(articles);
                    }

                    // Add a small delay between requests
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    if (error instanceof InvalidSessionError) {
                        logger.error('Invalid session detected - exiting process');
                        process.exit(1);
                    }
                    logger.error(`Error fetching batch ${batch + 1}:`, error);
                    // Continue with next batch even if one fails
                    continue;
                }
            }

            const archive = await fs.readJson(this.archiveFile);
            logger.info(`Successfully archived ${archive.articles.length} articles`);
            logger.info('Article fetch completed successfully');
        } catch (error) {
            if (error instanceof InvalidSessionError) {
                logger.error('Invalid session detected - exiting process');
                process.exit(1);
            }
            logger.error('Error during article fetch:', error);
            throw error;
        }
    }
}

// Export the WeChatScraper class
export { WeChatScraper };

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
    const scraper = new WeChatScraper();
    const command = process.argv[2] || 'run';
    
    if (command === 'new') {
        scraper.fetchNewArticles().catch(console.error);
    } else {
        scraper.fetchAllArticles().catch(console.error);
    }
}

export default WeChatScraper;

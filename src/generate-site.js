import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import Mustache from 'mustache';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SiteGenerator {
    constructor() {
        this.baseDir = path.join(__dirname, '..');
        this.dataDir = path.join(this.baseDir, 'data');
        this.templatesDir = path.join(this.baseDir, 'templates');
        this.outputDir = path.join(this.baseDir, 'public');
        this.articlesDir = path.join(this.dataDir, 'articles');
    }

    async initialize() {
        // Ensure output directory exists
        await fs.ensureDir(this.outputDir);
        await fs.ensureDir(path.join(this.outputDir, 'articles'));
    }

    async loadTemplate(name) {
        const templatePath = path.join(this.templatesDir, `${name}.html`);
        return fs.readFile(templatePath, 'utf-8');
    }

    async downloadImage(imageUrl, articleId, filename) {
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
            
            const buffer = await response.buffer();
            const imagesDir = path.join(this.outputDir, 'articles', articleId, 'images');
            await fs.ensureDir(imagesDir);
            
            const outputPath = path.join(imagesDir, filename);
            await fs.writeFile(outputPath, buffer);
            
            return `images/${filename}`;
        } catch (error) {
            console.error(`Error downloading image: ${error.message}`);
            return imageUrl; // Fallback to original URL if download fails
        }
    }

    async generateArticlePage(article) {
        try {
            const template = await this.loadTemplate('article');
            
            // Try to fetch the article content from WeChat
            let contentStatus = '';
            let articleContent = '';
            let articleImages = [];
            
            if (article.link) {
                try {
                    console.log(`Fetching content from: ${article.link}`);
                    const response = await fetch(article.link);
                    const html = await response.text();
                    console.log(`Received HTML response, length: ${html.length}`);
                    
                    // Parse the HTML content
                    const $ = cheerio.load(html);
                    
                    // Extract the main content
                    console.log('Looking for content div...');
                    const contentDiv = $('#js_content');
                    console.log('Content div found:', contentDiv.length > 0);
                    
                    // For debugging, let's see what we got
                    console.log('First 500 chars of HTML:', html.substring(0, 500));
                    
                    // Try to find the content in different ways
                    let mainContent = null;
                    if (contentDiv.length > 0) {
                        // First try: direct content
                        mainContent = contentDiv;
                    } else {
                        // Second try: look for rich_media_content
                        mainContent = $('#js_article');
                        if (!mainContent.length) {
                            mainContent = $('.rich_media_content');
                        }
                    }
                    
                    // If still not found, try looking for any content with class containing 'rich_media'
                    if (!mainContent || !mainContent.length) {
                        $('[class*="rich_media"]').each(function() {
                            if ($(this).find('img, p').length > 0) {
                                mainContent = $(this);
                                return false; // break the loop
                            }
                        });
                    }
                    
                    if (mainContent && mainContent.length > 0) {
                        // Process and download images
                        const imgElements = mainContent.find('img');
                        console.log(`Found ${imgElements.length} images in content`);
                        
                        for (let i = 0; i < imgElements.length; i++) {
                            const img = imgElements.eq(i);
                            const dataSrc = img.attr('data-src') || img.attr('src');
                            
                            if (dataSrc) {
                                const filename = `content_${i + 1}.jpg`;
                                try {
                                    await this.downloadImage(dataSrc, article.id, filename);
                                    img.attr('src', `images/${filename}`);
                                    articleImages.push(filename);
                                } catch (err) {
                                    console.error(`Error downloading image ${dataSrc}:`, err.message);
                                }
                            }
                        }
                        
                        // Clean up the content
                        mainContent.find('script').remove();
                        mainContent.find('style').remove();
                        
                        // Clean up the content
                        mainContent.find('script').remove();
                        mainContent.find('style').remove();
                        
                        // Fix image src attributes
                        let imageIndex = 1;
                        mainContent.find('img').each(function() {
                            const img = $(this);
                            // Remove WeChat specific attributes
                            img.removeAttr('data-src');
                            img.removeAttr('data-type');
                            img.removeAttr('data-w');
                            img.removeAttr('data-ratio');
                            img.removeAttr('data-s');
                            img.removeAttr('data-imgfileid');
                            img.removeAttr('data-galleryid');
                            
                            // Set src to local path
                            img.attr('src', `images/content_${imageIndex}.jpg`);
                            imageIndex++;
                        });
                        
                        // Get the cleaned HTML content
                        articleContent = mainContent.html();
                        
                        // Fix any truncated or malformed HTML
                        const tempDoc = cheerio.load(articleContent, {
                            decodeEntities: false
                        });
                        
                        // Remove any html/head/body tags
                        tempDoc('html, head, body').each(function() {
                            const element = tempDoc(this);
                            element.replaceWith(element.html());
                        });
                        
                        // Get the content
                        articleContent = tempDoc.html();
                        
                        console.log('Found content length:', articleContent ? articleContent.length : 0);
                        contentStatus = '';
                    } else {
                        contentStatus = '无法提取文章内容。请点击下方链接访问原文。';
                    }
                } catch (error) {
                    console.error(`Error fetching article ${article.id}:`, error.message);
                    contentStatus = '无法访问文章。请点击下方链接访问原文。';
                }
            }

            // Download cover image if present
            let localCover = '';
            if (article.cover) {
                console.log(`Downloading cover image for article ${article.id}...`);
                const filename = `cover${path.extname(article.cover) || '.jpg'}`;
                localCover = await this.downloadImage(article.cover, article.id, filename);
            }

            // Create output directory for this article
            const articleDir = path.join(this.outputDir, 'articles', article.id);
            await fs.ensureDir(articleDir);

            // Prepare data for the template
            const templateData = {
                ...article,
                hasCategories: article.categories && article.categories.length > 0,
                categoriesDisplay: article.categories ? article.categories.join(', ') : '',
                contentStatus,
                hasDigest: !!article.digest,
                showWeChat: !!article.link,
                cover: localCover || article.cover, // Use local image path if available
                link: article.link.replace(/&#x2F;/g, '/'), // Fix escaped URLs
                content: articleContent,
                hasContent: !!articleContent
            };

            // Generate HTML using Mustache template with HTML unescaping
            const html = Mustache.render(template, {
                ...templateData,
                link: templateData.link.replace(/&#x2F;/g, '/'),
                cover: templateData.cover.replace(/&#x2F;/g, '/'),
            }, {}, { escape: (text) => text }); // Disable HTML escaping
            await fs.writeFile(path.join(articleDir, 'index.html'), html);
            console.log(`Generated page for article ${article.id}`);
        } catch (error) {
            console.error(`Error generating page for article ${article.id}:`, error.message);
            throw error;
        }
    }

    async generateIndexPage(archive) {
        const template = await this.loadTemplate('index');
        const html = Mustache.render(template, archive);
        await fs.writeFile(path.join(this.outputDir, 'index.html'), html);
    }

    async generate() {
        console.log('Starting site generation...');
        await this.initialize();

        // Load archive data
        const archive = await fs.readJson(path.join(this.dataDir, 'archive.json'));
        console.log(`Found ${archive.articles.length} articles`);

        // Generate all article pages
        console.log(`Processing all ${archive.articles.length} articles...`);
        
        for (const article of archive.articles) {
            try {
                // First read the actual article data from its JSON file
                const articleFilePath = path.join(this.articlesDir, article.fileName);
                const articleData = await fs.readJson(articleFilePath);
                
                console.log(`\nProcessing article: ${articleData.title}`);
                console.log(`Article link: ${articleData.link}`);
                await this.generateArticlePage(articleData);
                console.log(`Successfully generated page for article: ${articleData.title}`);
            } catch (error) {
                console.error(`Error generating page for article ${article.id}:`, error);
            }
        }

        // Generate index page
        await this.generateIndexPage(archive);
        console.log('Generated index page');

        console.log('Site generation complete!');
    }
}

// Run the generator
const generator = new SiteGenerator();
generator.generate().catch(console.error);

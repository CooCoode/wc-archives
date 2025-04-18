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
            // Clean and validate the URL
            let cleanUrl = imageUrl;
            if (!cleanUrl) {
                throw new Error('Empty image URL');
            }

            // Skip if it's already a local path
            if (cleanUrl.startsWith('images/')) {
                return cleanUrl;
            }

            // Handle WeChat CDN URLs
            if (cleanUrl.startsWith('//')) {
                cleanUrl = 'https:' + cleanUrl;
            }

            // Handle data-src URLs
            if (cleanUrl.startsWith('data:')) {

                return imageUrl;
            }

            // Validate URL format
            try {
                // Only validate if it looks like a URL
                if (cleanUrl.includes('://') || cleanUrl.startsWith('//')) {
                    new URL(cleanUrl);
                } else {
                    throw new Error('Not a URL');
                }
            } catch (e) {
                console.error(`Not a valid URL: ${cleanUrl}`);
                return imageUrl;
            }


            const response = await fetch(cleanUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const buffer = await response.arrayBuffer();
            const imagesDir = path.join(this.outputDir, 'articles', articleId, 'images');
            await fs.ensureDir(imagesDir);
            
            const outputPath = path.join(imagesDir, filename);
            await fs.writeFile(outputPath, Buffer.from(buffer));
            
            return `images/${filename}`;
        } catch (error) {
            console.error(`Error downloading image: ${error.message}`);
            return imageUrl; // Fallback to original URL if download fails
        }
    }

    async generateArticlePage(article) {

        // Check the .done is existed to make sure this article is not processed yet
        const donePath = path.join(this.outputDir, 'articles', article.id, '.done');
        if (await fs.pathExists(donePath)) {
            console.log(`Skipping article ${article.id}: Already processed`);
            return;
        }

        try {
            const template = await this.loadTemplate('article');
            
            // Try to fetch the article content from WeChat
            let contentStatus = '';
            let articleContent = '';
            let articleImages = [];
            
            if (article.link) {
                try {
                    console.log(`Fetching content from: ${article.link}`);
                    const response = await fetch(article.link, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.5'
                        }
                    });
                    const html = await response.text();
                    console.log('Received HTML length:', html.length);
                    
                    // Parse the HTML content
                    const $ = cheerio.load(html, {
                        decodeEntities: false,
                        xmlMode: false
                    });
                    
                    // Log page title for debugging
                    console.log('Page title:', $('title').text());
                    
                    // Try to find the content in different ways
                    let mainContent = null;
                    
                    // Method 1: Standard WeChat content div
                    const jsContent = $('#js_content');
                    if (jsContent.length > 0) {
                        console.log('Found js_content');
                        // Remove visibility and opacity styles that may hide content
                        jsContent.css('visibility', 'visible');
                        jsContent.css('opacity', '1');
                        jsContent.find('*').css('visibility', 'visible').css('opacity', '1');
                        
                        // Remove any script tags and unwanted elements
                        jsContent.find('script, style, link, iframe').remove();
                        
                        // Process images
                        jsContent.find('img').each(function() {
                            const $img = $(this);
                            const dataSrc = $img.attr('data-src');
                            if (dataSrc) {
                                $img.attr('src', dataSrc);
                            }
                        });
                        
                        // Remove empty elements
                        jsContent.find('*').each(function() {
                            const $el = $(this);
                            if ($el.text().trim() === '' && !$el.find('img').length) {
                                $el.remove();
                            }
                        });
                        
                        const text = jsContent.text().trim();
                        console.log(`js_content text length: ${text.length}`);
                        console.log('Sample content:', text.substring(0, 100));
                        
                        if (text.length > 100) {
                            mainContent = jsContent;
                            console.log('Using js_content');
                        }
                    }
                    
                    // Method 2: Rich media content
                    if (!mainContent || mainContent.text().trim().length < 100) {
                        const richMedia = $('.rich_media_content');
                        if (richMedia.length > 0) {
                            console.log('Found rich_media_content');
                            richMedia.css('visibility', 'visible');
                            richMedia.css('opacity', '1');
                            richMedia.find('*').css('visibility', 'visible').css('opacity', '1');
                            
                            // Remove any script tags
                            richMedia.find('script').remove();
                            richMedia.find('style').remove();
                            richMedia.find('link').remove();
                            richMedia.find('iframe').remove();
                            
                            const text = richMedia.text().trim();
                            console.log(`rich_media_content text length: ${text.length}`);
                            
                            if (text.length > 100) {
                                mainContent = richMedia;
                                console.log('Using rich_media_content');
                            }
                        }
                    }
                    
                    // Method 3: Article content
                    if (!mainContent || mainContent.text().trim().length < 100) {
                        const articleContent = $('#js_article');
                        if (articleContent.length > 0) {
                            console.log('Found js_article');
                            articleContent.css('visibility', 'visible');
                            articleContent.css('opacity', '1');
                            articleContent.find('*').css('visibility', 'visible').css('opacity', '1');
                            
                            // Remove any script tags
                            articleContent.find('script').remove();
                            articleContent.find('style').remove();
                            articleContent.find('link').remove();
                            articleContent.find('iframe').remove();
                            
                            const text = articleContent.text().trim();
                            console.log(`js_article text length: ${text.length}`);
                            
                            if (text.length > 100) {
                                mainContent = articleContent;
                                console.log('Using js_article');
                            }
                        }
                    }

                    // Method 4: Rich media area
                    if (!mainContent || mainContent.text().trim().length < 100) {
                        const richMediaArea = $('#js_rich_media_area');
                        if (richMediaArea.length > 0) {
                            console.log('Found js_rich_media_area');
                            richMediaArea.css('visibility', 'visible');
                            richMediaArea.css('opacity', '1');
                            richMediaArea.find('*').css('visibility', 'visible').css('opacity', '1');
                            
                            // Remove any script tags
                            richMediaArea.find('script').remove();
                            richMediaArea.find('style').remove();
                            richMediaArea.find('link').remove();
                            richMediaArea.find('iframe').remove();
                            
                            const text = richMediaArea.text().trim();
                            console.log(`js_rich_media_area text length: ${text.length}`);
                            
                            if (text.length > 100) {
                                mainContent = richMediaArea;
                                console.log('Using js_rich_media_area');
                            }
                        }
                    }

                    // Method 5: Post area
                    if (!mainContent || mainContent.text().trim().length < 100) {
                        const postArea = $('#post_area');
                        if (postArea.length > 0) {
                            console.log('Found post_area');
                            postArea.css('visibility', 'visible');
                            postArea.css('opacity', '1');
                            postArea.find('*').css('visibility', 'visible').css('opacity', '1');
                            
                            // Remove any script tags
                            postArea.find('script').remove();
                            postArea.find('style').remove();
                            postArea.find('link').remove();
                            postArea.find('iframe').remove();
                            
                            const text = postArea.text().trim();
                            console.log(`post_area text length: ${text.length}`);
                            
                            if (text.length > 100) {
                                mainContent = postArea;
                                console.log('Using post_area');
                            }
                        }
                    }

                    // Method 6: Find divs with specific classes
                    if (!mainContent || mainContent.text().trim().length < 100) {
                        $('[class*="content"], [class*="article"], [class*="post"]').each(function() {
                            const $div = $(this);
                            // Skip divs that are likely headers or footers
                            if ($div.closest('header, footer').length > 0) return;
                            if ($div.find('header, footer').length > 0) return;
                            
                            $div.css('visibility', 'visible');
                            $div.css('opacity', '1');
                            $div.find('*').css('visibility', 'visible').css('opacity', '1');
                            
                            // Remove any script tags
                            $div.find('script').remove();
                            $div.find('style').remove();
                            $div.find('link').remove();
                            $div.find('iframe').remove();
                            
                            const text = $div.text().trim();
                            console.log(`Found content div with length ${text.length}`);
                            
                            if (text.length > 100 && !mainContent) {
                                mainContent = $div;
                                console.log('Using content div');
                            }
                        });
                    }

                    // Method 7: Find the largest text block as last resort
                    if (!mainContent || mainContent.text().trim().length < 100) {
                        let maxLength = 0;
                        let bestDiv = null;
                        $('div').each(function() {
                            const $div = $(this);
                            // Skip divs that are likely headers or footers
                            if ($div.closest('header, footer').length > 0) return;
                            if ($div.find('header, footer').length > 0) return;
                            
                            $div.css('visibility', 'visible');
                            $div.css('opacity', '1');
                            $div.find('*').css('visibility', 'visible').css('opacity', '1');
                            
                            // Remove any script tags
                            $div.find('script').remove();
                            $div.find('style').remove();
                            $div.find('link').remove();
                            $div.find('iframe').remove();
                            
                            const text = $div.text().trim();
                            // Look for paragraphs or meaningful content
                            if (text.length > maxLength && 
                                ($div.find('p').length > 0 || text.includes('。') || text.includes('，'))) {
                                maxLength = text.length;
                                bestDiv = $div;
                                console.log(`Found potential content div with length ${text.length}`);
                            }
                        });
                        if (bestDiv && maxLength > 100) {
                            mainContent = bestDiv;
                            console.log('Using largest text block');
                        }
                    }

                    // Log content status
                    if (mainContent) {
                        const contentLength = mainContent.text().trim().length;
                        console.log(`Content length: ${contentLength}`);
                        
                        if (contentLength < 100) {
                            console.log('Content too short, discarding');
                            mainContent = null;
                            contentStatus = '无法提取文章内容。请点击下方链接访问原文。';
                            articleContent = null;
                        } else {
                            // Process the content
                            mainContent.find('script').remove();
                            mainContent.find('style').remove();
                            mainContent.find('link').remove();
                            mainContent.find('iframe').remove();
                            
                            // Remove empty elements
                            mainContent.find('*').each(function() {
                                const $el = $(this);
                                if ($el.text().trim() === '' && $el.find('img').length === 0) {
                                    $el.remove();
                                }
                            });
                            
                            // Add spacing between paragraphs
                            mainContent.find('p').addClass('mb-4');
                            
                            // Get the HTML content
                            articleContent = mainContent.html();
                            console.log('Content processed successfully');
                            contentStatus = '';
                        }
                    } else {
                        console.log('No suitable content found');
                        contentStatus = '无法提取文章内容。请点击下方链接访问原文。';
                        articleContent = null;
                    }

                    if (mainContent) {
                        // Process images and clean up content
                        const articleImages = [];
                        const imgElements = mainContent.find('img');
                        console.log(`Found ${imgElements.length} images in content`);
                        
                        for (let i = 0; i < imgElements.length; i++) {
                            const img = imgElements.eq(i);
                            // Try multiple image source attributes in order of preference
                            const dataSrc = img.attr('data-src') || 
                                           img.attr('data-original') || 
                                           img.attr('data-actualsrc') || 
                                           img.attr('src');
                            
                            if (dataSrc) {
                                const filename = `content_${i + 1}.jpg`;
                                try {
                                    // Only try to download if it's not already a local path
                                    if (!dataSrc.startsWith('images/')) {
                                        const localPath = await this.downloadImage(dataSrc, article.id, filename);
                                        img.attr('src', localPath);
                                    }
                                    // Clean up WeChat specific attributes
                                    const attrsToRemove = [
                                        'data-src', 'data-type', 'data-w', 'data-ratio', 'data-s',
                                        'data-imgfileid', 'data-galleryid', 'data-original', 'data-actualsrc',
                                        'data-cropselx1', 'data-cropselx2', 'data-cropsely1', 'data-cropsely2',
                                        'data-format', 'data-height', 'data-width', 'data-copyright'
                                    ];
                                    attrsToRemove.forEach(attr => img.removeAttr(attr));
                                    articleImages.push(filename);
                                } catch (err) {
                                    console.error(`Error downloading image ${dataSrc}:`, err.message);
                                }
                            }
                        }
                        
                        // Clean up the content
                        mainContent.find('script').remove();
                        mainContent.find('style').remove();
                        mainContent.find('link').remove(); // Remove any stray style links
                        
                        // Additional cleanup
                        mainContent.find('*').each(function() {
                            const el = $(this);
                            // Remove empty elements except for valid HTML5 void elements
                            if (!el.text().trim() && !el.find('img').length && 
                                !['img', 'br', 'hr', 'input', 'meta', 'link'].includes(this.name)) {
                                el.remove();
                            }
                            // Remove all data-* attributes
                            Object.keys(this.attribs || {}).forEach(attr => {
                                if (attr.startsWith('data-')) {
                                    el.removeAttr(attr);
                                }
                            });
                        });
                        
                        // Get the cleaned HTML content
                        articleContent = mainContent.html();
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

            await fs.writeFile(path.join(articleDir, '.done'), ''); // Mark the article as processed
            console.log(`Generated page for article ${article.id}`);
        } catch (error) {
            console.error(`Error generating page for article ${article.id}:`, error.message);
            throw error;
        }
    }

    escape(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    async generateSitemap(articles) {
        const { generateSitemap } = await import('./generate-sitemap.js');
        await generateSitemap(articles);
    }

    async generateIndexPage(archive) {
        try {
            await this.initialize(); // Ensure output directory exists
            const template = await this.loadTemplate('index');
            
            // Sort articles by date (newest first)
            const sortedArchive = {
                ...archive,
                articles: [...archive.articles].sort((a, b) => 
                    new Date(b.publishTime || b.createAt) - new Date(a.publishTime || a.createAt)
                )
            };

            // Add formatted dates and URLs for the template
            sortedArchive.articles = sortedArchive.articles.map(article => ({
                ...article,
                formattedDate: new Date(article.publishTime || article.createAt).toLocaleDateString('zh-CN'),
                url: `articles/${article.id}/index.html`,
                author: article.author || 'SeeDAO'
            }));

            const html = Mustache.render(template, sortedArchive);
            await fs.writeFile(path.join(this.outputDir, 'index.html'), html);
            console.log(`Generated index.html with ${sortedArchive.articles.length} articles`);
        } catch (error) {
            console.error('Error generating index page:', error);
            throw error;
        }
    }

    async generate() {
        console.log('Starting site generation...');
        await this.initialize();

        // Load archive data
        const archive = await fs.readJson(path.join(this.dataDir, 'archive.json'));
        console.log(`Found ${archive.articles.length} articles`);

        // Generate all article pages
        console.log(`Processing all ${archive.articles.length} articles...`);
        
        const validArticles = [];
        for (const article of archive.articles) {
            try {
                // First read the actual article data from its JSON file
                const articleFilePath = path.join(this.articlesDir, article.id, 'article.json');
                if (!await fs.pathExists(articleFilePath)) {
                    console.warn(`Skipping article ${article.id}: File not found at ${articleFilePath}`);
                    continue;
                }
                
                const articleData = await fs.readJson(articleFilePath);
                if (!articleData) {
                    console.warn(`Skipping article ${article.id}: Invalid JSON data`);
                    continue;
                }
                
                console.log(`\nProcessing article: ${articleData.title}`);
                console.log(`Article link: ${articleData.link}`);
                await this.generateArticlePage(articleData);
                console.log(`Successfully generated page for article: ${articleData.title}`);
                validArticles.push({
                    ...article,
                    title: articleData.title,
                    cover: articleData.cover
                });
            } catch (error) {
                console.error(`Error generating page for article ${article.id}:`, error);
            }
        }

        // Generate index page with only valid articles
        const validArchive = { ...archive, articles: validArticles };
        await this.generateIndexPage(validArchive);
        console.log('Generated index page');

        // Generate sitemap with only valid articles
        await this.generateSitemap(validArticles);
        console.log('Generated sitemap');

        console.log('Site generation complete!');
    }
}

// Export the SiteGenerator class
export { SiteGenerator };

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
    const generator = new SiteGenerator();
    generator.generate().catch(console.error);
}

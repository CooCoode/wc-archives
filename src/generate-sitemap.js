import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseDir = path.join(__dirname, '..');
const dataDir = path.join(baseDir, 'data');
const outputDir = path.join(baseDir, 'public');

function escape(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export async function generateSitemap(articles) {
    const baseUrl = 'https://wc-archives.seedao.xyz';
    const formatISODate = (article) => {
        if (article.publishTime) {
            return new Date(article.publishTime).toISOString();
        }
        return new Date().toISOString();
    };

    console.log(`Generating sitemap for ${articles.length} articles`);

    const sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
    <url>
        <loc>${baseUrl}/</loc>
        <lastmod>${new Date().toISOString()}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
        <xhtml:link rel="alternate" hreflang="zh" href="${baseUrl}/"/>
        <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/"/>
    </url>
${articles.map(article => {
    if (!article || !article.id) return '';
    const url = `${baseUrl}/articles/${article.id}/index.html`;
    const lastmod = formatISODate(article);
    const newsXml = article.categories ? `
        <news:news>
            <news:publication>
                <news:name>SeeDAO WeChat Archives</news:name>
                <news:language>zh</news:language>
            </news:publication>
            <news:publication_date>${lastmod}</news:publication_date>
            <news:title>${escape(article.title || '')}</news:title>
            <news:keywords>${escape(article.categories.join(','))}</news:keywords>
        </news:news>` : '';

    return `    <url>
        <loc>${escape(url)}</loc>
        <lastmod>${lastmod}</lastmod>
        <changefreq>never</changefreq>
        <priority>0.8</priority>
        <xhtml:link rel="alternate" hreflang="zh" href="${escape(url)}"/>
        <xhtml:link rel="alternate" hreflang="x-default" href="${escape(url)}"/>${newsXml}
    </url>`;
}).filter(Boolean).join('\n')}
</urlset>`;

    await fs.writeFile(path.join(outputDir, 'sitemap.xml'), sitemapContent, 'utf8');
    console.log(`Generated sitemap.xml with ${articles.length} articles`);
}

// When run directly, generate sitemap from archive.json
if (import.meta.url === `file://${__filename}`) {
    const archive = await fs.readJson(path.join(dataDir, 'archive.json'));
    generateSitemap(archive.articles).catch(console.error);
}

# WeChat Article Archive

This repository archives WeChat articles and generates a static website to display them.

## Deployment

The website is automatically deployed to GitHub Pages. You can view it at: https://teamtaoist.github.io/wc-archives/

### Setup Instructions

1. Go to repository Settings > Pages
2. Under "Build and deployment":
   - Source: GitHub Actions
   - Branch: main
3. The site will be automatically deployed when changes are pushed to the main branch

## Workflows

The repository uses several GitHub Actions workflows:

1. `fetch-articles.yml`: Fetches new articles from WeChat
2. `batch-update.yml`: Processes articles in batches
3. `daily-update.yml`: Daily updates for new articles
4. `deploy-pages.yml`: Deploys the website to GitHub Pages

## Development

```bash
# Install dependencies
npm install

# Run article fetch to fetch all articles
npm run fetch

# Process articles
npm run process

# Run daily update to fetch new articles
npm run update
```

## Environment Variables

The following environment variables are required:

- `WECHAT_BIZ_ID`: WeChat business ID
- `WECHAT_TOKEN`: WeChat API token
- `WECHAT_COOKIE`: WeChat cookie for authentication

These should be set as GitHub repository secrets.

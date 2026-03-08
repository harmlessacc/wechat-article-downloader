# WeChat Article Downloader

Download WeChat Official Account (微信公众号) articles to clean Markdown with locally saved images.

Built as a [Claude Code](https://claude.com/claude-code) skill — works standalone via CLI or as an agent-invocable skill.

## Features

- **Chrome CDP rendering** — Full JavaScript execution, handles lazy-loaded images
- **Three download modes** — Single URL, batch file, or bulk account download via API
- **Markdown output** — YAML frontmatter (title, author, date, source) + clean body
- **Local images** — Downloads all article images, rewrites URLs to local paths
- **WeChat-specific** — Handles `data-src` lazy loading, `mmbiz.qpic.cn` images, `#js_content` extraction

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime
- Google Chrome or Chromium

### Install dependencies

```bash
bun install
```

### Download a single article

```bash
bun scripts/main.ts "https://mp.weixin.qq.com/s/YOUR_ARTICLE_ID"
```

### Download with local images

```bash
bun scripts/main.ts "https://mp.weixin.qq.com/s/xxxx" -o ./articles/
```

### Batch download from URL list

Create a `urls.txt` file:

```text
# One URL per line, lines starting with # are comments
https://mp.weixin.qq.com/s/article1
https://mp.weixin.qq.com/s/article2
https://mp.weixin.qq.com/s/article3
```

```bash
bun scripts/main.ts urls.txt -o ./backup/
```

### Download all articles from your own account

Requires WeChat Official Account API credentials:

```bash
# Set credentials
export WECHAT_APP_ID=your_app_id
export WECHAT_APP_SECRET=your_app_secret

# List all articles
bun scripts/main.ts --account --list

# Download all
bun scripts/main.ts --account -o ./my-articles/

# Download latest 20
bun scripts/main.ts --account --max 20
```

Or put credentials in `.wechat-article-downloader/.env`:

```env
WECHAT_APP_ID=your_app_id
WECHAT_APP_SECRET=your_app_secret
```

## CLI Options

| Option | Description |
|--------|-------------|
| `<url>` | Single WeChat article URL |
| `<file.txt>` | Batch file with URLs |
| `--account` | Download from your own Official Account via API |
| `-o, --output <dir>` | Output directory (default: `./wechat-articles/`) |
| `--no-images` | Skip image download, keep remote URLs |
| `--wait` | Wait mode: log in manually, then press Enter |
| `--timeout <ms>` | Page load timeout (default: 30000) |
| `--list` | List articles only (with `--account`) |
| `--max, -n <num>` | Max articles to download |

## Output Format

```
wechat-articles/
  article-title.md          # Markdown with YAML frontmatter
  article-title/
    imgs/
      001.jpg               # Downloaded images
      002.png
```

Each `.md` file includes:

```yaml
---
title: "Article Title"
author: "Author Name"
date: "2024-01-15"
source_url: "https://mp.weixin.qq.com/s/xxxx"
description: "Article summary..."
captured_at: "2024-01-15T12:00:00.000Z"
---

# Article Title

Article content in Markdown...

![](imgs/001.jpg)
```

## Claude Code Skill Usage

This tool works as a Claude Code skill. Install by symlinking:

```bash
ln -s /path/to/wechat-article-downloader ~/.claude/skills/wechat-article-downloader
```

Then in Claude Code, say:

- "下载这篇公众号文章 https://mp.weixin.qq.com/s/xxxx"
- "保存公众号文章到 Markdown"
- "批量下载公众号所有文章"

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WECHAT_DL_CHROME_PATH` | Custom Chrome executable path |
| `WECHAT_DL_CHROME_PROFILE_DIR` | Custom Chrome profile directory |
| `WECHAT_APP_ID` | WeChat Official Account App ID |
| `WECHAT_APP_SECRET` | WeChat Official Account App Secret |

## How It Works

1. **Chrome CDP** launches a headless Chrome instance
2. **Navigates** to the WeChat article URL
3. **Scrolls** the page to trigger lazy image loading (`data-src` → `src`)
4. **Extracts** metadata (title, author, date) and content HTML from `#js_content`
5. **Downloads** all images from `mmbiz.qpic.cn` with proper Referer headers
6. **Converts** HTML to Markdown using Turndown with WeChat-specific rules
7. **Writes** `.md` file with YAML frontmatter and local image references

For `--account` mode, it first calls the WeChat Official Platform API to list all published articles, then downloads each one via CDP.

## License

MIT

---
name: wechat-article-downloader
description: Downloads WeChat Official Account (微信公众号) articles and converts to Markdown with local images. Supports single URL, batch file, or bulk download all articles from your own account via API. Use when user mentions "download wechat article", "保存公众号文章", "下载公众号", "微信文章转markdown", or provides mp.weixin.qq.com URLs.
---

# WeChat Article Downloader

Downloads WeChat Official Account articles via Chrome CDP and converts to clean Markdown with locally saved images.

## Script Directory

**Important**: All scripts are located in the `scripts/` subdirectory of this skill.

**Agent Execution Instructions**:
1. Determine this SKILL.md file's directory path as `SKILL_DIR`
2. Script path = `${SKILL_DIR}/scripts/<script-name>.ts`
3. Replace all `${SKILL_DIR}` in this document with the actual path

**Script Reference**:
| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | CLI entry point for article downloading |

## Preferences (EXTEND.md)

Use Bash to check EXTEND.md existence (priority order):

```bash
# Check project-level first
test -f .wechat-article-downloader/EXTEND.md && echo "project"

# Then user-level
test -f "$HOME/.wechat-article-downloader/EXTEND.md" && echo "user"
```

| Path | Location |
|------|----------|
| `.wechat-article-downloader/EXTEND.md` | Project directory |
| `$HOME/.wechat-article-downloader/EXTEND.md` | User home |

**EXTEND.md Supports**: Default output directory | Image download toggle | Timeout settings

## Features

- Chrome CDP for full JavaScript rendering (handles lazy-loaded images)
- Three modes: single URL, batch file, or account-wide download
- WeChat-specific extraction: `#js_content`, `data-src` lazy images, metadata
- Local image download with URL rewriting
- YAML frontmatter: title, author, date, source_url, description
- WeChat Official Platform API integration for bulk article listing

## Usage

```bash
# Single article
npx -y bun ${SKILL_DIR}/scripts/main.ts "https://mp.weixin.qq.com/s/xxxx"

# Single article without images
npx -y bun ${SKILL_DIR}/scripts/main.ts "https://mp.weixin.qq.com/s/xxxx" --no-images

# Batch download from URL list file
npx -y bun ${SKILL_DIR}/scripts/main.ts urls.txt -o ./articles/

# Download all articles from your own account (requires API config)
npx -y bun ${SKILL_DIR}/scripts/main.ts --account -o ./my-articles/

# List all articles from your account (no download)
npx -y bun ${SKILL_DIR}/scripts/main.ts --account --list

# Download latest 10 articles from your account
npx -y bun ${SKILL_DIR}/scripts/main.ts --account --max 10

# Login-required article (wait mode)
npx -y bun ${SKILL_DIR}/scripts/main.ts "https://mp.weixin.qq.com/s/xxxx" --wait
```

## Options

| Option | Description |
|--------|-------------|
| `<url>` | Single WeChat article URL |
| `<batch-file.txt>` | Text file with one URL per line |
| `--account` | Download all articles from your own Official Account |
| `-o, --output <dir>` | Output directory (default: `./wechat-articles/`) |
| `--no-images` | Skip image download, keep remote URLs |
| `--wait` | Wait for user signal before capturing (for login pages) |
| `--timeout <ms>` | Page load timeout (default: 30000) |
| `--list` | List articles only, don't download (with `--account`) |
| `--max, -n <num>` | Max articles to download (with `--account`) |

## Download Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| Single URL | Pass a `mp.weixin.qq.com` URL | Download one article |
| Batch file | Pass a `.txt` file path | Download all URLs in file |
| Account | `--account` flag | List + download all articles via API |
| Wait | `--wait` flag | Open Chrome, user logs in, press Enter |

## Output Format

YAML frontmatter + Markdown body:

```yaml
---
title: "Article Title"
author: "Author Name"
date: "2024-01-15"
source_url: "https://mp.weixin.qq.com/s/xxxx"
description: "Article digest..."
captured_at: "2024-01-15T12:00:00.000Z"
---
```

## Output Directory

```
wechat-articles/
  <article-slug>.md
  <article-slug>/
    imgs/
      001.jpg
      002.png
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WECHAT_DL_CHROME_PATH` | Custom Chrome executable path |
| `WECHAT_DL_CHROME_PROFILE_DIR` | Custom Chrome profile directory |
| `WECHAT_APP_ID` | WeChat Official Account App ID (for `--account` mode) |
| `WECHAT_APP_SECRET` | WeChat Official Account App Secret (for `--account` mode) |

**API credentials** can also be set in `.wechat-article-downloader/.env` or `~/.wechat-article-downloader/.env`.

## Troubleshooting

- **Chrome not found** → Install Chrome or set `WECHAT_DL_CHROME_PATH`
- **Timeout** → Increase `--timeout` value
- **Login required** → Use `--wait` mode
- **API errors** → Check `WECHAT_APP_ID` and `WECHAT_APP_SECRET`
- **Images not loading** → Increase scroll steps (WeChat lazy-loads images)
- **Article deleted** → Error: "Article not found or has been deleted"

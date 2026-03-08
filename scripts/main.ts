import { createInterface } from "node:readline";
import { writeFile, mkdir, access } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { CdpConnection, getFreePort, launchChrome, waitForChromeDebugPort, waitForNetworkIdle, waitForPageLoad, autoScroll, killChrome } from "./cdp.js";
import { extractWeChatArticle } from "./wechat-extractor.js";
import { wechatHtmlToMarkdown, createMarkdownDocument } from "./wechat-to-markdown.js";
import { downloadImages } from "./image-downloader.js";
import { parseBatchFile, processBatch } from "./batch.js";
import { loadApiConfig, listPublishedArticles } from "./wechat-api.js";
import { searchAccountArticles } from "./wechat-search.js";
import type { ArticleOutput, WeChatExtractionResult } from "./types.js";
import {
  DEFAULT_TIMEOUT_MS,
  CDP_CONNECT_TIMEOUT_MS,
  NETWORK_IDLE_TIMEOUT_MS,
  POST_LOAD_DELAY_MS,
  SCROLL_STEP_WAIT_MS,
  SCROLL_MAX_STEPS,
  BATCH_INTER_ARTICLE_DELAY_MS,
} from "./constants.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

// --- Args ---

interface Args {
  input: string;
  output: string;
  noImages: boolean;
  wait: boolean;
  timeout: number;
  listOnly: boolean;
  maxArticles: number;
  account: boolean;
  search: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input: "",
    output: "./wechat-articles",
    noImages: false,
    wait: false,
    timeout: DEFAULT_TIMEOUT_MS,
    listOnly: false,
    maxArticles: Infinity,
    account: false,
    search: "",
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-images") args.noImages = true;
    else if (arg === "--wait" || arg === "-w") args.wait = true;
    else if (arg === "--list") args.listOnly = true;
    else if (arg === "--account") args.account = true;
    else if (arg === "--search" || arg === "-s") args.search = argv[++i] || "";
    else if (arg === "-o" || arg === "--output") args.output = argv[++i];
    else if (arg === "--timeout" || arg === "-t") args.timeout = parseInt(argv[++i], 10) || DEFAULT_TIMEOUT_MS;
    else if (arg === "--max" || arg === "-n") args.maxArticles = parseInt(argv[++i], 10) || Infinity;
    else if (!arg.startsWith("-") && !args.input) args.input = arg;
  }
  return args;
}

function printUsage(): void {
  console.log(`Usage: bun main.ts <url|batch-file> [options]

Arguments:
  <url>                   Single WeChat article URL
  <batch-file.txt>        Text file with one URL per line

Options:
  -o, --output <dir>      Output directory (default: ./wechat-articles/)
  --no-images             Skip image download, keep remote URLs
  --wait                  Wait mode: log in manually, press Enter to capture
  --timeout <ms>          Page load timeout (default: 30000)
  --search, -s <name>     Search & download articles from a public account by name
  --account               Download all articles from your own account (needs API config)
  --list                  List articles only, don't download
  --max, -n <num>         Max articles to download (default: all)

Examples:
  bun main.ts "https://mp.weixin.qq.com/s/xxxx"
  bun main.ts urls.txt -o ./backup/
  bun main.ts --search "时见谈" --max 5
  bun main.ts --search "时见谈" --list
  bun main.ts --account -o ./my-articles/
  bun main.ts --account --list`);
}

// --- Slug generation ---

function generateSlug(title: string): string {
  // For CJK titles, use first N characters + timestamp
  const cleaned = title
    .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf\s-]/g, "")
    .trim();

  if (!cleaned) return formatTimestamp();

  // If mostly CJK, keep first 20 chars
  const cjkRatio = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length / cleaned.length;
  if (cjkRatio > 0.3) {
    return cleaned.slice(0, 20).trim().replace(/\s+/g, "-");
  }

  // Latin: kebab-case
  return cleaned
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || formatTimestamp();
}

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function generateOutputPath(outputDir: string, title: string): Promise<string> {
  const slug = generateSlug(title);
  const basePath = path.join(outputDir, `${slug}.md`);
  if (!(await fileExists(basePath))) return basePath;
  return path.join(outputDir, `${slug}-${formatTimestamp()}.md`);
}

// --- Core: capture single article ---

async function waitForUserSignal(): Promise<void> {
  console.log("Page opened. Press Enter when ready to capture...");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.once("line", () => { rl.close(); resolve(); });
  });
}

async function captureArticle(
  cdp: CdpConnection,
  sessionId: string,
  url: string,
  args: Args,
): Promise<WeChatExtractionResult> {
  // Navigate
  const loadPromise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      cdp.off("Page.lifecycleEvent", handler);
      resolve();
    }, args.timeout);
    const handler = (params: unknown) => {
      const p = params as { name?: string };
      if (p.name === "load" || p.name === "DOMContentLoaded") {
        clearTimeout(timer);
        cdp.off("Page.lifecycleEvent", handler);
        resolve();
      }
    };
    cdp.on("Page.lifecycleEvent", handler);
  });
  await cdp.send("Page.navigate", { url }, { sessionId });
  await loadPromise;

  if (args.wait) {
    await waitForUserSignal();
  } else {
    await waitForNetworkIdle(cdp, sessionId, NETWORK_IDLE_TIMEOUT_MS);
    await sleep(POST_LOAD_DELAY_MS);
    await autoScroll(cdp, sessionId, SCROLL_MAX_STEPS, SCROLL_STEP_WAIT_MS);
    await sleep(POST_LOAD_DELAY_MS);
  }

  return extractWeChatArticle(cdp, sessionId, url, args.timeout);
}

async function processOneArticle(
  cdp: CdpConnection,
  sessionId: string,
  url: string,
  args: Args,
): Promise<ArticleOutput> {
  const extraction = await captureArticle(cdp, sessionId, url, args);

  // Download images
  let imageUrlMap: Map<string, string> | undefined;
  let imageCount = 0;
  const articleDir = path.dirname(await generateOutputPath(args.output, extraction.meta.title));

  if (!args.noImages && extraction.imageUrls.length > 0) {
    const outputBase = args.output;
    const slug = generateSlug(extraction.meta.title);
    const imgOutputDir = path.join(outputBase, slug);
    imageUrlMap = await downloadImages(extraction.imageUrls, imgOutputDir, console.log);
    imageCount = imageUrlMap.size;
  }

  // Convert to markdown
  const markdownBody = wechatHtmlToMarkdown(extraction.contentHtml, imageUrlMap);
  const document = createMarkdownDocument(extraction.meta, markdownBody);

  // Write file
  const outputPath = await generateOutputPath(args.output, extraction.meta.title);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, document, "utf-8");

  return {
    markdownPath: outputPath,
    imageDir: imageUrlMap && imageUrlMap.size > 0 ? path.join(args.output, generateSlug(extraction.meta.title), "imgs") : null,
    imageCount,
    meta: extraction.meta,
  };
}

// --- Chrome lifecycle ---

async function withChrome<T>(
  initialUrl: string,
  headless: boolean,
  fn: (cdp: CdpConnection, sessionId: string) => Promise<T>,
): Promise<T> {
  const port = await getFreePort();
  const chrome = await launchChrome(initialUrl, port, headless);

  let cdp: CdpConnection | null = null;
  try {
    const wsUrl = await waitForChromeDebugPort(port, 30_000);
    cdp = await CdpConnection.connect(wsUrl, CDP_CONNECT_TIMEOUT_MS);

    const targets = await cdp.send<{ targetInfos: Array<{ targetId: string; type: string; url: string }> }>("Target.getTargets");
    const pageTarget = targets.targetInfos.find(t => t.type === "page" && t.url.startsWith("http"));
    if (!pageTarget) throw new Error("No page target found");

    const { sessionId } = await cdp.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId: pageTarget.targetId, flatten: true }
    );
    await cdp.send("Network.enable", {}, { sessionId });
    await cdp.send("Page.enable", {}, { sessionId });

    return await fn(cdp, sessionId);
  } finally {
    if (cdp) {
      try { await cdp.send("Browser.close", {}, { timeoutMs: 5_000 }); } catch {}
      cdp.close();
    }
    killChrome(chrome);
  }
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // --search mode: search for account by name
  if (args.search) {
    return handleSearchMode(args);
  }

  // --account mode
  if (args.account) {
    return handleAccountMode(args);
  }

  if (!args.input) {
    printUsage();
    process.exit(1);
  }

  // Check if input is a URL or a batch file
  const isUrl = args.input.startsWith("http://") || args.input.startsWith("https://");
  const isBatchFile = !isUrl && fs.existsSync(args.input) && args.input.endsWith(".txt");

  if (!isUrl && !isBatchFile) {
    console.error(`Invalid input: ${args.input}`);
    console.error("Provide a WeChat article URL, a .txt batch file, or --account");
    process.exit(1);
  }

  await mkdir(args.output, { recursive: true });

  if (isUrl) {
    // Single URL mode
    console.log(`Fetching: ${args.input}`);
    const result = await withChrome(args.input, false, async (cdp, sessionId) => {
      return processOneArticle(cdp, sessionId, args.input, args);
    });
    console.log(`\nSaved: ${result.markdownPath}`);
    console.log(`Title: ${result.meta.title}`);
    if (result.imageCount > 0) console.log(`Images: ${result.imageCount}`);
  } else {
    // Batch file mode
    const urls = await parseBatchFile(args.input);
    if (urls.length === 0) {
      console.error("No valid URLs found in batch file.");
      process.exit(1);
    }
    console.log(`Found ${urls.length} URLs in ${args.input}`);

    const firstUrl = urls[0];
    await withChrome(firstUrl, false, async (cdp, sessionId) => {
      const result = await processBatch(
        urls,
        async (url, _idx) => {
          if (url !== firstUrl) {
            // Navigate to new URL within same Chrome instance
          }
          return processOneArticle(cdp, sessionId, url, args);
        },
        { delayMs: BATCH_INTER_ARTICLE_DELAY_MS, log: console.log }
      );

      console.log(`\n--- Summary ---`);
      console.log(`Succeeded: ${result.succeeded.length}`);
      console.log(`Failed: ${result.failed.length}`);
      if (result.failed.length > 0) {
        console.log("\nFailed URLs:");
        for (const f of result.failed) {
          console.log(`  ${f.url}: ${f.error}`);
        }
      }
    });
  }
}

async function handleSearchMode(args: Args): Promise<void> {
  const accountName = args.search;
  const max = isFinite(args.maxArticles) ? args.maxArticles : 10;

  await mkdir(args.output, { recursive: true });

  await withChrome("https://weixin.sogou.com", false, async (cdp, sessionId) => {
    // Search for articles
    const articles = await searchAccountArticles(cdp, sessionId, accountName, max, console.log);

    if (articles.length === 0) {
      console.error(`No articles found for "${accountName}".`);
      process.exit(1);
    }

    if (args.listOnly) {
      console.log(`\n--- Articles from "${accountName}" ---`);
      for (let i = 0; i < articles.length; i++) {
        console.log(`${String(i + 1).padStart(3)}. ${articles[i].title}`);
        console.log(`     ${articles[i].url}`);
      }
      return;
    }

    console.log(`\nDownloading ${articles.length} articles to ${args.output}/`);
    const urls = articles.map(a => a.url);

    const result = await processBatch(
      urls,
      async (url, _idx) => processOneArticle(cdp, sessionId, url, args),
      { delayMs: BATCH_INTER_ARTICLE_DELAY_MS, log: console.log }
    );

    console.log(`\n--- Summary ---`);
    console.log(`Succeeded: ${result.succeeded.length}`);
    console.log(`Failed: ${result.failed.length}`);
    if (result.failed.length > 0) {
      console.log("\nFailed URLs:");
      for (const f of result.failed) {
        console.log(`  ${f.url}: ${f.error}`);
      }
    }
  });
}

async function handleAccountMode(args: Args): Promise<void> {
  const config = loadApiConfig();
  if (!config) {
    console.error("WeChat API credentials not found.");
    console.error("Set WECHAT_APP_ID and WECHAT_APP_SECRET in:");
    console.error("  - .baoyu-skills/.env (project level)");
    console.error("  - ~/.baoyu-skills/.env (user level)");
    console.error("  - Environment variables");
    process.exit(1);
  }

  console.log("Fetching article list from WeChat API...");
  const articles = await listPublishedArticles(config, { maxArticles: args.maxArticles });
  console.log(`Found ${articles.length} published articles.`);

  if (articles.length === 0) {
    console.log("No articles found.");
    return;
  }

  if (args.listOnly) {
    console.log("\n--- Article List ---");
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      const date = new Date(a.createTime * 1000).toISOString().split("T")[0];
      console.log(`${String(i + 1).padStart(3)}. [${date}] ${a.title}`);
      console.log(`     ${a.url}`);
    }
    return;
  }

  const urls = articles.map(a => a.url).filter(Boolean);
  if (urls.length === 0) {
    console.error("No downloadable article URLs found.");
    process.exit(1);
  }

  await mkdir(args.output, { recursive: true });
  console.log(`\nDownloading ${urls.length} articles to ${args.output}/`);

  await withChrome(urls[0], false, async (cdp, sessionId) => {
    const result = await processBatch(
      urls,
      async (url, _idx) => processOneArticle(cdp, sessionId, url, args),
      { delayMs: BATCH_INTER_ARTICLE_DELAY_MS, log: console.log }
    );

    console.log(`\n--- Summary ---`);
    console.log(`Succeeded: ${result.succeeded.length}`);
    console.log(`Failed: ${result.failed.length}`);
    if (result.failed.length > 0) {
      console.log("\nFailed URLs:");
      for (const f of result.failed) {
        console.log(`  ${f.url}: ${f.error}`);
      }
    }
  });
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

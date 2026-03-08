import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const FREEPUBLISH_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/batchget";

export interface WeChatApiConfig {
  appId: string;
  appSecret: string;
}

export interface PublishedArticle {
  title: string;
  author: string;
  digest: string;
  url: string;
  thumbUrl: string;
  createTime: number;
}

function loadEnvFile(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;

  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  }
  return env;
}

export function loadApiConfig(): WeChatApiConfig | null {
  // Priority: env vars → project .env → user .env
  const cwdEnv = loadEnvFile(path.join(process.cwd(), ".wechat-article-downloader", ".env"));
  const homeEnv = loadEnvFile(path.join(process.env.HOME || "", ".wechat-article-downloader", ".env"));

  const appId = process.env.WECHAT_APP_ID || cwdEnv.WECHAT_APP_ID || homeEnv.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET || cwdEnv.WECHAT_APP_SECRET || homeEnv.WECHAT_APP_SECRET;

  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

async function getAccessToken(config: WeChatApiConfig): Promise<string> {
  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${config.appId}&secret=${config.appSecret}`;
  const res = await fetch(url);
  const data = await res.json() as { access_token?: string; errcode?: number; errmsg?: string };

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeChat API error ${data.errcode}: ${data.errmsg}`);
  }
  if (!data.access_token) {
    throw new Error("Failed to get access token");
  }
  return data.access_token;
}

export async function listPublishedArticles(
  config: WeChatApiConfig,
  options: { offset?: number; count?: number; maxArticles?: number } = {}
): Promise<PublishedArticle[]> {
  const accessToken = await getAccessToken(config);
  const maxArticles = options.maxArticles ?? Infinity;
  const pageSize = Math.min(options.count ?? 20, 20);
  let offset = options.offset ?? 0;
  const allArticles: PublishedArticle[] = [];

  while (allArticles.length < maxArticles) {
    const res = await fetch(`${FREEPUBLISH_URL}?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset, count: pageSize, no_content: 1 }),
    });

    const data = await res.json() as {
      errcode?: number;
      errmsg?: string;
      total_count?: number;
      item_count?: number;
      item?: Array<{
        article_id: string;
        content: {
          news_item: Array<{
            title: string;
            author: string;
            digest: string;
            url: string;
            thumb_url: string;
          }>;
          create_time: number;
        };
      }>;
    };

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`WeChat API error ${data.errcode}: ${data.errmsg}`);
    }

    const items = data.item ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      for (const article of item.content.news_item) {
        allArticles.push({
          title: article.title,
          author: article.author,
          digest: article.digest,
          url: article.url,
          thumbUrl: article.thumb_url,
          createTime: item.content.create_time,
        });
        if (allArticles.length >= maxArticles) break;
      }
      if (allArticles.length >= maxArticles) break;
    }

    offset += items.length;
    if ((data.item_count ?? 0) < pageSize) break;

    // Rate limit: WeChat API allows ~20 calls/second
    await new Promise(r => setTimeout(r, 200));
  }

  return allArticles;
}

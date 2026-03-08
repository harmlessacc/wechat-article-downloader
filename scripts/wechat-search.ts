import type { CdpConnection } from "./cdp.js";
import { evaluateScript } from "./cdp.js";

/**
 * Search for a WeChat Official Account's recent articles via Sogou Weixin Search.
 * Returns a list of article URLs.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const extractArticleLinksScript = `
(function() {
  var links = [];
  // Sogou weixin search result items
  var items = document.querySelectorAll('.news-list li, .news-box li, ul.news-list > li');
  items.forEach(function(item) {
    var a = item.querySelector('h3 a, .txt-box h3 a, a[href*="weixin.qq.com"]');
    if (a) {
      var href = a.href || a.getAttribute('href') || '';
      var title = a.textContent.trim();
      if (href && title) {
        links.push({ url: href, title: title });
      }
    }
  });

  // Fallback: any link pointing to mp.weixin.qq.com
  if (links.length === 0) {
    document.querySelectorAll('a[href]').forEach(function(a) {
      var href = a.href || '';
      var title = a.textContent.trim();
      if (href.indexOf('mp.weixin.qq.com') !== -1 && title && title.length > 4) {
        links.push({ url: href, title: title });
      }
    });
  }

  return links;
})()
`;

const extractAccountArticlesScript = `
(function() {
  var links = [];
  // On sogou account page, articles are listed
  document.querySelectorAll('a[href]').forEach(function(a) {
    var href = a.href || '';
    var title = a.textContent.trim();
    // Match weixin article links
    if ((href.indexOf('mp.weixin.qq.com/s') !== -1 || href.indexOf('weixin.qq.com/s?') !== -1)
        && title && title.length > 2) {
      // Deduplicate
      var exists = false;
      for (var i = 0; i < links.length; i++) {
        if (links[i].title === title) { exists = true; break; }
      }
      if (!exists) {
        links.push({ url: href, title: title });
      }
    }
  });
  return links;
})()
`;

export interface SearchResult {
  url: string;
  title: string;
}

export async function searchAccountArticles(
  cdp: CdpConnection,
  sessionId: string,
  accountName: string,
  maxArticles: number = 5,
  log?: (msg: string) => void,
): Promise<SearchResult[]> {
  // Step 1: Navigate to Sogou Weixin Search — search for account
  const searchUrl = `https://weixin.sogou.com/weixin?type=1&query=${encodeURIComponent(accountName)}&ie=utf8`;
  log?.(`Searching for account "${accountName}" on Sogou...`);

  await navigateAndWaitLoad(cdp, sessionId, searchUrl, 15_000);
  await sleep(2_000);

  // Step 2: Find the account link and click into it
  const clickAccountScript = `
  (function() {
    // Find the account matching the name
    var accounts = document.querySelectorAll('.news-box .img-box a, .news-list .img-box a, a.account_name, .txt-box a, p.tit a');
    for (var i = 0; i < accounts.length; i++) {
      var text = accounts[i].textContent.trim();
      if (text === "${accountName.replace(/"/g, '\\"')}") {
        return accounts[i].href || '';
      }
    }
    // Broader match
    var allLinks = document.querySelectorAll('a[href]');
    for (var i = 0; i < allLinks.length; i++) {
      var text = allLinks[i].textContent.trim();
      if (text.indexOf("${accountName.replace(/"/g, '\\"')}") !== -1 && allLinks[i].href.indexOf('sogou.com') !== -1) {
        return allLinks[i].href || '';
      }
    }
    return '';
  })()
  `;

  const accountPageUrl = await evaluateScript<string>(cdp, sessionId, clickAccountScript);

  let articles: SearchResult[] = [];

  if (accountPageUrl) {
    // Navigate to account page
    log?.(`Found account page, loading articles...`);
    await navigateAndWaitLoad(cdp, sessionId, accountPageUrl, 15_000);
    await sleep(2_000);

    articles = await evaluateScript<SearchResult[]>(cdp, sessionId, extractAccountArticlesScript);
  }

  // If no articles found via account page, try article search directly
  if (articles.length === 0) {
    log?.(`Trying article search...`);
    const articleSearchUrl = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(accountName)}&ie=utf8`;
    await navigateAndWaitLoad(cdp, sessionId, articleSearchUrl, 15_000);
    await sleep(2_000);

    articles = await evaluateScript<SearchResult[]>(cdp, sessionId, extractArticleLinksScript);
  }

  // Limit results
  const result = articles.slice(0, maxArticles);
  log?.(`Found ${result.length} articles.`);
  return result;
}

async function navigateAndWaitLoad(
  cdp: CdpConnection,
  sessionId: string,
  url: string,
  timeoutMs: number,
): Promise<void> {
  const loadPromise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      cdp.off("Page.lifecycleEvent", handler);
      resolve();
    }, timeoutMs);
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
}

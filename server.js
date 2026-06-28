import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// RSS Parser setup
const parser = new Parser();

// Memory Cache
let cachedAnalysis = null;
let cachedPrice = null;
let cachedNews = [];
let lastAnalysisTime = 0;
let isAnalyzing = false;
let analysisError = null;

const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes cooldown for manual refresh
const AUTO_REFRESH_MS = 15 * 60 * 1000; // 15 minutes auto-refresh

// Binance API: fetch BTC/USDT price data
async function fetchBTCPrice() {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
    if (!response.ok) throw new Error(`Binance API error: ${response.status}`);
    const data = await response.json();
    return {
      price: parseFloat(data.lastPrice),
      change24h: parseFloat(data.priceChangePercent),
      high24h: parseFloat(data.highPrice),
      low24h: parseFloat(data.lowPrice),
      volume24h: parseFloat(data.volume)
    };
  } catch (err) {
    console.error('Error fetching BTC price from Binance:', err.message);
    return cachedPrice || null; // fallback to cached price if available
  }
}

// Parse News RSS feeds
async function fetchNews() {
  const feeds = [
    { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { name: 'Decrypt', url: 'https://decrypt.co/feed' }
  ];

  const allArticles = [];
  for (const feed of feeds) {
    try {
      // Set a short timeout for each feed fetch to prevent blocking
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const parsed = await parser.parseURL(feed.url);
      clearTimeout(timeoutId);

      parsed.items.forEach(item => {
        allArticles.push({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
          source: feed.name,
          contentSnippet: item.contentSnippet || item.content || ''
        });
      });
    } catch (err) {
      console.error(`Error parsing feed ${feed.name}:`, err.message);
    }
  }

  // Sort by date descending
  allArticles.sort((a, b) => b.pubDate - a.pubDate);
  return allArticles.slice(0, 15);
}

// Generate Sentiment Analysis using Groq Llama-3.3-70b
async function generateAIAnalysis(priceInfo, newsArticles) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not defined in environment variables.');
  }

  const formattedNews = newsArticles.map((art, idx) => {
    return `${idx + 1}. [${art.source}] ${art.title}\n   Snippet: ${art.contentSnippet.slice(0, 150)}...`;
  }).join('\n\n');

  const prompt = `
Analyze the current Bitcoin (BTC) market status and recent news to provide a sentiment score, summary of key events, negative/positive factors, and a short-term outlook.

Current BTC/USDT price stats:
- Price: $${priceInfo.price.toLocaleString()}
- 24h Change: ${priceInfo.change24h}%
- 24h High: $${priceInfo.high24h.toLocaleString()}
- 24h Low: $${priceInfo.low24h.toLocaleString()}
- 24h Volume: ${priceInfo.volume24h.toLocaleString()} BTC

Recent aggregated news articles:
${formattedNews}

Provide your analysis in JSON format with the following keys. Please analyze in Vietnamese (tiếng Việt) for the summary, marketOutlook, and detailedAnalysis:
{
  "sentimentScore": <number between -100 and 100, where -100 is extremely bearish, 0 is neutral, and 100 is extremely bullish>,
  "sentimentLabel": "<Bullish | Bearish | Neutral>",
  "summary": ["<bullet point 1 in Vietnamese>", "<bullet point 2 in Vietnamese>", ...],
  "marketOutlook": "<1-2 sentence short term outlook in Vietnamese>",
  "detailedAnalysis": "<Detailed, paragraph-long market overview and trend analysis in Vietnamese. Support markdown.>",
  "keyFactors": {
    "positive": ["<positive driver 1 in Vietnamese>", ...],
    "negative": ["<negative driver 1 in Vietnamese>", ...]
  }
}
Respond strictly with valid JSON.
`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are an expert crypto market analyst who speaks fluent Vietnamese. You analyze news and price feeds to output precise, professional market reports. You must always return a JSON object conforming exactly to the requested schema. Do not write any explanations before or after the JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API returned error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const analysis = JSON.parse(content);
    analysis.timestamp = new Date().toISOString();
    return analysis;
  } catch (err) {
    console.error('Groq API Analysis failed:', err.message);
    throw err;
  }
}

// Background routine to refresh cached data
async function performAnalysis() {
  if (isAnalyzing) return;
  isAnalyzing = true;
  analysisError = null;
  console.log('Background Analysis started...');

  try {
    // 1. Get price
    const price = await fetchBTCPrice();
    if (!price) throw new Error('Could not fetch BTC price info.');
    cachedPrice = price;

    // 2. Get news
    const news = await fetchNews();
    if (!news || news.length === 0) throw new Error('Could not fetch crypto news.');
    cachedNews = news;

    // 3. Generate analysis
    const analysis = await generateAIAnalysis(price, news);
    cachedAnalysis = analysis;
    lastAnalysisTime = Date.now();
    console.log('Background Analysis completed successfully.');
  } catch (err) {
    console.error('Background Analysis failed:', err.message);
    analysisError = err.message;
  } finally {
    isAnalyzing = false;
  }
}

// Auto-refresh interval loop
setInterval(() => {
  console.log('Triggering scheduled auto-refresh of market data...');
  performAnalysis();
}, AUTO_REFRESH_MS);

// Run initial analysis on server start
performAnalysis();

// API: Get current market status (real-time price + news + cached AI analysis)
app.get('/api/market-status', async (req, res) => {
  // Fetch price real-time for each call to keep the live ticker fresh
  const livePrice = await fetchBTCPrice();
  if (livePrice) {
    cachedPrice = livePrice;
  }

  // Trigger background analysis if cache is empty or expired
  const age = Date.now() - lastAnalysisTime;
  if (!cachedAnalysis && !isAnalyzing) {
    // block first call to let analysis complete if it is the absolute start
    await performAnalysis();
  } else if (age > AUTO_REFRESH_MS && !isAnalyzing) {
    // trigger background refresh without blocking client
    performAnalysis();
  }

  res.json({
    price: cachedPrice,
    news: cachedNews,
    analysis: cachedAnalysis,
    lastUpdated: lastAnalysisTime,
    isAnalyzing,
    error: analysisError,
    cooldownRemaining: Math.max(0, COOLDOWN_MS - (Date.now() - lastAnalysisTime))
  });
});

// API: Force refresh analysis
app.post('/api/analyze', async (req, res) => {
  const timeSinceLast = Date.now() - lastAnalysisTime;
  if (isAnalyzing) {
    return res.status(429).json({ error: 'Analysis is currently running in the background.' });
  }

  if (timeSinceLast < COOLDOWN_MS) {
    const waitSeconds = Math.ceil((COOLDOWN_MS - timeSinceLast) / 1000);
    return res.status(429).json({ 
      error: `Please wait ${waitSeconds} seconds before refreshing the analysis again.`,
      cooldownRemaining: COOLDOWN_MS - timeSinceLast
    });
  }

  console.log('User triggered manual analysis refresh...');
  // Run synchronously so client gets the new analysis immediately
  await performAnalysis();

  if (analysisError) {
    return res.status(500).json({ error: 'Failed to perform analysis', details: analysisError });
  }

  res.json({
    price: cachedPrice,
    news: cachedNews,
    analysis: cachedAnalysis,
    lastUpdated: lastAnalysisTime
  });
});

// Catch-all route to serve the SPA frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Crypto AI Aggregator Server is running on port ${PORT}`);
});

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
let cachedNewsDigest = '';
let lastAnalysisTime = 0;
let lastHelperTime = 0;
let isAnalyzing = false;
let isHelperRunning = false;
let analysisError = null;

const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes cooldown for manual refresh
const AUTO_REFRESH_MS = 15 * 60 * 1000; // 15 minutes auto-refresh
const HELPER_INTERVAL_MS = 30 * 1000; // 30 seconds interval for 8B helper bot

// OKX API: fetch BTC/USDT price data (matches user's preferred OKX rates)
async function fetchBTCPriceOKX() {
  try {
    const response = await fetch('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
    if (!response.ok) throw new Error(`OKX API error: ${response.status}`);
    const resData = await response.json();
    if (resData.code !== '0' || !resData.data || resData.data.length === 0) {
      throw new Error(`OKX API returned bad code: ${resData.msg}`);
    }
    const data = resData.data[0];
    const last = parseFloat(data.last);
    const open = parseFloat(data.open24h);
    const change24h = ((last - open) / open) * 100;

    return {
      price: last,
      change24h: change24h,
      high24h: parseFloat(data.high24h),
      low24h: parseFloat(data.low24h),
      volume24h: parseFloat(data.vol24h)
    };
  } catch (err) {
    console.error('Error fetching BTC price from OKX:', err.message);
    return null;
  }
}

// Coinbase API: fetch BTC price data (friendly to cloud services like Render)
async function fetchBTCPriceCoinbase() {
  try {
    const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/stats', {
      headers: { 'User-Agent': 'CryptoPulseAI/1.0' }
    });
    if (!response.ok) throw new Error(`Coinbase API error: ${response.status}`);
    const data = await response.json();
    const open = parseFloat(data.open);
    const last = parseFloat(data.last);
    const change24h = ((last - open) / open) * 100;
    
    return {
      price: last,
      change24h: change24h,
      high24h: parseFloat(data.high),
      low24h: parseFloat(data.low),
      volume24h: parseFloat(data.volume)
    };
  } catch (err) {
    console.error('Error fetching BTC price from Coinbase:', err.message);
    return null;
  }
}

// Fetch BTC/USDT price data with multi-source fallback
async function fetchBTCPrice() {
  // 1. Try OKX first (user preferred exchange rates)
  const okxPrice = await fetchBTCPriceOKX();
  if (okxPrice) return okxPrice;

  // 2. Try Coinbase second (extremely cloud-friendly fallback)
  console.log('Falling back to Coinbase API...');
  const cbPrice = await fetchBTCPriceCoinbase();
  if (cbPrice) return cbPrice;

  // 3. Try Binance third (local fallback)
  console.log('Falling back to Binance API...');
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

// Parse News RSS feeds (handles user-agent blocks and cleans unescaped XML entities)
async function fetchNews() {
  const feeds = [
    { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { name: 'Decrypt', url: 'https://decrypt.co/feed' },
    { name: 'Blockworks', url: 'https://blockworks.co/feed' }
  ];

  const allArticles = [];
  for (const feed of feeds) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`Status ${response.status}`);
      const xmlText = await response.text();
      // Clean up raw unescaped '&' which causes sax parser errors
      const cleanXml = xmlText.replace(/&(?!(?:[a-zA-Z]+|#[0-9]+|#x[0-9a-fA-F]+);)/g, '&amp;');
      
      const parsed = await parser.parseString(cleanXml);

      parsed.items.forEach(item => {
        allArticles.push({
          title: item.title || '',
          link: item.link || '',
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
  // Return top 30 to give the helper AI a wider choice
  return allArticles.slice(0, 30);
}

// Helper Bot: uses llama-3.1-8b-instant to pre-filter, summarize, and translate 30 news articles
async function generateHelperAnalysis(newsArticles) {
  const apiKey = process.env.GROQ_API_KEY_HELPER || process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('No Groq API Key defined for Helper.');
  }

  const formattedNews = newsArticles.map((art, idx) => {
    return `${idx + 1}. [${art.source}] Title: ${art.title}\n   Snippet: ${art.contentSnippet.slice(0, 200)}`;
  }).join('\n\n');

  const prompt = `
Bạn là trợ lý AI tìm kiếm và lọc tin tức crypto. Hãy xử lý danh sách 30 bài báo tiếng Anh sau.

Nhiệm vụ:
1. Lọc ra khoảng 10-12 bài viết quan trọng nhất, có ảnh hưởng lớn nhất đến giá Bitcoin và thị trường crypto.
2. Dịch tiêu đề (Title) và mô tả ngắn (Snippet) của các bài viết được chọn sang tiếng Việt chuẩn, tự nhiên.
3. Viết 1 đoạn văn ngắn (từ 3-4 câu) tóm tắt xu hướng/chủ đề chính của các tin tức này (news digest).

YÊU CẦU QUAN TRỌNG:
- Trả về kết quả CHỈ ở định dạng JSON theo cấu trúc dưới đây.
- VIẾT HOÀN TOÀN BẰNG TIẾNG VIỆT CHUẨN, TỰ NHIÊN.
- TUYỆT ĐỐI KHÔNG sử dụng bất kỳ ký tự tiếng Trung nào (ví dụ: KHÔNG DÙNG 缺乏, 缺少, 難, mà phải dùng từ tiếng Việt như "thiếu", "cần", "khó khăn").
- Đảm bảo viết đúng ngữ pháp tiếng Việt, không bị dính chữ hay thiếu dấu.

Cấu trúc JSON yêu cầu:
{
  "newsDigest": "<đoạn văn tóm tắt xu hướng tin tức bằng tiếng Việt>",
  "translatedNews": [
    {
      "title": "<tiêu đề dịch sang tiếng Việt>",
      "snippet": "<mô tả ngắn dịch sang tiếng Việt>",
      "source": "<tên nguồn, ví dụ CoinTelegraph>",
      "link": "<đường dẫn link gốc của bài viết>"
    },
    ...
  ]
}
`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL_HELPER || 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a professional crypto translator. You translate English news to Vietnamese. You MUST write only in Vietnamese and return a JSON object. You are strictly forbidden from outputting Chinese characters.'
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
      throw new Error(`Helper Groq API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  } catch (err) {
    console.error('Helper AI Analysis failed:', err.message);
    throw err;
  }
}

// Generate Sentiment Analysis using Groq Llama-3.3-70b
async function generateAIAnalysis(priceInfo, newsDigest, newsArticles) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not defined in environment variables.');
  }

  const formattedNews = newsArticles.map((art, idx) => {
    return `${idx + 1}. [${art.source}] ${art.title}\n   Tóm tắt: ${art.snippet}`;
  }).join('\n\n');

  const prompt = `
Phân tích trạng thái thị trường Bitcoin (BTC) dựa trên giá hiện tại và các tin tức đã được dịch tóm tắt sau đây để đưa ra điểm số tâm lý, nhận định chi tiết, triển vọng ngắn hạn và các yếu tố tác động.

Thông tin giá BTC/USDT hiện tại (từ OKX):
- Giá hiện tại: $${priceInfo.price.toLocaleString()}
- Thay đổi 24h: ${priceInfo.change24h}%
- Giá cao nhất 24h: $${priceInfo.high24h.toLocaleString()}
- Giá thấp nhất 24h: $${priceInfo.low24h.toLocaleString()}
- Khối lượng 24h: ${priceInfo.volume24h.toLocaleString()} BTC

Tóm tắt xu hướng tin tức thị trường:
${newsDigest}

Chi tiết các tin tức thị trường gần đây:
${formattedNews}

Yêu cầu phân tích và trả về định dạng JSON dưới đây.
QUY TẮC BẮT BUỘC:
- Viết văn bản hoàn toàn bằng TIẾNG VIỆT CHUẨN, tự nhiên, mạch lạc, chuyên nghiệp.
- TUYỆT ĐỐI KHÔNG sử dụng ký tự tiếng Trung hay bất kỳ từ tiếng Trung nào (ví dụ: KHÔNG DÙNG 缺乏, 缺少, 難, mà phải dùng từ tiếng Việt như "thiếu", "cần", "khó khăn").
- Đảm bảo các từ không bị dính vào nhau (ví dụ: viết "và thiếu" thay vì "vàthiếu" hay "và缺乏").

Cấu trúc JSON phản hồi:
{
  "sentimentScore": <số từ -100 đến 100, trong đó -100 là cực kỳ tiêu cực, 0 là trung lập, 100 là cực kỳ tích cực>,
  "sentimentLabel": "<Tích cực | Tiêu cực | Trung lập>",
  "summary": ["<tóm tắt điểm tin chính 1 bằng tiếng Việt>", "<tóm tắt điểm tin chính 2 bằng tiếng Việt>", ...],
  "marketOutlook": "<Nhận định triển vọng ngắn hạn bằng tiếng Việt, từ 1-2 câu>",
  "detailedAnalysis": "<Phân tích xu hướng thị trường chi tiết bằng tiếng Việt, hỗ trợ markdown, viết mạch lạc thành đoạn văn chuyên nghiệp>",
  "keyFactors": {
    "positive": ["<yếu tố thúc đẩy tích cực 1>", ...],
    "negative": ["<yếu tố tiêu cực/rủi ro 1>", ...]
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
            content: 'You are an expert crypto market analyst who speaks fluent Vietnamese. You write only in Vietnamese and return a JSON object. You are strictly forbidden from outputting Chinese characters.'
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

// Background Helper Search routine: runs every 30 seconds
async function performHelperSearch() {
  if (isHelperRunning) return;
  isHelperRunning = true;
  console.log('30s Helper Search & Translation started...');

  try {
    const price = await fetchBTCPrice();
    if (price) cachedPrice = price;

    const rawNews = await fetchNews();
    if (rawNews && rawNews.length > 0) {
      const helperResult = await generateHelperAnalysis(rawNews);
      if (helperResult.translatedNews && helperResult.translatedNews.length > 0) {
        cachedNews = helperResult.translatedNews;
        cachedNewsDigest = helperResult.newsDigest;
        lastHelperTime = Date.now();
        console.log('30s Helper Search completed. Translated', cachedNews.length, 'articles.');
      }
    }
  } catch (err) {
    console.error('30s Helper Search failed:', err.message);
  } finally {
    isHelperRunning = false;
  }
}

// Background routine to refresh cached analysis (Llama 3.3)
async function performAnalysis() {
  if (isAnalyzing) return;
  isAnalyzing = true;
  analysisError = null;
  console.log('Main 70B Analysis started...');

  try {
    // 1. Get price
    const price = await fetchBTCPrice();
    if (!price) throw new Error('Could not fetch BTC price info.');
    cachedPrice = price;

    // 2. Ensure helper has run at least once
    if (cachedNews.length === 0) {
      await performHelperSearch();
    }

    if (cachedNews.length === 0) {
      throw new Error('Helper Search failed to retrieve news.');
    }

    // 3. Generate 70B analysis
    const analysis = await generateAIAnalysis(price, cachedNewsDigest, cachedNews);
    cachedAnalysis = analysis;
    lastAnalysisTime = Date.now();
    console.log('Main 70B Analysis completed successfully.');
  } catch (err) {
    console.error('Main 70B Analysis failed:', err.message);
    analysisError = err.message;
  } finally {
    isAnalyzing = false;
  }
}

// Initialization routine on server startup
async function init() {
  console.log('Initializing Server: Performing startup Helper Search and Main 70B Analysis...');
  await performHelperSearch();
  await performAnalysis();

  // Schedule intervals
  setInterval(performHelperSearch, HELPER_INTERVAL_MS);
  setInterval(performAnalysis, AUTO_REFRESH_MS);
}
init();

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
    await performAnalysis();
  } else if (age > AUTO_REFRESH_MS && !isAnalyzing) {
    performAnalysis();
  }

  res.json({
    price: cachedPrice,
    news: cachedNews,
    analysis: cachedAnalysis,
    lastUpdated: lastAnalysisTime,
    lastHelperUpdated: lastHelperTime,
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
  
  // Force update helper news first so the main analysis is completely fresh
  await performHelperSearch();
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

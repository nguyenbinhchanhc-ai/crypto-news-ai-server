// DOM Elements
const btcPriceEl = document.getElementById('btc-price');
const btcChangeEl = document.getElementById('btc-change');
const sentimentFillEl = document.getElementById('sentiment-fill');
const sentimentValEl = document.getElementById('sentiment-val');
const sentimentBadgeEl = document.getElementById('sentiment-badge');
const analysisTimeEl = document.getElementById('analysis-time');
const cooldownTimerEl = document.getElementById('cooldown-timer');
const summaryListEl = document.getElementById('summary-list');
const marketOutlookEl = document.getElementById('market-outlook');
const detailedAnalysisEl = document.getElementById('detailed-analysis');
const positiveFactorsEl = document.getElementById('positive-factors');
const negativeFactorsEl = document.getElementById('negative-factors');
const newsListEl = document.getElementById('news-list');
const btnRefreshEl = document.getElementById('btn-refresh');
const refreshIconEl = document.getElementById('refresh-icon');
const loaderOverlayEl = document.getElementById('loader-overlay');

let cooldownInterval = null;

// Helpers
function formatPrice(val) {
  if (val === null || val === undefined) return '$--,---.--';
  return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(val) {
  if (val === null || val === undefined) return '0.00%';
  const prefix = val > 0 ? '+' : '';
  return prefix + val.toFixed(2) + '%';
}

function formatDate(dateStr) {
  if (!dateStr) return 'Đang cập nhật...';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + d.toLocaleDateString('vi-VN');
}

// Convert simple markdown string to HTML format
function parseSimpleMarkdown(text) {
  if (!text) return '';
  
  // Replace headers (###, ##)
  let html = text.replace(/### (.*?)(?:\n|$)/g, '<h4>$1</h4>');
  html = html.replace(/## (.*?)(?:\n|$)/g, '<h3>$1</h3>');
  
  // Replace bold (**text**)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Replace list items starting with dash or bullet
  html = html.replace(/^\s*[-*]\s+(.*?)(?:\n|$)/gm, '<li>$1</li>');
  
  // Wrap consecutive <li> tags in <ul>
  html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');
  
  // Convert newlines to paragraphs
  html = '<p>' + html.split('\n\n').join('</p><p>').split('\n').join('<br>') + '</p>';
  
  // Clean up empty tags and adjacent block formatting conflicts
  html = html.replace(/<p>\s*<\/p>/g, '')
             .replace(/<p>(<h3>.*?<\/h3>)<\/p>/g, '$1')
             .replace(/<p>(<h4>.*?<\/h4>)<\/p>/g, '$1')
             .replace(/<p>(<ul>.*?<\/ul>)<\/p>/g, '$1');
             
  return html;
}

// Render data onto the page
function renderDashboard(data) {
  // 1. Render Price
  if (data.price) {
    btcPriceEl.textContent = formatPrice(data.price.price);
    btcChangeEl.textContent = formatPercent(data.price.change24h);
    
    // Color price badge based on positive/negative change
    btcChangeEl.className = 'price-change-badge';
    if (data.price.change24h > 0) {
      btcChangeEl.style.backgroundColor = 'var(--color-bullish-glow)';
      btcChangeEl.style.color = 'var(--color-bullish)';
      btcChangeEl.style.border = '1px solid var(--color-bullish)';
    } else if (data.price.change24h < 0) {
      btcChangeEl.style.backgroundColor = 'var(--color-bearish-glow)';
      btcChangeEl.style.color = 'var(--color-bearish)';
      btcChangeEl.style.border = '1px solid var(--color-bearish)';
    } else {
      btcChangeEl.style.backgroundColor = 'var(--color-neutral-glow)';
      btcChangeEl.style.color = 'var(--color-neutral)';
      btcChangeEl.style.border = '1px solid var(--color-neutral)';
    }
  }

  // 2. Render News List
  if (data.news && data.news.length > 0) {
    newsListEl.innerHTML = '';
    data.news.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = 'news-item';
      
      const timeStr = formatDate(item.pubDate);
      
      itemEl.innerHTML = `
        <a href="${item.link}" target="_blank" class="news-item-title">${item.title}</a>
        <div class="news-meta">
          <span class="news-source">${item.source}</span>
          <span>${timeStr}</span>
        </div>
      `;
      newsListEl.appendChild(itemEl);
    });
  }

  // 3. Render AI Analysis & Sentiment
  if (data.analysis) {
    const analysis = data.analysis;
    
    // Update Sentiment Score Gauge
    // Map -100 to 100 -> 0deg to 180deg
    const score = analysis.sentimentScore;
    sentimentValEl.textContent = score > 0 ? `+${score}` : score;
    const rotation = ((score + 100) / 200) * 180;
    sentimentFillEl.style.transform = `rotate(${rotation}deg)`;
    
    // Sentiment Badge
    sentimentBadgeEl.textContent = analysis.sentimentLabel;
    sentimentBadgeEl.className = 'sentiment-badge';
    const label = analysis.sentimentLabel.toLowerCase();
    if (label.includes('bullish') || label.includes('tích cực') || label.includes('tăng')) {
      sentimentBadgeEl.classList.add('bullish');
    } else if (label.includes('bearish') || label.includes('tiêu cực') || label.includes('giảm')) {
      sentimentBadgeEl.classList.add('bearish');
    } else {
      sentimentBadgeEl.classList.add('neutral');
    }
    
    // Update Time
    analysisTimeEl.textContent = `Phân tích lúc: ${formatDate(analysis.timestamp)}`;
    
    // Bullet Summary
    if (analysis.summary && analysis.summary.length > 0) {
      summaryListEl.innerHTML = '';
      analysis.summary.forEach(point => {
        const li = document.createElement('li');
        li.textContent = point;
        summaryListEl.appendChild(li);
      });
    }
    
    // Market Outlook
    marketOutlookEl.textContent = analysis.marketOutlook || 'Không có triển vọng cụ thể.';
    
    // Detailed Analysis
    detailedAnalysisEl.innerHTML = parseSimpleMarkdown(analysis.detailedAnalysis);
    
    // Positive Factors
    if (analysis.keyFactors && analysis.keyFactors.positive) {
      positiveFactorsEl.innerHTML = '';
      analysis.keyFactors.positive.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f;
        positiveFactorsEl.appendChild(li);
      });
    }
    
    // Negative Factors
    if (analysis.keyFactors && analysis.keyFactors.negative) {
      negativeFactorsEl.innerHTML = '';
      analysis.keyFactors.negative.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f;
        negativeFactorsEl.appendChild(li);
      });
    }
  }
}

// Start visual cooldown counter
function startCooldownTimer(msRemaining) {
  if (cooldownInterval) clearInterval(cooldownInterval);
  
  btnRefreshEl.disabled = true;
  cooldownTimerEl.classList.remove('hidden');
  
  let secondsLeft = Math.ceil(msRemaining / 1000);
  
  function updateTimerText() {
    if (secondsLeft <= 0) {
      clearInterval(cooldownInterval);
      cooldownTimerEl.classList.add('hidden');
      btnRefreshEl.disabled = false;
      return;
    }
    
    const minutes = Math.floor(secondsLeft / 60);
    const seconds = secondsLeft % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    cooldownTimerEl.textContent = `Yêu cầu làm mới khả dụng sau: ${formattedTime}`;
    secondsLeft--;
  }
  
  updateTimerText();
  cooldownInterval = setInterval(updateTimerText, 1000);
}

// Fetch general server status (polls background)
async function fetchStatus(isManual = false) {
  try {
    if (isManual) {
      loaderOverlayEl.classList.add('active');
      refreshIconEl.classList.add('loading');
    }
    
    const response = await fetch('/api/market-status');
    if (!response.ok) throw new Error('Không thể kết nối với server.');
    const data = await response.json();
    
    renderDashboard(data);
    
    // Check if client is in cooldown
    if (data.cooldownRemaining > 0) {
      startCooldownTimer(data.cooldownRemaining);
    }
  } catch (err) {
    console.error('Lỗi khi lấy dữ liệu từ server:', err.message);
  } finally {
    if (isManual) {
      loaderOverlayEl.classList.remove('active');
      refreshIconEl.classList.remove('loading');
    }
  }
}

// Trigger Manual AI Analysis
async function triggerAnalysis() {
  try {
    loaderOverlayEl.classList.add('active');
    refreshIconEl.classList.add('loading');
    btnRefreshEl.disabled = true;
    
    const response = await fetch('/api/analyze', { method: 'POST' });
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 429 && data.cooldownRemaining) {
        startCooldownTimer(data.cooldownRemaining);
        alert(data.error);
        return;
      }
      throw new Error(data.error || 'Yêu cầu phân tích thất bại.');
    }
    
    renderDashboard(data);
    // Start standard cooldown
    startCooldownTimer(3 * 60 * 1000);
  } catch (err) {
    console.error('Lỗi phân tích:', err.message);
    alert('Lỗi phân tích: ' + err.message);
    btnRefreshEl.disabled = false;
  } finally {
    loaderOverlayEl.classList.remove('active');
    refreshIconEl.classList.remove('loading');
  }
}

// Event Listeners
btnRefreshEl.addEventListener('click', triggerAnalysis);

// Initialize
// Fetch status immediately on page load
fetchStatus(false);

// Poll live prices every 10 seconds
setInterval(() => {
  fetchStatus(false);
}, 10000);

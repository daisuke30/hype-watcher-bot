// Hyperliquid Watcher Bot - Simple Version
// Monitors transactions of a target address and sends notifications via Telegram

// Import required libraries
require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const { formatEther, parseEther } = require('@ethersproject/units');

// Configuration
const TARGET_ADDRESS = '0xf3F496C9486BE5924a93D67e98298733Bb47057c';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TRADING_ENABLED = process.env.TRADING_ENABLED === 'true';
const HYPERLIQUID_PRIVATE_KEY = process.env.HYPERLIQUID_PRIVATE_KEY;

// API endpoints
const HYPERLIQUID_REST_API = 'https://api.hyperliquid.xyz';
const HYPERLIQUID_WS_API = 'wss://api.hyperliquid.xyz/ws';
const EXPLORER_URL = 'https://hypurrscan.io';

// Initialize Telegram bot
const telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Cache data
let knownTrades = new Set(); // Keep track of processed trades
let marketsCache = null; // Cache for market information

// Function to send notification
async function sendNotification(message) {
  try {
    await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });
    console.log(`[INFO] Notification sent`);
    return true;
  } catch (error) {
    console.error(`[ERROR] Failed to send notification:`, error);
    return false;
  }
}

// Function to format numbers
function formatNumber(num, decimals = 2) {
  return Number(num).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// Function to generate trade ID
function generateTradeId(trade) {
  return `${trade.coin}-${trade.time}-${trade.side}-${trade.sz}`;
}

// Function to fetch market information
async function fetchMarkets() {
  try {
    const response = await axios.post(`${HYPERLIQUID_REST_API}/info`, {
      type: 'metaAndAssetCtxs'
    });

    // Convert array to map for easier lookups
    const marketsMap = {};
    response.data.universe.forEach(market => {
      marketsMap[market.name] = market;
    });

    return marketsMap;
  } catch (error) {
    console.error('[ERROR] Failed to fetch market information:', error);
    return {};
  }
}

// Function to get price information for a specific asset
async function getMarketData(asset) {
  try {
    const response = await axios.post(`${HYPERLIQUID_REST_API}/info`, {
      type: 'allMids'
    });

    // Find price information for the requested asset
    const marketData = response.data.find(m => m.name === asset);
    return marketData || null;
  } catch (error) {
    console.error(`[ERROR] Failed to fetch price information for ${asset}:`, error);
    return null;
  }
}

// Function to fetch user's trade history
async function fetchUserTrades() {
  try {
    const response = await axios.post(`${HYPERLIQUID_REST_API}/info`, {
      type: 'userFills',
      user: TARGET_ADDRESS
    });

    return response.data;
  } catch (error) {
    console.error('[ERROR] Failed to fetch trade history:', error);
    return [];
  }
}

// Function to fetch user's position information
async function fetchUserPositions() {
  try {
    const response = await axios.post(`${HYPERLIQUID_REST_API}/info`, {
      type: 'clearinghouseState',
      user: TARGET_ADDRESS
    });

    return response.data;
  } catch (error) {
    console.error('[ERROR] Failed to fetch position information:', error);
    return null;
  }
}

// Function to send trade notification
async function sendTradeNotification(trade) {
  const price = parseFloat(trade.px);
  const size = parseFloat(trade.sz);
  const usdValue = price * size;
  const action = trade.side === 'B' ? '🟢 BUY' : '🔴 SELL';

  let message = `${action} trade detected!\n\n`;
  message += `<b>Asset:</b> ${trade.coin}\n`;
  message += `<b>Size:</b> ${formatNumber(size)} (≈$${formatNumber(usdValue)})\n`;
  message += `<b>Price:</b> $${formatNumber(price)}\n`;
  message += `<b>Time:</b> ${new Date(trade.time).toLocaleString()}\n\n`;
  message += `<a href="${EXPLORER_URL}/address/${TARGET_ADDRESS}">View on Hypurrscan</a>`;

  return sendNotification(message);
}

// Function to send position notification
async function sendPositionNotification(positions) {
  if (!positions || !positions.assetPositions) {
    return sendNotification('⚠️ Failed to fetch position information');
  }

  let message = `📊 <b>Current Positions:</b>\n\n`;

  if (positions.assetPositions.length === 0) {
    message += 'No open positions';
  } else {
    for (const position of positions.assetPositions) {
      const positionSize = parseFloat(position.position);
      const side = positionSize > 0 ? '🟢 LONG' : '🔴 SHORT';
      const entryPrice = parseFloat(position.entryPx);
      const pnl = parseFloat(position.unrealizedPnl);
      const pnlSymbol = pnl >= 0 ? '✅' : '❌';

      message += `<b>${position.coin}:</b> ${side}\n`;
      message += `<b>Size:</b> ${formatNumber(Math.abs(positionSize))}\n`;
      message += `<b>Entry Price:</b> $${formatNumber(entryPrice)}\n`;
      message += `<b>PnL:</b> ${pnlSymbol} $${formatNumber(Math.abs(pnl))}\n\n`;
    }
  }

  message += `<a href="${EXPLORER_URL}/address/${TARGET_ADDRESS}">View on Hypurrscan</a>`;

  return sendNotification(message);
}

// Function to analyze trade
async function analyzeTrade(trade) {
  // Generate trade ID
  const tradeId = generateTradeId(trade);

  // Skip if trade already processed
  if (knownTrades.has(tradeId)) {
    return;
  }

  // Record as known trade
  knownTrades.add(tradeId);

  // Send notification
  await sendTradeNotification(trade);

  // Execute mirroring trade if enabled
  if (TRADING_ENABLED && HYPERLIQUID_PRIVATE_KEY) {
    // Add trade execution logic here (implementation omitted)
    console.log(`[INFO] Simulating trade mirroring: ${trade.side === 'B' ? 'buy' : 'sell'} ${trade.coin}`);
  }
}

// Function to poll for new trades
async function pollForNewTrades() {
  try {
    // Initialize market information if not available
    if (!marketsCache) {
      marketsCache = await fetchMarkets();
    }

    // Get trade history
    const trades = await fetchUserTrades();

    // Process the latest 10 trades
    for (const trade of trades.slice(0, 10)) {
      await analyzeTrade(trade);
    }
  } catch (error) {
    console.error('[ERROR] Error while polling for trades:', error);
  }
}

// Function to check positions
async function checkPositions() {
  try {
    const positions = await fetchUserPositions();
    await sendPositionNotification(positions);
  } catch (error) {
    console.error('[ERROR] Error while checking positions:', error);
  }
}

// Function to set up WebSocket connection
function setupWebSocket() {
  try {
    const ws = new WebSocket(HYPERLIQUID_WS_API);

    ws.on('open', () => {
      console.log('[INFO] WebSocket connection established');

      // Subscribe to user trades
      ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: {
          type: 'userFills',
          user: TARGET_ADDRESS
        }
      }));
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle different types of messages
        if (message.channel === 'userFills' && message.data) {
          if (Array.isArray(message.data)) {
            for (const trade of message.data) {
              await analyzeTrade(trade);
            }
          } else if (message.data && typeof message.data === 'object') {
            // Single trade data
            await analyzeTrade(message.data);
          } else {
            console.log('[INFO] Received data is not in expected format:', message.data);
          }
        }
      } catch (error) {
        console.error('[ERROR] Error processing WebSocket message:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('[ERROR] WebSocket error:', error);
      // Attempt to reconnect
      setTimeout(() => setupWebSocket(), 5000);
    });

    ws.on('close', () => {
      console.log('[INFO] WebSocket connection closed');
      // Attempt to reconnect
      setTimeout(() => setupWebSocket(), 5000);
    });

    return ws;
  } catch (error) {
    console.error('[ERROR] Error setting up WebSocket:', error);
    return null;
  }
}

// Function to run tests
function runTests() {
  // Test Telegram notification
  sendNotification('🧪 Bot test: Notification system is working')
    .then(() => console.log('[TEST] Notification test completed'))
    .catch(err => console.error('[TEST] Notification test failed:', err));

  // Test API connection
  fetchMarkets()
    .then(markets => {
      if (Object.keys(markets).length > 0) {
        console.log('[TEST] API connection successful - received market data');
      } else {
        console.log('[TEST] API connection test inconclusive - no market data');
      }
    })
    .catch(err => console.error('[TEST] API connection test failed:', err));

  // Test WebSocket (indirectly)
  console.log('[TEST] WebSocket test: Check if "[INFO] WebSocket connection established" appears in logs');
}

// Main function
async function main() {
  console.log(`[INFO] Starting to watch address ${TARGET_ADDRESS}`);
  await sendNotification(`🔍 Started monitoring address ${TARGET_ADDRESS}`);

  // Fetch initial data
  await pollForNewTrades();
  await checkPositions();

  // Set polling interval (every 1 minute)
  setInterval(pollForNewTrades, 60 * 1000);

  // Set position check interval (every 5 minutes)
  setInterval(checkPositions, 5 * 60 * 1000);

  // Set up WebSocket connection
  const ws = setupWebSocket();

  // Uncomment for testing
  setTimeout(runTests, 3000);

  // Handle shutdown properly
  process.on('SIGINT', async () => {
    console.log('[INFO] Shutting down...');
    await sendNotification('🛑 Bot is shutting down');

    if (ws) {
      ws.close();
    }

    process.exit(0);
  });
}

// Start program
main().catch(error => {
  console.error('[ERROR] Error in main process:', error);
  sendNotification(`❌ Bot crashed: ${error.message}`);
});

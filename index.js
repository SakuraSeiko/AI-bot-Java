Const http = require('http');
Const mineflayer = require('mineflayer');
Const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
Const { initGemini, analyzeMessage } = require('./gemini');

Const PORT = process.env.PORT || 3000;

// HTTP server required for Render uptime checks
Const server = http.createServer((req, res) => {
  Res.writeHead(200, { 'Content-Type': 'text/plain' });
  Res.end('Alice AI Bot Service is active.\n');
});

Server.listen(PORT, () => {
  Console.log(`[SYSTEM] Web server listening on port ${PORT}`);
  InitGemini();
  InitBot();
});

Function initBot() {
  If (!process.env.GEMINI_API_KEY) {
    Console.error('[ERROR] GEMINI_API_KEY environment variable is missing!');
    Return;
  }

  Console.log('[BOT] Connecting to EsnaSeiko.aternos.me:51316...');

  Const bot = mineflayer.createBot({
    Host: 'EsnaSeiko.aternos.me',
    Port: 51316,
    Username: 'Alice',
    Version: '1.21'
  });

  Bot.on('login', () => {
    Console.log('[BOT] Successfully logged in to the server.');
  });

  Bot.on('spawn', () => {
    Console.log('[BOT] Alice spawned in the world.');
    Try {
      Bot.loadPlugin(pathfinder);
      Const defaultMove = new Movements(bot);
      Bot.pathfinder.setMovements(defaultMove);
      Console.log('[PATHFINDER SETUP] Pathfinder ready!');
    } catch (e) {
      Console.log('[PATHFINDER SETUP ERROR]', e.message);
    }
  });

  // Bot actions definitions
  Const botActions = {
    Async walkTo({ x, y, z }) {
      Bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
      Return `Walking to X:${x} Y:${y} Z:${z}`;
    },

    Async followPlayer({ targetUsername }) {
      Const player = bot.players[targetUsername]?.entity;
      If (!player) return `Player ${targetUsername} not visible.`;
      Bot.pathfinder.setGoal(new goals.GoalFollow(player, 2), true);
      Return `Following ${targetUsername}`;
    },

    Async digBlock({ x, y, z }) {
      Const targetBlock = bot.blockAt(bot.vec3(x, y, z));
      If (!targetBlock || targetBlock.name === 'air') return "No block there.";
      Try {
        Await bot.dig(targetBlock);
        Return `Mined ${targetBlock.name}`;
      } catch (err) {
        Return `Mining error: ${err.message}`;
      }
    },

    Async chatMessage({ message }) {
      // Wysyłanie przez /me
      Bot.chat(`/me ${message}`);
      Return `Sent message: ${message}`;
    }
  };

  // Universal message listener for MC 1.21 packet compatibility
  Bot.on('message', async (jsonMsg, position) => {
    If (position === 'game_info') return;

    Const fullText = jsonMsg.toString();
    If (!fullText.trim()) return;

    Console.log(`[RAW CHAT RECEIVED] ${fullText}`);

    // Updated regex allowing dots, dashes, and standard characters in usernames
    Const match = fullText.match(/^(?:<|\[)?([.\w-]+)(?:>|\])?[:\s]\s*(.+)$/);
    
    Let username = null;
    Let messageText = fullText;

    If (match) {
      Username = match[1];
      MessageText = match[2];
    }

    // Ignore self messages
    If (username === bot.username || fullText.includes(bot.username)) return;

    // Ignore messages starting with Alice or Alice:
    If (messageText.trim().toLowerCase().startsWith('alice')) return;

    Const botPos = bot.entity ? Bot.entity.position : { x: 0, y: 0, z: 0 };
    Const sender = username || 'Player';

    Const aiResult = await analyzeMessage(sender, messageText, botPos);
    If (!aiResult) return;

    If (aiResult.type === 'function') {
      Const { name, args } = aiResult.action;
      Console.log(`[AI ACTION] ${name}`, args);
      If (botActions[name]) {
        Const res = await botActions[name](args);
        Console.log(`[ACTION RESULT] ${res}`);
      }
    } else if (aiResult.type === 'text' && aiResult.text) {
      Bot.chat(`/me ${aiResult.text.trim()}`);
    }
  });

  Bot.on('error', (err) => {
    Console.error('[BOT ERROR]', err.message || err);
  });

  Bot.on('end', (reason) => {
    Console.log(`[BOT] Disconnected (${reason}). Reconnecting in 10 seconds...`);
    SetTimeout(initBot, 10000);
  });
}

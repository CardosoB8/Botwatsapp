// index.js

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const path = require('path');
const chrome = require('chrome-aws-lambda');
const cookieParser = require('cookie-parser');
const moment = require('moment-timezone');

// Importações do Projeto (CORREÇÃO: Importa a instância única da classe)
const config = require('./config');
const redisClient = require('./redis-client'); 
const commandHandler = require('./handlers/command-handler'); 
const scheduler = require('./handlers/scheduler'); 

// VARIÁVEIS GLOBAIS
let qrCodeValue = null;
let clientStatus = 'INICIANDO';
let client;

// CONEXÃO EXPRESS & WEB SERVER
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); 

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const AUTH_TOKEN = 'bot-auth-token';

function isAuthenticated(req, res, next) {
    if (req.cookies.token === AUTH_TOKEN) {
        return next();
    }
    if (req.originalUrl === '/dashboard') {
        return res.redirect('/login');
    }
    return res.status(401).json({ success: false, error: 'Acesso negado. Faça login.' });
}

// --- ROTAS DO PAINEL ---
app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => {
    if (req.cookies.token === AUTH_TOKEN) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { senha } = req.body;
    if (senha === config.WEB_PASSWORD) {
        res.cookie('token', AUTH_TOKEN, { httpOnly: true, maxAge: 86400000 });
        return res.json({ success: true, message: 'Login bem-sucedido.' });
    }
    return res.status(401).json({ success: false, error: 'Senha incorreta.' });
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// --- ROTAS DE API ---

// 1. Rota de Status
app.get('/status', isAuthenticated, async (req, res) => {
    const prompts = await redisClient.getAllScheduledPrompts();
    const promptsCount = Object.keys(prompts).reduce((count, key) => count + prompts[key].length, 0);

    res.json({
        connected: client && client.info ? true : false,
        status: clientStatus,
        timezone: config.TIMEZONE,
        currentTime: moment().tz(config.TIMEZONE).format('HH:mm:ss'),
        // Verifica a saúde usando o método da classe
        redisConnected: await redisClient.healthCheck(), 
        promptsCount: promptsCount,
    });
});

// 2. Rota de QR Code
app.get('/qrcode', isAuthenticated, (req, res) => {
    const qrUrl = qrCodeValue ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrCodeValue)}` : null;

    res.json({
        connected: client && client.info ? true : false,
        qr: qrUrl
    });
});

// 3. Rota de Prompts Agendados (GET)
app.get('/prompts', isAuthenticated, async (req, res) => {
    // Usa o método da classe para obter o Hash formatado
    const prompts = await redisClient.getAllScheduledPrompts();
    res.json(prompts);
});

// 4. Rota para Agendar Prompt (POST)
app.post('/prompt', isAuthenticated, async (req, res) => {
    if (!await redisClient.healthCheck()) return res.json({ success: false, error: 'Redis desconectado.' });

    const { hora, acao } = req.body;
    const key = hora.trim(); 

    try {
        const prompts = await redisClient.getAllScheduledPrompts();
        const currentPrompts = prompts[key] || [];
        
        // Adiciona o novo prompt
        currentPrompts.push({ id: Date.now(), acao: acao.trim() });
        
        await redisClient.updateScheduledPrompt(key, currentPrompts);
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao salvar prompt:', error);
        res.json({ success: false, error: error.message });
    }
});

// 5. Rota para Deletar Prompt (DELETE)
app.delete('/prompt/:hora/:index', isAuthenticated, async (req, res) => {
    if (!await redisClient.healthCheck()) return res.json({ success: false, error: 'Redis desconectado.' });
    
    const { hora, index } = req.params;
    const key = hora.trim();
    const idx = parseInt(index, 10);

    try {
        const prompts = await redisClient.getAllScheduledPrompts();
        let currentPrompts = prompts[key] || [];
        
        if (idx >= 0 && idx < currentPrompts.length) {
            currentPrompts.splice(idx, 1);
        }
        
        if (currentPrompts.length === 0) {
            await redisClient.removeScheduledPrompt(key);
        } else {
            await redisClient.updateScheduledPrompt(key, currentPrompts);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao deletar prompt:', error);
        res.json({ success: false, error: error.message });
    }
});


// --- INICIALIZAÇÃO DO SERVIÇO ---

app.listen(config.PORT, () => {
    console.log(`🌍 Interface Web rodando em http://localhost:${config.PORT}`); 
});

async function startBot() {
    // CORREÇÃO: Chama o método 'connect' na instância da classe
    const isRedisConnected = await redisClient.connect(); 
    
    // ... (restante do código do Cliente WhatsApp e eventos)

    client = new Client({
        authStrategy: new LocalAuth({ clientId: "bot-session" }),
        puppeteer: {
            executablePath: await chrome.executablePath,
            args: [...chrome.args, '--no-sandbox', '--disable-setuid-sandbox'],
            headless: true,
        },
        qrTimeoutMs: 60000, 
    });

    client.on('qr', (qr) => {
        qrCodeValue = qr;
        clientStatus = 'AGUARDANDO QR CODE';
        qrcode.generate(qr, { small: true }); 
    });

    client.on('ready', () => {
        clientStatus = 'CONECTADO';
        console.log(`🟢 Cliente pronto! ${config.BOT_NAME} está online.`);
        if (isRedisConnected) {
            scheduler.start(client, redisClient); 
        }
    });
    
    client.on('disconnected', (reason) => {
        clientStatus = 'DESCONECTADO';
        scheduler.stop();
        setTimeout(() => client.initialize(), 5000); 
    });

    client.on('message', async (msg) => {
        await commandHandler(client, msg, redisClient); 
    });

    try {
        await client.initialize();
    } catch (error) {
        clientStatus = 'ERRO DE INICIALIZAÇÃO';
        console.error('❌ Falha na inicialização do Cliente:', error.message);
    }
}

startBot();
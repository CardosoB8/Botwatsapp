// index.js

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const path = require('path');
const chrome = require('chrome-aws-lambda');
const cookieParser = require('cookie-parser');
const moment = require('moment-timezone');

// Importações do Projeto
const config = require('./config');
const { connectRedis, getClient } = require('./redis-client');
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
// Configuração para servir arquivos estáticos (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public'))); 

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const AUTH_TOKEN = 'bot-auth-token'; // Token simples

function isAuthenticated(req, res, next) {
    if (req.cookies.token === AUTH_TOKEN) {
        return next();
    }
    // Para todas as rotas protegidas, se não houver cookie, redireciona para o login
    if (req.originalUrl === '/dashboard') {
        return res.redirect('/login');
    }
    // Para chamadas de API (fetch), retorna 401
    return res.status(401).json({ success: false, error: 'Acesso negado. Faça login.' });
}

// --- ROTAS DO PAINEL (PROTEGIDAS) ---

// Rota de LOGIN (POST) - Chamada pelo login.html
app.post('/login', (req, res) => {
    const { senha } = req.body;
    if (senha === config.WEB_PASSWORD) {
        // Sucesso: Define um cookie simples e retorna sucesso
        res.cookie('token', AUTH_TOKEN, { httpOnly: true, maxAge: 86400000 }); // 24 horas
        return res.json({ success: true, message: 'Login bem-sucedido.' });
    }
    return res.status(401).json({ success: false, error: 'Senha incorreta.' });
});

// Rota do DASHBOARD - Protegida
app.get('/dashboard', isAuthenticated, (req, res) => {
    // Apenas serve o arquivo dashboard.html, o JS do frontend fará as chamadas de API
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Rota de LOGOUT
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});


// --- ROTAS DE API (PROTEGIDAS) ---

// 1. Rota de Status (para o JS do dashboard.html)
app.get('/status', isAuthenticated, async (req, res) => {
    const redisClient = getClient();
    const prompts = redisClient ? await redisClient.HGETALL('prompts') : {};
    
    res.json({
        connected: client && client.info ? true : false,
        status: clientStatus,
        timezone: config.TIMEZONE,
        currentTime: moment().tz(config.TIMEZONE).format('HH:mm:ss'),
        memorySize: Object.keys(prompts).length, // Número de prompts agendados
    });
});

// 2. Rota de QR Code (para o JS do dashboard.html)
app.get('/qrcode', isAuthenticated, (req, res) => {
    // O JS do dashboard espera a URL do QR Code
    const qrUrl = qrCodeValue ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrCodeValue)}` : null;

    res.json({
        connected: client && client.info ? true : false,
        qr: qrUrl
    });
});

// 3. Rota de Prompts Agendados (GET)
app.get('/prompts', isAuthenticated, async (req, res) => {
    const redisClient = getClient();
    if (!redisClient) return res.json({});
    
    // Retorna todos os prompts do Redis
    const promptsData = await redisClient.HGETALL('prompts');
    const prompts = {};

    // Formata os dados: { "HH:MM": [{ acao: "..." }, ...] }
    for (const hora in promptsData) {
        try {
            prompts[hora] = JSON.parse(promptsData[hora]);
        } catch (e) {
            console.error(`Erro ao parsear prompt para ${hora}:`, e);
            prompts[hora] = [];
        }
    }
    res.json(prompts);
});

// 4. Rota para Agendar Prompt (POST)
app.post('/prompt', isAuthenticated, async (req, res) => {
    const redisClient = getClient();
    if (!redisClient) return res.json({ success: false, error: 'Redis desconectado.' });

    const { hora, acao } = req.body;
    const key = hora.trim(); // A chave é a hora (HH:MM)

    try {
        const currentPromptsJson = await redisClient.HGET('prompts', key) || '[]';
        const currentPrompts = JSON.parse(currentPromptsJson);
        
        currentPrompts.push({ acao: acao.trim() });
        
        await redisClient.HSET('prompts', key, JSON.stringify(currentPrompts));
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao salvar prompt:', error);
        res.json({ success: false, error: error.message });
    }
});

// 5. Rota para Deletar Prompt (DELETE)
app.delete('/prompt/:hora/:index', isAuthenticated, async (req, res) => {
    const redisClient = getClient();
    if (!redisClient) return res.json({ success: false, error: 'Redis desconectado.' });
    
    const { hora, index } = req.params;
    const key = hora.trim();
    const idx = parseInt(index, 10);

    try {
        const currentPromptsJson = await redisClient.HGET('prompts', key) || '[]';
        let currentPrompts = JSON.parse(currentPromptsJson);
        
        if (idx >= 0 && idx < currentPrompts.length) {
            currentPrompts.splice(idx, 1);
        }
        
        if (currentPrompts.length === 0) {
            await redisClient.HDEL('prompts', key); // Remove a chave se a lista estiver vazia
        } else {
            await redisClient.HSET('prompts', key, JSON.stringify(currentPrompts));
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
    // 1. Conexão Redis
    const redisClient = await connectRedis();

    // 2. Configuração do Cliente WhatsApp
    client = new Client({
        authStrategy: new LocalAuth({ clientId: "bot-session" }),
        puppeteer: {
            executablePath: await chrome.executablePath,
            args: [...chrome.args, '--no-sandbox', '--disable-setuid-sandbox'],
            headless: true,
        },
        qrTimeoutMs: 60000, 
    });

    // 3. Eventos do Cliente
    client.on('qr', (qr) => {
        qrCodeValue = qr;
        clientStatus = 'AGUARDANDO QR CODE';
        qrcode.generate(qr, { small: true }); 
    });

    client.on('authenticated', () => {
        clientStatus = 'AUTENTICADO';
        qrCodeValue = null;
    });

    client.on('ready', () => {
        clientStatus = 'CONECTADO';
        console.log(`🟢 Cliente pronto! ${config.BOT_NAME} está online.`);
        if (redisClient) {
            scheduler.start(client, redisClient); // Inicia o sistema de agendamento
        }
    });
    
    client.on('disconnected', (reason) => {
        clientStatus = 'DESCONECTADO';
        console.log('🔴 Cliente desconectado. Motivo:', reason);
        if (redisClient) scheduler.stop(); // Para o scheduler
        setTimeout(() => client.initialize(), 5000); 
    });

    client.on('message', async (msg) => {
        await commandHandler(client, msg, redisClient); // Passa o cliente Redis para o handler
    });

    // 4. Inicializa o Cliente
    try {
        await client.initialize();
    } catch (error) {
        clientStatus = 'ERRO DE INICIALIZAÇÃO';
        console.error('❌ Falha na inicialização do Cliente:', error.message);
    }
}

// Inicia o Bot
startBot();
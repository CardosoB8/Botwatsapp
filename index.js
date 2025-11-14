// index.js

const express = require('express');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Dependências Serverless/Vercel
const chromeAwsLambda = require('chrome-aws-lambda');

// Importa a instância única da classe RedisClient
const RedisClient = require('./redis-client'); 
const { moderarConteudo, gerarResposta } = require('./gemini-ai');
const { DONO, WEB_SENHA } = require('./config'); 
const { processarComandos } = require('./handlers/command-handler'); 
const { iniciarAgendador, capturarAgendamento } = require('./handlers/scheduler'); 

// Fuso horário de Moçambique, conforme especificado
process.env.TZ = 'Africa/Maputo';

// --- 1. Inicialização do Servidor e Redis ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public')); // Serve a interface web
app.use(express.urlencoded({ extended: true }));

// Conecta ao Redis
RedisClient.connect().then(() => {
    console.log('✅ Sistema de persistência Redis pronto.');
}).catch(err => {
    console.error('❌ Falha crítica ao conectar ao Redis:', err);
});

// --- 2. Inicialização do Cliente WhatsApp (AJUSTADO PARA VERCEL) ---
const client = new Client({
    authStrategy: new LocalAuth({ clientId: "bot-gemini-redis" }),
    // Configuração para ambientes Serverless (Vercel/Lambda)
    puppeteer: {
        executablePath: process.env.NODE_ENV === 'production' 
            ? chromeAwsLambda.executablePath 
            : undefined, // undefined permite o puppeteer local funcionar em dev
        
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--single-process'
        ],
    }
});

client.on('qr', (qr) => {
    console.log('QR Code Recebido. Escaneie:', qr);
    qrcode.generate(qr, { small: true });
    RedisClient.set('qrCode', qr); 
});

client.on('ready', () => {
    console.log('🎉 Cliente WhatsApp pronto e conectado!');
    RedisClient.set('qrCode', null);
    RedisClient.set('status', 'online');
    iniciarAgendador(client); 
});

client.on('auth_failure', msg => {
    console.error('❌ Falha na Autenticação:', msg);
    RedisClient.set('status', 'auth_failure');
});

client.on('disconnected', (reason) => {
    console.log('🔌 Cliente desconectado:', reason);
    RedisClient.set('status', 'disconnected');
    client.initialize(); // Tenta reconectar
});

// --- 3. Manipulador de Mensagens Principal ---
client.on('message', async (msg) => {
    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const messageBody = msg.body;

    if (!messageBody) return;

    // 🛡️ 3.1. Moderação Inteligente com Gemini AI (Apenas em grupos)
    if (isGroup && !msg.fromMe) {
        const isInadequado = await moderarConteudo(messageBody);

        if (isInadequado) {
            console.log(`⚠️ Conteúdo inadequado em: ${chat.name}. Removendo.`);
            try {
                await msg.delete(true); 
                chat.sendMessage(`🚨 Alerta: Conteúdo moderado e removido. Por favor, siga as regras.`);
                return;
            } catch (error) {
                console.error("Erro ao deletar mensagem. O bot é admin?", error.message);
            }
        }
    }

    // ⏰ 3.2. Captura de Agendamento (Ex: "às 22:00 faça...")
    const isScheduled = await capturarAgendamento(msg); 
    if (isScheduled) return;

    // ⚡ 3.3. Processamento de Comandos (!...)
    if (messageBody.startsWith('!')) {
        await processarComandos(client, msg, chat);
        return; 
    }

    // 🧠 3.4. Respostas de IA (Em privado ou quando mencionado em grupo)
    if (!isGroup || (isGroup && msg.mentionedIds.includes(client.info.wid._serialized))) {
        
        const botId = client.info.wid.user;
        const prompt = isGroup ? messageBody.replace(new RegExp(`@${botId}`), '').trim() : messageBody;

        if (prompt && prompt.length > 3) {
            chat.sendStateTyping();
            const response = await gerarResposta(prompt);
            msg.reply(response);
            chat.clearState();
        }
    }
});


// --- 4. Rotas da Interface Web (Dashboard) ---
const checkAuth = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === `Bearer ${WEB_SENHA}`) { 
        next();
    } else {
        res.status(401).json({ success: false, message: 'Não autorizado. Faça o login.' });
    }
};

app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === WEB_SENHA) {
        res.status(200).json({ success: true, token: WEB_SENHA }); 
    } else {
        res.status(401).json({ success: false, message: 'Senha incorreta.' });
    }
});

app.get('/status', checkAuth, async (req, res) => {
    const qrCode = await RedisClient.get('qrCode');
    const status = await RedisClient.get('status') || (client.info ? 'online' : 'offline');
    const scheduledPrompts = await RedisClient.getScheduledPrompts();
    const redisHealth = await RedisClient.healthCheck();

    res.json({
        whatsappStatus: status,
        qrCode: qrCode,
        redisStatus: redisHealth ? 'Conectado e Saudável' : 'Erro ou Desconectado',
        botOwner: DONO,
        promptsAgendados: scheduledPrompts,
        currentTime: new Date().toLocaleString('pt-MZ', { timeZone: 'Africa/Maputo' })
    });
});


// --- 5. Inicia o Bot e o Servidor Web ---
client.initialize();
app.listen(PORT, () => {
    console.log(`🌍 Interface Web rodando em http://localhost:${PORT}`);
});
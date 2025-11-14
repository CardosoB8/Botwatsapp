const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const chrome = require('chrome-aws-lambda'); // Importação essencial para a Render
const dotenv = require('dotenv');

// Carrega variáveis de ambiente
dotenv.config();

// Carrega Handlers (garanta que estes arquivos existam na pasta 'handlers')
const commandHandler = require('./handlers/command-handler'); 
const scheduler = require('./handlers/scheduler');

// Inicialização do Express (para manter o serviço ativo na Render)
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.status(200).send('Bot WhatsApp está rodando!');
});

app.listen(PORT, () => {
    console.log(`🌍 Interface Web rodando em http://localhost:${PORT}`);
});

// Função Assíncrona Principal para Inicializar o Bot
async function startBot() {
    // Configuração do Cliente WhatsApp
    const client = new Client({
        authStrategy: new LocalAuth(), // Mantém a sessão salva
        puppeteer: {
            // ** CONFIGURAÇÃO CRÍTICA PARA AMBIENTES DE NUVEM COMO RENDER **
            executablePath: await chrome.executablePath, // Usa o caminho do Chrome AWS
            args: [
                ...chrome.args,
                '--no-sandbox', // Essencial para ambientes Linux/Cloud
                '--disable-setuid-sandbox' 
            ],
            headless: true, // Garante que o navegador rode em background
        }
    });

    // 1. Evento de QR Code
    client.on('qr', (qr) => {
        console.log('QR RECEIVED', qr);
        qrcode.generate(qr, { small: true });
        // Se estiver usando o Express, você pode querer servir o QR code aqui
    });

    // 2. Evento de Sessão Pronta
    client.on('ready', () => {
        console.log('Cliente está pronto!');
        // Inicializa tarefas agendadas (se o scheduler for uma função)
        // scheduler(client); 
    });
    
    // 3. Evento de Mensagem Recebida
    client.on('message', async (msg) => {
        // Envia o cliente para o handler de comandos
        await commandHandler(client, msg);
    });

    // 4. Inicializa o Cliente
    client.initialize();
}

// Inicia o Bot
startBot();

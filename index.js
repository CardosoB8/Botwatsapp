const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs').promises;
const config = require('./config');
const GeminiAI = require('./gemini-ai');

// Configurar fuso horário de Moçambique
process.env.TZ = config.TIMEZONE;

class BotFinal {
    constructor() {
        this.app = express();
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: { 
                headless: true,
                args: ['--no-sandbox']
            }
        });
        
        this.gemini = new GeminiAI(config.GEMINI_API_KEY);
        this.memory = {};
        this.currentQR = null;
        this.isAuthenticated = false;
        
        this.setupWebServer();
        this.inicializarBot();
    }

    setupWebServer() {
        // Middlewares
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(express.static('public'));
        
        this.app.use(session({
            secret: 'bot-whatsapp-secret',
            resave: false,
            saveUninitialized: false,
            cookie: { secure: false, maxAge: config.WEB.SESSION_TIMEOUT }
        }));

        // Rotas
        this.app.get('/', (req, res) => {
            if (req.session.authenticated) {
                res.redirect('/dashboard');
            } else {
                res.redirect('/login');
            }
        });

        this.app.get('/login', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'login.html'));
        });

        this.app.post('/login', (req, res) => {
            if (req.body.senha === config.WEB.SENHA) {
                req.session.authenticated = true;
                res.json({ success: true });
            } else {
                res.json({ success: false, error: 'Senha incorreta' });
            }
        });

        this.app.get('/dashboard', (req, res) => {
            if (!req.session.authenticated) {
                return res.redirect('/login');
            }
            res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
        });

        this.app.get('/qrcode', async (req, res) => {
            if (!req.session.authenticated) {
                return res.status(403).json({ error: 'Não autorizado' });
            }
            
            if (this.currentQR) {
                res.json({ qr: this.currentQR, connected: false });
            } else {
                res.json({ connected: true });
            }
        });

        this.app.get('/status', (req, res) => {
            if (!req.session.authenticated) {
                return res.status(403).json({ error: 'Não autorizado' });
            }
            
            res.json({
                connected: this.client.info ? true : false,
                user: this.client.info?.wid?.user || 'Não conectado',
                memorySize: Object.keys(this.memory.horarios || {}).length,
                timezone: config.TIMEZONE,
                currentTime: new Date().toLocaleString('pt-MZ', { timeZone: config.TIMEZONE })
            });
        });

        this.app.post('/prompt', async (req, res) => {
            if (!req.session.authenticated) {
                return res.status(403).json({ error: 'Não autorizado' });
            }

            const { tipo, hora, acao } = req.body;
            
            if (tipo === 'horario') {
                if (!this.memory.horarios[hora]) {
                    this.memory.horarios[hora] = [];
                }
                
                this.memory.horarios[hora].push({
                    acao: acao,
                    criado_em: new Date().toISOString(),
                    ultima_execucao: null
                });
                
                await this.salvarMemory();
                res.json({ success: true, message: `Prompt agendado para ${hora}` });
            }
        });

        this.app.get('/prompts', (req, res) => {
            if (!req.session.authenticated) {
                return res.status(403).json({ error: 'Não autorizado' });
            }
            
            res.json(this.memory.horarios || {});
        });

        this.app.delete('/prompt/:hora/:index', async (req, res) => {
            if (!req.session.authenticated) {
                return res.status(403).json({ error: 'Não autorizado' });
            }

            const { hora, index } = req.params;
            
            if (this.memory.horarios[hora]) {
                this.memory.horarios[hora].splice(index, 1);
                
                if (this.memory.horarios[hora].length === 0) {
                    delete this.memory.horarios[hora];
                }
                
                await this.salvarMemory();
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Prompt não encontrado' });
            }
        });

        // Iniciar servidor
        this.app.listen(config.WEB.PORT, () => {
            console.log(`🌐 Interface web: http://localhost:${config.WEB.PORT}`);
            console.log(`⏰ Fuso horário: ${config.TIMEZONE}`);
        });
    }

    async inicializarBot() {
        await this.carregarMemory();
        
        this.client.on('qr', async (qr) => {
            console.log('📱 QR Code gerado - Acesse a interface web');
            this.currentQR = await qrcode.toDataURL(qr);
        });

        this.client.on('ready', () => {
            console.log('✅ Bot conectado!');
            console.log(`📍 Fuso horário: ${config.TIMEZONE}`);
            this.currentQR = null;
            this.iniciarVerificacoesAgendadas();
        });

        this.client.on('message', async (message) => {
            await this.processarMensagem(message);
        });

        this.client.on('group_join', async (notification) => {
            await this.boasVindas(notification);
        });

        this.client.initialize();
    }

    // 🧠 SISTEMA DE MEMÓRIA (mesmo do anterior)
    async carregarMemory() {
        try {
            const data = await fs.readFile(config.MEMORY_FILE, 'utf8');
            this.memory = JSON.parse(data);
        } catch (error) {
            this.memory = { horarios: {}, configuracoes: {}, historico: [] };
            await this.salvarMemory();
        }
    }

    async salvarMemory() {
        await fs.writeFile(config.MEMORY_FILE, JSON.stringify(this.memory, null, 2));
    }

    // ⏰ SISTEMA DE HORÁRIOS COM FUSO MOÇAMBIQUE
    iniciarVerificacoesAgendadas() {
        setInterval(() => {
            this.verificarPromptsAgendados();
        }, config.COMPORTAMENTO.CHECK_INTERVAL);
    }

    async verificarPromptsAgendados() {
        const agora = new Date();
        // Usar fuso de Moçambique
        const horaAtual = agora.toLocaleTimeString('pt-MZ', { 
            timeZone: config.TIMEZONE,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
        }).slice(0, 5);

        console.log(`🕒 Verificando horários (${horaAtual} - ${config.TIMEZONE})`);
        
        for (const [hora, prompts] of Object.entries(this.memory.horarios)) {
            if (hora === horaAtual) {
                for (const prompt of prompts) {
                    await this.executarPromptAgendado(prompt);
                }
            }
        }
    }

    async executarPromptAgendado(promptConfig) {
        try {
            console.log(`🎯 Executando prompt: ${promptConfig.acao}`);
            
            const resposta = await this.gemini.processarPrompt(
                `Execute no WhatsApp: ${promptConfig.acao}. Hora atual: ${new Date().toLocaleString('pt-MZ', { timeZone: config.TIMEZONE })}`,
                { tipo: 'agendado', timezone: config.TIMEZONE }
            );

            // Encontrar todos os grupos e executar a ação
            const chats = await this.client.getChats();
            const grupos = chats.filter(chat => chat.isGroup);

            for (const grupo of grupos) {
                await this.delayAleatorio();
                await grupo.sendMessage(`🕒 ${resposta}`);
            }

            promptConfig.ultima_execucao = new Date().toISOString();
            await this.salvarMemory();
            
        } catch (error) {
            console.error('Erro executando prompt:', error);
        }
    }

    // 🤖 PROCESSAMENTO DE MENSAGENS (mesma lógica anterior)
    async processarMensagem(message) {
        try {
            const chat = await message.getChat();
            const isDono = message.from === config.DONO;
            
            if (isDono) {
                await this.processarComandoDono(message, chat);
            }

            if (chat.isGroup) {
                await this.moderarComGemini(message, chat);
            }
            
        } catch (error) {
            console.error('Erro:', error);
        }
    }

    async moderarComGemini(message, chat) {
        const analise = await this.gemini.analisarMensagem(message.body, `Grupo: ${chat.name}`);
        
        await this.delayAleatorio();
        
        switch (analise.acao) {
            case 'REMOVER':
                await message.delete(true);
                await message.reply(`🚫 Mensagem removida: ${analise.motivo}`);
                break;
            case 'ADVERTIR':
                await message.reply(`⚠️ ${analise.motivo}`);
                break;
            case 'RESPONDER':
                if (analise.resposta_opcional) {
                    await message.reply(analise.resposta_opcional);
                }
                break;
        }
    }

    async processarComandoDono(message, chat) {
        const comando = message.body.trim();
        
        if (comando.includes('às') && comando.includes('faça')) {
            await this.adicionarPromptHorario(comando, message);
        }
        else if (comando === '!prompts') {
            await this.listarPrompts(message);
        }
        else if (comando.startsWith('!prompt ')) {
            const prompt = comando.replace('!prompt ', '');
            await this.executarPromptImediato(prompt, message, chat);
        }
    }

    async adicionarPromptHorario(comando, message) {
        const match = comando.match(/às\s+(\d{2}:\d{2})\s+faça\s+(.+)/i);
        
        if (match) {
            const hora = match[1];
            const acao = match[2];
            
            if (!this.memory.horarios[hora]) {
                this.memory.horarios[hora] = [];
            }
            
            this.memory.horarios[hora].push({
                acao: acao,
                criado_em: new Date().toISOString(),
                ultima_execucao: null
            });
            
            await this.salvarMemory();
            await message.reply(`✅ Prompt agendado para ${hora} (${config.TIMEZONE}): "${acao}"`);
        }
    }

    async executarPromptImediato(prompt, message, chat) {
        await this.delayAleatorio();
        const resposta = await this.gemini.processarPrompt(prompt);
        await message.reply(`🤖 ${resposta}`);
    }

    async listarPrompts(message) {
        let lista = `📋 *PROMPTS ATIVOS (${config.TIMEZONE})*\n\n`;
        
        for (const [hora, prompts] of Object.entries(this.memory.horarios)) {
            lista += `🕒 ${hora}:\n`;
            prompts.forEach((p, i) => {
                lista += `  ${i + 1}. ${p.acao}\n`;
            });
        }
        
        await message.reply(lista || '📭 Nenhum prompt agendado');
    }

    async boasVindas(notification) {
        await this.delayAleatorio();
        await notification.reply(
            `🎉 Bem-vindo(a), ${notification.contact.name}!\n` +
            `⏰ Horário: ${new Date().toLocaleString('pt-MZ', { timeZone: config.TIMEZONE })}`
        );
    }

    async delayAleatorio() {
        const { DELAY_MIN, DELAY_MAX } = config.COMPORTAMENTO;
        const delay = Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN)) + DELAY_MIN;
        return new Promise(resolve => setTimeout(resolve, delay));
    }
}

new BotFinal();
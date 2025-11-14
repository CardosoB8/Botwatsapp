const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const session = require('express-session');
const path = require('path');
const RedisStore = require('connect-redis').default;
const redisClient = require('./redis-client');
const config = require('./config');
const GeminiAI = require('./gemini-ai');

// Configurar fuso horário
process.env.TZ = config.TIMEZONE;

class BotCompleto {
    constructor() {
        this.app = express();
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: "/tmp"
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--single-process',
                    '--no-zygote',
                    '--disable-dev-shm-usage'
                ]
            }
        });

        this.gemini = new GeminiAI(config.GEMINI_API_KEY);
        this.currentQR = null;
        this.memory = {
            horarios: {},
            configuracoes: {},
            historico: []
        };

        this.setupWebServer();
        this.inicializarBot();
    }

    async setupWebServer() {
        // Conectar Redis com a configuração fornecida
        const redisConnected = await redisClient.connect();
        if (!redisConnected) {
            console.log('⚠️ Usando memória volátil (Redis não conectado)');
        }

        // Configurar sessão com Redis
        let redisStore;
        if (redisConnected) {
            redisStore = new RedisStore({
                client: redisClient.client,
                prefix: `${config.REDIS.PREFIX}session:`
            });
        }

        // Middlewares
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(express.static('public'));

        // Configurar sessão
        this.app.use(session({
            store: redisStore || new session.MemoryStore(),
            secret: 'bot-whatsapp-secret-key',
            resave: false,
            saveUninitialized: false,
            cookie: { 
                secure: false, 
                maxAge: config.WEB.SESSION_TIMEOUT 
            }
        }));

        // Rotas da Web
        this.setupRoutes();

        // Iniciar servidor
        this.app.listen(config.WEB.PORT, () => {
            console.log(`🚀 Bot WhatsApp Completo`);
            console.log(`📍 http://localhost:${config.WEB.PORT}`);
            console.log(`⏰ Fuso: ${config.TIMEZONE}`);
            console.log(`💾 Redis: ${redisConnected ? '✅ Conectado' : '❌ Offline'}`);
        });
    }

    setupRoutes() {
        this.app.get('/', (req, res) => {
            req.session.authenticated ? 
                res.redirect('/dashboard') : 
                res.redirect('/login');
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
            if (!req.session.authenticated) return res.redirect('/login');
            res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
        });

        this.app.get('/qrcode', async (req, res) => {
            if (!req.session.authenticated) return res.status(403).json({ error: 'Não autorizado' });
            this.currentQR ? 
                res.json({ qr: this.currentQR, connected: false }) : 
                res.json({ connected: true });
        });

        this.app.get('/status', async (req, res) => {
            if (!req.session.authenticated) return res.status(403).json({ error: 'Não autorizado' });
            
            const redisHealth = await redisClient.healthCheck();
            
            res.json({
                connected: !!this.client.info,
                user: this.client.info?.wid?.user || 'Não conectado',
                memorySize: Object.keys(this.memory.horarios || {}).length,
                timezone: config.TIMEZONE,
                currentTime: new Date().toLocaleString('pt-MZ', { timeZone: config.TIMEZONE }),
                redis: redisHealth ? 'connected' : 'disconnected',
                commands: Object.keys(config.COMANDOS).length
            });
        });

        // API para gerenciar prompts
        this.app.get('/prompts', async (req, res) => {
            if (!req.session.authenticated) return res.status(403).json({ error: 'Não autorizado' });
            res.json(this.memory.horarios || {});
        });

        this.app.post('/prompt', async (req, res) => {
            if (!req.session.authenticated) return res.status(403).json({ error: 'Não autorizado' });

            const { hora, acao } = req.body;
            if (!this.memory.horarios[hora]) this.memory.horarios[hora] = [];

            this.memory.horarios[hora].push({
                acao: acao,
                criado_em: new Date().toISOString(),
                ultima_execucao: null
            });

            await this.salvarMemory();
            res.json({ success: true, message: `✅ Prompt agendado para ${hora}` });
        });

        this.app.delete('/prompt/:hora/:index', async (req, res) => {
            if (!req.session.authenticated) return res.status(403).json({ error: 'Não autorizado' });

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

        // Nova rota para status do Redis
        this.app.get('/redis-status', async (req, res) => {
            if (!req.session.authenticated) return res.status(403).json({ error: 'Não autorizado' });
            
            const health = await redisClient.healthCheck();
            res.json({ 
                redis: health ? 'healthy' : 'unhealthy',
                config: {
                    host: config.REDIS.HOST,
                    port: config.REDIS.PORT,
                    connected: health
                }
            });
        });
    }

    // 🧠 SISTEMA DE MEMÓRIA COM REDIS
    async carregarMemory() {
        try {
            if (await redisClient.healthCheck()) {
                const memoryData = await redisClient.get('memory');
                this.memory = memoryData || {
                    horarios: {},
                    configuracoes: {},
                    historico: []
                };
                console.log('💾 Memória carregada do Redis');
            } else {
                this.memory = { horarios: {}, configuracoes: {}, historico: [] };
                console.log('💾 Memória volátil (Redis offline)');
            }
        } catch (error) {
            console.error('Erro ao carregar memória:', error);
            this.memory = { horarios: {}, configuracoes: {}, historico: [] };
        }
    }

    async salvarMemory() {
        try {
            if (await redisClient.healthCheck()) {
                await redisClient.set('memory', this.memory);
            }
        } catch (error) {
            console.error('Erro ao salvar memória:', error);
        }
    }

    async inicializarBot() {
        await this.carregarMemory();

        this.client.on('qr', async (qr) => {
            console.log('📱 QR Code gerado - Acesse a interface web');
            this.currentQR = await qrcode.toDataURL(qr);
        });

        this.client.on('ready', () => {
            console.log('✅ Bot WhatsApp conectado e pronto!');
            console.log(`👤 Logado como: ${this.client.info.pushname}`);
            this.currentQR = null;
            this.iniciarVerificacoesAgendadas();
        });

        this.client.on('message', async (message) => {
            await this.processarMensagem(message);
        });

        this.client.on('group_join', async (notification) => {
            await this.boasVindas(notification);
        });

        this.client.on('group_leave', async (notification) => {
            await this.despedida(notification);
        });

        this.client.initialize();
    }

    // ⏰ SISTEMA DE AGENDAMENTOS (mantido igual)
    iniciarVerificacoesAgendadas() {
        setInterval(() => {
            this.verificarPromptsAgendados();
        }, config.COMPORTAMENTO.CHECK_INTERVAL);
    }

    async verificarPromptsAgendados() {
        const agora = new Date();
        const horaAtual = agora.toLocaleTimeString('pt-MZ', {
            timeZone: config.TIMEZONE,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
        }).slice(0, 5);

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
            console.log(`🎯 Executando: ${promptConfig.acao}`);
            
            const resposta = await this.gemini.processarPrompt(
                promptConfig.acao,
                { timezone: config.TIMEZONE, tipo: 'agendado' }
            );

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

    // 🤖 PROCESSAMENTO DE MENSAGENS
    async processarMensagem(message) {
        try {
            const chat = await message.getChat();
            
            // Comandos do dono
            if (this.isDono(message)) {
                await this.processarComandoDono(message, chat);
                return;
            }

            // Comandos de admin em grupos
            if (chat.isGroup) {
                const comando = message.body.trim().toLowerCase();
                const isAdmin = await this.verificarSeEhAdmin(message, chat);
                
                if (isAdmin) {
                    await this.processarComandoAdmin(comando, message, chat);
                }
                
                // Moderação com IA
                await this.moderarComGemini(message, chat);
            }

        } catch (error) {
            console.error('Erro processar mensagem:', error);
        }
    }

    // 👑 COMANDOS DO DONO
    async processarComandoDono(message, chat) {
        const comando = message.body.trim().toLowerCase();
        
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
        else {
            await this.processarComandoAdmin(comando, message, chat);
        }
    }

    // ⚡ COMANDOS DE ADMINISTRAÇÃO COMPLETOS
    async processarComandoAdmin(comando, message, chat) {
        switch (comando) {
            case config.COMANDOS.MENCIONAR_TODOS:
            case '!todos':
                await this.mencionarTodos(message, chat);
                break;

            case config.COMANDOS.MENCIONAR_ADMINS:
                await this.mencionarAdmins(message, chat);
                break;

            case config.COMANDOS.LIMPAR_CONVERSA:
                await this.limparConversa(message, chat);
                break;

            case config.COMANDOS.BANIR_USUARIO:
                if (message.hasQuotedMsg) {
                    const quotedMsg = await message.getQuotedMessage();
                    await this.banirUsuario(message, chat, quotedMsg.from);
                } else {
                    await message.reply('❌ Responda a mensagem do usuário para banir');
                }
                break;

            case config.COMANDOS.MUTAR_GRUPO:
                await this.mutarGrupo(message, chat, true);
                break;

            case config.COMANDOS.DESMUTAR_GRUPO:
                await this.mutarGrupo(message, chat, false);
                break;

            case config.COMANDOS.INFO_GRUPO:
                await this.infoGrupo(message, chat);
                break;

            case config.COMANDOS.PROMOVER_ADMIN:
                if (message.hasQuotedMsg) {
                    const quotedMsg = await message.getQuotedMessage();
                    await this.promoverAdmin(message, chat, quotedMsg.from);
                }
                break;

            case config.COMANDOS.REBAIXAR_ADMIN:
                if (message.hasQuotedMsg) {
                    const quotedMsg = await message.getQuotedMessage();
                    await this.rebaixarAdmin(message, chat, quotedMsg.from);
                }
                break;

            case config.COMANDOS.COMANDOS_LISTA:
                await this.mostrarComandos(message);
                break;

            default:
                if (comando.startsWith('!mencionar ')) {
                    const mensagem = comando.replace('!mencionar ', '');
                    await this.mencionarComMensagem(message, chat, mensagem);
                }
                break;
        }
    }

    // 🎯 SISTEMA DE MENCIONAR (OTIMIZADO)
    async mencionarTodos(message, chat) {
        try {
            await this.delayAleatorio();
            
            if (!await this.verificarSeEhAdmin(message, chat)) {
                return await message.reply('❌ Apenas administradores!');
            }

            if (chat.participants.length > config.COMPORTAMENTO.MENCIONAR_LIMITE) {
                return await message.reply(`❌ Grupo muito grande! Máximo: ${config.COMPORTAMENTO.MENCIONAR_LIMITE} membros`);
            }

            let texto = `📢 *MENÇÃO GERAL* 📢\n\n`;
            const mentions = [];
            let count = 0;

            for (const participant of chat.participants) {
                if (participant.id._serialized === this.client.info.wid._serialized) continue;
                
                texto += `@${participant.id.user} `;
                mentions.push(participant.id._serialized);
                count++;
            }

            texto += `\n\n👥 *Total: ${count} membros*`;
            texto += `\n📌 Por: ${message._data.notifyName}`;

            await chat.sendMessage(texto, { mentions });
            console.log(`✅ Mention all: ${count} membros`);

        } catch (error) {
            console.error('Erro mencionar todos:', error);
            await message.reply('❌ Erro ao mencionar membros');
        }
    }

    async mencionarAdmins(message, chat) {
        try {
            await this.delayAleatorio();
            
            if (!await this.verificarSeEhAdmin(message, chat)) {
                return await message.reply('❌ Apenas administradores!');
            }

            let texto = `👑 *MENÇÃO ADMINISTRADORES* 👑\n\n`;
            const mentions = [];
            let adminCount = 0;

            for (const participant of chat.participants) {
                if (participant.isAdmin) {
                    texto += `@${participant.id.user} `;
                    mentions.push(participant.id._serialized);
                    adminCount++;
                }
            }

            if (adminCount === 0) {
                return await message.reply('❌ Nenhum admin encontrado');
            }

            texto += `\n\n⚡ *Total: ${adminCount} administradores*`;
            await chat.sendMessage(texto, { mentions });

        } catch (error) {
            console.error('Erro mencionar admins:', error);
            await message.reply('❌ Erro ao mencionar administradores');
        }
    }

    async mencionarComMensagem(message, chat, mensagemPersonalizada) {
        try {
            await this.delayAleatorio();
            
            if (!await this.verificarSeEhAdmin(message, chat)) {
                return await message.reply('❌ Apenas administradores!');
            }

            let texto = `📢 *MENÇÃO IMPORTANTE* 📢\n\n`;
            const mentions = [];
            let count = 0;

            for (const participant of chat.participants) {
                if (participant.id._serialized === this.client.info.wid._serialized) continue;
                texto += `@${participant.id.user} `;
                mentions.push(participant.id._serialized);
                count++;
            }

            texto += `\n\n💬 *Mensagem:* ${mensagemPersonalizada}`;
            texto += `\n👥 *Total: ${count} membros*`;

            await chat.sendMessage(texto, { mentions });

        } catch (error) {
            console.error('Erro mencionar com mensagem:', error);
            await message.reply('❌ Erro ao executar menção');
        }
    }

    // 🗑️ LIMPAR CONVERSA (OTIMIZADO)
    async limparConversa(message, chat) {
        try {
            await this.delayAleatorio();
            
            if (!await this.verificarSeEhAdmin(message, chat)) {
                return await message.reply('❌ Apenas administradores!');
            }

            await message.reply('🔄 Limpando conversa... Isso pode levar alguns minutos.');

            let deletedCount = 0;
            const messages = await chat.fetchMessages({ limit: config.COMPORTAMENTO.LIMPAR_LIMITE });
            
            for (const msg of messages) {
                try {
                    await msg.delete(true);
                    deletedCount++;
                    
                    // Delay para evitar rate limit
                    if (deletedCount % 50 === 0) {
                        await this.delayAleatorio();
                    }
                } catch (error) {
                    // Ignora mensagens que não podem ser deletadas
                }
            }

            await message.reply(`✅ Conversa limpa! ${deletedCount} mensagens removidas.`);

        } catch (error) {
            console.error('Erro limpar conversa:', error);
            await message.reply('❌ Erro ao limpar conversa');
        }
    }

    // 🔨 FUNÇÕES AVANÇADAS DE ADMIN
    async banirUsuario(message, chat, usuarioId) {
        try {
            await chat.removeParticipants([usuarioId]);
            await message.reply('✅ Usuário removido do grupo!');
        } catch (error) {
            await message.reply('❌ Erro ao remover usuário. Verifique se tenho permissão.');
        }
    }

    async mutarGrupo(message, chat, status) {
        try {
            await chat.setMessagesAdminsOnly(status);
            const acao = status ? 'mutado' : 'desmutado';
            await message.reply(`✅ Grupo ${acao} com sucesso! ${status ? 'Apenas admins podem enviar mensagens.' : 'Todos podem enviar mensagens.'}`);
        } catch (error) {
            await message.reply('❌ Erro ao alterar configurações do grupo');
        }
    }

    async promoverAdmin(message, chat, usuarioId) {
        try {
            await chat.promoteParticipants([usuarioId]);
            await message.reply('✅ Usuário promovido a administrador!');
        } catch (error) {
            await message.reply('❌ Erro ao promover usuário. Verifique minhas permissões.');
        }
    }

    async rebaixarAdmin(message, chat, usuarioId) {
        try {
            await chat.demoteParticipants([usuarioId]);
            await message.reply('✅ Usuário rebaixado de administrador!');
        } catch (error) {
            await message.reply('❌ Erro ao rebaixar usuário. Verifique minhas permissões.');
        }
    }

    async infoGrupo(message, chat) {
        try {
            const admins = chat.participants.filter(p => p.isAdmin).length;
            const normais = chat.participants.length - admins;
            
            const info = `
👥 *INFORMAÇÕES DO GRUPO*

📛 *Nome:* ${chat.name}
👤 *Participantes:* ${chat.participants.length}
   ├─ 👑 Administradores: ${admins}
   └─ 👥 Membros: ${normais}
📅 *Criado em:* ${chat.createdAt?.toLocaleDateString('pt-MZ') || 'N/A'}
👑 *Dono:* ${chat.owner?.user || 'N/A'}
🔒 *Configurações:*
   - Apenas admins enviam mensagens: ${chat.messagesAdminsOnly ? '✅ Sim' : '❌ Não'}
   - Descrição: ${chat.description || 'Nenhuma'}
            `.trim();

            await message.reply(info);
        } catch (error) {
            await message.reply('❌ Erro ao obter informações do grupo');
        }
    }

    // 🔧 FUNÇÕES AUXILIARES
    async verificarSeEhAdmin(message, chat) {
        try {
            const participant = chat.participants.find(
                p => p.id._serialized === (message.author || message.from)
            );
            return participant ? participant.isAdmin : false;
        } catch (error) {
            return false;
        }
    }

    isDono(message) {
        return message.from === config.DONO;
    }

    async delayAleatorio() {
        const { DELAY_MIN, DELAY_MAX } = config.COMPORTAMENTO;
        const delay = Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN)) + DELAY_MIN;
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    // 📋 MOSTRAR COMANDOS COMPLETOS
    async mostrarComandos(message) {
        const comandos = `
🤖 *COMANDOS DISPONÍVEIS*

👥 *MENÇÕES:*
• \`!mencionar\` - Marca todos os membros
• \`!admins\` - Marca apenas administradores
• \`!mencionar [msg]\` - Marca com mensagem

⚡ *ADMINISTRAÇÃO:*
• \`!limpar\` - Limpa a conversa (até ${config.COMPORTAMENTO.LIMPAR_LIMITE} msgs)
• \`!banir\` - Remove usuário (responder msg)
• \`!mutar\` - Apenas admins podem enviar msg
• \`!desmutar\` - Todos podem enviar msg
• \`!promover\` - Torna usuário admin (responder msg)
• \`!rebaixar\` - Remove admin (responder msg)
• \`!info\` - Informações do grupo

⏰ *AGENDAMENTOS:*
• "às HH:MM faça [ação]" - Agenda prompt
• \`!prompts\` - Lista prompts
• \`!prompt [pergunta]\` - Executa prompt

📋 *AJUDA:*
• \`!comandos\` - Mostra esta lista

💡 *Nota:* Apenas administradores podem usar comandos de moderação.
        `.trim();

        await message.reply(comandos);
    }

    // 🤖 MODERAÇÃO COM GEMINI (mantida)
    async moderarComGemini(message, chat) {
        try {
            const analise = await this.gemini.analisarMensagem(
                message.body, 
                `Grupo: ${chat.name}`
            );

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
        } catch (error) {
            console.error('Erro moderação:', error);
        }
    }

    // 👋 BOAS-VINDAS E DESPEDIDAS
    async boasVindas(notification) {
        await this.delayAleatorio();
        await notification.reply(
            `🎉 Bem-vindo(a), ${notification.contact.name}!\n` +
            `💬 Leia as regras do grupo e divirta-se!\n` +
            `⏰ Horário: ${new Date().toLocaleString('pt-MZ', { timeZone: config.TIMEZONE })}`
        );
    }

    async despedida(notification) {
        await this.delayAleatorio();
        await notification.reply(`👋 ${notification.contact.name} saiu do grupo.`);
    }

    // ⏰ FUNÇÕES DE PROMPT (mantidas)
    async adicionarPromptHorario(comando, message) {
        const match = comando.match(/às\s+(\d{2}:\d{2})\s+faça\s+(.+)/i);
        if (match) {
            const hora = match[1];
            const acao = match[2];
            
            if (!this.memory.horarios[hora]) this.memory.horarios[hora] = [];
            this.memory.horarios[hora].push({
                acao: acao,
                criado_em: new Date().toISOString(),
                ultima_execucao: null
            });
            
            await this.salvarMemory();
            await message.reply(`✅ Prompt agendado para ${hora}: "${acao}"`);
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
}

// Inicializar o bot
new BotCompleto();
// redis-client.js (Com Funções Hash para Agendamento)

const { createClient } = require('redis');
const config = require('./config');

class RedisClient {
    constructor() {
        this.client = null;
        this.prefix = config.REDIS.PREFIX;
        
        this.redisConfig = {
            username: 'default',
            password: config.REDIS.PASSWORD,
            socket: {
                host: config.REDIS.HOST,
                port: config.REDIS.PORT,
            }
        };
        
        if (!config.REDIS.PASSWORD) {
            delete this.redisConfig.username;
            delete this.redisConfig.password;
        }
    }

    async connect() {
        if (this.client && this.client.isOpen) {
            console.log('✅ Redis já está conectado.');
            return true;
        }
        
        try {
            // Se houver REDIS_URL no ambiente, prioriza a URL
            if (process.env.REDIS_URL) {
                this.client = createClient({ url: process.env.REDIS_URL });
            } else {
                this.client = createClient(this.redisConfig);
            }

            this.client.on('error', (err) => console.error('❌ Redis Client Error:', err));
            this.client.on('connect', () => console.log('🟡 Conectando ao Redis...'));
            this.client.on('ready', () => console.log('✅ Conectado ao Redis com sucesso!'));

            await this.client.connect();
            return true;
        } catch (error) {
            console.error('❌ Falha ao conectar no Redis:', error.message);
            return false;
        }
    }
    
    // --- Funções para Agendamento (Usando HASH para o Scheduler) ---

    // Obtém todos os prompts agendados, agrupados por tempo
    async getAllScheduledPrompts() {
        if (!this.client || !this.client.isOpen) return {};
        try {
            const fullKey = `${this.prefix}scheduled_prompts`;
            // hGetAll retorna o Hash inteiro
            const promptsData = await this.client.hGetAll(fullKey); 
            
            // Desserializa todos os valores JSON
            const formattedPrompts = {};
            for (const hora in promptsData) {
                formattedPrompts[hora] = JSON.parse(promptsData[hora]);
            }
            return formattedPrompts;
        } catch (error) {
            console.error('Erro Redis getAllScheduledPrompts:', error);
            return {};
        }
    }

    // Adiciona/Atualiza um prompt agendado (requer HH:MM e lista de prompts)
    async updateScheduledPrompt(hora, promptsList) {
        if (!this.client || !this.client.isOpen) return false;
        try {
            const fullKey = `${this.prefix}scheduled_prompts`;
            const data = JSON.stringify(promptsList);
            await this.client.hSet(fullKey, hora, data); // hSet armazena o JSON
            return true;
        } catch (error) {
            console.error('Erro Redis updateScheduledPrompt:', error);
            return false;
        }
    }
    
    // Remove um prompt agendado por hora (remove o campo do Hash)
    async removeScheduledPrompt(hora) {
        if (!this.client || !this.client.isOpen) return false;
        try {
            const fullKey = `${this.prefix}scheduled_prompts`;
            await this.client.hDel(fullKey, hora);
            return true;
        } catch (error) {
            console.error('Erro Redis removeScheduledPrompt:', error);
            return false;
        }
    }

    async healthCheck() {
        if (!this.client || !this.client.isOpen) return false;
        try {
            await this.client.ping();
            return true;
        } catch (error) {
            return false;
        }
    }
}

// Exporta uma única instância da classe (CORRETO)
module.exports = new RedisClient();
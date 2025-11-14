// redis-client.js (Ajustado com Funções de Agendamento)

const { createClient } = require('redis');
const config = require('./config');

class RedisClient {
    constructor() {
        this.client = null;
        // O prefixo foi movido para o config.js
        this.prefix = config.REDIS.PREFIX; 
        
        this.redisConfig = {
            username: 'default',
            password: config.REDIS.PASSWORD,
            socket: {
                host: config.REDIS.HOST,
                port: config.REDIS.PORT,
                // tls: { 
                //     rejectUnauthorized: false // Usado para conexões seguras/cloud
                // }
            }
        };
        
        // Se a senha não estiver configurada, remove username/password
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
            this.client = createClient(this.redisConfig);
            
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

    // --- Funções Básicas ---
    
    async set(key, value) {
        if (!this.client || !this.client.isOpen) return null;
        try {
            const fullKey = `${this.prefix}${key}`;
            // Armazenamos sempre como string JSON, como na sua implementação
            return await this.client.set(fullKey, JSON.stringify(value));
        } catch (error) {
            console.error('Erro Redis set:', error);
            return null;
        }
    }

    async get(key) {
        if (!this.client || !this.client.isOpen) return null;
        try {
            const fullKey = `${this.prefix}${key}`;
            const data = await this.client.get(fullKey);
            // Retorna o objeto desserializado
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Erro Redis get:', error);
            return null;
        }
    }
    
    // --- Funções para Agendamento (Lista) ---

    async addScheduledPrompt(promptData) {
        if (!this.client || !this.client.isOpen) return null;
        try {
            const fullKey = `${this.prefix}scheduled_prompts`;
            const data = JSON.stringify(promptData);
            // Adiciona ao início da lista
            await this.client.lPush(fullKey, data); 
        } catch (error) {
            console.error('Erro Redis lPush (addScheduledPrompt):', error);
        }
    }

    async getScheduledPrompts() {
        if (!this.client || !this.client.isOpen) return [];
        try {
            const fullKey = `${this.prefix}scheduled_prompts`;
            // Pega todos os elementos da lista
            const list = await this.client.lRange(fullKey, 0, -1); 
            // Faz o parse de cada item
            return list.map(item => JSON.parse(item));
        } catch (error) {
            console.error('Erro Redis lRange (getScheduledPrompts):', error);
            return [];
        }
    }
    
    // Você pode adicionar uma função para remover prompts da lista, se necessário:
    // async removeScheduledPrompt(promptData) { ... }
    
    async healthCheck() {
        if (!this.client || !this.client.isOpen) return false;
        try {
            await this.client.ping();
            return true;
        } catch (error) {
            return false;
        }
    }
    
    // Função de exclusão (mantida do seu original)
    async delete(key) {
        if (!this.client || !this.client.isOpen) return null;
        try {
            const fullKey = `${this.prefix}${key}`;
            return await this.client.del(fullKey);
        } catch (error) {
            console.error('Erro Redis delete:', error);
            return null;
        }
    }
}

// Exporta uma única instância da classe para ser usada em todo o projeto
module.exports = new RedisClient();
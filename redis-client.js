const { createClient } = require('redis');
const config = require('./config');

class RedisClient {
    constructor() {
        this.client = null;
        this.prefix = config.REDIS.PREFIX;
        
        // Configuração IDÊNTICA à que você já usa
        this.redisConfig = {
            username: 'default',
            password: process.env.REDIS_PASSWORD || config.REDIS.PASSWORD,
            socket: {
                host: process.env.REDIS_HOST || config.REDIS.HOST,
                port: process.env.REDIS_PORT || config.REDIS.PORT,
                tls: { 
                    rejectUnauthorized: false
                }
            }
        };
    }

    async connect() {
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

    async set(key, value) {
        if (!this.client) return null;
        try {
            const fullKey = `${this.prefix}${key}`;
            return await this.client.set(fullKey, JSON.stringify(value));
        } catch (error) {
            console.error('Erro Redis set:', error);
            return null;
        }
    }

    async get(key) {
        if (!this.client) return null;
        try {
            const fullKey = `${this.prefix}${key}`;
            const data = await this.client.get(fullKey);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Erro Redis get:', error);
            return null;
        }
    }

    async delete(key) {
        if (!this.client) return null;
        try {
            const fullKey = `${this.prefix}${key}`;
            return await this.client.del(fullKey);
        } catch (error) {
            console.error('Erro Redis delete:', error);
            return null;
        }
    }

    async getAllKeys(pattern = '*') {
        if (!this.client) return [];
        try {
            const fullPattern = `${this.prefix}${pattern}`;
            return await this.client.keys(fullPattern);
        } catch (error) {
            console.error('Erro Redis keys:', error);
            return [];
        }
    }

    // Método para verificar saúde da conexão
    async healthCheck() {
        if (!this.client) return false;
        try {
            await this.client.ping();
            return true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = new RedisClient();
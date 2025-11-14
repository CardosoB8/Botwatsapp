// config.js

const dotenv = require('dotenv');
dotenv.config();

module.exports = {
    // Variáveis de Ambiente
    OWNER_JID: process.env.DONO || '258865446574@c.us',
    WEB_PASSWORD: process.env.WEB_SENHA || 'admin123',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    
    // Configurações Redis (Estrutura aninhada exigida pela classe)
    REDIS: {
        HOST: process.env.REDIS_HOST || 'localhost',
        PORT: process.env.REDIS_PORT || 6379,
        PASSWORD: process.env.REDIS_PASSWORD, // Use REDIS_PASSWORD no .env
        PREFIX: 'bot:', // Prefixo para chaves no Redis
    },

    // Configurações Gerais
    TIMEZONE: 'Africa/Maputo',
    BOT_NAME: 'Bot WhatsApp Gemini AI',
    PORT: process.env.PORT || 10000,
    PREFIX: '!',
    MAX_MESSAGES_TO_CLEAR: 1000,
};
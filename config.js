// config.js (Ajustado)

require('dotenv').config();

module.exports = {
    DONO: process.env.DONO,
    WEB_SENHA: process.env.WEB_SENHA,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    REDIS: {
        PASSWORD: process.env.REDIS_PASSWORD,
        HOST: process.env.REDIS_HOST || 'localhost', // Fallback para localhost
        PORT: process.env.REDIS_PORT || 6379,     // Fallback para 6379
        PREFIX: 'whatsapp-bot:' // Novo prefixo para todas as chaves
    }
};
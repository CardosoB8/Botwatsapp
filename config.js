module.exports = {
    // DONO DO BOT - Substitua pelo seu número
    DONO: '258841234567@c.us', // Formato: código país + número (Moçambique: 258)
    
    // GEMINI AI CONFIG - Obtenha em: https://aistudio.google.com/
    GEMINI_API_KEY: 'SUA_CHAVE_GEMINI_AQUI',
    
    // CONFIGURAÇÕES WEB
    WEB: {
        PORT: 3000,
        SENHA: 'admin123', // Senha para acessar a interface web
        SESSION_TIMEOUT: 24 * 60 * 60 * 1000 // 24 horas
    },
    
    // FUSO HORÁRIO DE MOÇAMBIQUE (UTC+2)
    TIMEZONE: 'Africa/Maputo',
    
    // SISTEMA DE MEMÓRIA
    MEMORY_FILE: './memory.json',
    
    // COMPORTAMENTO DO BOT
    COMPORTAMENTO: {
        DELAY_MIN: 2000,    // 2 segundos
        DELAY_MAX: 15000,   // 15 segundos
        CHECK_INTERVAL: 60000 // Verificar prompts a cada 1 minuto
    }
};
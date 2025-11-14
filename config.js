module.exports = {
    // DONO DO BOT - Use variável de ambiente
    DONO: process.env.DONO || '258853500876@c.us',
    
    // GEMINI AI CONFIG
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'AIzaSyAXYB2gIfAvlaMMqA9VJY5hqPCy67s2hPo',
    
    // CONFIGURAÇÕES WEB
    WEB: {
        PORT: process.env.PORT || 3000,
        SENHA: process.env.WEB_SENHA || 'admin123',
        SESSION_TIMEOUT: 24 * 60 * 60 * 1000
    },
    
    // REDIS CONFIG - Use variáveis de ambiente
    REDIS: {
        HOST: process.env.REDIS_HOST || 'redis-16345.c81.us-east-1-2.ec2.redns.redis-cloud.com',
        PORT: process.env.REDIS_PORT || 16345,
        PASSWORD: process.env.REDIS_PASSWORD || 'UnK847ICOOWU5DS7RTGOHbauOq0PemVj',
        PREFIX: 'bot:'
    },
    
    // FUSO HORÁRIO DE MOÇAMBIQUE
    TIMEZONE: 'Africa/Maputo',
    
    // COMANDOS
    COMANDOS: {
        MENCIONAR_TODOS: '!mencionar',
        MENCIONAR_ADMINS: '!admins', 
        LIMPAR_CONVERSA: '!limpar',
        BANIR_USUARIO: '!banir',
        MUTAR_GRUPO: '!mutar',
        DESMUTAR_GRUPO: '!desmutar',
        INFO_GRUPO: '!info',
        COMANDOS_LISTA: '!comandos',
        PROMOVER_ADMIN: '!promover',
        REBAIXAR_ADMIN: '!rebaixar'
    },
    
    // CONFIGURAÇÕES DE COMPORTAMENTO
    COMPORTAMENTO: {
        DELAY_MIN: 1000,
        DELAY_MAX: 5000,
        CHECK_INTERVAL: 30000,
        MENCIONAR_LIMITE: 100,
        LIMPAR_LIMITE: 1000
    }
};
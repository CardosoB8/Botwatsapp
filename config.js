module.exports = {
    // DONO DO BOT
    DONO: '258841234567@c.us',
    
    // GEMINI AI CONFIG
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'SUA_CHAVE_AQUI',
    
    // CONFIGURAÇÕES WEB
    WEB: {
        PORT: process.env.PORT || 3000,
        SENHA: process.env.WEB_SENHA || 'admin123',
        SESSION_TIMEOUT: 24 * 60 * 60 * 1000
    },
    
    // REDIS CONFIG - MESMA CONFIG QUE VOCÊ USA
    REDIS: {
        HOST: 'redis-16345.c81.us-east-1-2.ec2.redns.redis-cloud.com',
        PORT: 16345,
        PASSWORD: 'UnK847ICOOWU5DS7RTGOHbauOq0PemVj',
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
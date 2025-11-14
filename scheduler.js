// handlers/scheduler.js

const schedule = require('node-schedule');
const moment = require('moment-timezone');
const config = require('../config');

let currentJob = null; // Para manter o job principal do scheduler

/**
 * Cria um job recorrente que verifica a cada minuto se há prompts agendados.
 */
function start(client, redisClient) {
    if (currentJob) return; // Já está rodando

    console.log('⏰ Scheduler iniciado para verificar prompts.');
    
    // Verifica a cada minuto (:00)
    currentJob = schedule.scheduleJob('*/1 * * * *', async () => {
        const currentTime = moment().tz(config.TIMEZONE).format('HH:mm');
        console.log(`[Scheduler] Verificando prompts para ${currentTime}`);

        try {
            const promptsJson = await redisClient.HGET('prompts', currentTime);
            
            if (promptsJson) {
                const prompts = JSON.parse(promptsJson);
                
                for (const prompt of prompts) {
                    // A lógica do scheduler aqui será enviar a ação para o command-handler processar
                    console.log(`[Scheduler] Executando ação agendada: ${prompt.acao}`);
                    
                    // Simula uma mensagem para que o command-handler possa processar a "ação"
                    const dummyMsg = {
                        body: prompt.acao,
                        from: config.OWNER_JID, // Executado como se fosse o dono
                        reply: (content) => { 
                            console.log(`[Scheduler Rsp] ${content}`); 
                            // Aqui você poderia definir um ID de grupo padrão para onde enviar a resposta
                        },
                        getChat: async () => ({
                            isGroup: false, 
                            // Retornar um chat padrão ou o ID de um grupo para o envio real
                        }),
                        // ... outros métodos mockados
                    };
                    
                    // Para simplificar, apenas envia a notificação para o console por enquanto.
                    // A implementação completa exigiria a definição do grupo de destino.
                }
            }
        } catch (error) {
            console.error('❌ Erro durante execução do Scheduler:', error.message);
        }
    });
}

function stop() {
    if (currentJob) {
        currentJob.cancel();
        currentJob = null;
        console.log('⏰ Scheduler parado.');
    }
}

module.exports = {
    start,
    stop,
};
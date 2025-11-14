// handlers/scheduler.js

const cron = require('node-cron');
const { addScheduledPrompt, getScheduledPrompts } = require('../redis-client');
const { gerarResposta } = require('../gemini-ai');

const TIMEZONE = 'Africa/Maputo'; 
const activeCronJobs = {}; 

/**
 * Processa uma mensagem para verificar se é um comando de agendamento.
 */
async function capturarAgendamento(msg) {
    const body = msg.body.trim().toLowerCase();
    
    // Regex: "às HH:MM faça [ação]"
    const regex = /^às\s+(\d{1,2}:\d{2})\s+faça\s+(.+)$/i; 
    const match = body.match(regex);

    if (match) {
        const time = match[1]; 
        const action = match[2]; 
        const chatId = msg.from;

        const newPrompt = {
            id: Date.now().toString(),
            chatId: chatId,
            time: time,
            action: action,
        };

        await addScheduledPrompt(newPrompt);
        agendarJob(newPrompt, msg.client);

        msg.reply(`✅ Prompt agendado! A ação será executada *${time}* (Horário de Maputo).`);
        return true;
    }
    return false;
}

/**
 * Agenda um job CRON para um prompt específico.
 */
function agendarJob(promptData, client) {
    const [hour, minute] = promptData.time.split(':');
    const cronExpression = `${minute} ${hour} * * *`; 

    if (activeCronJobs[promptData.id]) {
        activeCronJobs[promptData.id].stop();
    }

    const job = cron.schedule(cronExpression, async () => {
        console.log(`⏰ Executando prompt agendado: ${promptData.id} em ${promptData.chatId}`);
        
        try {
            const chat = await client.getChatById(promptData.chatId);
            
            // 🧠 Pedir à IA para interpretar a ação e formatar a resposta
            const aiPrompt = `A instrução agendada é: "${promptData.action}". Se a instrução pedir para desativar o chat, responda com JSON: {"command": "mutar", "text": "Chat desativado!"}. Caso contrário, crie uma mensagem de resposta adequada e responda com JSON: {"command": "mensagem", "text": "Sua mensagem aqui..."}`;
            
            const aiResponseText = await gerarResposta(aiPrompt);
            
            // Tentativa de parse (a IA deve ser instruída a retornar JSON válido)
            let aiResponse;
            try {
                aiResponse = JSON.parse(aiResponseText.trim().replace(/```json|```/g, ''));
            } catch (e) {
                console.error("Erro ao parsear JSON da IA, enviando como texto simples.");
                chat.sendMessage(`[ERRO AGENDAMENTO]: Falha na execução da ação. Resposta da IA: ${aiResponseText}`);
                return;
            }

            if (aiResponse.command === 'mutar' && chat.isGroup) {
                await chat.setMessagesAdminsOnly(true);
                chat.sendMessage(aiResponse.text || 'Chat desativado conforme agendamento.');
            } else if (aiResponse.command === 'mensagem') {
                chat.sendMessage(aiResponse.text);
            }
            
        } catch (error) {
            console.error(`Falha ao executar job agendado ${promptData.id}:`, error);
        }

    }, {
        scheduled: true,
        timezone: TIMEZONE
    });

    activeCronJobs[promptData.id] = job;
}

/**
 * Inicializa o agendador carregando todos os prompts do Redis.
 */
async function iniciarAgendador(client) {
    console.log('🔄 Inicializando Agendador CRON...');
    const scheduledPrompts = await getScheduledPrompts() || [];

    scheduledPrompts.forEach(prompt => {
        agendarJob(prompt, client);
    });

    console.log(`✅ ${scheduledPrompts.length} jobs agendados, operando em ${TIMEZONE}.`);
}

module.exports = {
    capturarAgendamento,
    iniciarAgendador,
};
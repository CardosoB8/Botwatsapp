// handlers/command-handler.js

const { DONO } = require('../config');
const { getScheduledPrompts } = require('../redis-client');

/**
 * Funções auxiliares para verificação de permissão
 */
async function isAdmin(senderId, chat) {
    if (!chat.isGroup) return false;
    const participants = await chat.getParticipants();
    const sender = participants.find(p => p.id._serialized === senderId);
    return sender ? sender.isAdmin || sender.isSuperAdmin : false;
}

/**
 * Função principal para processar comandos do WhatsApp.
 */
async function processarComandos(client, msg, chat) {
    const args = msg.body.trim().split(/\s+/);
    const command = args[0].toLowerCase();
    const isGroup = chat.isGroup;
    const senderId = msg.from;
    
    // Verificações
    const isOwner = senderId === DONO;
    const adminPermission = await isAdmin(senderId, chat);
    const isAdminOrOwner = adminPermission || isOwner;

    try {
        switch (command) {
            case '!comandos':
                await handleComandos(msg);
                break;
            case '!info':
                await handleInfo(msg, chat, isGroup);
                break;
            case '!mencionar':
                if (isGroup) await handleMencionar(chat, args.slice(1).join(' ') || 'Atenção, grupo!');
                break;
            case '!admins':
                if (isGroup) await handleAdmins(msg, chat);
                break;

            // Comandos que exigem permissão
            case '!banir':
            case '!promover':
            case '!rebaixar':
            case '!mutar':
            case '!desmutar':
            case '!limpar': // No WhatsApp Web.js, isso é mais um utilitário
                if (isAdminOrOwner) {
                    await handleAdminActions(command, msg, chat, client);
                } else {
                    msg.reply('🚫 Apenas administradores podem usar este comando.');
                }
                break;
            default:
                break;
        }
    } catch (error) {
        console.error(`Erro ao processar comando ${command}:`, error);
        msg.reply('❌ Ocorreu um erro ao executar este comando.');
    }
}

// --- Lógica das Funções de Comando ---

async function handleComandos(msg) {
    // ... (Corpo da função handleComandos) ...
    const comandos = `
*💡 COMANDOS DISPONÍVEIS:*

*🛠️ Utilidade:*
!comandos - Esta lista.
!info - Informações do grupo/bot.
!mencionar [msg] - Marca todos os membros do grupo.
!admins - Marca apenas os administradores.

*🛡️ Administração (Apenas Admins):*
!banir - Remove usuário (responder mensagem).
!promover - Torna usuário admin (responder mensagem).
!rebaixar - Remove privilégios de admin (responder mensagem).
!mutar - Desativa o chat (apenas admins podem enviar).
!desmutar - Ativa o chat para todos.
!limpar - Limpa a conversa (bot deve ser Admin).
    
*⏰ Agendador:*
"às HH:MM faça [ação]" - Agenda uma ação automática.
`;
    msg.reply(comandos);
}

async function handleInfo(msg, chat, isGroup) {
    let info = '*🤖 Informações do Bot:*\n\n';
    const scheduledPrompts = await getScheduledPrompts();

    if (isGroup) {
        info += `*Grupo:* ${chat.name}\n`;
        info += `*Membros:* ${(await chat.getParticipants()).length}\n`;
        info += `*Restrição:* ${chat.isMuted ? 'Mutado (Apenas Admins)' : 'Todos podem enviar'}\n\n`;
    }
    
    info += `*⏰ Próximos Agendamentos:* ${scheduledPrompts.length > 0 ? scheduledPrompts.map(p => `\n - ${p.time} em ${p.chatId.split('@')[0]}: ${p.action}`).join('') : ' Nenhum.'}\n`;
    info += `*🌍 Fuso Horário:* Africa/Maputo (UTC+2)\n`;
    
    msg.reply(info);
}

async function handleMencionar(chat, message) {
    const participants = await chat.getParticipants();
    const mentions = participants.map(p => p.id._serialized);
    await chat.sendMessage(message, { mentions: mentions });
}

async function handleAdmins(msg, chat) {
    const participants = await chat.getParticipants();
    const admins = participants.filter(p => p.isAdmin);
    const mentions = admins.map(a => a.id._serialized);
    
    await chat.sendMessage('✨ Atenção, administradores!', { mentions: mentions });
}

async function handleAdminActions(command, msg, chat, client) {
    const targetMsg = await msg.getQuotedMessage();
    let targetId;

    if (targetMsg) {
        targetId = targetMsg.from;
    } else {
        return msg.reply('🚨 Você deve *responder* à mensagem do usuário para executar este comando.');
    }

    if (!targetId) return msg.reply('Não foi possível identificar o usuário alvo.');
    
    // Prevenção de auto-banimento ou ataque ao dono
    if (targetId === DONO) return msg.reply('🚫 Não é possível executar ações no Dono do Bot.');

    try {
        switch (command) {
            case '!banir':
                await chat.removeParticipants([targetId]);
                msg.reply(`👋 Usuário removido.`);
                break;
            case '!promover':
                await chat.promoteParticipants([targetId]);
                msg.reply(`👑 Usuário promovido a Admin.`);
                break;
            case '!rebaixar':
                await chat.demoteParticipants([targetId]);
                msg.reply(`⬇️ Usuário rebaixado.`);
                break;
            case '!mutar':
                await chat.setMessagesAdminsOnly(true);
                msg.reply('🔒 Chat ativado apenas para administradores.');
                break;
            case '!desmutar':
                await chat.setMessagesAdminsOnly(false);
                msg.reply('🔓 Chat ativado para todos os membros.');
                break;
            case '!limpar':
                // Nota: O método .delete() no chat só remove a conversa localmente para o bot.
                // Para apagar para todos, precisaria de uma lógica mais complexa (apagar msg por msg).
                await chat.clear(); 
                msg.reply('✅ Limpeza de conversa (mensagens mais antigas) concluída.');
                break;
        }
    } catch (error) {
        console.error(`Erro na ação de admin ${command}:`, error);
        msg.reply(`❌ Falha na execução: O bot precisa de permissões de administrador no grupo.`);
    }
}

module.exports = { processarComandos };

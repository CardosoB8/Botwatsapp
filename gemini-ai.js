const { GoogleGenerativeAI } = require("@google/generative-ai");

class GeminiAI {
    constructor(apiKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
        this.contexto = [];
    }

    // Analisar mensagem com Gemini para moderação
    async analisarMensagem(mensagem, contextoGrupo = '') {
        try {
            const prompt = `
Analise esta mensagem de WhatsApp de um grupo e responda APENAS com JSON:

MENSAGEM: "${mensagem}"
CONTEXTO DO GRUPO: ${contextoGrupo}

Regras de moderação:
- Conteúdo ofensivo, spam ou perigoso: REMOVER
- Conteúdo questionável mas não grave: ADVERTIR  
- Pergunta que precisa de resposta: RESPONDER
- Conteúdo normal: PERMITIR

Responda com este formato JSON:
{
    "acao": "PERMITIR|ADVERTIR|REMOVER|RESPONDER",
    "motivo": "explicação breve",
    "resposta_opcional": "resposta se necessário ou null",
    "nivel_gravidade": 1-10
}
`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            // Extrair JSON da resposta
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            
            return { acao: "PERMITIR", motivo: "Análise não concluída", nivel_gravidade: 1 };
            
        } catch (error) {
            console.error('Erro Gemini AI:', error);
            return { acao: "PERMITIR", motivo: "Erro na análise", nivel_gravidade: 1 };
        }
    }

    // Processar prompt personalizado para ações agendadas
    async processarPrompt(prompt, dadosContexto = {}) {
        try {
            const promptCompleto = `
INSTRUÇÃO: ${prompt}

CONTEXTO ATUAL:
- Data e Hora (Moçambique): ${new Date().toLocaleString('pt-MZ', { timeZone: 'Africa/Maputo' })}
- Informações Adicionais: ${JSON.stringify(dadosContexto)}

Execute a instrução de forma prática e direta para um bot de WhatsApp:
`;

            const result = await this.model.generateContent(promptCompleto);
            const response = await result.response;
            return response.text().trim();
            
        } catch (error) {
            console.error('Erro ao processar prompt:', error);
            return `❌ Erro: ${error.message}`;
        }
    }
}

module.exports = GeminiAI;
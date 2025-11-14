const { GoogleGenerativeAI } = require("@google/generative-ai");

class GeminiAI {
    constructor(apiKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
    }

    async analisarMensagem(mensagem, contexto = '') {
        try {
            const prompt = `
Analise esta mensagem de WhatsApp para moderação:

MENSAGEM: "${mensagem}"
CONTEXTO: ${contexto}

Responda APENAS com JSON:
{
    "acao": "PERMITIR|ADVERTIR|REMOVER|RESPONDER",
    "motivo": "explicação breve",
    "resposta_opcional": "resposta ou null",
    "nivel_gravidade": 1-10
}`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            return jsonMatch ? JSON.parse(jsonMatch[0]) : 
                { acao: "PERMITIR", motivo: "Análise falhou", nivel_gravidade: 1 };
                
        } catch (error) {
            console.error('Erro Gemini:', error);
            return { acao: "PERMITIR", motivo: "Erro na análise", nivel_gravidade: 1 };
        }
    }

    async processarPrompt(prompt, contexto = {}) {
        try {
            const promptCompleto = `
Instrução: ${prompt}

Contexto:
- Data/Hora: ${new Date().toLocaleString('pt-MZ', { timeZone: 'Africa/Maputo' })}
- Informações: ${JSON.stringify(contexto)}

Execute de forma prática:`;

            const result = await this.model.generateContent(promptCompleto);
            const response = await result.response;
            return response.text().trim();
        } catch (error) {
            return `❌ Erro: ${error.message}`;
        }
    }
}

module.exports = GeminiAI;
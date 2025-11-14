// gemini-ai.js

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY } = require('./config'); 

if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY não configurada no arquivo .env");
}

const ai = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = "gemini-2.5-flash"; // Modelo rápido e eficiente

async function moderarConteudo(text) {
    const systemInstruction = `Você é um moderador de grupo de WhatsApp. Verifique se a mensagem contém conteúdo inadequado, como: spam, discurso de ódio, assédio, violência ou links suspeitos. Responda APENAS com "INADEQUADO" se a mensagem for inadequada, ou "OK" se for segura. Não use pontuação nem explique.`;

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: text,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.1
            }
        });

        const resultText = response.text.trim().toUpperCase();
        return resultText.includes('INADEQUADO');
    } catch (error) {
        console.error("Erro na moderação com Gemini AI:", error);
        return false;
    }
}

async function gerarResposta(prompt) {
    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt
        });
        return response.text;
    } catch (error) {
        console.error("Erro ao gerar resposta com Gemini AI:", error);
        return "Desculpe, a IA está indisponível no momento.";
    }
}

module.exports = {
    moderarConteudo,
    gerarResposta
};
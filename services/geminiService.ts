
import { GoogleGenAI } from "@google/genai";
import { Loan, Client } from "../types";
import { calculateTotalDue, getDaysDiff } from "./financialLogic";

export const analyzeLoanRisk = async (debtor: Client, loanDetails: Partial<Loan>) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Analise o risco para este empréstimo privado:
      Devedor: ${debtor.name}
      Documento: ${debtor.document}
      Telefone: ${debtor.phone}
      Capital: R$ ${loanDetails.principal}
      Taxa: ${loanDetails.interestRate}% AM
      Multa: ${loanDetails.finePercent}% | Mora: ${loanDetails.dailyInterestPercent}% diária.
      PIX p/ Recebimento: ${loanDetails.pixKey || 'Não informada'}
      
      Forneça uma recomendação técnica curta sobre a saúde do contrato.`,
      config: {
        systemInstruction: "Analista de risco crédito privado.",
        temperature: 0.5,
      },
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Análise indisponível.";
  }
};

export const getCollectionStrategy = async (loan: Loan) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Encontrar parcela mais atrasada ou próxima
  const pendingInstallment = loan.installments.find(i => i.status !== 'PAID');
  if (!pendingInstallment) return "O contrato está quitado. Nenhuma cobrança necessária.";

  const debt = calculateTotalDue(loan, pendingInstallment);
  const daysLate = Math.max(0, getDaysDiff(pendingInstallment.dueDate));
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Gere uma mensagem de cobrança para WhatsApp.
      
      Dados:
      - Cliente: ${loan.debtorName}
      - Valor Original: R$ ${pendingInstallment.amount.toFixed(2)}
      - Valor Atualizado (com multa/juros): R$ ${debt.total.toFixed(2)}
      - Vencimento: ${new Date(pendingInstallment.dueDate).toLocaleDateString()}
      - Dias de Atraso: ${daysLate}
      - PIX: ${loan.pixKey || 'Solicitar'}

      Instruções de Tom:
      - Se dias < 3: Lembrete amigável.
      - Se dias > 5: Tom firme, mencionando juros correndo.
      - Se dias > 20: Notificação extrajudicial séria.
      
      A mensagem deve ser curta, direta e formatada para WhatsApp (use *negrito*).`,
      config: { systemInstruction: "Especialista em recuperação de crédito." }
    });
    return response.text;
  } catch (error) { return "Erro ao gerar mensagem de cobrança."; }
};

export const processNaturalLanguageCommand = async (text: string) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Interprete o comando financeiro do usuário.
      Entrada: "${text}"
      
      Ações Suportadas:
      - PAY_FULL: Quitar parcela ou contrato.
      - PAY_PARTIAL: Pagamento parcial.
      - LEND_MORE: Novo aporte (refinanciamento).
      - CREATE_CLIENT: Novo cliente.
      - CREATE_SOURCE: Nova fonte.
      - CHAT: Dúvidas gerais.

      Retorne JSON:
      {
        "intent": "INTENT_NAME",
        "data": { "amount": number, "name": string, "installments": number ... },
        "message": "Texto de confirmação ou resposta"
      }`,
      config: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    return { intent: "CHAT", message: "Erro ao processar comando." };
  }
};

import { Installment, Loan, LoanStatus, LedgerEntry, LoanPolicy } from "../types";

// --- UTILITÁRIOS MATEMÁTICOS (ARREDONDAMENTO ESTRITO) ---
// Resolve o problema de "0.00000001" na amortização
const round = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

// --- CÁLCULOS DE TEMPO ---

export const getDaysDiff = (dueDateStr: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normaliza para meia-noite
  
  // Trata a string de data para garantir compatibilidade
  const [y, m, d] = dueDateStr.split('T')[0].split('-').map(Number);
  const dueDate = new Date(y, m - 1, d, 0, 0, 0);
  
  const diffTime = today.getTime() - dueDate.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export const add30Days = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('T')[0].split('-').map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0); // Meio-dia para evitar fuso
  date.setDate(date.getDate() + 30);
  return date.toISOString();
};

// --- STATUS USER FACING ---

export const deriveUserFacingStatus = (inst: Installment): string => {
  if (inst.status === LoanStatus.PAID) return "Quitado";
  const days = getDaysDiff(inst.dueDate);
  if (days === 0) return "Vence Hoje";
  if (days > 0) return `${days} dias vencidos`;
  return "Em dia";
};

// --- CORE LOGIC ---

export const getInstallmentStatusLogic = (inst: Installment): LoanStatus => {
  // CRÍTICO: Só é pago se principalRemaining for <= 0. 
  // Juros podem ser zerados ao pagar juros (renovação), mas isso não quita o empréstimo.
  if (round(inst.principalRemaining) <= 0) return LoanStatus.PAID;
  if (getDaysDiff(inst.dueDate) > 0) return LoanStatus.LATE;
  if (inst.paidTotal > 0) return LoanStatus.PARTIAL;
  return LoanStatus.PENDING;
};

export const calculateTotalDue = (loan: Loan, inst: Installment): {
  total: number;
  principal: number;
  interest: number;
  lateFee: number;
  baseForFine: number;
  daysLate: number;
} => {
  const daysLate = Math.max(0, getDaysDiff(inst.dueDate));
  
  // Usa snapshot (regras congeladas) ou fallback para atuais
  const policy: LoanPolicy = loan.policiesSnapshot || {
    interestRate: loan.interestRate,
    finePercent: loan.finePercent,
    dailyInterestPercent: loan.dailyInterestPercent
  };

  // Base para cálculo de multa é o Principal + Juros devidos no período atual
  const baseForFine = round(inst.principalRemaining + inst.interestRemaining);
  
  let currentLateFee = 0;
  
  // Calcula multa e mora apenas se houver atraso E saldo devedor
  if (daysLate > 0 && baseForFine > 0) {
    const fineFixed = baseForFine * (policy.finePercent / 100);
    const fineDaily = baseForFine * (policy.dailyInterestPercent / 100) * daysLate;
    currentLateFee = round(fineFixed + fineDaily);
  }

  const total = round(baseForFine + currentLateFee);

  return {
    total,
    principal: inst.principalRemaining,
    interest: inst.interestRemaining,
    lateFee: currentLateFee,
    baseForFine,
    daysLate
  };
};

interface PaymentResult {
  principalPaid: number;
  interestPaid: number;
  lateFeePaid: number;
  avGenerated: number;
}

export const allocatePayment = (
  paymentAmount: number,
  debt: ReturnType<typeof calculateTotalDue>
): PaymentResult => {
  let remaining = round(paymentAmount);
  
  // PRIORIDADE 1: Multa/Mora
  const payLateFee = Math.min(remaining, debt.lateFee);
  remaining = round(remaining - payLateFee);

  // PRIORIDADE 2: Juros
  const payInterest = Math.min(remaining, debt.interest);
  remaining = round(remaining - payInterest);

  // PRIORIDADE 3: Principal (Nunca pagar mais que o saldo devedor de principal)
  const payPrincipal = Math.min(remaining, debt.principal);
  remaining = round(remaining - payPrincipal);

  // SOBRA: Adiantamento/Crédito (AV)
  // Se sobrou dinheiro depois de pagar tudo, considera como amortização extra ou crédito.
  // Neste contexto, geralmente abate do principal se houver (mas já pagamos o principal da parcela acima).
  // Se for "Renovação + AV", o usuário pagou Juros + X. O X abate do principal.
  const avGenerated = remaining;

  return {
    principalPaid: round(payPrincipal),
    interestPaid: round(payInterest),
    lateFeePaid: round(payLateFee),
    avGenerated: round(avGenerated)
  };
};

// --- RECONCILIAÇÃO (FONTE ÚNICA DA VERDADE) ---
// Reconstrói o estado atual da parcela reprocessando todo o histórico do Ledger
export const rebuildLoanStateFromLedger = (loan: Loan): Loan => {
  // 1. Resetar todas as parcelas para o estado original "Scheduled" (Limpo)
  const rebuiltInstallments = loan.installments.map(inst => ({
    ...inst,
    principalRemaining: round(inst.scheduledPrincipal),
    interestRemaining: round(inst.scheduledInterest),
    lateFeeAccrued: 0,
    avApplied: 0,
    paidPrincipal: 0,
    paidInterest: 0,
    paidLateFee: 0,
    paidTotal: 0,
    status: LoanStatus.PENDING,
    logs: [] as string[]
  }));

  // 2. Replay do Ledger (Cronológico)
  const sortedLedger = [...(loan.ledger || [])].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  sortedLedger.forEach(entry => {
    if (entry.installmentId) {
      const instIndex = rebuiltInstallments.findIndex(i => i.id === entry.installmentId);
      if (instIndex !== -1) {
        const inst = rebuiltInstallments[instIndex];
        
        // Atualiza acumuladores (Histórico de Pagamentos)
        inst.paidPrincipal = round(inst.paidPrincipal + entry.principalDelta);
        inst.paidInterest = round(inst.paidInterest + entry.interestDelta);
        inst.paidLateFee = round(inst.paidLateFee + entry.lateFeeDelta);
        inst.paidTotal = round(inst.paidTotal + entry.amount);

        // Atualiza saldos restantes (Estado Atual)
        // Usa Math.max(0) para garantir que erros de arredondamento não gerem saldo negativo
        inst.principalRemaining = round(Math.max(0, inst.principalRemaining - entry.principalDelta));
        
        // Lógica de Renovação: Se pagou apenas juros, o interestRemaining zera MOMENTANEAMENTE, 
        // mas se foi uma renovação, ele deveria ser restaurado para o próximo mês. 
        // Como o app usa o "scheduledInterest" como base, se o ledger mostra que pagou, desconta.
        // Se a data mudou (renovação), o Ledger deve refletir o pagamento do "mês anterior".
        // Para simplificar: O ledger reduz o que era devido. Se a pessoa renova, ela paga o que deve.
        // O sistema visual (UI) vai mostrar "Juros: R$ X" novamente porque o tempo passou ou foi resetado manualmente?
        // Neste modelo simples, ao pagar juros, interestRemaining zera. Se a data for adiada, 
        // o contrato ainda está "aberto" (principal > 0).
        // Se quisermos cobrar juros NOVAMENTE, precisaríamos adicionar "Novo Juros" ao interestRemaining.
        // Como não temos um evento "ADD_INTEREST" no ledger, assumimos que o scheduledInterest é por período.
        // *Correção para Renovação*: Se a data de vencimento foi alterada no banco, o sistema calcula 'late fee' baseado na nova data.
        // O juro base (scheduled) continua lá. Se foi pago, interestRemaining diminui.
        // Se queremos cobrar MAIS juros (novo mês), precisaríamos tecnicamente aumentar o interestRemaining.
        // Para evitar complexidade extrema de ledger agora: assumimos que na renovação, o pagamento zera o juro pendente.
        // O principal fica. No próximo mês, se não pagar, gera multa sobre o principal.
        
        inst.interestRemaining = round(Math.max(0, inst.interestRemaining - entry.interestDelta));
        
        if (entry.notes) inst.logs?.push(entry.notes);
      }
    }
  });

  // 3. Atualizar Status Finais e Datas
  rebuiltInstallments.forEach(inst => {
    // Se foi feita uma renovação que alterou a data no banco de dados (App.tsx),
    // a inst.dueDate já vem atualizada do Supabase antes dessa função rodar.
    // Porém, se interestRemaining zerou, parece pago. Mas se principal > 0, NÃO está pago.
    
    // Se for renovação (data futura + principal pendente + juros pagos), precisamos "rearmar" os juros?
    // Em sistemas simples de nota promissória, o juro é mensal. Se pagou o mês 1, deve o mês 2.
    // Aqui, vamos confiar que se principalRemaining > 0, o status é LATE ou PENDING, nunca PAID.
    
    // Se a data de vencimento é futura (foi adiada) e o juro atual está pago, 
    // visualmente o cliente está "Em Dia". 
    // Quando virar o mês, o sistema não soma juros automaticamente ao 'interestRemaining' sem uma transação.
    // *Solução Pragmática*: No App.tsx, ao renovar, além de mudar a data, poderíamos 
    // inserir um log ou lógica visual, mas manteremos o core simples: Pagou juros -> zera juros daquele período.
    
    inst.status = getInstallmentStatusLogic(inst);
    
    if (inst.status === LoanStatus.PAID && !inst.paidDate) {
       const lastPayment = sortedLedger.filter(e => e.installmentId === inst.id).pop();
       if (lastPayment) inst.paidDate = lastPayment.date;
    }
  });

  return {
    ...loan,
    installments: rebuiltInstallments
  };
};

// Função para atualizar juros dinâmicos (visualização) ao abrir o app
export const refreshAllLateFees = (loans: Loan[]): Loan[] => {
  return loans.map(loan => {
    const rebuiltLoan = rebuildLoanStateFromLedger(loan);
    const updatedInstallments = rebuiltLoan.installments.map(inst => {
      const debt = calculateTotalDue(rebuiltLoan, inst);
      
      // Se foi renovado (data futura), e o juro foi pago, ele aparece zerado.
      // Se quisermos simular o juro do PRÓXIMO mês visualmente antes de vencer:
      // if (principal > 0 && interest == 0) -> interest = scheduledInterest (hack visual)
      // Mas por enquanto, vamos manter estrito ao ledger.
      
      return {
        ...inst,
        lateFeeAccrued: debt.lateFee 
      };
    });

    return { ...rebuiltLoan, installments: updatedInstallments };
  });
};
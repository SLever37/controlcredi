
export enum LoanStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  LATE = 'LATE',
  PARTIAL = 'PARTIAL'
}

export type PaymentMethod = 'PIX' | 'CASH' | 'BANK_TRANSFER' | 'OTHER';

export interface CapitalSource {
  id: string;
  name: string;
  type: 'CASH' | 'CARD' | 'WALLET' | 'BANK';
  balance: number;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  document: string;
  email?: string;
  address: string;
  city?: string;
  state?: string;
  zipCode?: string;
  notes?: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  date: string;
  type: 'PAYMENT_FULL' | 'PAYMENT_PARTIAL' | 'PAYMENT_INTEREST_ONLY' | 'LEND_MORE' | 'WITHDRAW_PROFIT' | 'ADJUSTMENT' | 'ARCHIVE' | 'RESTORE';
  amount: number;
  principalDelta: number;
  interestDelta: number;
  lateFeeDelta: number;
  sourceId?: string; 
  installmentId?: string; // NOVO: Vínculo para reconciliação
  notes?: string;
}

export interface Installment {
  id: string;
  dueDate: string;
  
  // Valores Estáticos (Contrato Original)
  scheduledPrincipal: number; 
  scheduledInterest: number;  
  amount: number;             

  // Valores Dinâmicos (Estado Atual - Derivado do Ledger)
  principalRemaining: number;
  interestRemaining: number;
  lateFeeAccrued: number;     
  avApplied: number;          

  // Acumuladores de Pagamento (Derivado do Ledger)
  paidPrincipal: number;
  paidInterest: number;
  paidLateFee: number;
  paidTotal: number;

  status: LoanStatus;
  paidDate?: string;
  paidAmount?: number; 
  logs?: string[];
}

export interface LoanPolicy {
  interestRate: number;
  finePercent: number;
  dailyInterestPercent: number;
}

export interface PaymentSignal {
  date: string;
  type: 'INTEREST' | 'AMORTIZATION' | 'FULL';
  receiptBase64?: string; // Comprovante
  status: 'PENDING' | 'REVIEWED';
}

export interface Loan {
  id: string;
  clientId: string;
  debtorName: string;
  debtorPhone: string;
  debtorDocument: string;
  debtorAddress?: string;
  sourceId: string;
  preferredPaymentMethod: PaymentMethod;
  pixKey?: string;
  
  // Configuração do Empréstimo
  billingCycle: 'MONTHLY' | 'DAILY'; // NOVO: Ciclo de cobrança
  amortizationType: 'PRICE' | 'BULLET'; // NOVO: Price (Parcelado) ou Bullet (Giro de Juros)

  // Dados do Contrato
  principal: number;
  interestRate: number;
  finePercent: number; 
  dailyInterestPercent: number; 
  
  // NOVO: Snapshot de regras para evitar inconsistência futura
  policiesSnapshot?: LoanPolicy;

  startDate: string;
  installments: Installment[];
  totalToReceive: number;
  
  ledger: LedgerEntry[]; 
  paymentSignals?: PaymentSignal[]; // NOVO: Sinais de pagamento do cliente

  notes: string;
  guaranteeDescription?: string;
  attachments?: string[]; 
  documentPhotos?: string[]; 
  isArchived?: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  password?: string; // Nova propriedade para segurança
  recoveryPhrase?: string; // Frase secreta para recuperação de senha
  accessLevel?: number; // 1 = Master/Admin, null/0 = User
  email: string;
  businessName?: string;
  document?: string;
  phone?: string;
  address?: string;
  addressNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  website?: string;
  photo?: string;
  pixKey?: string;
  totalAvailableCapital: number;
  interestBalance: number;
  totalHistoricalInterest?: number; 
  createdAt?: string;
}

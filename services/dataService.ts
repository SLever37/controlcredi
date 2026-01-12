
import { Loan, Client, CapitalSource, UserProfile, LedgerEntry, Installment, LoanStatus } from "../types";
import { getInstallmentStatusLogic } from "./financialLogic";
import * as XLSX from 'xlsx';

export interface BackupData {
  version: string;
  timestamp: string;
  profile: UserProfile;
  clients: Client[];
  loans: Loan[];
  sources: CapitalSource[];
}

export const convertToCSV = (data: any[]) => {
  if (data.length === 0) return '';
  const header = Object.keys(data[0]).join(',');
  const rows = data.map(obj => 
    Object.values(obj).map(val => {
        if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`; 
        return val;
    }).join(',')
  );
  return [header, ...rows].join('\n');
};

export const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const generateBackup = (profile: UserProfile, clients: Client[], loans: Loan[], sources: CapitalSource[]) => {
  const backup: BackupData = {
    version: "3.4", 
    timestamp: new Date().toISOString(),
    profile,
    clients,
    loans,
    sources
  };
  return JSON.stringify(backup, null, 2);
};

export const generateLoansCSV = (loans: Loan[]) => {
  const flatLoans = loans.map(l => {
    const paid = l.installments.filter(i => i.status === 'PAID').length;
    const total = l.installments.length;
    return {
      ID: l.id,
      Devedor: l.debtorName,
      Documento: l.debtorDocument,
      Telefone: l.debtorPhone,
      Principal: l.principal,
      Total_A_Receber: l.totalToReceive,
      Juros_Mensal: `${l.interestRate}%`,
      Parcelas_Pagas: `${paid}/${total}`,
      Status: l.isArchived ? 'Arquivado' : (paid === total ? 'Quitado' : 'Em Aberto'),
      Data_Inicio: l.startDate
    };
  });
  return convertToCSV(flatLoans);
};

// --- IMPORTAÇÃO EXCEL E CSV ---

export const parseExcelClients = async (file: File): Promise<Partial<Client>[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        const clients: Partial<Client>[] = [];
        // Pula o cabeçalho (i=1)
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (row.length > 0) {
             clients.push({
                name: row[0] || 'Sem Nome',
                phone: row[1] ? String(row[1]) : '',
                document: row[2] ? String(row[2]) : '',
                address: row[3] || 'Importado via Excel'
             });
          }
        }
        resolve(clients);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

export const parseClientCSV = async (file: File): Promise<Partial<Client>[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n');
      const clients: Partial<Client>[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
        if (cols.length >= 2) {
            if (cols[0].toLowerCase().includes('nome') && cols[1].toLowerCase().includes('telefone')) continue;
            clients.push({
                name: cols[0],
                phone: cols[1],
                document: cols[2] || '',
                address: cols[3] || 'Importado via Planilha'
            });
        }
      }
      resolve(clients);
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
};

export const readBackupFile = async (file: File): Promise<BackupData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (!json.profile || !json.loans) throw new Error("Formato de backup inválido");
        resolve(json);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
};

// --- RELATÓRIOS CONTÁBEIS ---

export const summarizeLedgerByPeriod = (entries: LedgerEntry[], startISO: string, endISO: string) => {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  
  const filtered = entries.filter(e => {
    const t = new Date(e.date).getTime();
    return t >= start && t <= end;
  });

  return {
    principalIn: filtered.reduce((acc, e) => acc + (e.principalDelta > 0 ? e.principalDelta : 0), 0),
    principalOut: filtered.reduce((acc, e) => acc + (e.principalDelta < 0 ? Math.abs(e.principalDelta) : 0), 0),
    interestIn: filtered.reduce((acc, e) => acc + e.interestDelta, 0),
    lateFeeIn: filtered.reduce((acc, e) => acc + e.lateFeeDelta, 0),
    totalIn: filtered.reduce((acc, e) => acc + (e.amount > 0 ? e.amount : 0), 0), 
    totalOut: filtered.reduce((acc, e) => acc + (e.amount < 0 ? Math.abs(e.amount) : 0), 0),
    net: filtered.reduce((acc, e) => acc + e.amount, 0),
    count: filtered.length
  };
};

export const filterLedgerByLoan = (entries: LedgerEntry[], loanId: string) => {
    return entries.filter(e => e.id.includes(loanId) || (e.notes && e.notes.includes(loanId))); // Fallback se id nao tiver relacao direta
};

// --- MIGRAÇÃO DE DADOS ---
export const migrateStoredDataV2 = (oldLoans: any[]): Loan[] => {
  return oldLoans.map(loan => {
    
    // GARANTIA: Policy Snapshot para contratos antigos
    const policiesSnapshot = loan.policiesSnapshot || {
      interestRate: loan.interestRate || 30,
      finePercent: loan.finePercent || 2,
      dailyInterestPercent: loan.dailyInterestPercent || 1
    };

    const installments: Installment[] = loan.installments.map((inst: any) => {
      const isPaid = inst.status === 'PAID';
      
      const scheduledPrincipal = inst.scheduledPrincipal ?? (loan.principal / loan.installments.length);
      const scheduledInterest = inst.scheduledInterest ?? (Math.max(0, inst.amount - scheduledPrincipal));

      const principalRemaining = inst.principalRemaining ?? (isPaid ? 0 : scheduledPrincipal);
      const interestRemaining = inst.interestRemaining ?? (isPaid ? 0 : scheduledInterest);
      
      const paidPrincipal = inst.paidPrincipal ?? (isPaid ? scheduledPrincipal : 0);
      const paidInterest = inst.paidInterest ?? (isPaid ? scheduledInterest : 0);
      const paidTotal = inst.paidTotal ?? (isPaid ? inst.amount : (inst.paidAmount || 0));

      return {
        ...inst,
        scheduledPrincipal,
        scheduledInterest,
        principalRemaining,
        interestRemaining,
        lateFeeAccrued: inst.lateFeeAccrued || 0,
        avApplied: inst.avApplied || 0,
        paidPrincipal,
        paidInterest,
        paidLateFee: inst.paidLateFee || 0,
        paidTotal,
        logs: inst.logs || []
      };
    });

    return {
      ...loan,
      policiesSnapshot,
      ledger: loan.ledger || [], 
      installments
    };
  });
};


import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  TrendingUp, Plus, Search, CheckCircle2, X, Phone, Wallet, Users, Banknote, User, MessageSquare, Trash2, Edit, Archive, CreditCard, PieChart as PieIcon, Bell, DollarSign, ArrowUpRight, BarChart3, MapPin, ShieldCheck, Mail, Building, Briefcase, Database, AlertCircle, Share2, Printer, Landmark, FileText, ChevronRight, AlertTriangle, MoreHorizontal, ArrowDownCircle, Calculator, CalendarClock, Sparkles, ArrowRightLeft, PiggyBank, RotateCcw, Home, LayoutDashboard, LogOut, PlusCircle, Globe, Loader2, Download, Upload, FileSpreadsheet, HardDrive, Filter, Lock, Unlock, KeyRound, Menu, ShieldAlert, Send, Shield, History, Power, Heart, Link as LinkIcon, ExternalLink, Save, RefreshCcw, UserCog, Key, ImageIcon, Camera, ArrowUp, HelpCircle, ArrowLeft, Calendar, FileEdit, XCircle, MoreVertical, LayoutGrid, Edit2, HandCoins, StickyNote, Receipt
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { createClient } from '@supabase/supabase-js';
import { Loan, LoanStatus, Installment, CapitalSource, Client, UserProfile, LedgerEntry } from './types';
import { StatCard } from './components/StatCard';
import { LoanForm } from './components/LoanForm';
import { processNaturalLanguageCommand, getCollectionStrategy } from './services/geminiService';
import { generateBackup, generateLoansCSV, downloadFile, readBackupFile, parseClientCSV, parseExcelClients, migrateStoredDataV2 } from './services/dataService';
import { calculateTotalDue, allocatePayment, getInstallmentStatusLogic, rebuildLoanStateFromLedger, refreshAllLateFees, add30Days } from './services/financialLogic';

// --- SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://hzchchbxkhryextaymkn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_S3HLqCSMKyMprrOCoo6FHQ_Lstki7QA';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- HELPERS ---
const maskPhone = (value: string) => {
  return value.replace(/\D/g, '').replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d)(\d{4})$/, '$1-$2').slice(0, 15);
};

const maskDocument = (value: string) => {
  const clean = value.replace(/\D/g, '');
  if (clean.length <= 11) {
    return clean.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})/, '$1-$2').slice(0, 14);
  }
  return clean.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').slice(0, 18);
};

const onlyDigits = (v: string) => (v || '').replace(/\D/g, '');

const isTestClientName = (name: string) => {
  const n = (name || '').trim().toLowerCase();
  return n === 'teste';
};

// Gera código de acesso (4 dígitos) evitando colisão dentro do mesmo perfil no estado atual
const generateUniqueAccessCode = (existingCodes: Set<string>) => {
  for (let i = 0; i < 300; i++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (code === '0000') continue; // opcional
    if (!existingCodes.has(code)) return code;
  }
  // fallback (muito improvável)
  return String(Math.floor(1000 + Math.random() * 9000));
};

// Gera número do cliente (6 dígitos) evitando colisão no estado atual
const generateUniqueClientNumber = (existingNums: Set<string>) => {
  for (let i = 0; i < 300; i++) {
    const num = String(Math.floor(100000 + Math.random() * 900000));
    if (!existingNums.has(num)) return num;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
};



// Date-only helpers (avoid timezone drift / "day jumping")
const parseDateOnlyUTC = (input: string) => {
  const s = (input || '').slice(0, 10);
  const parts = s.split('-');
  if (parts.length !== 3) return new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(Date.UTC(y, m - 1, d));
};

const addDaysUTC = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);

const toISODateOnlyUTC = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};


// Days difference helper (today - dueDate) using DATE-only UTC (avoids timezone drift).
// Returns: 0 if due today, positive if overdue, negative if still in the future.
const getDaysDiff = (dueDateISO: string) => {
  const due = parseDateOnlyUTC(dueDateISO);
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffMs = todayUTC.getTime() - due.getTime();
  return Math.floor(diffMs / 86400000);
};


const formatBRDate = (isoDate: string) => {
  const d = parseDateOnlyUTC(isoDate);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

// CPF validation (Brazil)
const isValidCPF = (cpfRaw: string) => {
  const cpf = onlyDigits(cpfRaw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === Number(cpf[10]);
};

// CNPJ validation (Brazil)
const isValidCNPJ = (cnpjRaw: string) => {
  const cnpj = onlyDigits(cnpjRaw);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (base: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(base[i]) * weights[i];
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const base12 = cnpj.slice(0, 12);
  const d1 = calc(base12, [5,4,3,2,9,8,7,6,5,4,3,2]);
  const base13 = base12 + String(d1);
  const d2 = calc(base13, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return cnpj === base12 + String(d1) + String(d2);
};

const isValidCPForCNPJ = (doc: string) => {
  const d = onlyDigits(doc);
  if (d.length === 11) return isValidCPF(d);
  if (d.length === 14) return isValidCNPJ(d);
  return false;
};


type SpeechSetter = (v: string) => void;

const startDictation = (setter: SpeechSetter, onError?: (msg: string) => void) => {
  const AnyWindow: any = window as any;
  const SpeechRecognition = AnyWindow.SpeechRecognition || AnyWindow.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.('Ditado não suportado neste navegador.');
    return;
  }
  const rec = new SpeechRecognition();
  rec.lang = 'pt-BR';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = (event: any) => {
    const transcript = event?.results?.[0]?.[0]?.transcript ?? '';
    if (transcript) setter(transcript.trim());
  };
  rec.onerror = () => onError?.('Falha no ditado. Verifique permissão do microfone.');
  rec.start();
};

// --- SHARED COMPONENTS (HOISTED) ---

const ProfitCard = ({ balance, onWithdraw }: { balance: number, onWithdraw: () => void }) => (
    <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700 p-6 rounded-2xl shadow-xl hover:border-blue-500/50 transition-all duration-300 relative group flex flex-col justify-between h-full min-h-[130px]">
        <div>
            <div className="flex justify-between items-start mb-3">
                <div className="p-3 bg-slate-900 rounded-xl text-blue-400">
                    <ArrowUpRight />
                </div>
                <button onClick={(e) => { e.stopPropagation(); onWithdraw(); }} className="p-2 px-3 bg-emerald-600 text-white rounded-lg text-[9px] font-black uppercase hover:scale-105 transition-transform flex items-center gap-1 shadow-lg shadow-emerald-900/20">
                    Resgatar <ArrowRightLeft size={10} />
                </button>
            </div>
            <div>
                <p className="text-slate-400 text-sm font-medium">Lucro Disponível</p>
                <h3 className="text-2xl font-bold text-white mt-1">R$ {balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h3>
            </div>
        </div>
    </div>
);

const Modal: React.FC<{onClose: () => void, title: string, children: React.ReactNode}> = ({onClose, title, children}) => (
  <div className="fixed inset-0 z-[100] bg-slate-950/98 backdrop-blur-2xl flex items-center justify-center p-4 overflow-y-auto">
    <div className="bg-slate-900 border border-slate-800 w-full max-w-3xl rounded-[2rem] sm:rounded-[3rem] p-6 sm:p-12 shadow-2xl animate-in fade-in zoom-in-95 duration-200 my-auto relative">
      <div className="flex justify-between items-center mb-6 sm:mb-10 sticky top-0 bg-slate-900 z-10 py-2">
        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tighter text-white">{title}</h2>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition-all p-2 sm:p-3 bg-slate-800 rounded-2xl"><X size={20}/></button>
      </div>
      {children}
    </div>
  </div>
);

const ReceiptModal = ({ data, onClose, userName, userDoc }: { data: {loan: Loan, inst: Installment, amountPaid: number, type: string}, onClose: () => void, userName: string, userDoc?: string }) => {
    const authCode = `${data.inst.id.substring(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
    
    const share = () => {
        const text = `*COMPROVANTE DE PAGAMENTO*\n` +
            `--------------------------------\n` +
            `*Beneficiário:* ${userName}\n` +
            `*Data:* ${new Date().toLocaleDateString()} às ${new Date().toLocaleTimeString()}\n` +
            `--------------------------------\n` +
            `*Pagador:* ${data.loan.debtorName}\n` +
            `*CPF:* ${data.loan.debtorDocument}\n` +
            `*Referente:* ${data.type === 'FULL' ? 'Quitação de Parcela' : 'Pagamento de Juros/Renovação'}\n` +
            `--------------------------------\n` +
            `*VALOR PAGO:* R$ ${data.amountPaid.toFixed(2)}\n` +
            `--------------------------------\n` +
            `Autenticação: ${authCode}\n\n` +
            `Obrigado pela preferência!`;
        window.open(`https://wa.me/55${data.loan.debtorPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank');
    };

    return (
        <Modal onClose={onClose} title="Comprovante Oficial">
            <div className="flex flex-col items-center">
                {/* VIZUALIZAÇÃO DO CUPOM (Para Print) */}
                <div className="bg-[#fffdf5] text-slate-900 w-full max-w-sm mx-auto p-6 rounded-none shadow-xl border-t-8 border-emerald-600 relative overflow-hidden mb-6 font-mono text-sm leading-relaxed" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}>
                    
                    {/* Header Cupom */}
                    <div className="text-center border-b-2 border-dashed border-slate-300 pb-4 mb-4">
                        <div className="flex justify-center mb-2 text-emerald-600">
                            <Receipt size={32} />
                        </div>
                        <h2 className="font-bold text-lg uppercase tracking-wider">{userName}</h2>
                        {userDoc && <p className="text-[10px] text-slate-500">CNPJ/CPF: {userDoc}</p>}
                        <p className="text-[10px] text-slate-500">{new Date().toLocaleDateString()} às {new Date().toLocaleTimeString()}</p>
                    </div>

                    {/* Corpo Cupom */}
                    <div className="space-y-3 mb-4">
                        <div className="flex justify-between">
                            <span className="text-slate-500 font-bold">RECIBO Nº</span>
                            <span className="font-bold">{Math.floor(Math.random() * 100000)}</span>
                        </div>
                        <div className="border-b border-slate-200 pb-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Pagador</p>
                            <p className="font-bold uppercase truncate">{data.loan.debtorName}</p>
                            <p className="text-xs text-slate-500">{data.loan.debtorDocument}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Descrição</p>
                            <p className="font-bold">{data.type === 'FULL' ? 'AMORTIZAÇÃO / QUITAÇÃO' : 'PAGAMENTO DE JUROS'}</p>
                            <p className="text-xs text-slate-500">Ref. Contrato: {data.loan.id.substring(0, 8).toUpperCase()}</p>
                        </div>
                    </div>

                    {/* Totais */}
                    <div className="bg-slate-100 p-3 rounded-lg border border-slate-200 mb-4">
                        <div className="flex justify-between items-end">
                            <span className="font-bold text-slate-600 uppercase text-xs">Total Pago</span>
                            <span className="font-black text-xl text-emerald-600">R$ {data.amountPaid.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Footer Cupom */}
                    <div className="text-center text-[9px] text-slate-400 border-t-2 border-dashed border-slate-300 pt-4">
                        <p>Autenticação Eletrônica:</p>
                        <p className="font-mono mt-1 text-[10px] text-slate-500 break-all">{authCode}</p>
                        <p className="mt-2 italic">Obrigado pela pontualidade!</p>
                    </div>

                    {/* Efeito de Serrilha (Visual apenas) */}
                    <div className="absolute bottom-0 left-0 right-0 h-2 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMiAxMCIgcHJlc2VydmVBc3BlY3RSYXRpbz0ibm9uZSI+PHBhdGggZD0iTTAgMTBMNiAwIDEyIDEweiIgZmlsbD0iIzBmMTcyYSIvPjwvc3ZnPg==')] bg-contain bg-bottom bg-repeat-x opacity-10"></div>
                </div>

                <div className="flex flex-col w-full gap-3">
                    <button onClick={share} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2 hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/20">
                        <Share2 size={18} /> Enviar no WhatsApp
                    </button>
                    <p className="text-center text-xs text-slate-500 mt-2">Dica: Tire um print da área acima para enviar como imagem.</p>
                </div>
            </div>
        </Modal>
    );
};

// Promissória do sistema (fallback): abre uma janela de impressão para o cliente salvar em PDF.
// Observação: não depende de assets externos nem de Storage.
const openSystemPromissoriaPrint = (args: {
  clientName: string;
  clientPhone?: string;
  loanId: string;
  loanCreatedAt?: string;
  principal?: number;
  interestRate?: number | string;
  debtorDocument?: string;
  totalToPay?: number;
}) => {
  const {
    clientName,
    clientPhone,
    loanId,
    loanCreatedAt,
    principal,
    interestRate,
    debtorDocument,
    totalToPay,
  } = args;

  const fmtMoney = (v?: number) =>
    typeof v === 'number' && !Number.isNaN(v)
      ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '—';

  const fmtDate = (v?: string) => {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  };
  const computedTotalToPay = (() => {
    if (typeof totalToPay === 'number' && !Number.isNaN(totalToPay)) return totalToPay;
    const p = typeof principal === 'number' && !Number.isNaN(principal) ? principal : 0;
    const ir = Number(interestRate);
    if (!Number.isFinite(ir)) return p;
    return p * (1 + (ir / 100));
  })();

  const html = `
  <!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Promissória</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #0f172a; }
        h1 { font-size: 18px; margin: 0 0 12px; }
        .muted { color: #475569; font-size: 12px; }
        .box { border: 1px solid #cbd5e1; padding: 16px; margin-top: 12px; }
        .row { display: flex; gap: 12px; flex-wrap: wrap; }
        .col { flex: 1; min-width: 220px; }
        .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
        .value { font-size: 14px; font-weight: 700; }
        .divider { border-top: 1px dashed #cbd5e1; margin: 16px 0; }
        .sign { margin-top: 22px; }
        .line { border-bottom: 1px solid #0f172a; height: 20px; margin-top: 28px; }
        .small { font-size: 11px; color: #334155; margin-top: 6px; }
        @media print { body { margin: 0.8cm; } }
      </style>
    </head>
    <body>
      <h1>Promissória (Sistema)</h1>
      <div class="muted">
        Documento gerado automaticamente com base no contrato. Você pode imprimir ou salvar como PDF.
      </div>
      <div style="margin: 10px 0 16px 0;">
        <button onclick="window.print()" style="background:#0f172a;color:#fff;border:0;padding:10px 14px;border-radius:10px;font-weight:800;cursor:pointer;">Imprimir / Salvar PDF</button>
        <span style="margin-left:10px;color:#64748b;font-size:12px;">Se não abrir automaticamente, toque no botão.</span>
      </div>

      <div class="box">
        <div class="row">
          <div class="col">
            <div class="label">Cliente</div>
            <div class="value">${clientName || '—'}</div>
          </div>
          <div class="col">
            <div class="label">Telefone</div>
            <div class="value">${clientPhone || '—'}</div>
          </div>
          <div class="col">
            <div class="label">Documento (CPF/CNPJ do contrato)</div>
            <div class="value">${debtorDocument || '—'}</div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="row">
          <div class="col">
            <div class="label">Contrato (ID)</div>
            <div class="value">${loanId || '—'}</div>
          </div>
          <div class="col">
            <div class="label">Data do contrato</div>
            <div class="value">${fmtDate(loanCreatedAt)}</div>
          </div>
        </div>

        <div class="row" style="margin-top: 12px;">
          <div class="col">
            <div class="label">Valor total a pagar</div>
            <div class="value">${fmtMoney(computedTotalToPay)}</div>
          </div>
        </div>

        <div class="sign">
          <div class="small">Assinatura do Devedor</div>
          <div class="line"></div>
          <div class="small">Assinatura do Credor</div>
          <div class="line"></div>
        </div>
      </div>

      <script>
        setTimeout(() => window.print(), 250);
      </script>
    </body>
  </html>
  `;

  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
};

const MessageHubModal = ({ loan, client, onClose }: { loan: Loan, client?: any, onClose: () => void }) => {
    const handleSend = (type: 'WELCOME' | 'REMINDER' | 'LATE' | 'PAID') => {
        const firstName = (loan.debtorName || '').split(' ').filter(Boolean)[0] || 'Cliente';

        const clientCode = String(client?.access_code || client?.accessCode || '').padStart(4, '0') || '----';
        const clientNumber = String(client?.client_number || client?.clientNumber || '').trim();
        const clientDoc = String(loan.debtorDocument || client?.document || client?.cpf || client?.cnpj || '').trim();

        const portalLink = `${window.location.origin}/?portal=${loan.id}`;

        const pendingInst = loan.installments.find(i => i.status !== 'PAID');
        const nextDate = pendingInst ? new Date(pendingInst.dueDate).toLocaleDateString('pt-BR') : 'Finalizado';
        const amount = pendingInst ? calculateTotalDue(loan, pendingInst).total.toFixed(2) : '0,00';

        const loginLine = clientDoc
          ? `Login: *${clientDoc}* + Código *${clientCode}*${clientNumber ? ` (ou Nº Cliente *${clientNumber}* + Código)` : ''}`
          : `Login: Código *${clientCode}*${clientNumber ? ` (ou Nº Cliente *${clientNumber}* + Código)` : ''}`;

        const portalBlock = `\n\n🔗 Portal: ${portalLink}\n🔐 Código do cliente: *${clientCode}*\n${loginLine}`;

        let text = '';

        switch (type) {
            case 'WELCOME':
                text =
                  `Olá *${firstName}*!\n\n` +
                  `Seu acesso ao portal foi criado.\n` +
                  `Quando precisar, use o portal para ver seus contratos e enviar comprovantes.` +
                  portalBlock;
                break;
            case 'REMINDER':
                text =
                  `Olá *${firstName}*!\n\n` +
                  `Lembrete: existe uma parcela no valor de *R$ ${amount}* com vencimento em *${nextDate}*.\n` +
                  `Se já pagou, pode enviar o comprovante pelo portal.` +
                  portalBlock;
                break;
            case 'LATE':
                text =
                  `⚠️ *AVISO DE COBRANÇA*\n\n` +
                  `Sr(a). *${loan.debtorName}*.\n\n` +
                  `Consta em aberto a parcela de *R$ ${amount}* com vencimento em *${nextDate}*.\n\n` +
                  `Solicitamos a regularização.` +
                  portalBlock;
                break;
            case 'PAID':
                text =
                  `Olá *${firstName}*!\n\n` +
                  `Confirmamos o recebimento do seu pagamento.\n\n` +
                  `Obrigado!` +
                  portalBlock;
                break;
        }

        const cleanPhone = String(loan.debtorPhone || '').replace(/\D/g, '');
        const waPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;

        const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
        onClose();
    };

    return (
        <Modal onClose={onClose} title="Central de Mensagens">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button onClick={() => handleSend('WELCOME')} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl hover:border-blue-500 transition-all text-left group">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl group-hover:bg-blue-500 group-hover:text-white transition-colors"><HandCoins size={20}/></div>
                        <span className="font-bold text-white uppercase text-xs">Boas Vindas</span>
                    </div>
                    <p className="text-[10px] text-slate-500">Inclui portal + código do cliente.</p>
                </button>
                <button onClick={() => handleSend('REMINDER')} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl hover:border-amber-500 transition-all text-left group">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl group-hover:bg-amber-500 group-hover:text-white transition-colors"><CalendarClock size={20}/></div>
                        <span className="font-bold text-white uppercase text-xs">Lembrete Vencimento</span>
                    </div>
                    <p className="text-[10px] text-slate-500">Com link do portal + login.</p>
                </button>
                <button onClick={() => handleSend('LATE')} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl hover:border-rose-500 transition-all text-left group">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-rose-500/10 text-rose-500 rounded-xl group-hover:bg-rose-500 group-hover:text-white transition-colors"><ShieldAlert size={20}/></div>
                        <span className="font-bold text-white uppercase text-xs">Cobrança Atraso</span>
                    </div>
                    <p className="text-[10px] text-slate-500">Mensagem firme com portal + código.</p>
                </button>
                <button onClick={() => handleSend('PAID')} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl hover:border-emerald-500 transition-all text-left group">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl group-hover:bg-emerald-500 group-hover:text-white transition-colors"><CheckCircle2 size={20}/></div>
                        <span className="font-bold text-white uppercase text-xs">Recibo Pagamento</span>
                    </div>
                    <p className="text-[10px] text-slate-500">Confirmação com login do portal.</p>
                </button>
            </div>
        </Modal>
    );
};

const CalculatorModal = ({ onClose }: { onClose: () => void }) => {
    const [cVal, setCVal] = useState('');
    const [cRate, setCRate] = useState('');
    const [cTime, setCTime] = useState('');
    const [cRes, setCRes] = useState<number | null>(null);

    const calc = () => {
        const v = parseFloat(cVal);
        const r = parseFloat(cRate) / 100;
        const t = parseFloat(cTime);
        if(v && r && t) setCRes(v + (v * r * t));
    };

    return (
        <Modal onClose={onClose} title="Calculadora de Simulação">
            <div className="space-y-6">
                <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800">
                    <p className="text-slate-500 text-xs font-bold uppercase mb-2">Valor Principal (R$)</p>
                    <input type="number" placeholder="0.00" className="w-full bg-transparent text-white text-3xl font-black outline-none" value={cVal} onChange={e => setCVal(e.target.value)}/>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950 p-4 rounded-3xl border border-slate-800">
                        <p className="text-slate-500 text-xs font-bold uppercase mb-2">Taxa Mensal (%)</p>
                        <input type="number" placeholder="0" className="w-full bg-transparent text-white text-xl font-bold outline-none" value={cRate} onChange={e => setCRate(e.target.value)}/>
                    </div>
                    <div className="bg-slate-950 p-4 rounded-3xl border border-slate-800">
                        <p className="text-slate-500 text-xs font-bold uppercase mb-2">Parcelas / Meses</p>
                        <input type="number" placeholder="1" className="w-full bg-transparent text-white text-xl font-bold outline-none" value={cTime} onChange={e => setCTime(e.target.value)}/>
                    </div>
                </div>
                <button onClick={calc} className="w-full py-5 bg-blue-600 text-white font-black rounded-2xl uppercase hover:bg-blue-500 transition-all shadow-lg flex items-center justify-center gap-2">
                    <Calculator size={20}/> Calcular
                </button>
                {cRes !== null && (
                    <div className="grid grid-cols-2 gap-4 mt-4 animate-in slide-in-from-bottom-4">
                        <div className="p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-2xl text-center">
                            <p className="text-emerald-500 text-[10px] font-black uppercase">Total Final</p>
                            <p className="text-2xl font-black text-white">R$ {cRes.toFixed(2)}</p>
                        </div>
                        <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-2xl text-center">
                            <p className="text-slate-400 text-[10px] font-black uppercase">Lucro Bruto</p>
                            <p className="text-2xl font-black text-white">R$ {(cRes - parseFloat(cVal || '0')).toFixed(2)}</p>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
};

const AgendaModal = ({ onClose, loans, onSelectLoan }: { onClose: () => void, loans: Loan[], onSelectLoan: (id: string) => void }) => {
    // ... existing implementation unchanged ...
    const today = new Date();
    const [currentMonth, setCurrentMonth] = useState(today.getMonth());
    const [currentYear, setCurrentYear] = useState(today.getFullYear());
    const [view, setView] = useState<'CALENDAR' | 'ADD'>('CALENDAR');
    
    const [manualEvents, setManualEvents] = useState<{id: number, date: string, title: string, desc: string}[]>([]);
    const [newEvent, setNewEvent] = useState({ title: '', date: new Date().toISOString().split('T')[0], desc: '' });

    useEffect(() => {
        const stored = localStorage.getItem('cm_agenda_events');
        if(stored) {
            try { setManualEvents(JSON.parse(stored)); } catch(e){}
        }
    }, []);

    const saveEvent = () => {
        if(!newEvent.title || !newEvent.date) return;
        const updated = [...manualEvents, { id: Date.now(), ...newEvent }];
        setManualEvents(updated);
        localStorage.setItem('cm_agenda_events', JSON.stringify(updated));
        setNewEvent({ title: '', date: new Date().toISOString().split('T')[0], desc: '' });
        setView('CALENDAR');
    };

    const deleteEvent = (id: number) => {
        const updated = manualEvents.filter(e => e.id !== id);
        setManualEvents(updated);
        localStorage.setItem('cm_agenda_events', JSON.stringify(updated));
    };

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();

    const getStatusColor = (daysLate: number) => {
        if (daysLate > 30) return 'bg-slate-900 border-2 border-slate-600 text-slate-400';
        if (daysLate > 0) return 'bg-rose-600 text-white';
        if (daysLate >= -3) return 'bg-orange-500 text-white';
        return 'bg-blue-600 text-white';
    };

    const loanEvents = loans.flatMap(l => 
        l.isArchived ? [] : l.installments
            .filter(i => i.status !== 'PAID')
            .map(i => {
                const date = new Date(i.dueDate);
                return {
                    type: 'LOAN',
                    day: date.getDate(),
                    month: date.getMonth(),
                    year: date.getFullYear(),
                    client: l.debtorName,
                    amount: i.amount,
                    days: getDaysDiff(i.dueDate),
                    loanId: l.id
                };
            })
    );

    const manualEventsMapped = manualEvents.map(e => {
        const date = new Date(e.date + 'T12:00:00'); 
        return {
            type: 'MANUAL',
            day: date.getDate(),
            month: date.getMonth(),
            year: date.getFullYear(),
            client: e.title,
            desc: e.desc,
            id: e.id
        };
    });

    const allMonthEvents = [...loanEvents, ...manualEventsMapped].filter(ev => ev.month === currentMonth && ev.year === currentYear);

    const renderCalendarDays = () => {
        const days = [];
        for (let i = 0; i < firstDayOfWeek; i++) {
            days.push(<div key={`empty-${i}`} className="h-24 bg-slate-950/30 rounded-xl border border-slate-800/30"></div>);
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const dayEvents = allMonthEvents.filter(e => e.day === d);
            
            days.push(
                <div key={d} className="min-h-[6rem] bg-slate-950 border border-slate-800 rounded-xl p-2 flex flex-col items-start hover:border-slate-600 transition-colors relative overflow-hidden group">
                    <span className="text-xs font-bold text-slate-500 mb-1">{d}</span>
                    {dayEvents.length > 0 && (
                        <div className="w-full space-y-1">
                            {dayEvents.slice(0, 3).map((ev: any, idx) => (
                                <div key={idx} onClick={() => ev.type === 'LOAN' ? onSelectLoan(ev.loanId) : null} className={`cursor-pointer truncate ${ev.type === 'MANUAL' ? 'opacity-80 hover:opacity-100' : ''}`}>
                                    <div className={`h-1.5 w-full rounded-full mb-0.5 ${ev.type === 'LOAN' ? getStatusColor(ev.days).split(' ')[0] : 'bg-purple-500'}`}></div>
                                    <p className="text-[8px] text-white truncate font-bold flex justify-between">
                                        <span>{ev.client.split(' ')[0]}</span>
                                        {ev.type === 'MANUAL' && <button onClick={(e) => {e.stopPropagation(); deleteEvent(ev.id)}} className="text-slate-500 hover:text-rose-500 ml-1"><X size={8}/></button>}
                                    </p>
                                </div>
                            ))}
                            {dayEvents.length > 3 && <p className="text-[8px] text-slate-500 text-center">+{dayEvents.length - 3}...</p>}
                        </div>
                    )}
                </div>
            );
        }
        return days;
    };

    return (
        <Modal onClose={onClose} title="Agenda Mensal">
            {view === 'CALENDAR' ? (
                <div className="space-y-4">
                    <div className="flex justify-between items-center mb-4 bg-slate-950 p-4 rounded-2xl border border-slate-800">
                        <div className="flex items-center gap-2">
                            <button onClick={() => setCurrentMonth(prev => prev === 0 ? 11 : prev - 1)} className="p-2 bg-slate-800 rounded-lg text-white hover:bg-slate-700"><ArrowLeft size={16}/></button>
                            <h3 className="text-sm sm:text-lg font-black uppercase text-white">
                                {new Date(currentYear, currentMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                            </h3>
                            <button onClick={() => setCurrentMonth(prev => prev === 11 ? 0 : prev + 1)} className="p-2 bg-slate-800 rounded-lg text-white hover:bg-slate-700"><ArrowRightLeft size={16} className="rotate-180"/></button>
                        </div>
                        <button onClick={() => setView('ADD')} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 hover:bg-blue-500"><Plus size={14}/> Novo</button>
                    </div>
                    
                    <div className="grid grid-cols-7 gap-2 mb-2">
                        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
                            <div key={d} className="text-center text-[10px] font-black uppercase text-slate-500">{d}</div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                        {renderCalendarDays()}
                    </div>
                    
                    <div className="flex flex-wrap justify-center gap-4 text-[9px] uppercase font-bold text-slate-500 mt-4 border-t border-slate-800 pt-4">
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-600"></div> Em Dia</span>
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-500"></div> Próximo</span>
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-rose-600"></div> Vencido</span>
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500"></div> Lembrete</span>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-4">
                        <button onClick={() => setView('CALENDAR')} className="p-2 bg-slate-800 rounded-lg text-white"><ArrowLeft size={16}/></button>
                        <h3 className="font-bold text-white">Novo Lembrete</h3>
                    </div>
                    <input type="text" placeholder="Título do Lembrete" className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none" value={newEvent.title} onChange={e => setNewEvent({...newEvent, title: e.target.value})} />
                    <input type="date" className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none" value={newEvent.date} onChange={e => setNewEvent({...newEvent, date: e.target.value})} />
                    <textarea placeholder="Descrição (Opcional)" className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white outline-none h-24" value={newEvent.desc} onChange={e => setNewEvent({...newEvent, desc: e.target.value})} />
                    <button onClick={saveEvent} className="w-full py-4 bg-purple-600 text-white rounded-xl font-black uppercase text-xs">Salvar Lembrete</button>
                </div>
            )}
        </Modal>
    );
};

// ... other shared components (FlowModal, NavHub, ClientPortalView, DashboardAlerts) unchanged ...
const FlowModal = ({ onClose, loans, profit }: { onClose: () => void, loans: Loan[], profit: number }) => {
    const allTrans = loans.flatMap(l => l.ledger).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const totalIn = allTrans.filter(t => t.amount > 0 && !t.type.includes('LEND')).reduce((acc, t) => acc + t.amount, 0);
    const totalOut = allTrans.filter(t => t.type === 'LEND_MORE').reduce((acc, t) => acc + t.amount, 0);

    return (
        <Modal onClose={onClose} title="Extrato Financeiro Detalhado">
            <div className="space-y-6">
                <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 text-center relative overflow-hidden">
                    <div className="relative z-10">
                        <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Lucro Líquido Disponível</p>
                        <p className="text-4xl font-black text-emerald-400">R$ {profit.toFixed(2)}</p>
                    </div>
                    <div className="absolute top-0 right-0 p-4 opacity-10 text-emerald-500"><PiggyBank size={80}/></div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-2xl text-center">
                        <p className="text-[10px] text-emerald-500 font-black uppercase">Entradas (Total)</p>
                        <p className="text-xl font-black text-white">R$ {totalIn.toFixed(2)}</p>
                    </div>
                    <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-2xl text-center">
                        <p className="text-[10px] text-rose-500 font-black uppercase">Saídas (Total)</p>
                        <p className="text-xl font-black text-white">R$ {totalOut.toFixed(2)}</p>
                    </div>
                </div>

                <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden flex flex-col h-[400px]">
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {allTrans.map((t, i) => (
                            <div key={i} className="flex justify-between items-center p-4 border-b border-slate-800 last:border-0 hover:bg-slate-900 transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2.5 rounded-xl ${t.type === 'LEND_MORE' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                        {t.type === 'LEND_MORE' ? <ArrowUpRight size={16}/> : <ArrowDownCircle size={16}/>}
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-white uppercase">{t.type === 'LEND_MORE' ? 'Empréstimo' : 'Pagamento'}</p>
                                        <p className="text-[10px] text-slate-500">{new Date(t.date).toLocaleDateString()} • {t.notes || 'Movimentação'}</p>
                                    </div>
                                </div>
                                <span className={`text-sm font-black ${t.type === 'LEND_MORE' ? 'text-rose-500' : 'text-emerald-500'}`}>
                                    {t.type === 'LEND_MORE' ? '-' : '+'} R$ {t.amount.toFixed(2)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
};

const NavHub = ({ onClose, onNavigate, userLevel }: { onClose: () => void, onNavigate: (tab: string, modal?: string) => void, userLevel: number }) => (
    <div className="fixed inset-0 z-[60] bg-slate-950/40 backdrop-blur-xl flex items-start justify-end p-4 md:p-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-full max-w-sm">
            <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black text-white uppercase tracking-tighter flex items-center gap-2"><LayoutGrid className="text-blue-500"/> Hub Central</h2>
                <button onClick={onClose} className="p-3 bg-slate-900 rounded-full text-slate-400 hover:text-white"><X/></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <button onClick={() => onNavigate('PROFILE')} className="p-6 bg-slate-900 border border-slate-800 rounded-3xl hover:border-blue-600 transition-all group flex flex-col items-center justify-center gap-3">
                    <div className="p-4 bg-slate-800 rounded-2xl text-blue-500 group-hover:scale-110 transition-transform"><User size={32}/></div>
                    <span className="font-bold text-white uppercase text-xs tracking-widest">Meu Perfil</span>
                </button>
                <button onClick={() => onNavigate('DASHBOARD', 'AGENDA')} className="p-6 bg-slate-900 border border-slate-800 rounded-3xl hover:border-purple-600 transition-all group flex flex-col items-center justify-center gap-3">
                    <div className="p-4 bg-slate-800 rounded-2xl text-purple-500 group-hover:scale-110 transition-transform"><Calendar size={32}/></div>
                    <span className="font-bold text-white uppercase text-xs tracking-widest">Agenda</span>
                </button>
                <button onClick={() => onNavigate('DASHBOARD', 'CALC')} className="p-6 bg-slate-900 border border-slate-800 rounded-3xl hover:border-emerald-600 transition-all group flex flex-col items-center justify-center gap-3">
                    <div className="p-4 bg-slate-800 rounded-2xl text-emerald-500 group-hover:scale-110 transition-transform"><Calculator size={32}/></div>
                    <span className="font-bold text-white uppercase text-xs tracking-widest">Calculadora</span>
                </button>
                <button onClick={() => onNavigate('DASHBOARD', 'FLOW')} className="p-6 bg-slate-900 border border-slate-800 rounded-3xl hover:border-orange-600 transition-all group flex flex-col items-center justify-center gap-3">
                    <div className="p-4 bg-slate-800 rounded-2xl text-orange-500 group-hover:scale-110 transition-transform"><ArrowRightLeft size={32}/></div>
                    <span className="font-bold text-white uppercase text-xs tracking-widest">Extrato</span>
                </button>
                {userLevel === 1 && (
                    <button onClick={() => onNavigate('MASTER')} className="col-span-2 p-6 bg-slate-900 border border-slate-800 rounded-3xl hover:border-rose-600 transition-all group flex flex-col items-center justify-center gap-3">
                        <div className="p-4 bg-slate-800 rounded-2xl text-rose-500 group-hover:scale-110 transition-transform"><Shield size={32}/></div>
                        <span className="font-bold text-white uppercase text-xs tracking-widest">SAC / Gestão de Acessos</span>
                    </button>
                )}
            </div>
        </div>
    </div>
);

const ClientPortalView = ({ initialLoanId }: { initialLoanId: string }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [portalError, setPortalError] = useState<string | null>(null);
    const [portalInfo, setPortalInfo] = useState<string | null>(null);

    const [loginIdentifier, setLoginIdentifier] = useState('');
    const [loginCode, setLoginCode] = useState('');
    const [loggedClient, setLoggedClient] = useState<{ id: string; name: string; phone?: string; cpf?: string; client_number?: string } | null>(null);
    const [selectedLoanId, setSelectedLoanId] = useState<string>(initialLoanId);
    const loanId = selectedLoanId;
    const [clientLoans, setClientLoans] = useState<any[]>([]);
    const [byeName, setByeName] = useState<string | null>(null);

    const PORTAL_SESSION_KEY = 'cm_portal_session';

    const [portalSignals, setPortalSignals] = useState<Array<{ id: string; created_at?: string; tipo_intencao?: string; status?: string; comprovante_url?: string; review_note?: string; reviewed_at?: string; client_viewed_at?: string }>>([]);
    const [hasUnseenStatusUpdate, setHasUnseenStatusUpdate] = useState(false);

    const [loan, setLoan] = useState<any | null>(null);
    const [pixKey, setPixKey] = useState<string>('');
    const [installments, setInstallments] = useState<Array<{ data_vencimento: string | null; valor_parcela: number | null; numero_parcela?: number | null; status?: string | null }>>([]);

    const [intentId, setIntentId] = useState<string | null>(null);
    const [intentType, setIntentType] = useState<string | null>(null);
    const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

    const [isNoteOpen, setIsNoteOpen] = useState(false);

    
    useEffect(() => {
        // Auto-login do portal (mantém sessão)
        const run = async () => {
            if (loggedClient) return;
            try {
                const raw = localStorage.getItem(PORTAL_SESSION_KEY);
                if (!raw) return;
                const sess = JSON.parse(raw || '{}');
                const clientId = String(sess?.client_id || '');
                const accessCode = String(sess?.access_code || '');
                if (!clientId || !accessCode) return;

                // Valida no BD (segurança)
                const { data: clientData, error } = await supabase
                    .from('clientes')
                    .select('id, name, phone, cpf, client_number, access_code')
                    .eq('id', clientId)
                    .eq('access_code', accessCode)
                    .single();

                if (error || !clientData) {
                    localStorage.removeItem(PORTAL_SESSION_KEY);
                    return;
                }

                setLoggedClient({
                    id: String(clientData.id),
                    name: String(clientData.name || ''),
                    phone: clientData.phone ? String(clientData.phone) : undefined,
                    cpf: clientData.cpf ? String(clientData.cpf) : undefined,
                    client_number: clientData.client_number ? String(clientData.client_number) : undefined,
                });

                // Se tiver um último contrato salvo e ele existir para esse cliente, seleciona
                const lastLoanId = String(sess?.last_loan_id || '');
                if (lastLoanId) setSelectedLoanId(lastLoanId);

                setPortalInfo(null);
                setByeName(null);
            } catch (e) {
                try { localStorage.removeItem(PORTAL_SESSION_KEY); } catch {}
            }
        };
        run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

useEffect(() => {
        loadPortalLoan(initialLoanId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialLoanId]);

    const loadInstallments = async () => {
        try {
            const { data, error } = await supabase
                .from('parcelas')
                .select('data_vencimento, valor_parcela, numero_parcela, status')
                .eq('loan_id', loanId)
                .order('data_vencimento', { ascending: true });

            if (error) throw error;
            setInstallments((data || []).map((p: any) => ({
                data_vencimento: p.data_vencimento ?? p.due_date ?? null,
                valor_parcela: p.valor_parcela ?? p.amount ?? null,
                numero_parcela: p.numero_parcela ?? null,
                status: p.status ?? null
            })));
        } catch (e: any) {
            setPortalError(e?.message || 'Falha ao carregar as parcelas.');
        }
    };


    const loadPortalLoan = async (targetLoanId: string, clientIdForList?: string) => {
        setPortalError(null);
        setIsLoading(true);
        try {
            const { data: loanData, error: loanError } = await supabase
                .from('contratos')
                .select('*')
                .eq('id', targetLoanId)
                .single();

            if (loanError) throw loanError;

            setLoan(loanData);
            setSelectedLoanId(targetLoanId);

            const profileId = loanData?.profile_id;
            if (profileId) {
                const { data: profileData, error: profileError } = await supabase
                    .from('perfis')
                    .select('pix_key')
                    .eq('id', profileId)
                    .single();

                if (!profileError && profileData?.pix_key) {
                    setPixKey(String(profileData.pix_key));
                }
            }

            const { data: parcelasData, error: parcelasError } = await supabase
                .from('parcelas')
                .select('data_vencimento, valor_parcela, numero_parcela, status')
                .eq('loan_id', targetLoanId)
                .order('data_vencimento', { ascending: true });

            if (parcelasError) throw parcelasError;

            setInstallments((parcelasData || []).map((p: any) => ({
                data_vencimento: p.data_vencimento ?? p.due_date ?? null,
                valor_parcela: p.valor_parcela ?? p.amount ?? null,
                numero_parcela: p.numero_parcela ?? null,
                status: p.status ?? null
            })));
            // Carrega sinalizações e status (aprovação/negação) para feedback no portal
            try {
                const effectiveClientId = String((clientIdForList || loanData?.client_id) || '');
                if (effectiveClientId) {
                    const { data: sigData, error: sigError } = await supabase
                        .from('sinalizacoes_pagamento')
                        .select('id, created_at, tipo_intencao, status, comprovante_url, review_note, reviewed_at, client_viewed_at')
                        .eq('loan_id', targetLoanId)
                        .eq('client_id', effectiveClientId)
                        .order('created_at', { ascending: false });

                    if (!sigError) {
                        setPortalSignals(sigData || []);

                        // Marca como "não visto" quando existir atualização (aprovado/negado) sem client_viewed_at
                        const unseen = (sigData || []).some((s: any) => {
                            const st = String(s.status || '').toUpperCase();
                            return (st === 'APROVADO' || st === 'NEGADO') && !s.client_viewed_at;
                        });
                        setHasUnseenStatusUpdate(unseen);

                        // Se houver aprova/nega não visto, grava client_viewed_at ao abrir
                        const toMark = (sigData || []).filter((s: any) => {
                            const st = String(s.status || '').toUpperCase();
                            return (st === 'APROVADO' || st === 'NEGADO') && !s.client_viewed_at;
                        });

                        if (toMark.length) {
                            const ids = toMark.map((s: any) => s.id);
                            await supabase.from('sinalizacoes_pagamento')
                                .update({ client_viewed_at: new Date().toISOString() })
                                .in('id', ids);
                        }
                    }
                }
            } catch (e) {
                // silencioso
            }


            const clientId = clientIdForList || loanData?.client_id;
            if (clientId && profileId) {
                const { data: loansList, error: loansListError } = await supabase
                    .from('contratos')
                    .select('id, start_date, principal, interest_rate, total_to_receive, is_archived, debtor_name')
                    .eq('client_id', clientId)
                    .eq('profile_id', profileId)
                    .order('start_date', { ascending: false });

                if (!loansListError) setClientLoans(loansList || []);
            }
        } catch (e: any) {
            setPortalError(e?.message || 'Falha ao carregar o contrato no portal.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = async () => {
        setPortalError(null);
        const identifierRaw = loginIdentifier.trim();
        const code = loginCode.trim();

        if (!identifierRaw || !code) {
            setPortalError('Informe seu CPF/CNPJ ou Telefone e o código de acesso.');
            return;
        }

        try {
            if (!loan?.client_id) throw new Error('Contrato sem vínculo de cliente.');

            // Busca o cliente vinculado a este contrato
            const { data: clientData, error: clientError } = await supabase
                .from('clientes')
                .select('id, name, phone, document, cpf, cnpj, client_number, access_code')
                .eq('id', loan.client_id)
                .single();

            if (clientError) throw clientError;

            const expectedCode = String(clientData.access_code || '').trim();
            if (!expectedCode || expectedCode !== code) {
                throw new Error('Código de acesso inválido.');
            }

            const identifierDigits = onlyDigits(identifierRaw);
            const contractDocDigits = onlyDigits(String(loan.debtor_document || loan.debtorDocument || ''));
            const clientPhoneDigits = onlyDigits(String(clientData.phone || ''));
            const debtorPhoneDigits = onlyDigits(String((loan as any).debtor_phone || (loan as any).debtorPhone || ''));

            // Regra principal: CPF/CNPJ do CONTRATO + código do cliente.
            const matchesContractDoc = Boolean(identifierDigits && contractDocDigits && identifierDigits === contractDocDigits);

            // Fallback 1: Nº do cliente + código
            const matchesClientNumber = Boolean(
                String(clientData.client_number || '').trim() &&
                String(clientData.client_number || '').trim() === String(identifierRaw || '').trim()
            );

            // Fallback 2: Telefone + código (para clientes antigos que não forneceram CPF)
            const matchesPhone = Boolean(
                identifierDigits &&
                ((clientPhoneDigits && identifierDigits === clientPhoneDigits) || (debtorPhoneDigits && identifierDigits === debtorPhoneDigits))
            );

            if (!matchesContractDoc && !matchesClientNumber && !matchesPhone) {
                throw new Error('Informe CPF/CNPJ ou telefone cadastrado (ou Nº do Cliente).');
            }
setLoggedClient({
                id: String(clientData.id),
                name: String(clientData.name || ''),
                phone: clientData.phone ? String(clientData.phone) : undefined,
                cpf: clientData.cpf ? String(clientData.cpf) : undefined,
                client_number: clientData.client_number ? String(clientData.client_number) : undefined,
            });
            // Persistir sessão do portal (fica logado até clicar em Sair)
            try {
                localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify({
                    client_id: String(clientData.id),
                    access_code: String(clientData.access_code || code),
                    identifier: identifierRaw,
                    last_loan_id: String(loanId || initialLoanId),
                    saved_at: new Date().toISOString()
                }));
            } catch (e) {}


            // Rastro de acesso
            await supabase.from('logs_acesso_cliente').insert([{ client_id: clientData.id }]);
        } catch (e: any) {
            setPortalError(e?.message || 'Não foi possível autenticar. Verifique seus dados.');
        }
    };

    useEffect(() => {
        if (loggedClient) loadInstallments();
    }, [loggedClient]);

    type PortalIntent = 'PAGAR_PIX' | 'PAGAR_CARTAO' | 'QUITAR_ENCERRAR';
    const PORTAL_INTENT_LABEL: Record<PortalIntent, string> = {
        PAGAR_PIX: 'Pagar (PIX)',
        PAGAR_CARTAO: 'Cartão de Crédito',
        QUITAR_ENCERRAR: 'Quitar e Encerrar'
    };

    const handleSignalIntent = async (tipo: PortalIntent) => {
        if (!loggedClient) return;
        setPortalError(null);
        setIntentType(tipo);

        // Aviso claro: ao clicar em PAGAR (PIX), o sistema copia a chave PIX automaticamente
        if (tipo === 'PAGAR_PIX') {
            try {
                if (pixKey) {
                    await navigator.clipboard.writeText(pixKey);
                    setPortalInfo('PIX copiado. Cole no seu banco/app para pagar.');
                } else {
                    setPortalInfo('PIX não encontrado. Avise o operador.');
                }
            } catch (e) {
                setPortalInfo('Não foi possível copiar o PIX automaticamente. Copie manualmente com o operador.');
            }
        } else if (tipo === 'PAGAR_CARTAO') {
            setPortalInfo('Pedido enviado. O operador vai orientar o pagamento no cartão.');
        } else {
            setPortalInfo('Pedido enviado. O operador vai confirmar o encerramento do contrato.');
        }

        try {
            const { data, error } = await supabase
                .from('sinalizacoes_pagamento')
                .insert([{
                    client_id: loggedClient.id,
                    loan_id: loanId,
                    tipo_intencao: tipo,
                    status: 'PENDENTE',
                    profile_id: loan?.profile_id || null
                }])
                .select('id')
                .single();

            if (error) throw error;

            setIntentId(String(data.id));
            setReceiptPreview(null);
        } catch (e: any) {
            setPortalError(e?.message || 'Não foi possível registrar sua solicitação agora.');
        }
    };

    const handleReceiptUpload = async (file: File) => {
        if (!intentId) {
            setPortalError('Selecione um tipo de pagamento antes de anexar o comprovante.');
            return;
        }

        try {
            const previewUrl = URL.createObjectURL(file);
            setReceiptPreview(previewUrl);

            const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
            const safeName = `${intentId}.${ext}`;
            const storagePath = `${loan?.profile_id || 'public'}/${loggedClient.id}/${safeName}`;

            const { error: uploadError } = await supabase.storage
                .from('comprovantes')
                .upload(storagePath, file, { upsert: true, contentType: file.type || 'application/octet-stream' });

            if (uploadError) throw uploadError;

            // Guardamos o caminho/URL pública. Se o bucket não for público, o operador abre via signed URL no painel.
            const { data: publicData } = supabase.storage.from('comprovantes').getPublicUrl(storagePath);
            const comprovanteUrl = publicData?.publicUrl || storagePath;

            const { error } = await supabase
                .from('sinalizacoes_pagamento')
                .update({ comprovante_url: comprovanteUrl })
                .eq('id', intentId);

            if (error) throw error;
        } catch (e: any) {
            setPortalError(e?.message || 'Falha ao enviar o comprovante.');
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
                <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 text-center max-w-md w-full shadow-2xl">
                    <h1 className="text-xl font-black text-white uppercase mb-2">Portal do Cliente</h1>
                    <p className="text-slate-400 text-sm">Carregando...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
            <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 text-center max-w-md w-full shadow-2xl">
                <ShieldCheck className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                <h1 className="text-2xl font-black text-white uppercase mb-2">Portal do Cliente</h1>

                <p className="text-slate-400 text-sm mb-6">
                    Contrato:&nbsp;<span className="text-blue-500 font-mono">{loanId}</span>
                </p>

                {portalError && (
                    <div className="bg-red-950/40 p-3 rounded-xl border border-red-900 text-red-200 text-xs mb-4">
                        {portalError}
                    </div>
                )}

                {byeName && (
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-white text-sm mb-4">
                        Até logo, <span className="font-bold">{byeName}</span>.
                    </div>
                )}

                {!loggedClient ? (
                    <>
                        <div className="text-left space-y-3 mb-6">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">CPF/CNPJ ou Telefone</label>
                                <input
                                    value={loginIdentifier}
                                    onChange={e => setLoginIdentifier(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none"
                                    placeholder="Digite seu CPF/CNPJ ou Telefone"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Código de Acesso</label>
                                <input
                                    value={loginCode}
                                    onChange={e => setLoginCode(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white outline-none"
                                    placeholder="4 dígitos"
                                    inputMode="numeric"
                                    maxLength={4}
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleLogin}
                            className="w-full bg-blue-600 p-3 rounded-xl font-bold uppercase text-xs hover:bg-blue-500 transition-all"
                        >
                            Entrar
                        </button>

                        <button
                            onClick={() => { try { localStorage.removeItem(PORTAL_SESSION_KEY); } catch (e) {} setByeName(loggedClient?.name || 'Cliente'); setLoggedClient(null); setPortalError(null); setPortalInfo(null); setLoginIdentifier(''); setLoginCode(''); setSelectedLoanId(initialLoanId); }}
                            className="w-full mt-3 bg-slate-800 p-3 rounded-xl font-bold uppercase text-xs hover:bg-slate-700 transition-all"
                        >
                            Voltar ao Início
                        </button>
                    </>
                ) : (
                    <>
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6 text-left">
                            <p className="text-white font-bold mb-1">Olá, {loggedClient.name || 'Cliente'}</p>
                            {portalSignals.length > 0 && (
                                <div className="mt-3 p-3 rounded-xl border border-slate-800 bg-slate-900/40">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-xs text-slate-300 font-bold uppercase tracking-widest">Status do seu pedido</p>
                                        <span className="text-[10px] px-2 py-1 rounded-full bg-slate-800 text-slate-200 font-black">
                                            {String(portalSignals[0]?.status || 'PENDENTE').toUpperCase()}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-2">
                                        Última ação: {portalSignals[0]?.tipo_intencao ? String(portalSignals[0].tipo_intencao) : '—'}
                                        {portalSignals[0]?.created_at ? ` • ${new Date(String(portalSignals[0].created_at)).toLocaleString('pt-BR')}` : ''}
                                    </p>
                                    {String(portalSignals[0]?.status || '').toUpperCase() === 'NEGADO' && portalSignals[0]?.review_note && (
                                        <p className="text-xs text-rose-300 mt-2">
                                            Motivo/observação: {String(portalSignals[0].review_note)}
                                        </p>
                                    )}
                                    {String(portalSignals[0]?.status || '').toUpperCase() === 'APROVADO' && (
                                        <p className="text-xs text-emerald-300 mt-2">
                                            Seu pedido foi aprovado. Se você já pagou, aguarde a baixa pelo operador.
                                        </p>
                                    )}
                                </div>
                            )}

                            {clientLoans.length > 1 && (
                                <div className="mt-4 bg-slate-950 border border-slate-800 rounded-2xl p-4">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Seus Contratos</p>
                                    <div className="space-y-2">
                                        {clientLoans.map((l: any) => (
                                            <button
                                                key={l.id}
                                                onClick={() => loadPortalLoan(String(l.id), loggedClient.id)}
                                                className={`w-full text-left p-3 rounded-xl border transition-all ${
                                                    String(l.id) === String(loanId)
                                                        ? 'bg-blue-600/20 border-blue-500/30'
                                                        : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                                                }`}
                                            >
                                                <div className="flex justify-between items-center">
                                                    <span className="text-xs font-bold text-white truncate">{l.debtor_name || 'Contrato'}</span>
                                                    <span className="text-[10px] font-black text-slate-400">{l.start_date ? new Date(l.start_date).toLocaleDateString() : ''}</span>
                                                </div>
                                                <div className="mt-1 flex justify-between items-center">
                                                    <span className="text-[10px] text-slate-400">Total: R$ {Number((l as any).total_to_receive || 0).toFixed(2)}</span>
                                                    <span className="text-[10px] text-slate-400">Total: R$ {Number(l.total_to_receive || 0).toFixed(2)}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <p className="text-xs text-slate-400">Abaixo está o extrato das suas parcelas.</p>
                        </div>

                        <div className="text-left mb-6">
                            <div className="text-xs text-slate-500 mb-2 uppercase font-bold">Parcelas</div>
                            <div className="space-y-2 max-h-56 overflow-auto pr-1">
                                {(installments || []).length === 0 ? (
                                    <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-xl p-3">
                                        Nenhuma parcela encontrada.
                                    </div>
                                ) : (
                                    installments.map((p, idx) => (
                                        <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                                            <div>
                                                <p className="text-white text-sm font-bold">
                                                    {p.numero_parcela ? `Parcela ${p.numero_parcela}` : `Parcela ${idx + 1}`}
                                                </p>
                                                <p className="text-xs text-slate-400">
                                                    Venc.: {p.data_vencimento ? new Date(p.data_vencimento).toLocaleDateString('pt-BR') : '-'}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-white font-black">
                                                    {typeof p.valor_parcela === 'number' ? p.valor_parcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}
                                                </p>
                                                {p.status && <p className="text-xs text-slate-500">{p.status}</p>}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 mb-4">
                            <button
                                onClick={() => handleSignalIntent('PAGAR_PIX')}
                                className="w-full bg-emerald-600 p-3 rounded-xl font-black uppercase text-xs hover:bg-emerald-500 transition-all"
                            >
                                PAGAR (PIX)
                            </button>
                            <button
                                onClick={() => handleSignalIntent('PAGAR_CARTAO')}
                                className="w-full bg-blue-600 p-3 rounded-xl font-black uppercase text-xs hover:bg-blue-500 transition-all"
                            >
                                PAGAR NO CARTÃO
                            </button>
                            <button
                                onClick={() => handleSignalIntent('QUITAR_ENCERRAR')}
                                className="w-full bg-amber-600 p-3 rounded-xl font-black uppercase text-xs hover:bg-amber-500 transition-all"
                            >
                                QUITAR E ENCERRAR
                            </button>
                        </div>

                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-left mb-4">
                            <p className="text-xs text-slate-400 mb-2">
                                {intentType ? `Opção selecionada: ${PORTAL_INTENT_LABEL[(intentType as PortalIntent)] ?? intentType}` : 'Selecione uma opção de pagamento.'}
                            </p>
                            {portalInfo && <p className="text-xs text-slate-300 mb-2">{portalInfo}</p>}
                            <input
                                type="file"
                                accept="image/*,application/pdf"
                                className="text-xs text-slate-300"
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleReceiptUpload(f);
                                }}
                            />
                            {receiptPreview && (
                                <div className="mt-3 text-xs text-slate-400">
                                    Comprovante anexado.
                                </div>
                            )}
                            {pixKey && (
                                <div className="mt-3 text-xs text-slate-400">
                                    Ao clicar em PAGAR (PIX), o sistema copia a chave PIX para pagamento.
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => setIsNoteOpen(true)}
                            className="w-full bg-slate-800 p-3 rounded-xl font-bold uppercase text-xs hover:bg-slate-700 transition-all"
                        >
                            Ver Promissória
                        </button>

                        <button
                            onClick={() => { setPortalError(null); setPortalInfo(null); setLoginIdentifier(''); setLoginCode(''); }}
                            className="w-full mt-3 bg-slate-950 border border-slate-800 p-3 rounded-xl font-bold uppercase text-xs hover:bg-slate-800 transition-all"
                        >
                            Sair
                        </button>

                        {isNoteOpen && (
                            <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                                <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 max-w-lg w-full">
                                    {/* Se o operador carregou uma promissória assinada (PDF/Imagem), o cliente vê aqui. Se não, mostramos a promissória do sistema. */}
                                    {Boolean((loan as any)?.promissoria_url && String((loan as any).promissoria_url).trim() !== '') && (
                                        <div className="mb-4 p-3 rounded-xl bg-blue-600/10 border border-blue-500/20">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-2">Promissória assinada</p>
                                            <a
                                                href={(loan as any).promissoria_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-2 text-[10px] font-black uppercase text-white bg-blue-600 px-4 py-2 rounded-xl"
                                            >
                                                <ExternalLink size={14}/> Abrir / Baixar
                                            </a>
                                            <p className="text-[9px] text-slate-500 mt-2">Você pode baixar este arquivo. Não é possível apagar pelo portal.</p>
                                        </div>
                                    )}
                                    {!Boolean((loan as any)?.promissoria_url && String((loan as any).promissoria_url).trim() !== '') && (
                                        <div className="mb-4 p-3 rounded-xl bg-slate-950/40 border border-slate-800">
                                            {(loan as any)?.confissao_divida_url && String((loan as any).confissao_divida_url).trim() !== '' && (
                                        <div className="mb-4 p-3 rounded-xl bg-slate-950/40 border border-slate-800">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-2">Documento anexado</p>
                                            <button
                                                onClick={() => window.open(String((loan as any).confissao_divida_url), '_blank', 'noreferrer')}
                                                className="w-full px-4 py-3 rounded-2xl bg-slate-900 text-emerald-400 hover:text-white hover:bg-emerald-600 transition-all text-[9px] font-black uppercase"
                                            >
                                                Baixar documento
                                            </button>
                                        </div>
                                    )}

                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Promissória do sistema</p>
                                            <p className="text-[9px] text-slate-500 mt-1">Nenhuma promissória assinada foi anexada pelo operador para este contrato.</p>
                                            <button
                                                onClick={() => openSystemPromissoriaPrint({
                                                    clientName: loggedClient.name,
                                                    clientPhone: loggedClient.phone,
                                                    loanId: String(loanId),
                                                    loanCreatedAt: (loan as any)?.created_at,
                                                    principal: typeof (loan as any)?.principal === 'number' ? (loan as any).principal : Number((loan as any)?.principal),
                                                    interestRate: (loan as any)?.interest_rate ?? (loan as any)?.interestRate,
                                                    totalToPay: Number((loan as any)?.total_to_receive ?? (loan as any)?.totalToReceive ?? 0),
                                                    debtorDocument: (loan as any)?.debtor_document ?? (loan as any)?.debtorDocument ?? loggedClient?.document ?? (loggedClient as any)?.cpf ?? (loggedClient as any)?.cnpj,
                                                })}
                                                className="inline-flex items-center gap-2 mt-3 text-[10px] font-black uppercase text-white bg-slate-800 px-4 py-2 rounded-xl hover:bg-slate-700"
                                                title="Abrir a promissória do sistema para imprimir / salvar em PDF"
                                            >
                                                <Printer size={14}/> Imprimir / Salvar PDF
                                            </button>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between mb-4">
                                        <h2 className="text-white font-black uppercase text-sm">Promissória</h2>
                                        <button
                                            onClick={() => setIsNoteOpen(false)}
                                            className="bg-slate-800 px-3 py-2 rounded-xl text-xs text-white font-bold hover:bg-slate-700"
                                        >
                                            Fechar
                                        </button>
                                    </div>
                                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-left text-xs text-slate-200 space-y-2">
                                        <p><span className="text-slate-400">Cliente:</span> {loggedClient.name}</p>
                                        <p><span className="text-slate-400">Telefone:</span> {loggedClient.phone}</p>
                                        <p><span className="text-slate-400">Contrato:</span> {loanId}</p>
                                        {loan?.created_at && <p><span className="text-slate-400">Data do contrato:</span> {new Date(loan.created_at).toLocaleDateString('pt-BR')}</p>}
                                        {loan?.principal && <p><span className="text-slate-400">Principal:</span> {Number(loan.principal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>}
                                        {loan?.interest_rate && <p><span className="text-slate-400">Juros:</span> {String(loan.interest_rate)}%</p>}
                                        <p className="text-slate-400 pt-2">
                                            Este documento é exibido com base nos dados do contrato ativo vinculado ao link do portal.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

const DashboardAlerts = ({ loans }: { loans: Loan[] }) => {
    const activeLoans = loans.filter(l => !l.isArchived);
    const critical = activeLoans.filter(l => l.installments.some(i => getDaysDiff(i.dueDate) > 30 && i.status !== 'PAID')).length;
    
    if (critical === 0) return null;

    return (
        <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex items-center gap-4 mb-6 animate-pulse">
           <div className="p-3 bg-rose-500 rounded-xl text-white shadow-lg shadow-rose-900/20"><ShieldAlert size={24}/></div>
           <div>
             <p className="text-white font-bold text-sm uppercase">Atenção Necessária</p>
             <p className="text-rose-400 text-xs font-medium">{critical} contratos com atraso crítico superior a 30 dias.</p>
           </div>
        </div>
    );
};

// --- MAIN APP COMPONENT ---

export const App: React.FC = () => {
  // Portal State
  const [portalLoanId, setPortalLoanId] = useState<string | null>(null);

  // Login State
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [loginUser, setLoginUser] = useState(''); 
  const [loginPassword, setLoginPassword] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<{id: string, name: string, email: string}[]>([]);
  
  // Registration State
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileForm, setNewProfileForm] = useState({ name: '', email: '', businessName: '', password: '', recoveryPhrase: '' });

  // Recovery State
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  const [recoveryForm, setRecoveryForm] = useState({ email: '', phrase: '', newPassword: '' });

  // Profile Edit State
  const [profileEditForm, setProfileEditForm] = useState<UserProfile | null>(null);

  // --- MASTER PANEL STATE ---
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [masterEditUser, setMasterEditUser] = useState<any>(null); 
  const [sacSearch, setSacSearch] = useState('');
  
  const [activeUser, setActiveUser] = useState<UserProfile | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [sources, setSources] = useState<CapitalSource[]>([]);
  
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'CLIENTS' | 'SOURCES' | 'PROFILE' | 'MASTER'>('DASHBOARD');
  const [mobileDashboardTab, setMobileDashboardTab] = useState<'CONTRACTS' | 'BALANCE'>('CONTRACTS');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [isAddFundsModalOpen, setIsAddFundsModalOpen] = useState<CapitalSource | null>(null);
  const [donateModal, setDonateModal] = useState(false);
  const [resetDataModal, setResetDataModal] = useState(false);

const [deleteAccountModal, setDeleteAccountModal] = useState(false);
const [deleteAccountAgree, setDeleteAccountAgree] = useState(false);
const [deleteAccountConfirm, setDeleteAccountConfirm] = useState('');

  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [showHelpModal, setShowHelpModal] = useState(false);
  
  // NAVIGATION & MODALS STATE
  const [showNavHub, setShowNavHub] = useState(false);
  const [showCalcModal, setShowCalcModal] = useState(false);
  const [showAgendaModal, setShowAgendaModal] = useState(false);
  const [showFlowModal, setShowFlowModal] = useState(false);
  const [noteModalLoan, setNoteModalLoan] = useState<Loan | null>(null);
  const [noteText, setNoteText] = useState('');
  const [editingSource, setEditingSource] = useState<CapitalSource | null>(null);

  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'ATRASADOS' | 'EM_DIA' | 'PAGOS' | 'ARQUIVADOS' | 'ATRASO_CRITICO'>('TODOS');
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  
  const [showReceipt, setShowReceipt] = useState<{loan: Loan, inst: Installment, amountPaid: number, type: string} | null>(null);
  const [viewProofModal, setViewProofModal] = useState<string | null>(null);
  const handleOpenComprovante = async (urlOrPath: string) => {
      try {
          if (!urlOrPath) return;
          // Se já for URL http(s) ou data URL, abre direto
          if (/^(https?:)?\/\//i.test(urlOrPath) || urlOrPath.startsWith('data:')) {
              setViewProofModal(urlOrPath);
              return;
          }
          // Caso seja path do Storage, gerar Signed URL
          const { data, error } = await supabase.storage.from('comprovantes').createSignedUrl(urlOrPath, 60 * 60);
          if (error) throw error;
          if (data?.signedUrl) setViewProofModal(data.signedUrl);
      } catch (e: any) {
          showToast(e?.message || 'Não foi possível abrir o comprovante.', 'error');
      }
  };

  const handleReviewSignal = async (signalId: string, nextStatus: 'APROVADO' | 'NEGADO') => {
      if (!activeUser) return;
      try {
          const note = window.prompt(nextStatus === 'APROVADO' ? 'Observação (opcional):' : 'Motivo/observação (opcional):') || null;
          const { error } = await supabase
              .from('sinalizacoes_pagamento')
              .update({
                  status: nextStatus,
                  reviewed_at: new Date().toISOString(),
                  review_note: note
              })
              .eq('id', signalId)
              .eq('profile_id', activeUser.id);

          if (error) throw error;

          // Recarrega dados do perfil para refletir no painel
          if (activeProfileId) await fetchFullData(activeProfileId);

          showToast(nextStatus === 'APROVADO' ? 'Pagamento aprovado.' : 'Pagamento negado.', 'success');
      } catch (e: any) {
          showToast(e?.message || 'Falha ao atualizar status.', 'error');
      }
  };



  const [clientForm, setClientForm] = useState({ name: '', phone: '', document: '', email: '', address: '', city: '', state: '', notes: '' });
  const [clientDraftAccessCode, setClientDraftAccessCode] = useState<string>('');
  const [clientDraftNumber, setClientDraftNumber] = useState<string>('');
  const [sourceForm, setSourceForm] = useState({ name: '', type: 'BANK', balance: '' });
  const [addFundsValue, setAddFundsValue] = useState('');

  const [paymentModal, setPaymentModal] = useState<{loan: Loan, inst: Installment, calculations: any} | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  
  const [messageModalLoan, setMessageModalLoan] = useState<Loan | null>(null);
  
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [withdrawValue, setWithdrawValue] = useState('');
  const [withdrawSourceId, setWithdrawSourceId] = useState('');
  
  const [paymentType, setPaymentType] = useState<'FULL' | 'RENEW_INTEREST' | 'RENEW_AV'>('FULL');
  const [avAmount, setAvAmount] = useState('');
  
  const [refundChecked, setRefundChecked] = useState(true);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error' | 'info'} | null>(null);

  const [confirmation, setConfirmation] = useState<{
    type: 'DELETE' | 'ARCHIVE' | 'RESTORE' | 'DELETE_CLIENT' | 'DELETE_SOURCE', 
    target: any,
    title?: string,
    message?: string,
    showRefundOption?: boolean,
    actionFn?: () => void 
  } | null>(null);

  const fileInputBackupRef = useRef<HTMLInputElement>(null);
  const fileInputExcelRef = useRef<HTMLInputElement>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const promissoriaFileInputRef = useRef<HTMLInputElement>(null);
  const [promissoriaUploadLoanId, setPromissoriaUploadLoanId] = useState<string | null>(null);
  const extraDocFileInputRef = useRef<HTMLInputElement>(null);
  const [extraDocUploadLoanId, setExtraDocUploadLoanId] = useState<string | null>(null);
  const [extraDocKind, setExtraDocKind] = useState<'CONFISSAO' | null>(null);

  // --- INITIALIZATION ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const portalId = params.get('portal');
    if (portalId) {
        setPortalLoanId(portalId);
        return;
    }

    const saved = localStorage.getItem('cm_saved_profiles');
    if (saved) {
      try { setSavedProfiles(JSON.parse(saved)); } catch (e) {}
    }

    const session = localStorage.getItem('cm_session');
    if (session) {
      try {
        const { profileId } = JSON.parse(session);
        // Sem verificação de timeout (sessão persistente)
        if (profileId) setActiveProfileId(profileId);
      } catch (e) { localStorage.removeItem('cm_session'); }
    }

    // Restaurar aba
    const lastTab = localStorage.getItem('cm_last_tab');
    if (lastTab) setActiveTab(lastTab as any);
  }, []);

  // --- PERSIST ACTIVE TAB ---
  useEffect(() => {
    if (activeTab) localStorage.setItem('cm_last_tab', activeTab);
  }, [activeTab]);

  // --- COMPUTED STATES ---
  const filteredLoans = useMemo(() => {
    let result = loans;

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(l =>
        l.debtorName.toLowerCase().includes(lower) ||
        String(l.debtorDocument || '').toLowerCase().includes(lower) ||
        String(l.debtorPhone || '').toLowerCase().includes(lower) ||
        String((l as any).debtorEmail || '').toLowerCase().includes(lower) ||
        String((l as any).debtorCode || '').toLowerCase().includes(lower) ||
        String((l as any).debtorClientNumber || '').toLowerCase().includes(lower) ||
        (onlyDigits(lower) && (
          onlyDigits(String(l.debtorDocument || '')).includes(onlyDigits(lower)) ||
          onlyDigits(String(l.debtorPhone || '')).includes(onlyDigits(lower)) ||
          onlyDigits(String((l as any).debtorCode || '')).includes(onlyDigits(lower)) ||
          onlyDigits(String((l as any).debtorClientNumber || '')).includes(onlyDigits(lower))
        ))
      );
    }

    if (statusFilter === 'TODOS') {
        result = result.filter(l => !l.isArchived && !l.installments.every(i => i.status === LoanStatus.PAID));
    } else if (statusFilter === 'ATRASADOS') {
      result = result.filter(l => l.installments.some(i => getInstallmentStatusLogic(i) === LoanStatus.LATE) && !l.isArchived);
    } else if (statusFilter === 'ATRASO_CRITICO') {
      result = result.filter(l => l.installments.some(i => getDaysDiff(i.dueDate) > 30 && i.status !== LoanStatus.PAID) && !l.isArchived);
    } else if (statusFilter === 'EM_DIA') {
      result = result.filter(l => l.installments.every(i => getInstallmentStatusLogic(i) !== LoanStatus.LATE) && !l.installments.every(i => i.status === LoanStatus.PAID) && !l.isArchived);
    } else if (statusFilter === 'PAGOS') {
      result = result.filter(l => l.installments.every(i => i.status === LoanStatus.PAID));
    } else if (statusFilter === 'ARQUIVADOS') {
      result = result.filter(l => l.isArchived);
    }

    return result.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [loans, searchTerm, statusFilter]);


  const filteredClients = useMemo(() => {
    if (!clientSearchTerm) return clients;
    const lower = clientSearchTerm.toLowerCase().trim();
    const ld = (v: any) => String(v || '').toLowerCase();
    const digits = onlyDigits(clientSearchTerm);
    return clients.filter(c => {
      return (
        ld(c.name).includes(lower) ||
        ld(c.phone).includes(lower) ||
        ld(c.email).includes(lower) ||
        ld((c as any).document).includes(lower) ||
        ld((c as any).cpf).includes(lower) ||
        ld((c as any).cnpj).includes(lower) ||
        ld((c as any).client_number).includes(lower) ||
        ld((c as any).access_code).includes(lower) ||
        (digits && (onlyDigits(c.phone || '').includes(digits) || onlyDigits((c as any).cpf || '').includes(digits) || onlyDigits((c as any).cnpj || '').includes(digits) || onlyDigits((c as any).document || '').includes(digits)))
      );
    });
  }, [clients, clientSearchTerm]);

  const stats = useMemo(() => {
    const activeLoans = loans.filter(l => !l.isArchived);
    
    const totalLent = activeLoans.reduce((acc, l) => {
        const remainingInLoan = l.installments.reduce((instAcc, i) => instAcc + (Number(i.principalRemaining) || 0), 0);
        return acc + remainingInLoan;
    }, 0);

    const totalReceived = loans.reduce((acc, l) => {
      return acc + l.installments.reduce((sum, i) => sum + (Number(i.paidTotal) || 0), 0);
    }, 0);

    const expectedProfit = activeLoans.reduce((acc, l) => {
        const loanProjectedProfit = l.installments.reduce((sum, i) => {
            return sum + (Number(i.interestRemaining) || 0) + (Number(i.lateFeeAccrued) || 0);
        }, 0);
        return acc + loanProjectedProfit;
    }, 0);

    const interestBalance = Number(activeUser?.interestBalance) || 0;

    const paidCount = loans.filter(l => l.installments.every(i => i.status === LoanStatus.PAID)).length; 
    const lateCount = activeLoans.filter(l => l.installments.some(i => getInstallmentStatusLogic(i) === LoanStatus.LATE) && !l.installments.every(i => i.status === LoanStatus.PAID)).length;
    const onTimeCount = activeLoans.length - lateCount; 

    const pieData = [
      { name: 'Em Dia', value: onTimeCount, color: '#3b82f6' },
      { name: 'Atrasados', value: lateCount, color: '#f43f5e' },
      { name: 'Quitados', value: paidCount, color: '#10b981' },
    ];

    const monthlyDataMap: {[key: string]: {name: string, Entradas: number, Saidas: number}} = {};
    const monthsBack = 5;
    for (let i = monthsBack; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const key = d.toISOString().slice(0, 7); 
        monthlyDataMap[key] = { name: `${d.getDate()}/${d.getMonth()+1}`, Entradas: 0, Saidas: 0 };
    }
    loans.forEach(l => {
        l.ledger.forEach(t => {
            const key = t.date.slice(0, 7); 
            if (monthlyDataMap[key]) {
                if (t.type === 'LEND_MORE') monthlyDataMap[key].Saidas += t.amount;
                else if (t.type.includes('PAYMENT')) monthlyDataMap[key].Entradas += t.amount;
            }
        });
    });
    const lineChartData = Object.values(monthlyDataMap).sort((a,b) => a.name.localeCompare(b.name));

    return { totalLent, totalReceived, expectedProfit, interestBalance, pieData, lineChartData };
  }, [loans, activeUser]);

  // --- SUPABASE FETCHING LOGIC ---
  const fetchFullData = async (profileId: string) => {
    setIsLoadingData(true);
    try {
        const { data: profile, error: profileError } = await supabase.from('perfis').select('*').eq('id', profileId).single();
        if (profileError) throw profileError;

        const { data: dbClients } = await supabase.from('clientes').select('*').eq('profile_id', profileId);
        const { data: dbSources } = await supabase.from('fontes').select('*').eq('profile_id', profileId);
        const { data: dbLoans } = await supabase
            .from('contratos')
            .select('*, parcelas(*), transacoes(*), sinalizacoes_pagamento(*)')
            .eq('profile_id', profileId);

        if (profile) {
             const userProfile = {
                 id: String(profile.id),
                 name: String(profile.nome_operador || ''),
                 email: String(profile.usuario_email || ''),
                 businessName: String(profile.nome_empresa || ''),
                 password: String(profile.senha_acesso || ''),
                 accessLevel: Number(profile.access_level || 0),
                 recoveryPhrase: String(profile.recovery_phrase || ''),
                 document: String(profile.document || ''),
                 phone: String(profile.phone || ''),
                 address: String(profile.address || ''),
                 addressNumber: String(profile.address_number || ''),
                 neighborhood: String(profile.neighborhood || ''),
                 city: String(profile.city || ''),
                 state: String(profile.state || ''),
                 zipCode: String(profile.zip_code || ''),
                 pixKey: String(profile.pix_key || ''),
                 interestBalance: Number(profile.interest_balance) || 0,
                 totalAvailableCapital: Number(profile.total_available_capital) || 0,
                 photo: String(profile.avatar_url || profile.photo || '')
             };
             setActiveUser(userProfile);
             setProfileEditForm(userProfile);
        }

        setClients((dbClients || []).map((c: any) => ({
            id: String(c.id),
            name: String(c.name || ''),
            phone: String(c.phone || ''),
            document: String(c.document || ''),
            email: String(c.email || ''),
            address: String(c.address || ''),
            city: String(c.city || ''),
            state: String(c.state || ''),
            zipCode: String(c.zip_code || ''),
            notes: String(c.notes || ''),
            // campos extras (não alteram layout, mas habilitam portal/busca/import)
            access_code: c.access_code || null,
            client_number: c.client_number || null,
            cpf: c.cpf || null,
            cnpj: c.cnpj || null,
            createdAt: String(c.created_at || new Date().toISOString())
        })) as any);

        setSources((dbSources || []).map((s: any) => ({
            id: String(s.id),
            name: String(s.name || ''),
            type: s.type || 'BANK',
            balance: Number(s.balance) || 0
        })));

        const safeLoans = (dbLoans || []).map((l: any) => ({
            id: String(l.id),
            clientId: String(l.client_id || ''),
            sourceId: String(l.source_id || ''),
            debtorName: String(l.debtor_name || ''),
            debtorPhone: String(l.debtor_phone || ''),
            debtorDocument: String(l.debtor_document || ''),
            debtorAddress: String(l.debtor_address || ''),
            preferredPaymentMethod: l.preferred_payment_method || 'PIX',
            pixKey: String(l.pix_key || ''),
            billingCycle: l.billing_cycle || 'MONTHLY',
            amortizationType: l.amortization_type || 'PRICE',
            principal: Number(l.principal) || 0,
            interestRate: Number(l.interest_rate) || 0,
            finePercent: Number(l.fine_percent) || 0,
            dailyInterestPercent: Number(l.daily_interest_percent) || 0,
            startDate: String(l.start_date || new Date().toISOString()),
            totalToReceive: Number(l.total_to_receive) || 0,
            notes: String(l.notes || ''),
            guaranteeDescription: String(l.guarantee_description || ''),
            paymentSignals: (l.sinalizacoes_pagamento || []).map((s: any) => ({
                id: String(s.id),
                date: s.created_at,
                type: String(s.tipo_intencao || s.type || ''),
                status: String(s.status || ''),
                comprovanteUrl: s.comprovante_url ? String(s.comprovante_url) : null,
                clientViewedAt: s.client_viewed_at ? String(s.client_viewed_at) : null,
                reviewNote: s.review_note ? String(s.review_note) : null
            })),
            isArchived: !!l.is_archived,
            installments: (l.parcelas || []).map((p: any) => {
                let logs: any[] = [];
                try { logs = typeof p.logs === 'string' ? JSON.parse(p.logs) : p.logs; } catch (e) { logs = []; }
                const sanitizedLogs = Array.isArray(logs) ? logs.map(String) : [];
                return {
                    id: String(p.id),
                    // Adding defensive check for new column names to ensure app stability
                    dueDate: String(p.data_vencimento || p.due_date),
                    amount: Number(p.valor_parcela || p.amount) || 0,
                    scheduledPrincipal: Number(p.scheduled_principal) || 0,
                    scheduledInterest: Number(p.scheduled_interest) || 0,
                    principalRemaining: Number(p.principal_remaining) || 0,
                    interestRemaining: Number(p.interest_remaining) || 0,
                    lateFeeAccrued: Number(p.late_fee_accrued) || 0,
                    avApplied: Number(p.av_applied) || 0,
                    paidPrincipal: Number(p.paid_principal) || 0,
                    paidInterest: Number(p.paid_interest) || 0,
                    paidLateFee: Number(p.paid_late_fee) || 0,
                    paidTotal: Number(p.paid_total) || 0,
                    status: p.status,
                    paidDate: p.paid_date ? String(p.paid_date) : undefined,
                    logs: sanitizedLogs
                };
            }),
            ledger: (l.transacoes || []).map((t: any) => ({
                id: String(t.id),
                date: String(t.date),
                type: t.type,
                amount: Number(t.amount) || 0,
                principalDelta: Number(t.principal_delta) || 0,
                interestDelta: Number(t.interest_delta) || 0,
                lateFeeDelta: Number(t.late_fee_delta) || 0,
                sourceId: t.source_id ? String(t.source_id) : undefined,
                installmentId: t.installment_id ? String(t.installment_id) : undefined,
                notes: String(t.notes || '')
            }))
        }));
        setLoans(refreshAllLateFees(safeLoans));
    } catch (error: any) {
        console.error("Erro fetch:", error);
        setLoans([]); 
    } finally {
        setIsLoadingData(false);
    }
  };

  const fetchAllUsers = async () => {
    if (!activeUser || activeUser.accessLevel !== 1) return;
    const { data, error } = await supabase.from('perfis').select('*').order('created_at', { ascending: false });
    if (data) setAllUsers(data);
  };

  useEffect(() => {
    if (activeProfileId) fetchFullData(activeProfileId);
    else { setLoans([]); setClients([]); setSources([]); setActiveUser(null); }
  }, [activeProfileId]);

  useEffect(() => {
      if (activeTab === 'MASTER' && activeUser?.accessLevel === 1) {
          fetchAllUsers();
      }
  }, [activeTab, activeUser]);

  useEffect(() => {
    if (toast) { const timer = setTimeout(() => setToast(null), 4000); return () => clearTimeout(timer); }
  }, [toast]);

  // Actions... 
  const handleSaveLoan = async (loan: Loan) => {
    if (!activeUser) return;
    
    try {
        let finalSourceId = loan.sourceId;
        let finalClientId = loan.clientId;

        if (!finalSourceId) {
            const defaultSource = sources.find(s => s.name === 'Carteira Principal');
            if (defaultSource) finalSourceId = defaultSource.id;
            else { 
                const newId = crypto.randomUUID(); 
                await supabase.from('fontes').insert([{ id: newId, profile_id: activeUser.id, name: 'Carteira Principal', type: 'CASH', balance: 0 }]); 
                finalSourceId = newId; 
            }
        }

        if (!finalClientId) {
            const docClean = onlyDigits(loan.debtorDocument || '');
            if (!isTestClientName(loan.debtorName)) {
                if (!docClean || !isValidCPForCNPJ(docClean)) {
                    throw new Error("CPF/CNPJ inválido para o cliente. Use nome TESTE para cadastros de teste.");
                }
            }

            const newId = crypto.randomUUID();
            const { error: clientError } = await supabase.from('clientes').insert([{
                id: newId,
                profile_id: activeUser.id,
                name: loan.debtorName,
                phone: loan.debtorPhone,
                email: (loan as any).debtorEmail || null,
                address: loan.debtorAddress || 'Endereço do Contrato',
                created_at: new Date().toISOString(),
                access_code: String(Math.floor(1000 + Math.random() * 9000)),
                client_number: String(Math.floor(100000 + Math.random() * 900000)),
                document: docClean || null,
                cpf: (docClean.length === 11 ? docClean : null),
                cnpj: (docClean.length === 14 ? docClean : null)
            }]);
            if (clientError) throw new Error("Erro ao criar cliente: " + clientError.message);
            finalClientId = newId;
        } else {
            const docClean = onlyDigits(loan.debtorDocument || '');
            if (!isTestClientName(loan.debtorName)) {
                if (!docClean || !isValidCPForCNPJ(docClean)) {
                    throw new Error("CPF/CNPJ inválido para o cliente. Use nome TESTE para cadastros de teste.");
                }
            }
            await supabase.from('clientes').update({
                name: loan.debtorName,
                phone: loan.debtorPhone,
                email: (loan as any).debtorEmail || null,
                document: docClean || null,
                cpf: (docClean.length === 11 ? docClean : null),
                cnpj: (docClean.length === 14 ? docClean : null),
                address: loan.debtorAddress || ''
            }).eq('id', finalClientId).eq('profile_id', activeUser.id);
        }

        const contractData = { 
            id: loan.id, 
            profile_id: activeUser.id, 
            client_id: finalClientId, 
            source_id: finalSourceId, 
            debtor_name: loan.debtorName, 
            debtor_phone: loan.debtorPhone, 
            debtor_document: loan.debtorDocument, 
            debtor_address: loan.debtorAddress, 
            principal: Number(loan.principal), 
            interest_rate: Number(loan.interestRate), 
            fine_percent: Number(loan.finePercent), 
            daily_interest_percent: Number(loan.dailyInterestPercent), 
            billing_cycle: loan.billingCycle,
            amortization_type: loan.amortizationType,
            start_date: loan.startDate, 
            total_to_receive: Number(loan.totalToReceive), 
            preferred_payment_method: loan.preferredPaymentMethod, 
            pix_key: loan.pixKey, 
            notes: loan.notes, 
            guarantee_description: loan.guaranteeDescription, 
            is_archived: loan.isArchived || false,
            is_daily: loan.billingCycle === 'DAILY',
            payment_type: loan.amortizationType
        };
        const { error: loanError } = await supabase.from('contratos').upsert(contractData);
        if (loanError) throw new Error("Erro ao salvar contrato: " + loanError.message);

        
        // --- PARCELAS ---
        // Correção de duplicação ao editar contrato:
        // - Reusa IDs existentes por numero_parcela (evita criar "parcela extra")
        // - Se a modalidade for MONTHLY, força vencimentos em ciclos exatos de 30 dias a partir de start_date (date-only, sem drift)
        let existingByNumero = new Map<number, string>();
        if (editingLoan) {
            const { data: existing } = await supabase
                .from('parcelas')
                .select('id, numero_parcela')
                .eq('loan_id', loan.id)
                .eq('profile_id', activeUser.id)
                .order('numero_parcela', { ascending: true });
            (existing || []).forEach((p: any) => {
                const n = Number(p.numero_parcela);
                if (n && p.id) existingByNumero.set(n, String(p.id));
            });
        }

        const startBase = parseDateOnlyUTC(String(loan.startDate || new Date().toISOString()));
        const installmentsData = loan.installments.map((i, index) => {
            const numero = index + 1;
            const forcedDue = (loan.billingCycle === 'MONTHLY')
                ? toISODateOnlyUTC(addDaysUTC(startBase, 30 * numero))   // 30, 60, 90... dias após a data inicial
                : String(i.dueDate).slice(0, 10);

            const idToUse = existingByNumero.get(numero) || i.id;

            return {
                id: idToUse,
                loan_id: loan.id,
                profile_id: activeUser.id,

                // "língua" do BD (novas colunas)
                numero_parcela: numero,
                data_vencimento: forcedDue,
                valor_parcela: Number(i.amount),

                // compatibilidade (colunas antigas)
                due_date: forcedDue,
                amount: Number(i.amount),

                // campos de lógica financeira existentes (mantidos)
                scheduled_principal: Number(i.scheduledPrincipal),
                scheduled_interest: Number(i.scheduledInterest),
                principal_remaining: Number(i.principalRemaining),
                interest_remaining: Number(i.interestRemaining),
                status: i.status
            };
        });

        // Se estiver editando, evita deixar "sobras" de parcelas antigas:
        // apaga apenas as parcelas extras que não estão no novo range (seguro: não mexe em transações).
        if (editingLoan) {
            const newCount = installmentsData.length;
            const { data: extras } = await supabase
                .from('parcelas')
                .select('id, numero_parcela')
                .eq('loan_id', loan.id)
                .eq('profile_id', activeUser.id)
                .gt('numero_parcela', newCount);

            const extraIds = (extras || []).map((p: any) => String(p.id));
            if (extraIds.length > 0) {
                // só remove se não houver transações apontando para essas parcelas
                const { data: txRefs } = await supabase
                    .from('transacoes')
                    .select('installment_id')
                    .eq('loan_id', loan.id)
                    .eq('profile_id', activeUser.id)
                    .in('installment_id', extraIds);

                const referenced = new Set((txRefs || []).map((t: any) => String(t.installment_id)));
                const safeToDelete = extraIds.filter(id => !referenced.has(id));

                if (safeToDelete.length > 0) {
                    await supabase
                        .from('parcelas')
                        .delete()
                        .in('id', safeToDelete)
                        .eq('profile_id', activeUser.id);
                }
            }
        }

        // upsert mantém atualizações e cria apenas o que não existir (com IDs reaproveitados)
        const { error: instError } = await supabase.from('parcelas').upsert(installmentsData);
        if (instError) throw new Error("Erro nas parcelas: " + instError.message);

        if (!editingLoan) {
             const source = sources.find(s => s.id === finalSourceId);
             if (source) { 
                 const newBalance = Number(source.balance) - Number(loan.principal); 
                 await supabase.from('fontes').update({ balance: newBalance }).eq('id', finalSourceId).eq('profile_id', activeUser.id); 
             }
             const txId = crypto.randomUUID();
             await supabase.from('transacoes').insert([{ 
                 id: txId, 
                 loan_id: loan.id, 
                 profile_id: activeUser.id, 
                 source_id: finalSourceId, 
                 date: new Date().toISOString(), 
                 type: 'LEND_MORE', 
                 amount: Number(loan.principal), 
                 principal_delta: 0, 
                 interest_delta: 0, 
                 late_fee_delta: 0, 
                 notes: `Empréstimo Inicial - ${loan.installments.length} Parcelas` 
             }]);
        }

        showToast('Contrato Salvo!', 'success'); 
        setIsFormOpen(false); 
        setEditingLoan(null); 
        fetchFullData(activeUser.id);

    } catch (e: any) {
        showToast(e.message || "Erro desconhecido ao salvar", "error");
        console.error(e);
    }
  };

  const openConfirmation = (config: typeof confirmation) => { setRefundChecked(true); setConfirmation(config); };
  
  const executeConfirmation = async () => { 
    if (!confirmation || !activeUser) return;
    
    // Check if target is string (ID) for Client/Source or Object (Loan)
    let loan = null;
    let targetId = '';

    if (typeof confirmation.target === 'string') {
        targetId = confirmation.target;
    } else {
        loan = confirmation.target as Loan;
        targetId = loan.id;
    }

    try {
        if (confirmation.showRefundOption && refundChecked && loan && loan.sourceId) {
           const remainingPrincipal = loan.installments.reduce((sum, i) => sum + i.principalRemaining, 0);
           if (remainingPrincipal > 0) {
               const source = sources.find(s => s.id === loan.sourceId);
               if (source) {
                   await supabase.from('fontes').update({ balance: source.balance + remainingPrincipal }).eq('id', source.id).eq('profile_id', activeUser.id);
               }
           }
        }

        let error = null;

        if (confirmation.type === 'DELETE') {
            const res = await supabase.from('contratos').delete().eq('id', targetId).eq('profile_id', activeUser.id);
            error = res.error;
            showToast('Contrato Excluído (Estornado).');
        }
        else if (confirmation.type === 'ARCHIVE') {
            const res = await supabase.from('contratos').update({ is_archived: true }).eq('id', targetId).eq('profile_id', activeUser.id);
            error = res.error;
            showToast('Arquivado.');
        }
        else if (confirmation.type === 'RESTORE') {
            const res = await supabase.from('contratos').update({ is_archived: false }).eq('id', targetId).eq('profile_id', activeUser.id);
            error = res.error;
            showToast('Restaurado.');
        }
        else if (confirmation.type === 'DELETE_CLIENT') {
            // Safety check for ID
            if (!targetId || targetId === '') { console.error('ID ausente'); return; }
            const res = await supabase.from('clientes').delete().eq('id', targetId).eq('profile_id', activeUser.id);
            error = res.error;
            if(error) window.alert('Erro no Banco: ' + error.message);
            else showToast('Cliente removido.');
        }
        else if (confirmation.type === 'DELETE_SOURCE') {
            const res = await supabase.from('fontes').delete().eq('id', targetId).eq('profile_id', activeUser.id);
            error = res.error;
            showToast('Fonte removida.');
        }

        if (error) throw error;

    } catch (err: any) {
        if(!confirmation.type.includes('DELETE_CLIENT')) showToast("Erro ao executar ação: " + err.message, "error");
        console.error(err);
    } finally {
        setConfirmation(null); 
        setSelectedLoanId(null); 
        await fetchFullData(activeUser.id);
    }
  };

  const handleToggleAdmin = async (user: any) => {
    if (!activeUser || activeUser.accessLevel !== 1) return;
    if (user.id === activeUser.id) { showToast("Você não pode alterar seu próprio nível.", "error"); return; }
    
    const newLevel = user.access_level === 1 ? 2 : 1;
    const confirmMsg = newLevel === 1 ? `Promover ${user.nome_operador} a ADMIN (Nível 1)?` : `Remover acesso ADMIN de ${user.nome_operador} (Nível 2)?`;
    
    if (window.confirm(confirmMsg)) {
        const { error } = await supabase.from('perfis').update({ access_level: newLevel }).eq('id', user.id);
        if (error) showToast("Erro na operação.", "error");
        else { showToast("Permissões atualizadas.", "success"); fetchAllUsers(); }
    }
  };

  const handleAdminResetPassword = async (user: any) => {
      if (!activeUser || activeUser.accessLevel !== 1) return;
      const newPass = prompt(`Digite a nova senha para ${user.nome_operador}:`);
      if (newPass && newPass.trim().length > 0) {
          const { error } = await supabase.from('perfis').update({ senha_acesso: newPass }).eq('id', user.id);
          if (error) showToast("Erro ao redefinir senha.", "error");
          else showToast("Senha redefinida com sucesso!", "success");
      }
  };

  const handleMasterUpdateUser = async () => {
      if (!activeUser || !masterEditUser || activeUser.accessLevel !== 1) return;
      
      const updates: any = {
          nome_operador: masterEditUser.nome_operador,
          nome_empresa: masterEditUser.nome_empresa,
          pix_key: masterEditUser.pix_key,
          access_level: masterEditUser.access_level
      };

      if (masterEditUser.newPassword && masterEditUser.newPassword.trim().length > 0) {
          updates.senha_acesso = masterEditUser.newPassword;
      }

      const { error } = await supabase.from('perfis').update(updates).eq('id', masterEditUser.id);
      
      if (error) {
          showToast("Erro ao atualizar usuário.", "error");
      } else {
          showToast("Usuário atualizado!", "success");
          setMasterEditUser(null);
          fetchAllUsers();
      }
  };

  const handleHelpSupport = (type: 'password' | 'user') => {
      const number = "5592991148103";
      let msg = "";
      if(type === 'password') msg = "Olá, esqueci minha senha no CrediMaster. Poderia me ajudar?";
      if(type === 'user') msg = "Olá, esqueci meu usuário de login no CrediMaster. Poderia me ajudar?";
      
      window.open(`https://wa.me/${number}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleSaveNote = async () => {
      if (!activeUser || !noteModalLoan) return;
      try {
          const { error } = await supabase.from('contratos').update({ notes: noteText }).eq('id', noteModalLoan.id);
          if (error) throw error;
          showToast("Anotação salva com sucesso!");
          setNoteModalLoan(null);
          setNoteText('');
          fetchFullData(activeUser.id);
      } catch (e) {
          showToast("Erro ao salvar anotação", "error");
      }
  };

  const handleUpdateSourceBalance = async () => {
      if (!activeUser || !editingSource) return;
      try {
          const { error } = await supabase.from('fontes').update({ balance: editingSource.balance }).eq('id', editingSource.id);
          if (error) throw error;
          showToast("Saldo da fonte atualizado!");
          setEditingSource(null);
          fetchFullData(activeUser.id);
      } catch(e) {
          showToast("Erro ao atualizar saldo.", "error");
      }
  };

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => { setToast({ msg, type }); };
  const handleLogout = () => { setActiveProfileId(null); setActiveTab('DASHBOARD'); localStorage.removeItem('cm_session'); };

  const submitLogin = async () => {
    setIsLoadingData(true);
    const cleanLogin = loginUser.trim();
    const { data: profiles, error } = await supabase
        .from('perfis')
        .select('*')
        .or(`usuario_email.ilike.%${cleanLogin}%,nome_operador.ilike.%${cleanLogin}%`);
    
    if (error || !profiles || profiles.length === 0) {
        showToast("Usuário não encontrado.", "error");
        setIsLoadingData(false);
        return;
    }

    const profile = profiles.find(p => p.senha_acesso === loginPassword);
    if (profile) {
        setActiveProfileId(profile.id);
        const newSaved = [...savedProfiles.filter(p => p.id !== profile.id), { id: profile.id, name: profile.nome_operador, email: profile.usuario_email }];
        setSavedProfiles(newSaved);
        localStorage.setItem('cm_saved_profiles', JSON.stringify(newSaved));
        localStorage.setItem('cm_session', JSON.stringify({ profileId: profile.id, timestamp: Date.now() }));
        showToast("Login realizado com sucesso!");
    } else {
        showToast("Senha incorreta.", "error");
    }
    setIsLoadingData(false);
  };

  const handleSelectSavedProfile = (profile: any) => {
    setLoginUser(profile.email);
    setLoginPassword('');
    showToast(`Olá, ${profile.name}. Digite sua senha.`);
  };

  const handleRemoveSavedProfile = (id: string) => {
    const updated = savedProfiles.filter(p => p.id !== id);
    setSavedProfiles(updated);
    localStorage.setItem('cm_saved_profiles', JSON.stringify(updated));
  };

  const handleCreateProfile = async () => {
    if (!newProfileForm.name || !newProfileForm.email || !newProfileForm.password) {
        showToast("Preencha todos os campos obrigatórios.", "error");
        return;
    }
    
    // CORREÇÃO: Removido ID explícito, garantindo campos corretos para tabela perfis
    const { error } = await supabase.from('perfis').insert([{ 
        nome_operador: newProfileForm.name, 
        usuario_email: newProfileForm.email, 
        nome_empresa: newProfileForm.businessName, 
        senha_acesso: newProfileForm.password, 
        recovery_phrase: newProfileForm.recoveryPhrase, 
        access_level: 2
    }]);

    if (error) { 
        window.alert('Erro no Banco: ' + error.message);
    } else { 
        showToast("Conta criada! Faça login agora.", "success"); 
        setIsCreatingProfile(false); 
    }
  };

  const handlePasswordRecovery = async () => {
    const { data: profiles } = await supabase.from('perfis').select('*').eq('usuario_email', recoveryForm.email);
    const profile = profiles?.find(p => p.recovery_phrase === recoveryForm.phrase);
    if (profile) { await supabase.from('perfis').update({ senha_acesso: recoveryForm.newPassword }).eq('id', profile.id); showToast("Senha redefinida com sucesso!"); setIsRecoveringPassword(false); } else { showToast("Dados de recuperação inválidos.", "error"); }
  };
  
  const handleDeleteAccount = async () => {
    if (!activeUser) return;
    // Modal com aviso legal + confirmação forte (sem mexer no layout geral)
    setDeleteAccountAgree(false);
    setDeleteAccountConfirm('');
    setDeleteAccountModal(true);
};

  const handleResetData = async () => {
     if (!activeUser) return;
     if (!resetPasswordInput) {
         showToast("Informe sua senha para confirmar.", "error");
         return;
     }

     if (resetPasswordInput !== activeUser.password) {
         showToast("Senha incorreta.", "error");
         return;
     }

     if (!window.confirm("Tem certeza absoluta? Isso apagará TODOS os contratos, clientes, fontes e histórico de transações deste perfil.")) {
         return;
     }

     setIsLoadingData(true);
     try {
         const pid = activeUser.id;

         // 1) Descobre o escopo real pelos contratos do perfil
         const { data: loansData, error: loansErr } = await supabase
             .from('contratos')
             .select('id, client_id')
             .eq('profile_id', pid);

         if (loansErr) throw loansErr;

         const loanIds = (loansData || []).map((l: any) => String(l.id));
         const clientIds = Array.from(new Set((loansData || []).map((l: any) => l.client_id).filter(Boolean).map((v: any) => String(v))));

         // 2) Apaga dependências por loan_id (não depende de profile_id em todas as tabelas)
         if (loanIds.length) {
             const tablesByLoan = ['transacoes', 'parcelas', 'sinalizacoes_pagamento'];
             for (const table of tablesByLoan) {
                 const { error } = await supabase.from(table as any).delete().in('loan_id', loanIds);
                 if (error) throw error;
             }
         }

         // 3) Apaga contratos do perfil
         {
             const { error } = await supabase.from('contratos').delete().eq('profile_id', pid);
             if (error) throw error;
         }

         // 4) Apaga TODOS os clientes do perfil (inclui clientes importados/sem contrato)
         {
             const { error } = await supabase.from('clientes').delete().eq('profile_id', pid);
             if (error) throw error;
         }

         // (Fallback) Se houver algum cliente antigo ainda sem profile_id mas ligado a contratos, apaga por id
         if (clientIds.length) {
             const { error } = await supabase.from('clientes').delete().in('id', clientIds);
             if (error) throw error;
         }

         // 5) Apaga fontes do perfil (se existir profile_id, mantém o escopo por perfil)
         {
             const { error } = await supabase.from('fontes').delete().eq('profile_id', pid);
             if (error) {
                 // Se a tabela não tiver profile_id, evita reset global por segurança
                 console.warn("Reset fontes:", error.message);
             }
         }

         // 6) Zera saldos do perfil
         {
             const { error } = await supabase.from('perfis').update({
                 interest_balance: 0,
                 total_available_capital: 0
             }).eq('id', pid);
             if (error) throw error;
         }

         showToast("Todos os dados foram resetados.", "success");
         setResetDataModal(false);
         setResetPasswordInput('');
         fetchFullData(pid);
     } catch (e: any) {
         console.error("Erro reset:", e);
         showToast("Erro ao resetar dados: " + (e?.message || "desconhecido"), "error");
     } finally {
         setIsLoadingData(false);
     }
  };

  const handleSaveProfile = async () => {
      if (!activeUser || !profileEditForm) return;
      
      const { error } = await supabase.from('perfis').update({
          nome_operador: profileEditForm.name,
          nome_empresa: profileEditForm.businessName,
          document: profileEditForm.document,
          phone: profileEditForm.phone,
          address: profileEditForm.address,
          pix_key: profileEditForm.pixKey,
          avatar_url: profileEditForm.photo
      }).eq('id', activeUser.id);

      if (error) {
          showToast("Erro ao atualizar perfil.", "error");
      } else {
          setActiveUser(profileEditForm);
          showToast("Perfil atualizado!", "success");
      }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && profileEditForm) {
          if (file.size > 2 * 1024 * 1024) {
              showToast("A imagem deve ter no máximo 2MB.", "error");
              return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
              setProfileEditForm({ ...profileEditForm, photo: reader.result as string });
          };
          reader.readAsDataURL(file);
      }
  };

  const handlePromissoriaFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!activeUser?.id || !promissoriaUploadLoanId) {
      toast.error('Selecione um contrato antes de anexar a promissória.');
      return;
    }

    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const safeExt = ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'bin';
      const path = `${activeUser.id}/${promissoriaUploadLoanId}-${Date.now()}.${safeExt}`;

      const { error: uploadError } = await supabase.storage
        .from('promissorias')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from('promissorias').getPublicUrl(path);
      const publicUrl = publicData?.publicUrl;

      if (!publicUrl) throw new Error('Não foi possível obter a URL do arquivo.');

      const { error: updateError } = await supabase
        .from('contratos')
        .update({ promissoria_url: publicUrl })
        .eq('id', promissoriaUploadLoanId)
        .eq('profile_id', activeUser.id);

      if (updateError) throw updateError;

      toast.success('Promissória anexada com sucesso.');
      await fetchFullData(activeUser.id);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Falha ao anexar a promissória.');
    } finally {
      if (promissoriaFileInputRef.current) promissoriaFileInputRef.current.value = '';
      setPromissoriaUploadLoanId(null);
    }
  };



  const handleExtraDocFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!activeUser?.id || !extraDocUploadLoanId || !extraDocKind) {
      toast.error('Selecione um contrato antes de anexar o documento.');
      return;
    }

    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const safeExt = ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'bin';
      const storageBucket = 'documentos';
      const path = `${activeUser.id}/${extraDocUploadLoanId}-${extraDocKind}-${Date.now()}.${safeExt}`;

      const { error: uploadError } = await supabase.storage
        .from(storageBucket)
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from(storageBucket).getPublicUrl(path);
      const publicUrl = publicData?.publicUrl;
      if (!publicUrl) throw new Error('Não foi possível obter a URL do arquivo.');

      const updatePayload: any = {};
      if (extraDocKind === 'CONFISSAO') updatePayload.confissao_divida_url = publicUrl;

      const { error: updateError } = await supabase
        .from('contratos')
        .update(updatePayload)
        .eq('id', extraDocUploadLoanId)
        .eq('profile_id', activeUser.id);

      if (updateError) throw updateError;

      toast.success('Documento anexado com sucesso.');
      await fetchFullData(activeUser.id);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Falha ao anexar o documento.');
    } finally {
      if (extraDocFileInputRef.current) extraDocFileInputRef.current.value = '';
      setExtraDocUploadLoanId(null);
      setExtraDocKind(null);
    }
  };


  const openClientModal = (client?: Client) => {
      setEditingClient(client || null);

      // Prepara códigos para exibição/cópia no modal (sem sobrescrever no BD ao editar)
      if (client) {
          setClientDraftAccessCode(String((client as any).access_code || '').trim());
          setClientDraftNumber(String((client as any).client_number || '').trim());
          setClientForm({
              name: client.name,
              phone: client.phone,
              document: (client as any).document || (client as any).cpf || (client as any).cnpj || '',
              email: (client as any).email || '',
              address: (client as any).address || '',
              city: (client as any).city || '',
              state: (client as any).state || '',
              notes: (client as any).notes || ''
          });
      } else {
          // gera rascunho para novo cliente (será persistido no salvar)
          const codes = new Set((clients || []).map(c => String((c as any).access_code || '').trim()).filter(Boolean));
          const nums = new Set((clients || []).map(c => String((c as any).client_number || '').trim()).filter(Boolean));
          setClientDraftAccessCode(generateUniqueAccessCode(codes));
          setClientDraftNumber(generateUniqueClientNumber(nums));

          setClientForm({ name: '', phone: '', document: '', email: '', address: '', city: '', state: '', notes: '' });
      }
      setIsClientModalOpen(true);
  };

  const handleSaveClient = async () => {
      if (!activeUser || !clientForm.name || isSaving) return;
      // Validação CPF/CNPJ: só permite documento verdadeiro, exceto cliente TESTE
      const docClean = onlyDigits(clientForm.document);
      if (!isTestClientName(clientForm.name)) {
        if (!docClean) {
          showToast('Informe um CPF ou CNPJ válido (ou use nome TESTE para cadastro de teste).', 'error');
          return;
        }
        if (!isValidCPForCNPJ(docClean)) {
          showToast('CPF/CNPJ inválido. Verifique os dígitos.', 'error');
          return;
        }
      }

      setIsSaving(true);
      try {
          const id = editingClient?.id || crypto.randomUUID();
          const access_code = editingClient ? undefined : String(Math.floor(1000 + Math.random() * 9000));
          const client_number = editingClient ? undefined : String(Math.floor(100000 + Math.random() * 900000));
          // CORREÇÃO: Garante o envio do profile_id corretamente para o upsert de clientes
          const payload = { 
              id, 
              profile_id: activeUser.id, 
              name: clientForm.name, 
              phone: clientForm.phone, 
              email: clientForm.email, 
              address: clientForm.address, 
              city: clientForm.city, 
              state: clientForm.state,
              access_code: (() => {
                  const existingCode = (editingClient as any)?.access_code;
                  if (existingCode && String(existingCode).trim().length > 0) return String(existingCode);

                  // Se já geramos um rascunho no modal, reutiliza (evita trocar ao clicar salvar)
                  const draft = String(clientDraftAccessCode || '').trim();
                  if (draft) return draft;

                  // evita colisão no perfil
                  const codes = new Set((clients || [])
                    .filter(c => String((c as any).id) !== String(id))
                    .map(c => String((c as any).access_code || '').trim())
                    .filter(Boolean));
                  return generateUniqueAccessCode(codes);
              })(),
              client_number: (() => {
                  const existingNum = (editingClient as any)?.client_number;
                  if (existingNum && String(existingNum).trim().length > 0) return String(existingNum);

                  const draft = String(clientDraftNumber || '').trim();
                  if (draft) return draft;

                  const nums = new Set((clients || [])
                    .filter(c => String((c as any).id) !== String(id))
                    .map(c => String((c as any).client_number || '').trim())
                    .filter(Boolean));
                  return generateUniqueClientNumber(nums);
              })(),
              cpf: (docClean.length === 11 ? docClean : null),
              cnpj: (docClean.length === 14 ? docClean : null),
              document: docClean || null,
              notes: clientForm.notes,
              created_at: editingClient ? editingClient.createdAt : new Date().toISOString()
          };
          
          const { error } = await supabase.from('clientes').upsert(payload);
          
          if (error) { 
              console.error(error);
              showToast("Erro ao salvar cliente: " + error.message, "error"); 
          } else { 
              showToast("Cliente salvo!", "success"); 
              setIsClientModalOpen(false); 
              fetchFullData(activeUser.id); 
          }
      } catch(e: any) {
          showToast("Erro ao salvar cliente: " + e.message, "error");
      } finally {
          setIsSaving(false);
      }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeUser) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsLoadingData(true);
    try {
        const ext = file.name.toLowerCase().split('.').pop();
        let imported: any[] = [];

        if (ext === 'csv') {
            imported = await parseClientCSV(file);
        } else {
            // xlsx/xls
            imported = await parseExcelClients(file);
        }

        if (!Array.isArray(imported) || imported.length === 0) {
            showToast("Nenhum registro encontrado na planilha.", "info");
            return;
        }

        // Merge: tenta identificar por CPF/CNPJ/email/phone/client_number
        const toUpsert: any[] = [];
        for (const row of imported) {
            const name = String(row.name || row.nome || '').trim();
            if (!name) continue;

            const docRaw = String(row.document || row.cpf || row.cnpj || row.doc || '').trim();
            const docClean = onlyDigits(docRaw);
            const phone = String(row.phone || row.telefone || '').trim();
            const email = String(row.email || '').trim();
            const client_number = String(row.client_number || row.clientNumber || row.codigo || '').trim();

            // Validação CPF/CNPJ real (exceto TESTE)
            if (!isTestClientName(name)) {
                if (docClean && !isValidCPForCNPJ(docClean)) {
                    // ignora linha inválida (não quebra import todo)
                    continue;
                }
            }

            // tenta achar cliente existente no estado atual
            const existing = clients.find(c => {
                const cDoc = onlyDigits((c as any).document || (c as any).cpf || (c as any).cnpj || '');
                if (docClean && cDoc && docClean === cDoc) return true;
                if (email && (c.email || '').toLowerCase() === email.toLowerCase()) return true;
                if (phone && onlyDigits(c.phone || '') === onlyDigits(phone)) return true;
                if (client_number && String((c as any).client_number || (c as any).clientNumber || '') === client_number) return true;
                return false;
            });

            const id = existing?.id || crypto.randomUUID();

            // mantém códigos existentes quando atualiza
            const access_code = (() => {
                const existingCode = existing ? String((existing as any).access_code || '').trim() : '';
                if (existingCode) return existingCode;

                const codes = new Set((clients || [])
                  .filter(c => String((c as any).id) !== String(id))
                  .map(c => String((c as any).access_code || '').trim())
                  .filter(Boolean));
                return generateUniqueAccessCode(codes);
            })();
            const final_client_number = (() => {
                const existingNum = existing ? String((existing as any).client_number || '').trim() : '';
                if (existingNum) return existingNum;
                if (client_number) return client_number;

                const nums = new Set((clients || [])
                  .filter(c => String((c as any).id) !== String(id))
                  .map(c => String((c as any).client_number || '').trim())
                  .filter(Boolean));
                return generateUniqueClientNumber(nums);
            })();

            toUpsert.push({
                id,
                profile_id: activeUser.id,
                name,
                phone,
                email: email || null,
                address: row.address || row.endereco || null,
                city: row.city || row.cidade || null,
                state: row.state || row.uf || null,
                notes: row.notes || row.obs || null,
                access_code,
                client_number: final_client_number,
                document: docClean || null,
                cpf: (docClean.length === 11 ? docClean : null),
                cnpj: (docClean.length === 14 ? docClean : null),
                created_at: existing ? (existing as any).createdAt : new Date().toISOString()
            });
        }

        if (toUpsert.length === 0) {
            showToast("Nada para importar (linhas inválidas ou vazias).", "info");
            return;
        }

        const { error } = await supabase.from('clientes').upsert(toUpsert);
        if (error) throw new Error(error.message);

        showToast(`Importação concluída: ${toUpsert.length} cliente(s).`, "success");
        fetchFullData(activeUser.id);
    } catch (err: any) {
        console.error(err);
        showToast("Erro ao importar planilha: " + (err?.message || 'desconhecido'), "error");
    } finally {
        setIsLoadingData(false);
    }
};

  const handleExportBackup = async () => {
    if (!activeUser) return;
    try {
        const json = generateBackup(activeUser, clients, loans, sources);
        // 1) Download local file (as before)
        downloadFile(json, `backup_credimaster_${new Date().toISOString().split('T')[0]}.json`, 'application/json');

        // 2) Save latest snapshot locally (fast restore/offline)
        try {
            localStorage.setItem(`credimaster_backup_latest_${activeUser.id}`, json);
            localStorage.setItem(`credimaster_backup_latest_at_${activeUser.id}`, new Date().toISOString());
        } catch { /* ignore storage quota */ }

        // 3) Save in Supabase (cloud restore)
        let payload: any = null;
        try { payload = JSON.parse(json); } catch { payload = { raw: json }; }

        const { error } = await supabase.from('backups').insert([{
            profile_id: activeUser.id,
            backup_version: 1,
            payload
        }]);

        if (error) {
            console.error('Backup Supabase error:', error);
            showToast("Backup baixado, mas falhou salvar na nuvem: " + error.message, "error");
        } else {
            showToast("Backup salvo (arquivo + nuvem).", "success");
        }
    } catch (e: any) {
        console.error(e);
        showToast("Erro ao gerar backup: " + (e?.message || 'desconhecido'), "error");
    }
};
  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeUser) return;
    if (!e.target.files || !e.target.files[0]) return;

    const file = e.target.files[0];
    // allow re-upload same file
    e.target.value = '';

    setIsLoadingData(true);
    try {
        const text = await file.text();
        let snapshot: any = null;
        try { snapshot = JSON.parse(text); } catch { throw new Error("Arquivo de backup inválido (JSON)."); }

        // Basic validation
        const snapProfileId = snapshot?.activeUser?.id || snapshot?.profile?.id || snapshot?.user?.id || snapshot?.profileId;
        const snapClients = snapshot?.clients || snapshot?.data?.clients;
        const snapLoans = snapshot?.loans || snapshot?.data?.loans;
        const snapSources = snapshot?.sources || snapshot?.data?.sources;

        if (!snapClients || !snapLoans || !snapSources) {
            throw new Error("Backup incompleto: faltam clientes/contratos/fontes.");
        }

        // Safety: restore into the currently logged profile only
        if (snapProfileId && String(snapProfileId) !== String(activeUser.id)) {
            if (!window.confirm("Este backup parece ser de outra conta. Deseja restaurar MESMO ASSIM dentro da conta atual?")) {
                setIsLoadingData(false);
                return;
            }
        }

        // 1) Clear current profile data (safe: scoped by profile_id)
        const pid = activeUser.id;
        await supabase.from('transacoes').delete().eq('profile_id', pid);
        await supabase.from('parcelas').delete().eq('profile_id', pid);
        await supabase.from('contratos').delete().eq('profile_id', pid);
        await supabase.from('clientes').delete().eq('profile_id', pid);
        await supabase.from('fontes').delete().eq('profile_id', pid);

        // 2) Restore Sources
        const restoredSources = (snapSources || []).map((s: any) => ({
            id: s.id,
            profile_id: pid,
            name: s.name,
            type: s.type,
            balance: Number(s.balance ?? 0),
            created_at: s.createdAt || s.created_at || new Date().toISOString()
        }));
        if (restoredSources.length) {
            const { error } = await supabase.from('fontes').insert(restoredSources);
            if (error) throw new Error("Erro restaurando fontes: " + error.message);
        }

        // 3) Restore Clients
        const restoredClients = (snapClients || []).map((c: any) => {
            const docClean = onlyDigits(c.document || c.cpf || c.cnpj || '');
            return ({
                id: c.id,
                profile_id: pid,
                name: c.name,
                phone: c.phone,
                email: c.email || null,
                address: c.address || null,
                city: c.city || null,
                state: c.state || null,
                notes: c.notes || null,
                access_code: c.access_code || c.accessCode || null,
                client_number: c.client_number || c.clientNumber || null,
                document: docClean || null,
                cpf: (docClean.length === 11 ? docClean : (c.cpf || null)),
                cnpj: (docClean.length === 14 ? docClean : (c.cnpj || null)),
                created_at: c.createdAt || c.created_at || new Date().toISOString()
            });
        });
        if (restoredClients.length) {
            const { error } = await supabase.from('clientes').insert(restoredClients);
            if (error) throw new Error("Erro restaurando clientes: " + error.message);
        }

        // 4) Restore Loans + Installments + Ledger (transacoes)
        const restoredLoans = (snapLoans || []).map((loan: any) => ({
            id: loan.id,
            profile_id: pid,
            client_id: loan.clientId || loan.client_id,
            source_id: loan.sourceId || loan.source_id,
            debtor_name: loan.debtorName,
            debtor_phone: loan.debtorPhone,
            debtor_document: loan.debtorDocument,
            debtor_address: loan.debtorAddress,
            principal: Number(loan.principal ?? 0),
            interest_rate: Number(loan.interestRate ?? 0),
            fine_percent: Number(loan.finePercent ?? 0),
            daily_interest_percent: Number(loan.dailyInterestPercent ?? 0),
            billing_cycle: loan.billingCycle,
            amortization_type: loan.amortizationType,
            start_date: loan.startDate,
            total_to_receive: Number(loan.totalToReceive ?? 0),
            preferred_payment_method: loan.preferredPaymentMethod,
            pix_key: loan.pixKey,
            notes: loan.notes,
            guarantee_description: loan.guaranteeDescription,
            is_archived: !!loan.isArchived,
            is_daily: loan.billingCycle === 'DAILY',
            payment_type: loan.amortizationType
        }));

        if (restoredLoans.length) {
            const { error } = await supabase.from('contratos').insert(restoredLoans);
            if (error) throw new Error("Erro restaurando contratos: " + error.message);
        }

        const restoredInstallments: any[] = [];
        const restoredTransactions: any[] = [];

        (snapLoans || []).forEach((loan: any) => {
            (loan.installments || []).forEach((i: any, idx: number) => {
                restoredInstallments.push({
                    id: i.id,
                    loan_id: loan.id,
                    profile_id: pid,
                    numero_parcela: (i.numero_parcela ?? (idx + 1)),
                    data_vencimento: i.dueDate || i.data_vencimento,
                    valor_parcela: Number(i.amount ?? i.valor_parcela ?? 0),
                    scheduled_principal: Number(i.scheduledPrincipal ?? i.scheduled_principal ?? 0),
                    scheduled_interest: Number(i.scheduledInterest ?? i.scheduled_interest ?? 0),
                    principal_remaining: Number(i.principalRemaining ?? i.principal_remaining ?? 0),
                    interest_remaining: Number(i.interestRemaining ?? i.interest_remaining ?? 0),
                    status: i.status
                });
            });

            (loan.ledger || []).forEach((t: any) => {
                restoredTransactions.push({
                    id: t.id || crypto.randomUUID(),
                    loan_id: loan.id,
                    profile_id: pid,
                    source_id: loan.sourceId || loan.source_id,
                    date: t.date || new Date().toISOString(),
                    type: t.type || 'PAYMENT',
                    amount: Number(t.amount ?? 0),
                    principal_delta: Number(t.principalDelta ?? t.principal_delta ?? 0),
                    interest_delta: Number(t.interestDelta ?? t.interest_delta ?? 0),
                    late_fee_delta: Number(t.lateFeeDelta ?? t.late_fee_delta ?? 0),
                    notes: t.notes || null
                });
            });
        });

        if (restoredInstallments.length) {
            const { error } = await supabase.from('parcelas').insert(restoredInstallments);
            if (error) throw new Error("Erro restaurando parcelas: " + error.message);
        }

        if (restoredTransactions.length) {
            const { error } = await supabase.from('transacoes').insert(restoredTransactions);
            if (error) throw new Error("Erro restaurando histórico: " + error.message);
        }

        showToast("Backup restaurado com sucesso.", "success");
        fetchFullData(pid);
    } catch (err: any) {
        console.error(err);
        showToast(err?.message || "Erro ao restaurar backup.", "error");
    } finally {
        setIsLoadingData(false);
    }
};
  const handleExportCSV = () => { const csv = generateLoansCSV(loans); downloadFile(csv, `relatorio_contratos_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv'); };

  const handleSaveSource = async () => {
      if (!activeUser || !sourceForm.name || isSaving) return;
      setIsSaving(true);
      try {
          const id = crypto.randomUUID();
          const { error } = await supabase.from('fontes').insert([{ id, profile_id: activeUser.id, name: sourceForm.name, type: sourceForm.type, balance: Number(sourceForm.balance) }]);
          if (error) showToast("Erro ao criar fonte", "error"); else { showToast("Fonte criada!", "success"); setIsSourceModalOpen(false); fetchFullData(activeUser.id); }
      } catch (e) {
          showToast("Erro ao criar fonte.", "error");
      } finally {
          setIsSaving(false);
      }
  };

  const handleAddFunds = async () => {
      if (!activeUser || !isAddFundsModalOpen || !addFundsValue) return;
      const amount = Number(addFundsValue);
      const newBalance = isAddFundsModalOpen.balance + amount;
      await supabase.from('fontes').update({ balance: newBalance }).eq('id', isAddFundsModalOpen.id);
      showToast("Saldo atualizado!", "success"); setIsAddFundsModalOpen(null); fetchFullData(activeUser.id);
  };

  const handleWithdrawProfit = async () => {
      if (!activeUser || !withdrawValue) return;
      const amount = parseFloat(withdrawValue);
      if (amount > activeUser.interestBalance) { showToast("Saldo de lucro insuficiente.", "error"); return; }
      const newInterestBalance = activeUser.interestBalance - amount;
      await supabase.from('perfis').update({ interest_balance: newInterestBalance }).eq('id', activeUser.id);
      if (withdrawSourceId !== 'EXTERNAL_WITHDRAWAL') { const source = sources.find(s => s.id === withdrawSourceId); if (source) { await supabase.from('fontes').update({ balance: source.balance + amount }).eq('id', source.id); } }
      showToast("Resgate realizado com sucesso!", "success"); setWithdrawModal(false); fetchFullData(activeUser.id);
  };
  
  const handleGenerateLink = (loan: Loan) => {
      const url = `${window.location.origin}/?portal=${loan.id}`; 
      navigator.clipboard.writeText(url);
      showToast("Link do Portal copiado!", "success");
  };

  const handlePickContact = async () => {
    if ('contacts' in navigator && 'ContactsManager' in window) {
      try {
        const props = ['name', 'tel'];
        const opts = { multiple: false };
        const contacts = await (navigator as any).contacts.select(props, opts);
        if (contacts.length) {
          const contact = contacts[0];
          const name = contact.name && contact.name.length > 0 ? contact.name[0] : '';
          let number = contact.tel && contact.tel.length > 0 ? contact.tel[0] : '';
          let clean = number.replace(/\D/g, '');
          if (clean.startsWith('55') && clean.length > 11) clean = clean.substring(2);
          setClientForm(prev => ({ ...prev, name: name || prev.name, phone: clean ? maskPhone(clean) : prev.phone }));
        }
      } catch (ex) {}
    } else { alert("Importação de contatos disponível apenas em dispositivos Android via Chrome."); }
  };
  
  const handlePayment = async () => {
      if (!activeUser || !paymentModal || isProcessingPayment) return;
      setIsProcessingPayment(true);

      try {
          const { loan, inst, calculations } = paymentModal;
          
          let amountToPay = 0;
          let paymentNote = '';
          
          if (paymentType === 'FULL') {
              amountToPay = calculations.total;
              paymentNote = 'Pagamento Total (Quitação)';
          } else if (paymentType === 'RENEW_INTEREST') {
              amountToPay = calculations.interest + calculations.lateFee;
              paymentNote = 'Pagamento Juros (Renovação)';
          } else if (paymentType === 'RENEW_AV') {
              const av = parseFloat(avAmount) || 0;
              if (av <= 0) {
                  showToast("Valor do AV inválido.", "error");
                  setIsProcessingPayment(false);
                  return;
              }
              amountToPay = calculations.interest + calculations.lateFee + av;
              paymentNote = `Juros + AV (R$ ${av.toFixed(2)})`;
          }
          
          if (isNaN(amountToPay) || amountToPay <= 0) { 
              showToast("Valor inválido", "error"); 
              setIsProcessingPayment(false);
              return; 
          }
          
          const allocation = allocatePayment(amountToPay, calculations);
          const profitGenerated = allocation.interestPaid + allocation.lateFeePaid;
          const principalReturned = allocation.principalPaid + allocation.avGenerated;

          if (profitGenerated > 0) {
              const newInterestBalance = (activeUser.interestBalance || 0) + profitGenerated;
              await supabase.from('perfis').update({ interest_balance: newInterestBalance }).eq('id', activeUser.id);
          }
          
          if (principalReturned > 0) {
              const source = sources.find(s => s.id === loan.sourceId);
              if (source) { 
                  await supabase.from('fontes').update({ balance: source.balance + principalReturned }).eq('id', source.id); 
              }
          }
          
          const txId = crypto.randomUUID();
          await supabase.from('transacoes').insert([{ 
              id: txId, 
              loan_id: loan.id, 
              profile_id: activeUser.id, 
              installment_id: inst.id, 
              source_id: loan.sourceId, 
              date: new Date().toISOString(), 
              type: paymentType === 'FULL' ? 'PAYMENT_FULL' : 'PAYMENT_PARTIAL', 
              amount: amountToPay, 
              principal_delta: allocation.principalPaid, 
              interest_delta: allocation.interestPaid, 
              late_fee_delta: allocation.lateFeePaid, 
              notes: paymentNote 
          }]);

          if (paymentType === 'RENEW_INTEREST' || paymentType === 'RENEW_AV') {
              const newDate = toISODateOnlyUTC(addDaysUTC(parseDateOnlyUTC(String(inst.dueDate)), 30));
              
              const currentPrincipal = inst.principalRemaining;
              const principalPaidNow = allocation.principalPaid + allocation.avGenerated;
              const newPrincipalRemaining = Math.max(0, currentPrincipal - principalPaidNow);
              
              const nextMonthInterest = newPrincipalRemaining * (loan.interestRate / 100);
              
              await supabase.from('parcelas').update({ 
                  due_date: newDate,
                  scheduled_interest: inst.scheduledInterest + nextMonthInterest 
              }).eq('id', inst.id);
          }
          
          showToast(paymentType !== 'FULL' ? "Renovado (+30 dias) com novos juros!" : "Quitado com sucesso!", "success"); 
          setPaymentModal(null); 
          setAvAmount(''); 
          setShowReceipt({ loan, inst, amountPaid: amountToPay, type: paymentType }); 
          await fetchFullData(activeUser.id);

      } catch (error) {
          console.error(error);
          showToast("Erro ao processar pagamento.", "error");
      } finally {
          setIsProcessingPayment(false);
      }
  };

  const renderPaymentModal = () => {
    if (!paymentModal) return null;
    const { loan, inst, calculations } = paymentModal;
    return (
        <Modal onClose={() => !isProcessingPayment && setPaymentModal(null)} title="Gerenciar Pagamento">
            <div className="space-y-6">
                <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 text-center">
                    <p className="text-xs font-black uppercase text-slate-500 mb-2">Valor Total Devido</p>
                    <p className="text-4xl font-black text-white mb-4">R$ {calculations.total.toFixed(2)}</p>
                    <div className="flex justify-center gap-4 text-[10px] font-bold uppercase text-slate-500">
                        <span>Principal: {calculations.principal.toFixed(2)}</span>
                        <span>Juros: {calculations.interest.toFixed(2)}</span>
                        <span className="text-rose-500">Multa: {calculations.lateFee.toFixed(2)}</span>
                    </div>
                </div>

                <div className="space-y-3">
                    <button onClick={() => setPaymentType('RENEW_INTEREST')} disabled={isProcessingPayment} className={`w-full p-4 rounded-2xl border transition-all flex justify-between items-center ${paymentType === 'RENEW_INTEREST' ? 'bg-amber-500/10 border-amber-500 text-amber-500' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'}`}>
                        <div className="text-left">
                            <p className="font-black uppercase text-xs">Pagar Juros (Renovar)</p>
                            <p className="text-[10px]">Paga Juros/Multa, adia 30 dias e gera novo juro.</p>
                        </div>
                        <span className="font-bold">R$ {(calculations.interest + calculations.lateFee).toFixed(2)}</span>
                    </button>

                    <button onClick={() => setPaymentType('RENEW_AV')} disabled={isProcessingPayment} className={`w-full p-4 rounded-2xl border transition-all flex justify-between items-center ${paymentType === 'RENEW_AV' ? 'bg-blue-500/10 border-blue-500 text-blue-500' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'}`}>
                        <div className="text-left">
                            <p className="font-black uppercase text-xs">Juros + AV (Amortizar)</p>
                            <p className="text-[10px]">Paga Juros, abate do Principal e renova o restante.</p>
                        </div>
                        <span className="font-bold">Personalizar</span>
                    </button>

                    <button onClick={() => setPaymentType('FULL')} disabled={isProcessingPayment} className={`w-full p-4 rounded-2xl border transition-all flex justify-between items-center ${paymentType === 'FULL' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'}`}>
                        <div className="text-left">
                            <p className="font-black uppercase text-xs">Quitar Totalmente</p>
                            <p className="text-[10px]">Liquida a parcela e encerra a dívida.</p>
                        </div>
                        <span className="font-bold">R$ {calculations.total.toFixed(2)}</span>
                    </button>
                </div>

                {paymentType === 'RENEW_AV' && (
                    <div className="animate-in slide-in-from-top-2 bg-slate-900 p-4 rounded-2xl border border-slate-800">
                        <label className="text-xs font-bold text-slate-500 mb-1 block">Valor da Amortização (AV)</label>
                        <input type="number" step="0.01" value={avAmount} onChange={e => setAvAmount(e.target.value)} disabled={isProcessingPayment} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-lg font-bold outline-none focus:border-blue-500 transition-colors" placeholder="0.00" />
                        <div className="mt-3 text-right">
                            <p className="text-[10px] text-slate-500">Juros/Multa: R$ {(calculations.interest + calculations.lateFee).toFixed(2)}</p>
                            <p className="text-xs font-bold text-white">Total a Pagar: R$ {((parseFloat(avAmount) || 0) + calculations.interest + calculations.lateFee).toFixed(2)}</p>
                        </div>
                    </div>
                )}
                
                <div className="flex gap-3 pt-2">
                    <button onClick={() => { setMessageModalLoan(loan); setPaymentModal(null); }} disabled={isProcessingPayment} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-slate-400 hover:text-emerald-500 transition-all"><MessageSquare/></button>
                    <button onClick={handlePayment} disabled={isProcessingPayment} className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                        {isProcessingPayment ? <Loader2 className="animate-spin"/> : <><DollarSign size={16}/> Confirmar Pagamento</>}
                    </button>
                </div>
            </div>
        </Modal>
    );
  };

  if (portalLoanId) return <ClientPortalView initialLoanId={portalLoanId} />;

  // Se estiver restaurando a sessão (tem ID mas ainda não carregou o user completo)
  if (activeProfileId && !activeUser) {
      const knownName = savedProfiles.find(p => p.id === activeProfileId)?.name || 'Usuário';
      return (
          <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
              <div className="flex flex-col items-center animate-in zoom-in duration-500">
                  <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 shadow-2xl shadow-blue-900/20 border border-slate-800">
                      <Loader2 className="w-8 h-8 text-blue-500 animate-spin"/>
                  </div>
                  <h2 className="text-2xl font-black text-white tracking-tighter uppercase mb-2">Aguarde</h2>
                  <p className="text-blue-500 font-bold text-lg">{knownName}...</p>
              </div>
          </div>
      );
  }

  if (!activeProfileId || !activeUser) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-start justify-end p-4 md:p-6 relative">
            <div className="absolute top-6 right-6 z-50">
                <button onClick={() => setShowHelpModal(true)} className="p-3 bg-slate-800/50 rounded-full text-slate-400 hover:text-white transition-all">
                    <HelpCircle size={24}/>
                </button>
            </div>
            <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden flex flex-col justify-center animate-in zoom-in-95 duration-300">
                <div className="absolute inset-0 bg-blue-600/5 blur-3xl rounded-full pointer-events-none"></div>
                <div className="relative z-10 text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20 mb-4"><TrendingUp className="text-white w-8 h-8" /></div>
                    <h1 className="text-2xl font-black text-white uppercase tracking-tighter mb-1">CrediMaster <span className="text-blue-500">DB</span></h1>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Sincronizado na Nuvem</p>
                </div>
                {!isCreatingProfile && !isRecoveringPassword && (
                    <div className="space-y-6">
                        <div className="bg-slate-800/50 p-2 rounded-2xl border border-slate-700 flex items-center gap-2"><div className="p-3 bg-slate-800 rounded-xl"><User className="text-slate-400 w-5 h-5" /></div><input type="text" className="bg-transparent w-full text-white outline-none text-sm font-bold placeholder:font-normal" placeholder="E-mail ou Usuário" value={loginUser} onChange={e => setLoginUser(e.target.value)} /></div>
                        <div className="bg-slate-800/50 p-2 rounded-2xl border border-slate-700 flex items-center gap-2"><div className="p-3 bg-slate-800 rounded-xl"><KeyRound className="text-slate-400 w-5 h-5" /></div><input type="password" id="login-password" className="bg-transparent w-full text-white outline-none text-sm font-bold placeholder:font-normal" placeholder="Senha" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitLogin()} /></div>
                        <button onClick={submitLogin} disabled={isLoadingData} className="w-full py-4 bg-blue-600 text-white rounded-2xl text-xs font-black uppercase shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2">{isLoadingData ? <Loader2 className="animate-spin" /> : 'Entrar'}</button>
                        <div className="flex gap-2"><button onClick={() => setIsCreatingProfile(true)} className="flex-1 py-3 bg-slate-800 text-slate-400 rounded-2xl text-[10px] font-black uppercase">Criar Conta</button><button onClick={() => setIsRecoveringPassword(true)} className="flex-1 py-3 bg-slate-800 text-slate-400 rounded-2xl text-[10px] font-black uppercase">Recuperar</button></div>
                        {savedProfiles.length > 0 && (
                            <div className="pt-4 border-t border-slate-800/50">
                                <p className="text-[10px] text-slate-500 font-bold uppercase mb-2 text-center">Contas Conhecidas</p>
                                <div className="flex flex-col gap-2">
                                    {savedProfiles.map(p => (
                                        <div key={p.id} className="flex items-center gap-3 bg-slate-950 p-2 rounded-xl border border-slate-800 cursor-pointer hover:border-slate-600 transition-colors" onClick={() => handleSelectSavedProfile(p)}>
                                            <div className="w-8 h-8 rounded-lg bg-blue-900/30 flex items-center justify-center text-blue-400 font-black text-xs">{p.name.charAt(0).toUpperCase()}</div>
                                            <div className="flex-1 overflow-hidden">
                                                <p className="text-xs font-bold text-white truncate">{p.name}</p>
                                                <p className="text-[10px] text-slate-500 truncate">{p.email}</p>
                                            </div>
                                            <button onClick={(e) => { e.stopPropagation(); handleRemoveSavedProfile(p.id); }} className="p-2 text-slate-600 hover:text-rose-500"><X size={14} /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {isCreatingProfile && (
                    <div className="space-y-4 animate-in slide-in-from-right duration-300">
                        <h3 className="text-center text-white font-bold text-sm uppercase mb-2">Novo Cadastro</h3>
                        <input type="text" placeholder="Nome do Usuário" className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm outline-none" value={newProfileForm.name} onChange={e => setNewProfileForm({...newProfileForm, name: e.target.value})} />
                        <input type="email" placeholder="E-mail para Login" className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm outline-none" value={newProfileForm.email} onChange={e => setNewProfileForm({...newProfileForm, email: e.target.value})} />
                        <input type="text" placeholder="Nome do Negócio" className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm outline-none" value={newProfileForm.businessName} onChange={e => setNewProfileForm({...newProfileForm, businessName: e.target.value})} />
                        <input type="password" placeholder="Senha" className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm outline-none" value={newProfileForm.password} onChange={e => setNewProfileForm({...newProfileForm, password: e.target.value})} />
                        <input type="text" placeholder="Frase de Recuperação" className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm outline-none" value={newProfileForm.recoveryPhrase} onChange={e => setNewProfileForm({...newProfileForm, recoveryPhrase: e.target.value})} />
                        <div className="flex gap-3 pt-2"><button onClick={() => setIsCreatingProfile(false)} className="flex-1 py-4 bg-slate-800 text-slate-400 rounded-2xl text-xs font-black uppercase">Cancelar</button><button onClick={handleCreateProfile} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl text-xs font-black uppercase shadow-lg">Criar</button></div>
                    </div>
                )}
                {isRecoveringPassword && (
                    <div className="space-y-4 animate-in slide-in-from-right duration-300">
                        <h3 className="text-center text-white font-bold text-sm uppercase mb-2">Recuperar Acesso</h3>
                        <input type="email" placeholder="E-mail ou Usuário" className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm outline-none" value={recoveryForm.email} onChange={e => setRecoveryForm({...recoveryForm, email: e.target.value})} />
                        <input type="text" placeholder="Frase Secreta" className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm outline-none" value={recoveryForm.phrase} onChange={e => setRecoveryForm({...recoveryForm, phrase: e.target.value})} />
                        <input type="password" placeholder="Nova Senha" className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm outline-none" value={recoveryForm.newPassword} onChange={e => setRecoveryForm({...recoveryForm, newPassword: e.target.value})} />
                        <div className="flex gap-3 pt-2"><button onClick={() => setIsRecoveringPassword(false)} className="flex-1 py-4 bg-slate-800 text-slate-400 rounded-2xl text-xs font-black uppercase">Voltar</button><button onClick={handlePasswordRecovery} className="flex-1 py-4 bg-rose-600 text-white rounded-2xl text-xs font-black uppercase shadow-lg">Redefinir</button></div>
                    </div>
                )}
            </div>
            
            {showHelpModal && (
                <Modal onClose={() => setShowHelpModal(false)} title="Central de Ajuda">
                    <div className="space-y-4">
                        <p className="text-center text-slate-400 text-sm mb-4">Selecione o motivo do contato. O suporte é realizado exclusivamente por mensagem.</p>
                        <button onClick={() => handleHelpSupport('password')} className="w-full p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between hover:bg-slate-800 transition-all group">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-slate-800 rounded-lg group-hover:bg-slate-700"><KeyRound className="text-blue-500" size={20}/></div>
                                <span className="text-sm font-bold text-white">Esqueci a Senha</span>
                            </div>
                            <ChevronRight size={16} className="text-slate-500"/>
                        </button>
                        <button onClick={() => handleHelpSupport('user')} className="w-full p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between hover:bg-slate-800 transition-all group">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-slate-800 rounded-lg group-hover:bg-slate-700"><User className="text-emerald-500" size={20}/></div>
                                <span className="text-sm font-bold text-white">Esqueci o Usuário</span>
                            </div>
                            <ChevronRight size={16} className="text-slate-500"/>
                        </button>
                    </div>
                </Modal>
            )}

            {toast && <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[300] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top duration-300 ${toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>{toast.type === 'error' ? <AlertCircle size={20}/> : <CheckCircle2 size={20}/>}<p className="font-bold text-xs uppercase tracking-widest">{toast.msg}</p></div>}
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-950 pb-28 md:pb-12 text-slate-100 font-sans selection:bg-blue-600/30 relative">
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 sm:h-20 flex items-center justify-between">
          <div className="flex items-center justify-between w-full md:w-auto gap-3 sm:gap-6">
             <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setActiveTab('DASHBOARD')}>
                <div className="w-10 h-10 sm:w-11 sm:h-11 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/30 group-hover:scale-110 transition-transform flex-shrink-0"><TrendingUp className="text-white w-5 h-5 sm:w-6 sm:h-6" /></div>
                <div>
                    <h1 className="text-base sm:text-2xl font-black tracking-tighter uppercase leading-none">CrediMaster <span className="text-blue-500">DB</span></h1>
                    {activeUser.businessName && <p className="text-[10px] sm:text-xs text-emerald-400 font-extrabold uppercase tracking-widest mt-0.5 shadow-black drop-shadow-sm">{activeUser.businessName}</p>}
                </div>
             </div>
             
             {/* Mobile Profile Icon (Top Right) */}
             <button onClick={() => setActiveTab('PROFILE')} className="md:hidden w-10 h-10 rounded-full bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center">
                {activeUser.photo ? <img src={activeUser.photo} className="w-full h-full object-cover"/> : <span className="text-white font-bold">{activeUser.name[0]}</span>}
             </button>

             {isLoadingData && <Loader2 className="animate-spin text-blue-500 hidden md:block" />}
             <div className="h-8 w-px bg-slate-800 hidden md:block" />
             <div className="hidden lg:flex items-center gap-4">
                {/* User Info (Photo + Name) - Desktop */}
                <button onClick={() => setActiveTab('PROFILE')} className="flex items-center gap-3 bg-slate-900/50 p-2 pr-4 rounded-full border border-slate-800/50">
                     <div className="w-8 h-8 rounded-full overflow-hidden border border-slate-700">
                        {activeUser.photo ? <img src={activeUser.photo} className="w-full h-full object-cover"/> : <div className="w-full h-full bg-slate-800 flex items-center justify-center text-xs font-bold">{activeUser.name[0]}</div>}
                     </div>
                     <div className="text-xs">
                        <p className="text-white font-bold">{activeUser.name.split(' ')[0]}</p>
                        <p className="text-[9px] text-slate-500 uppercase font-black">@{activeUser.email.split('@')[0]}</p>
	                     </div>
	                </button>

                {/* Hub Button */}
                <button onClick={() => setShowNavHub(true)} className="p-3 bg-slate-900 hover:bg-blue-600 text-slate-400 hover:text-white rounded-xl transition-all shadow-lg group">
                    <LayoutGrid size={20} className="group-hover:scale-110 transition-transform"/>
                </button>
             </div>
          </div>
          <nav className="hidden md:flex bg-slate-900 p-1.5 rounded-2xl border border-slate-800 gap-1">
             <button onClick={() => setActiveTab('DASHBOARD')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'DASHBOARD' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Painel</button>
             <button onClick={() => setActiveTab('CLIENTS')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'CLIENTS' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Clientes</button>
             <button onClick={() => setActiveTab('SOURCES')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'SOURCES' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Capital</button>
          </nav>
          <button onClick={() => { setEditingLoan(null); setIsFormOpen(true); }} className="hidden md:flex bg-blue-600 hover:bg-blue-500 text-white px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-600/30 active:scale-95 transition-all items-center justify-center gap-2"><Plus className="w-5 h-5" /> Novo Contrato</button>
        </div>
      </header>

      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-950/90 backdrop-blur-xl border-t border-slate-800 z-50 flex justify-around p-2 pb-safe">
         <button onClick={() => setActiveTab('DASHBOARD')} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === 'DASHBOARD' ? 'text-blue-500' : 'text-slate-500'}`}><LayoutDashboard size={20}/><span className="text-[9px] font-bold uppercase">Painel</span></button>
         <button onClick={() => setActiveTab('CLIENTS')} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === 'CLIENTS' ? 'text-blue-500' : 'text-slate-500'}`}><Users size={20}/><span className="text-[9px] font-bold uppercase">Clientes</span></button>
         <div className="relative -top-6">
            <button onClick={() => { setEditingLoan(null); setIsFormOpen(true); }} className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-blue-600/40"><Plus size={24}/></button>
         </div>
         <button onClick={() => setActiveTab('SOURCES')} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === 'SOURCES' ? 'text-blue-500' : 'text-slate-500'}`}><Wallet size={20}/><span className="text-[9px] font-bold uppercase">Fundos</span></button>
         <button onClick={() => setShowNavHub(true)} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === 'PROFILE' || activeTab === 'MASTER' ? 'text-blue-500' : 'text-slate-500'}`}><LayoutGrid size={20}/><span className="text-[9px] font-bold uppercase">Menu</span></button>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        {activeTab === 'DASHBOARD' && (
          <div className="flex flex-col gap-6">
            {/* Mobile View Toggle */}
            <div className="md:hidden bg-slate-900 p-1 rounded-2xl border border-slate-800 flex relative">
                <button onClick={() => setMobileDashboardTab('CONTRACTS')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${mobileDashboardTab === 'CONTRACTS' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}>Contratos</button>
                <button onClick={() => setMobileDashboardTab('BALANCE')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${mobileDashboardTab === 'BALANCE' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}>Balanço</button>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 sm:gap-8">
                {/* Left Column (Contracts & List) */}
                <div className={`flex-1 space-y-6 sm:space-y-8 ${mobileDashboardTab === 'BALANCE' ? 'hidden md:block' : ''}`}>
                    <DashboardAlerts loans={loans} />

                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                        {['TODOS', 'ATRASADOS', 'ATRASO_CRITICO', 'EM_DIA', 'PAGOS', 'ARQUIVADOS'].map(filter => (
                        <button key={filter} onClick={() => setStatusFilter(filter as any)} className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border flex items-center gap-2 ${statusFilter === filter ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/20' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'}`}>
                            {filter === 'ATRASO_CRITICO' && <ShieldAlert size={14} className="text-rose-500" />}
                            {filter.replace('_', ' ')}
                        </button>
                        ))}
                    </div>

                    <div className="bg-slate-900 border border-slate-800 p-2 rounded-2xl flex items-center gap-2">
                        <Search className="text-slate-500 ml-2" size={18}/>
                        <input
                            type="text"
                            placeholder="Buscar contrato por nome, CPF/CNPJ, código, telefone, e-mail..."
                            className="bg-transparent w-full p-2 text-white outline-none text-sm"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <button
                            onClick={() => startDictation(setSearchTerm, (msg) => showToast(msg, 'error'))}
                            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 hover:text-white hover:border-slate-600 transition-colors text-xs font-black uppercase"
                            title="Buscar por voz"
                            type="button"
                        >
                            🎙
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:gap-5">
                        {filteredLoans.map(loan => {
                        const isPaid = loan.installments.every(i => i.status === LoanStatus.PAID);
                        const isLate = loan.installments.some(i => getInstallmentStatusLogic(i) === LoanStatus.LATE);
                        const isCritical = loan.installments.some(i => getDaysDiff(i.dueDate) > 30 && i.status !== LoanStatus.PAID);
                        const isExpanded = selectedLoanId === loan.id;
                        const hasNotes = loan.notes && loan.notes.trim().length > 0;
                        
                        let cardStyle = "bg-slate-900 border-slate-800";
                        let iconStyle = "bg-slate-800 text-slate-500";

                        if (hasNotes) {
                            cardStyle = "bg-amber-950/20 border-amber-500/30";
                        }

                        if (isPaid) {
                            cardStyle = "bg-emerald-950/30 border-emerald-500/50 shadow-emerald-900/10";
                            iconStyle = "bg-emerald-500/20 text-emerald-500";
                        } else if (isLate) {
                            cardStyle = "bg-rose-950/30 border-rose-500/50 shadow-rose-900/10";
                            iconStyle = "bg-rose-500/20 text-rose-500";
                        } else {
                            const daysUntilDue = Math.min(...loan.installments.filter(i => i.status !== LoanStatus.PAID).map(i => -getDaysDiff(i.dueDate)));
                            if (daysUntilDue >= 0 && daysUntilDue <= 3) {
                                cardStyle = "bg-orange-950/30 border-orange-500/50 shadow-orange-900/10";
                                iconStyle = "bg-orange-500/20 text-orange-500";
                            } else if (!hasNotes) {
                                cardStyle = "bg-blue-950/20 border-blue-500/30 shadow-blue-900/5";
                                iconStyle = "bg-blue-600/20 text-blue-500";
                            }
                        }

                        return (
                            <div key={loan.id} className={`border transition-all duration-300 rounded-[2rem] sm:rounded-[2.5rem] p-5 sm:p-8 hover:shadow-2xl cursor-pointer overflow-hidden active:scale-[0.99] ${cardStyle} ${isExpanded ? 'ring-1 ring-white/10' : ''} ${isCritical ? 'animate-pulse ring-1 ring-rose-500' : ''}`} onClick={() => setSelectedLoanId(isExpanded ? null : loan.id)}>
                                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                                <div className="flex items-center gap-4 sm:gap-6 w-full">
                                    <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center font-black text-lg sm:text-xl transition-all flex-shrink-0 ${iconStyle}`}>
                                        {isCritical ? <ShieldAlert size={24} /> : loan.debtorName[0]}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-black text-base sm:text-xl text-white truncate">{loan.debtorName}</h3>
                                        <div className="flex flex-wrap gap-2 mt-1 sm:mt-2">
                                            <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><Phone size={10}/> {loan.debtorPhone}</p>
                                            {(() => {
                                                const nextDue = loan.installments
                                                    .filter(i => i.status !== LoanStatus.PAID)
                                                    .map(i => i.dueDate)
                                                    .sort()[0];
                                                if (!nextDue) return null;
                                                return (
                                                    <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                                                        <Calendar size={10}/> Venc: {formatBRDate(nextDue)}
                                                    </p>
                                                );
                                            })()}

                                            {loan.billingCycle === 'DAILY' && <span className="text-[8px] bg-purple-600 text-white px-2 py-0.5 rounded font-black uppercase">DIÁRIO</span>}
                                            {isCritical && <span className="text-[8px] bg-rose-600 text-white px-2 py-0.5 rounded font-black uppercase">CRÍTICO</span>}
                                            {isLate && !isCritical && !isPaid && <span className="text-[8px] bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded font-black uppercase">Atrasado</span>}
                                            {loan.isArchived && <span className="text-[8px] bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded font-black uppercase">Arquivado</span>}
                                            {hasNotes && <span className="text-[8px] bg-amber-500 text-black px-2 py-0.5 rounded font-black uppercase flex items-center gap-1"><FileText size={8}/> Obs</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex w-full sm:w-auto items-center justify-end gap-2 sm:gap-3 border-t sm:border-t-0 border-slate-800 pt-3 sm:pt-0">
                                    <button onClick={(e) => { e.stopPropagation(); setNoteModalLoan(loan); setNoteText(loan.notes); }} className={`p-2 sm:p-3.5 rounded-xl sm:rounded-2xl transition-all flex-1 sm:flex-none flex justify-center ${hasNotes ? 'bg-amber-500 text-black hover:bg-amber-400' : 'bg-slate-800 text-slate-500 hover:text-white'}`}><FileEdit className="w-4 h-4 sm:w-5 sm:h-5" /></button>
                                    <button onClick={(e) => { e.stopPropagation(); setMessageModalLoan(loan); }} className="p-2 sm:p-3.5 bg-emerald-500/10 text-emerald-500 rounded-xl sm:rounded-2xl hover:bg-emerald-500 hover:text-white transition-all flex-1 sm:flex-none flex justify-center"><MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" /></button>
                                    <div className="flex gap-2">
                                        {loan.isArchived ? (<button onClick={(e) => { e.stopPropagation(); openConfirmation({ type: 'RESTORE', target: loan }); }} className="p-2 sm:p-2.5 rounded-xl bg-slate-800 text-slate-500 hover:text-emerald-500 transition-all"><RotateCcw className="w-4 h-4" /></button>) : (<button onClick={(e) => { e.stopPropagation(); openConfirmation({ type: 'ARCHIVE', target: loan, showRefundOption: true }); }} className="p-2 sm:p-2.5 rounded-xl bg-slate-800 text-slate-500 hover:text-amber-500 transition-all"><Archive className="w-4 h-4" /></button>)}
                                        <button onClick={(e) => { e.stopPropagation(); openConfirmation({ type: 'DELETE', target: loan, showRefundOption: true }); }} className="p-2 sm:p-2.5 bg-rose-500/10 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition-all"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 sm:gap-8 pt-6 sm:pt-8 border-t border-white/5 mt-6 sm:mt-8">
                                <div className="space-y-1"><p className="text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-widest">Principal</p><p className="font-black text-xs sm:text-base text-white">R$ {loan.principal.toLocaleString()}</p></div>
                                <div className="space-y-1 text-center"><p className="text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-widest">Fonte</p><p className="font-black text-[10px] sm:text-xs text-blue-400 truncate max-w-[80px] sm:max-w-none mx-auto">{sources.find(s => s.id === loan.sourceId)?.name || '...'}</p></div>
                                <div className="space-y-1 text-right"><p className="text-[8px] sm:text-[9px] font-black text-slate-500 uppercase tracking-widest">Juros/Mês</p><p className="font-black text-xs sm:text-base text-emerald-500">{loan.interestRate}%</p></div>
                                </div>
                                {isExpanded && (
                                <div className="mt-8 sm:mt-10 space-y-6 sm:space-y-8 animate-in slide-in-from-top-4 duration-500" onClick={e => e.stopPropagation()}>
                                    {hasNotes && (
                                        <div className="bg-amber-900/20 p-4 rounded-2xl border border-amber-500/20">
                                            <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-2 flex items-center gap-2"><FileText size={12}/> Anotações / Observações</h4>
                                            <p className="text-xs text-slate-300 italic">{loan.notes}</p>
                                        </div>
                                    )}
                                    <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><History size={12}/> Extrato Financeiro Recente</h4>
                                        <div className="space-y-2 max-h-40 overflow-y-auto pr-2 no-scrollbar">
                                            {loan.ledger && loan.ledger.length > 0 ? (
                                                [...loan.ledger].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(t => (
                                                    <div key={t.id} className="flex justify-between items-center text-xs border-b border-slate-800/50 pb-2 last:border-0 last:pb-0">
                                                        <div>
                                                            <p className="text-white font-bold">{t.notes || (t.type === 'LEND_MORE' ? 'Empréstimo' : 'Pagamento')}</p>
                                                            <p className="text-[9px] text-slate-500">{new Date(t.date).toLocaleDateString()} às {new Date(t.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                                                        </div>
                                                        <span className={`font-black ${t.type === 'LEND_MORE' ? 'text-rose-500' : 'text-emerald-500'}`}>
                                                            {t.type === 'LEND_MORE' ? '-' : '+'} R$ {t.amount.toFixed(2)}
                                                        </span>
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-[10px] text-slate-600 text-center italic">Nenhuma transação registrada.</p>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {loan.paymentSignals && loan.paymentSignals.length > 0 && (
                                        <div className="bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20">
                                            <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-2 flex items-center gap-2"><HandCoins size={12}/> Intenções de Pagamento (Portal)</h4>
                                            {loan.paymentSignals.map((s, idx) => (
                                                <div key={idx} className="flex justify-between items-center bg-slate-900/50 p-2 rounded-lg mb-1 last:mb-0">
                                                    <span className="text-xs text-white">{new Date(s.date).toLocaleDateString()} - {s.type}</span>
                                                    {s.comprovanteUrl && (
                                                        <button
                                                            onClick={() => handleOpenComprovante(String(s.comprovanteUrl))}
                                                            className="text-[10px] text-blue-400 hover:underline"
                                                        >
                                                            Ver Comprovante
                                                        </button>
                                                    )}
                                                    {s.status === 'PENDENTE' && (
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleReviewSignal(String(s.id), 'APROVADO')}
                                                                className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/30"
                                                            >
                                                                Aprovar
                                                            </button>
                                                            <button
                                                                onClick={() => handleReviewSignal(String(s.id), 'NEGADO')}
                                                                className="text-[10px] px-2 py-1 rounded-lg bg-red-500/20 border border-red-500/30 text-red-200 hover:bg-red-500/30"
                                                            >
                                                                Negar
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                                        {loan.installments.map((inst, i) => {
                                        const st = getInstallmentStatusLogic(inst); 
                                        const debt = calculateTotalDue(loan, inst); 
                                        const daysDiff = getDaysDiff(inst.dueDate); 
                                        const isLateInst = st === LoanStatus.LATE;
                                        let statusText = ''; let statusColor = '';
                                        if (inst.status === LoanStatus.PAID) { statusText = 'PAGO'; statusColor = 'text-emerald-500'; } else if (daysDiff === 0) { statusText = 'Vence HOJE'; statusColor = 'text-amber-400 animate-pulse'; } else if (daysDiff < 0) { statusText = `Faltam ${Math.abs(daysDiff)} dias`; statusColor = 'text-blue-400'; } else { statusText = `Atrasado há ${daysDiff} dias`; statusColor = 'text-rose-500 font-black'; }
                                        return (
                                            <div key={inst.id} className={`p-4 sm:p-5 rounded-2xl sm:rounded-3xl border flex flex-col justify-between ${inst.status === LoanStatus.PAID ? 'bg-emerald-500/5 border-emerald-500/20' : isLateInst ? 'bg-rose-500/5 border-rose-500/20' : 'bg-slate-950 border-slate-800'}`}>
                                            <div className="flex justify-between items-start mb-3 sm:mb-4"><div><p className="text-[8px] sm:text-[9px] font-black text-slate-500 uppercase mb-0.5 sm:mb-1">{i+1}ª Parcela</p><p className="text-[9px] sm:text-[10px] font-bold text-white">{new Date(inst.dueDate).toLocaleDateString()}</p><p className={`text-[8px] sm:text-[9px] font-bold uppercase mt-1 ${statusColor}`}>{statusText}</p></div>{isLateInst && inst.status !== LoanStatus.PAID && <AlertCircle className="w-3 h-3 sm:w-4 sm:h-4 text-rose-500" />}{inst.status === LoanStatus.PAID && <CheckCircle2 className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-500" />}</div>
                                            <div className="mb-4 sm:mb-5">
                                                <div className="flex flex-col">
                                                        <div className="flex items-baseline gap-2 flex-wrap">
                                                            <span className="text-lg sm:text-xl font-black text-white" title="Principal Restante">R$ {debt.principal.toFixed(2)}</span>
                                                            {(debt.interest + debt.lateFee) > 0 && (
                                                                <>
                                                                    <span className="text-slate-500 font-bold">+</span>
                                                                    <span className={`text-lg sm:text-xl font-black ${isLateInst && inst.status !== LoanStatus.PAID ? 'text-rose-500' : 'text-emerald-500'}`} title="Juros + Multas">
                                                                        R$ {(debt.interest + debt.lateFee).toFixed(2)}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mt-1">Principal + Juros</p>
                                                </div>
                                                {isLateInst && inst.status !== LoanStatus.PAID && (<div className="mt-2 space-y-0.5"><p className="text-[9px] text-rose-400 flex justify-between"><span>Multa Inclusa:</span><span>R$ {debt.lateFee.toFixed(2)}</span></p></div>)}
                                                {inst.paidDate && <p className="text-[8px] sm:text-[9px] text-emerald-500 font-bold mt-1">Pago em {new Date(inst.paidDate).toLocaleDateString()}</p>}
                                            </div>
                                            {inst.status !== LoanStatus.PAID ? (<button onClick={() => setPaymentModal({ loan, inst, calculations: debt })} className="w-full py-2.5 sm:py-3 rounded-xl text-[8px] sm:text-[9px] font-black uppercase transition-all bg-blue-600 text-white shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 hover:bg-blue-500 active:scale-95"><MoreHorizontal size={14} /> Gerenciar</button>) : (<button disabled className="w-full py-2.5 sm:py-3 rounded-xl text-[8px] sm:text-[9px] font-black uppercase transition-all bg-slate-800 text-slate-500 cursor-not-allowed">Quitado</button>)}
                                            </div>
                                        );
                                        })}
                                    </div>
                                    
                                    <div className="flex justify-between items-center pt-4 border-t border-slate-800">
                                        <button onClick={(e) => { e.stopPropagation(); handleGenerateLink(loan); }} className="px-5 py-3 bg-slate-800 text-blue-400 rounded-2xl hover:text-white hover:bg-blue-600 transition-all flex items-center gap-2 text-[9px] font-black uppercase"><LinkIcon size={14}/> Portal do Cliente</button>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPromissoriaUploadLoanId(String(loan.id));
                                                    promissoriaFileInputRef.current?.click();
                                                }}
                                                className="px-5 py-3 bg-slate-800 text-slate-300 rounded-2xl hover:text-white hover:bg-slate-700 transition-all flex items-center gap-2 text-[9px] font-black uppercase"
                                                title="Anexar promissória assinada (PDF ou imagem)"
                                            >
                                                <Upload size={14}/> Promissória
                                                                                        </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setExtraDocUploadLoanId(String(loan.id));
                                                    setExtraDocKind('CONFISSAO');
                                                    extraDocFileInputRef.current?.click();
                                                }}
                                                className="px-5 py-3 bg-slate-800 text-slate-300 rounded-2xl hover:text-white hover:bg-slate-700 transition-all flex items-center gap-2 text-[9px] font-black uppercase"
                                                title="Anexar documento (Confissão de dívida) (PDF ou imagem)"
                                            >
                                                <Upload size={14}/> Documento
                                            </button>
                                            {(loan as any)?.promissoria_url && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(String((loan as any).promissoria_url), '_blank', 'noreferrer');
                                                    }}
                                                    className="px-5 py-3 bg-slate-800 text-emerald-400 rounded-2xl hover:text-white hover:bg-emerald-600 transition-all flex items-center gap-2 text-[9px] font-black uppercase"
                                                    title="Ver/baixar promissória anexada"
                                                >
                                                    <ExternalLink size={14}/> Ver
                                                </button>
                                            )}
                                            {(loan as any)?.confissao_divida_url && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(String((loan as any).confissao_divida_url), '_blank', 'noreferrer');
                                                    }}
                                                    className="px-5 py-3 bg-slate-800 text-emerald-400 rounded-2xl hover:text-white hover:bg-emerald-600 transition-all flex items-center gap-2 text-[9px] font-black uppercase"
                                                    title="Ver/baixar documento anexado"
                                                >
                                                    <ExternalLink size={14}/> Ver Doc
                                                </button>
                                            )}
                                        </div>

                                        {!loan.isArchived && <button onClick={(e) => { e.stopPropagation(); setEditingLoan(loan); setIsFormOpen(true); }} className="px-5 py-3 bg-slate-800 text-slate-400 rounded-2xl hover:text-white hover:bg-slate-700 transition-all flex items-center gap-2 text-[9px] font-black uppercase"><Edit size={14}/> Editar Contrato</button>}
                                    </div>
                                </div>
                                )}
                            </div>
                        );
                        })}
                        {filteredLoans.length === 0 && <div className="text-center py-16 sm:py-24 bg-slate-900/30 rounded-[2rem] sm:rounded-[3rem] border-2 border-dashed border-slate-800 flex flex-col items-center px-4"><div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-900 rounded-full flex items-center justify-center mb-4 sm:mb-6"><BarChart3 className="w-6 h-6 sm:w-8 sm:h-8 text-slate-700" /></div><p className="font-black uppercase text-xs sm:text-sm text-slate-500 tracking-widest">Nenhum contrato encontrado</p></div>}
                    </div>
                </div>

                {/* Right Column (Stats) */}
                <aside className={`w-full lg:w-96 space-y-5 sm:space-y-6 ${mobileDashboardTab === 'CONTRACTS' ? 'hidden md:block' : ''}`}>
                    {/* Mobile Only View - Now matching grid style */}
                    <div className="md:hidden grid grid-cols-1 gap-3">
                        <StatCard title="Capital na Rua" value={`R$ ${stats.totalLent.toLocaleString()}`} icon={<Banknote />} />
                        <StatCard title="Recebido (Total)" value={`R$ ${stats.totalReceived.toLocaleString()}`} icon={<CheckCircle2 />} />
                        <StatCard title="Lucro Projetado" value={`R$ ${stats.expectedProfit.toLocaleString()}`} icon={<Briefcase />} />
                        <ProfitCard balance={stats.interestBalance} onWithdraw={() => setWithdrawModal(true)} />
                    </div>

                    {/* Desktop View */}
                    <div className="hidden md:grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <StatCard title="Capital na Rua" value={`R$ ${stats.totalLent.toLocaleString()}`} icon={<Banknote />} />
                        <StatCard title="Recebido (Total)" value={`R$ ${stats.totalReceived.toLocaleString()}`} icon={<CheckCircle2 />} />
                        <StatCard title="Lucro Projetado" value={`R$ ${stats.expectedProfit.toLocaleString()}`} icon={<Briefcase />} />
                        
                        {/* Desktop Profit Display - Moved here as requested (4th item) */}
                        <ProfitCard 
                            balance={stats.interestBalance} 
                            onWithdraw={() => setWithdrawModal(true)} 
                        />
                    </div>
                    
                    <div className="bg-slate-900 border border-slate-800 rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-8 flex flex-col items-center shadow-xl">
                        <h3 className="text-[9px] sm:text-[10px] font-black uppercase mb-6 sm:mb-10 tracking-widest text-slate-500 flex items-center gap-2 w-full"><PieIcon className="w-4 h-4 text-blue-500" /> Saúde da Carteira</h3>
                        <div className="w-full" style={{ height: '200px', minHeight: '200px', width: '100%' }}> 
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                <Pie data={stats.pieData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none" cornerRadius={4}>{stats.pieData.map((entry, index) => <Cell key={index} fill={entry.color} />)}</Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', fontSize: '10px', fontWeight: 'bold' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:gap-3 mt-6 w-full">{stats.pieData.map(d => (<div key={d.name} className="flex items-center justify-between bg-slate-950 px-4 sm:px-5 py-3 sm:py-4 rounded-2xl border border-slate-800/50"><div className="flex items-center gap-2 sm:gap-3"><div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full" style={{ backgroundColor: d.color }} /><span className="text-[8px] sm:text-[9px] font-black uppercase text-slate-300">{d.name}</span></div><span className="text-xs sm:text-sm font-black text-white">{d.value}</span></div>))}</div>
                        <h3 className="text-[9px] sm:text-[10px] font-black uppercase mb-4 mt-8 tracking-widest text-slate-500 flex items-center gap-2 w-full pt-6 border-t border-slate-800"><TrendingUp className="w-4 h-4 text-emerald-500" /> Evolução (6 Meses)</h3>
                        <div className="w-full" style={{ height: '200px', minHeight: '200px', width: '100%' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={stats.lineChartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                    <XAxis dataKey="name" tick={{fontSize: 10, fill: '#64748b'}} axisLine={false} tickLine={false} />
                                    <YAxis tick={{fontSize: 10, fill: '#64748b'}} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', fontSize: '10px' }} />
                                    <Legend wrapperStyle={{fontSize: '10px', paddingTop: '10px'}} />
                                    <Line type="monotone" dataKey="Entradas" stroke="#10b981" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
                                    <Line type="monotone" dataKey="Saidas" stroke="#f43f5e" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </aside>
            </div>
          </div>
        )}
        
        {activeTab === 'CLIENTS' && (
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-black uppercase tracking-tighter text-white">Carteira de Clientes</h2>
                    <button onClick={() => openClientModal()} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2">
                        <Plus size={16}/> Novo Cliente
                    </button>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-2 rounded-2xl flex items-center gap-2">
                    <Search className="text-slate-500 ml-2" size={18}/>
                    <input
                        type="text"
                        placeholder="Buscar cliente por nome, CPF/CNPJ, código, telefone, e-mail..."
                        className="bg-transparent w-full p-2 text-white outline-none text-sm"
                        value={clientSearchTerm}
                        onChange={e => setClientSearchTerm(e.target.value)}
                    />
                    <button
                        onClick={() => startDictation(setClientSearchTerm, (msg) => showToast(msg, 'error'))}
                        className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 hover:text-white hover:border-slate-600 transition-colors text-xs font-black uppercase"
                        title="Buscar por voz"
                        type="button"
                    >
                        🎙
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredClients.map(client => (
                        <div key={client.id} className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] hover:border-blue-500/50 transition-all group relative">
                            <div className="flex items-start justify-between mb-4">
                                <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center text-slate-500 font-black text-xl group-hover:text-blue-500 transition-colors">
                                    {client.name.charAt(0)}
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => openClientModal(client)} className="p-2 text-slate-600 hover:text-white transition-colors"><Edit size={16}/></button>
                                    <button onClick={(e) => { e.stopPropagation(); openConfirmation({ type: 'DELETE_CLIENT', target: client.id }); }} className="p-2 text-slate-600 hover:text-rose-500 transition-colors"><Trash2 size={16}/></button>
                                </div>
                            </div>
                            <h3 className="font-bold text-white text-lg truncate">{client.name}</h3>
                            <p className="text-sm text-slate-500 mb-4">{client.phone}</p>
                            <div className="space-y-2 pt-4 border-t border-slate-800">
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-600 uppercase font-bold">Documento</span>
                                    <span className="text-slate-400">{client.document || '-'}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-600 uppercase font-bold">Endereço</span>
                                    <span className="text-slate-400 truncate max-w-[150px]">{client.address || '-'}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {activeTab === 'SOURCES' && (
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-black uppercase tracking-tighter text-white">Fontes de Capital</h2>
                    <button onClick={() => setIsSourceModalOpen(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2">
                        <Plus size={16}/> Nova Fonte
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {sources.map(source => (
                            <div key={source.id} className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] relative overflow-hidden">
                                <div className={`absolute top-0 right-0 p-8 opacity-10 ${source.type === 'BANK' ? 'text-blue-500' : source.type === 'CASH' ? 'text-emerald-500' : 'text-purple-500'}`}>
                                    {source.type === 'BANK' ? <Landmark size={100} /> : source.type === 'CASH' ? <Banknote size={100} /> : <Wallet size={100} />}
                                </div>
                                <div className="relative z-10">
                                    <div className="flex justify-between items-start">
                                        <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2">{source.type}</p>
                                        <button onClick={() => setEditingSource(source)} className="p-2 bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"><Edit2 size={12}/></button>
                                    </div>
                                    <h3 className="text-2xl font-black text-white mb-1">{source.name}</h3>
                                    <p className="text-3xl font-bold text-emerald-400 my-6">R$ {source.balance.toLocaleString()}</p>
                                    <div className="flex gap-3">
                                        <button onClick={() => { setIsAddFundsModalOpen(source); setAddFundsValue(''); }} className="flex-1 py-3 bg-slate-800 hover:bg-emerald-600 hover:text-white text-emerald-500 rounded-xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2"><PlusCircle size={14}/> Adicionar</button>
                                        <button onClick={(e) => { e.stopPropagation(); openConfirmation({ type: 'DELETE_SOURCE', target: source.id }); }} className="py-3 px-4 bg-slate-800 hover:bg-rose-600 hover:text-white text-slate-500 rounded-xl transition-all"><Trash2 size={16}/></button>
                                    </div>
                                </div>
                            </div>
                        ))}
                </div>
                {editingSource && (
                    <Modal onClose={() => setEditingSource(null)} title={`Editar Saldo: ${editingSource.name}`}>
                        <div className="space-y-4">
                            <input 
                                type="number" 
                                value={editingSource.balance} 
                                onChange={e => setEditingSource({...editingSource, balance: parseFloat(e.target.value) || 0})}
                                className="w-full bg-slate-950 p-4 rounded-xl text-white text-xl font-bold outline-none border border-slate-800"
                            />
                            <button onClick={handleUpdateSourceBalance} className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl uppercase">Salvar Saldo</button>
                        </div>
                    </Modal>
                )}
            </div>
        )}

        {/* PROFILE, MASTER and MODALS sections remain largely unchanged but are included below for full file integrity */}
        {activeTab === 'PROFILE' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] text-center relative overflow-hidden">
                        <div className="w-24 h-24 bg-slate-800 rounded-full mx-auto mb-6 flex items-center justify-center border-4 border-slate-900 shadow-2xl relative z-10 overflow-hidden">
                            {activeUser.photo ? <img src={activeUser.photo} className="w-full h-full object-cover"/> : <User size={40} className="text-slate-600"/>}
                        </div>
                        <h2 className="text-xl font-black text-white">{activeUser.name}</h2>
                        <p className="text-sm text-slate-500 font-bold uppercase tracking-widest mt-1">{activeUser.businessName || 'Empreendedor'}</p>
                        
                        <div className="mt-8 space-y-3">
                            <button onClick={() => setShowHelpModal(true)} className="w-full py-4 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white rounded-2xl text-xs font-black uppercase transition-all flex items-center justify-center gap-2"><HelpCircle size={16}/> Ajuda / Suporte</button>
                            <button onClick={() => setDonateModal(true)} className="w-full py-4 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-2xl text-xs font-black uppercase transition-all flex items-center justify-center gap-2 hover:scale-105 shadow-lg"><Heart size={16}/> Apoiar Projeto</button>
                            <button onClick={handleLogout} className="w-full py-4 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white rounded-2xl text-xs font-black uppercase transition-all flex items-center justify-center gap-2"><LogOut size={16}/> Sair</button>
                            
                            <div className="pt-4 mt-4 border-t border-slate-800 space-y-2">
                                <p className="text-[10px] text-rose-500 font-black uppercase tracking-widest">Zona de Perigo</p>
                                <button onClick={() => setResetDataModal(true)} className="w-full py-4 bg-rose-900/20 text-rose-500 hover:bg-rose-600 hover:text-white rounded-2xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2"><RefreshCcw size={14}/> Zerar Tudo</button>
                                <button onClick={handleDeleteAccount} className="w-full py-4 text-slate-600 hover:text-rose-500 rounded-2xl text-[10px] font-black uppercase transition-all">Excluir Conta</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-2 space-y-6">
                    {profileEditForm && (
                        <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] space-y-6">
                            <h3 className="text-lg font-black uppercase text-white mb-2 flex items-center gap-2"><User size={20} className="text-emerald-500"/> Dados do Operador</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1 md:col-span-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Foto de Perfil (Avatar)</label>
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 bg-slate-950 rounded-full flex-shrink-0 border border-slate-800 overflow-hidden flex items-center justify-center">
                                            {profileEditForm.photo ? <img src={profileEditForm.photo} className="w-full h-full object-cover"/> : <User size={24} className="text-slate-600"/>}
                                        </div>
                                        <div>
                                            <button onClick={() => profilePhotoInputRef.current?.click()} className="px-6 py-3 bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase hover:bg-slate-700 flex items-center gap-2">
                                                <Camera size={14}/> Carregar Foto
                                            </button>
                                            <input type="file" ref={profilePhotoInputRef} onChange={handlePhotoUpload} className="hidden" accept="image/*"/>


                                            <p className="text-[9px] text-slate-500 mt-1">Recomendado: 500x500px (Max 2MB)</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Nome Completo</label>
                                    <input type="text" value={profileEditForm.name} onChange={e => setProfileEditForm({...profileEditForm, name: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none focus:border-emerald-500" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Nome do Negócio</label>
                                    <input type="text" value={profileEditForm.businessName} onChange={e => setProfileEditForm({...profileEditForm, businessName: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none focus:border-emerald-500" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">CPF/CNPJ</label>
                                    <input type="text" value={profileEditForm.document} onChange={e => setProfileEditForm({...profileEditForm, document: maskDocument(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none focus:border-emerald-500" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Telefone</label>
                                    <input type="text" value={profileEditForm.phone} onChange={e => setProfileEditForm({...profileEditForm, phone: maskPhone(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none focus:border-emerald-500" />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Chave PIX (Padrão)</label>
                                    <input type="text" value={profileEditForm.pixKey} onChange={e => setProfileEditForm({...profileEditForm, pixKey: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none focus:border-emerald-500" placeholder="CPF, Email, Telefone ou Aleatória" />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Endereço Completo</label>
                                    <input type="text" value={profileEditForm.address} onChange={e => setProfileEditForm({...profileEditForm, address: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none focus:border-emerald-500" />
                                </div>
                            </div>
                            <button onClick={handleSaveProfile} className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase shadow-lg hover:bg-emerald-500 transition-all flex items-center justify-center gap-2"><Save size={16}/> Salvar Alterações</button>
                        </div>
                    )}

                    <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem]">
                        <h3 className="text-lg font-black uppercase text-white mb-6 flex items-center gap-2"><HardDrive size={20} className="text-blue-500"/> Gestão de Dados</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <label className="p-6 bg-slate-950 border border-slate-800 rounded-3xl hover:border-emerald-500 transition-all group text-left cursor-pointer">
                                <FileSpreadsheet size={24} className="text-slate-500 group-hover:text-emerald-500 mb-4 transition-colors"/>
                                <p className="font-bold text-white text-sm">Importar Planilha</p>
                                <p className="text-xs text-slate-500 mt-1">Carregar Excel (.xlsx)</p>
                                <input type="file" className="hidden" ref={fileInputExcelRef} onChange={handleImportExcel} accept=".xlsx, .xls" />
                            </label>
                            <button onClick={handleExportBackup} className="p-6 bg-slate-950 border border-slate-800 rounded-3xl hover:border-blue-500 transition-all group text-left">
                                <Download size={24} className="text-slate-500 group-hover:text-blue-500 mb-4 transition-colors"/>
                                <p className="font-bold text-white text-sm">Backup Completo</p>
                                <p className="text-xs text-slate-500 mt-1">Baixar arquivo JSON</p>
                            </button>
                            <label className="p-6 bg-slate-950 border border-slate-800 rounded-3xl hover:border-purple-500 transition-all group text-left cursor-pointer">
                                <Upload size={24} className="text-slate-500 group-hover:text-purple-500 mb-4 transition-colors"/>
                                <p className="font-bold text-white text-sm">Restaurar Backup</p>
                                <p className="text-xs text-slate-500 mt-1">Carregar arquivo JSON</p>
                                <input type="file" className="hidden" ref={fileInputBackupRef} onChange={handleRestoreBackup} accept=".json" />
                            </label>
                            <button onClick={handleExportCSV} className="p-6 bg-slate-950 border border-slate-800 rounded-3xl hover:border-slate-500 transition-all group text-left">
                                <FileSpreadsheet size={24} className="text-slate-500 group-hover:text-white mb-4 transition-colors"/>
                                <p className="font-bold text-white text-sm">Relatório CSV</p>
                                <p className="text-xs text-slate-500 mt-1">Excel / Google Sheets</p>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* MASTER TAB CONTENT */}
        {activeTab === 'MASTER' && activeUser.accessLevel === 1 && (
            <div className="space-y-6">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <button onClick={() => setActiveTab('PROFILE')} className="flex items-center gap-2 text-slate-500 hover:text-white mb-2 text-xs font-bold uppercase transition-colors"><ArrowLeft size={16}/> Voltar ao Perfil</button>
                        <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Gestão de Acessos</h2>
                        <p className="text-slate-500 text-xs mt-1">Painel Administrativo Master</p>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl">
                        <span className="text-xs font-bold text-slate-400 uppercase">Total: <span className="text-white">{allUsers.length}</span></span>
                    </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-2 rounded-2xl flex items-center gap-2 mb-4">
                    <Search className="text-slate-500 ml-2" size={18}/>
                    <input 
                        type="text" 
                        placeholder="Buscar usuário por nome ou email..." 
                        className="bg-transparent w-full p-2 text-white outline-none text-sm"
                        value={sacSearch}
                        onChange={e => setSacSearch(e.target.value)}
                    />
                </div>
                
                <div className="space-y-3">
                    {allUsers.filter(u => 
                        u.nome_operador?.toLowerCase().includes(sacSearch.toLowerCase()) || 
                        u.usuario_email?.toLowerCase().includes(sacSearch.toLowerCase())
                    ).map(user => (
                        <div key={user.id} className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-slate-700 transition-all">
                            <div className="flex items-center gap-4 w-full sm:w-auto overflow-hidden">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl flex-shrink-0 ${user.access_level === 1 ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-slate-800 text-slate-500'}`}>
                                    {user.nome_operador?.charAt(0).toUpperCase() || '?'}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-white text-sm truncate">{user.nome_operador}</h3>
                                        {user.access_level === 1 ? (
                                            <span className="bg-emerald-500/10 text-emerald-500 text-[9px] font-black px-2 py-0.5 rounded uppercase border border-emerald-500/20">ADMIN</span>
                                        ) : (
                                            <span className="bg-slate-800 text-slate-500 text-[9px] font-black px-2 py-0.5 rounded uppercase border border-slate-700">OPERADOR</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-500 truncate">{user.usuario_email}</p>
                                    <p className="text-[10px] text-slate-600 font-bold uppercase mt-0.5">{user.nome_empresa || 'Sem Empresa'}</p>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2 w-full sm:w-auto pt-4 sm:pt-0 border-t sm:border-t-0 border-slate-800">
                                <button onClick={() => setMasterEditUser({...user, newPassword: ''})} className="p-3 bg-slate-800 text-slate-400 hover:text-white rounded-xl hover:bg-slate-700 transition-all" title="Editar">
                                    <Edit size={18}/>
                                </button>
                                <button onClick={() => handleAdminResetPassword(user)} className="p-3 bg-slate-800 text-slate-400 hover:text-blue-400 rounded-xl hover:bg-slate-700 transition-all" title="Resetar Senha">
                                    <KeyRound size={18}/>
                                </button>
                                <button 
                                    onClick={() => handleToggleAdmin(user)} 
                                    className={`flex-1 sm:flex-none px-4 py-3 rounded-xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 ${user.access_level === 1 ? 'bg-orange-500/10 text-orange-500 hover:bg-orange-500 hover:text-white' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white'}`}
                                >
                                    {user.access_level === 1 ? <ArrowDownCircle size={16}/> : <ArrowUpRight size={16}/>}
                                    {user.access_level === 1 ? 'Rebaixar' : 'Promover'}
                                </button>
                            </div>
                        </div>
                    ))}
                    {allUsers.length === 0 && (
                        <div className="text-center py-12 text-slate-500 font-bold uppercase text-xs border-2 border-dashed border-slate-800 rounded-3xl">Nenhum usuário encontrado.</div>
                    )}
                </div>
            </div>
        )}
      </main>

      {/* MASTER EDIT USER MODAL */}
      {masterEditUser && (
          <Modal onClose={() => setMasterEditUser(null)} title="Editar Perfil (Master)">
              <div className="space-y-4">
                  <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Nome Operador</label>
                      <input type="text" value={masterEditUser.nome_operador || ''} onChange={e => setMasterEditUser({...masterEditUser, nome_operador: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none" />
                  </div>
                  <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Nome Empresa</label>
                      <input type="text" value={masterEditUser.nome_empresa || ''} onChange={e => setMasterEditUser({...masterEditUser, nome_empresa: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none" />
                  </div>
                  <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Chave Pix</label>
                      <input type="text" value={masterEditUser.pix_key || ''} onChange={e => setMasterEditUser({...masterEditUser, pix_key: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none" />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2">Nível de Acesso</label>
                          <select value={masterEditUser.access_level || 0} onChange={e => setMasterEditUser({...masterEditUser, access_level: Number(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs outline-none">
                              <option value={2}>Usuário Padrão (2)</option>
                              <option value={1}>Administrador Master (1)</option>
                          </select>
                      </div>
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2">Redefinir Senha</label>
                          <input type="text" value={masterEditUser.newPassword || ''} onChange={e => setMasterEditUser({...masterEditUser, newPassword: e.target.value})} placeholder="Nova Senha (Opcional)" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs outline-none" />
                      </div>
                  </div>

                  <button onClick={handleMasterUpdateUser} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg mt-4">Salvar Alterações</button>
              </div>
          </Modal>
      )}

      {/* MODALS */}
      {isFormOpen && (
        <LoanForm 
            onAdd={handleSaveLoan} 
            onCancel={() => { setIsFormOpen(false); setEditingLoan(null); }} 
            initialData={editingLoan}
            clients={clients}
            sources={sources}
        />
      )}

      {renderPaymentModal()}
      
      {showReceipt && activeUser && (
          <ReceiptModal 
              data={showReceipt} 
              userName={activeUser.businessName || activeUser.name}
              userDoc={activeUser.document}
              onClose={() => setShowReceipt(null)} 
          />
      )}
      
      {showCalcModal && <CalculatorModal onClose={() => setShowCalcModal(false)} />}
      {showAgendaModal && <AgendaModal onClose={() => setShowAgendaModal(false)} loans={loans} onSelectLoan={(id) => { setSelectedLoanId(id); setShowAgendaModal(false); setActiveTab('DASHBOARD'); }} />}
      {showFlowModal && <FlowModal onClose={() => setShowFlowModal(false)} loans={loans} profit={stats.interestBalance} />}
      {messageModalLoan && <MessageHubModal loan={messageModalLoan} client={clients.find(c => c.id === messageModalLoan.clientId)} onClose={() => setMessageModalLoan(null)} />}
      
      {showNavHub && (
          <NavHub 
              onClose={() => setShowNavHub(false)} 
              userLevel={activeUser?.accessLevel || 0}
              onNavigate={(tab, modal) => {
                  setActiveTab(tab as any);
                  setShowNavHub(false);
                  if (modal === 'CALC') setShowCalcModal(true);
                  if (modal === 'AGENDA') setShowAgendaModal(true);
                  if (modal === 'FLOW') setShowFlowModal(true);
              }}
          />
      )}

      {/* MODAL DE NOTAS INTELIGENTES */}
      {noteModalLoan && (
          <Modal onClose={() => setNoteModalLoan(null)} title="Anotações do Contrato">
              <div className="space-y-4">
                  <p className="text-sm text-slate-400">Escreva observações importantes sobre este contrato. Elas ficarão visíveis no card principal.</p>
                  <textarea 
                      className="w-full h-40 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-white outline-none resize-none focus:border-amber-500 transition-colors"
                      placeholder="Ex: Cliente prometeu pagar dia 15..."
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                  />
                  <div className="flex justify-end gap-3">
                      <button onClick={() => setNoteModalLoan(null)} className="px-6 py-3 bg-slate-800 text-slate-400 rounded-xl font-bold uppercase text-xs">Cancelar</button>
                      <button onClick={handleSaveNote} className="px-6 py-3 bg-amber-600 text-white rounded-xl font-bold uppercase text-xs shadow-lg flex items-center gap-2"><Save size={16}/> Salvar Nota</button>
                  </div>
              </div>
          </Modal>
      )}

      {isClientModalOpen && (
        <Modal onClose={() => setIsClientModalOpen(false)} title={editingClient ? "Editar Cliente" : "Novo Cliente"}>
            <div className="space-y-4">
                <input type="text" placeholder="Nome Completo" value={clientForm.name} onChange={e => setClientForm({...clientForm, name: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none" />
                {(clientDraftAccessCode || clientDraftNumber) && (
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-left">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Código do Portal</p>
                                <p className="text-white font-black text-lg tracking-widest">{clientDraftAccessCode || '-'}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    const v = String(clientDraftAccessCode || '').trim();
                                    if (v) navigator.clipboard.writeText(v);
                                    showToast('Código copiado!', 'success');
                                }}
                                className="px-4 py-3 bg-slate-800 text-slate-200 rounded-2xl font-black uppercase text-[10px] hover:bg-slate-700"
                            >
                                Copiar
                            </button>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                            <div>
                                <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Número do Cliente</p>
                                <p className="text-white font-black">{clientDraftNumber || '-'}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    const v = String(clientDraftNumber || '').trim();
                                    if (v) navigator.clipboard.writeText(v);
                                    showToast('Número copiado!', 'success');
                                }}
                                className="px-4 py-3 bg-slate-800 text-slate-200 rounded-2xl font-black uppercase text-[10px] hover:bg-slate-700"
                            >
                                Copiar
                            </button>
                        </div>
                    </div>
                )}
                <div className="flex gap-2">
                    <input type="text" placeholder="Telefone" value={clientForm.phone} onChange={e => setClientForm({...clientForm, phone: maskPhone(e.target.value)})} className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none" />
                    <button type="button" onClick={handlePickContact} className="px-4 bg-slate-950 border border-slate-800 rounded-2xl text-slate-400 hover:text-white"><Search size={20}/></button>
                </div>
                <input type="text" placeholder="CPF/CNPJ" value={clientForm.document} onChange={e => setClientForm({...clientForm, document: maskDocument(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none" />
                <input type="text" placeholder="Endereço" value={clientForm.address} onChange={e => setClientForm({...clientForm, address: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none" />
                <input type="email" placeholder="Email (Opcional)" value={clientForm.email} onChange={e => setClientForm({...clientForm, email: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none" />
                <textarea placeholder="Observações" value={clientForm.notes} onChange={e => setClientForm({...clientForm, notes: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none min-h-[100px]" />
                <button onClick={handleSaveClient} disabled={isSaving} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                    {isSaving ? <Loader2 className="animate-spin"/> : 'Salvar Cliente'}
                </button>
            </div>
        </Modal>
      )}

      {isSourceModalOpen && (
        <Modal onClose={() => setIsSourceModalOpen(false)} title="Nova Fonte de Capital">
            <div className="space-y-4">
                <input type="text" placeholder="Nome da Fonte (ex: Banco X)" value={sourceForm.name} onChange={e => setSourceForm({...sourceForm, name: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none" />
                <select value={sourceForm.type} onChange={e => setSourceForm({...sourceForm, type: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none">
                    <option value="BANK">Conta Bancária</option>
                    <option value="CASH">Dinheiro em Espécie</option>
                    <option value="WALLET">Carteira Digital</option>
                </select>
                <input type="number" placeholder="Saldo Inicial" value={sourceForm.balance} onChange={e => setSourceForm({...sourceForm, balance: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none" />
                <button onClick={handleSaveSource} disabled={isSaving} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                    {isSaving ? <Loader2 className="animate-spin"/> : 'Criar Fonte'}
                </button>
            </div>
        </Modal>
      )}

      {isAddFundsModalOpen && (
        <Modal onClose={() => setIsAddFundsModalOpen(null)} title={`Adicionar a ${isAddFundsModalOpen.name}`}>
            <div className="space-y-4 text-center">
                <p className="text-slate-400 text-sm">Informe o valor para adicionar ao saldo desta fonte.</p>
                <input type="number" placeholder="Valor (R$)" value={addFundsValue} onChange={e => setAddFundsValue(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-xl font-bold text-center outline-none" autoFocus />
                <button onClick={handleAddFunds} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg">Confirmar Entrada</button>
            </div>
        </Modal>
      )}

      {withdrawModal && (
        <Modal onClose={() => setWithdrawModal(false)} title="Resgatar Lucro">
            <div className="space-y-4">
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center">
                    <p className="text-[10px] font-black uppercase text-slate-500">Disponível para Saque</p>
                    <p className="text-2xl font-black text-emerald-500">R$ {activeUser?.interestBalance.toFixed(2)}</p>
                </div>
                <input type="number" placeholder="Valor do Saque" value={withdrawValue} onChange={e => setWithdrawValue(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-lg font-bold outline-none" />
                <select value={withdrawSourceId} onChange={e => setWithdrawSourceId(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white outline-none text-sm">
                    <option value="">-- Selecionar Fonte de Origem --</option>
                    {sources.map(s => <option key={s.id} value={s.id}>{s.name} (Saldo: R$ {s.balance.toLocaleString()})</option>)}
                    <option value="EXTERNAL_WITHDRAWAL">Saque Externo (Apenas baixa no Lucro)</option>
                </select>
                <button onClick={handleWithdrawProfit} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg">Confirmar Resgate</button>
            </div>
        </Modal>
      )}

      {viewProofModal && (
          <Modal onClose={() => setViewProofModal(null)} title="Comprovante de Pagamento">
              <div className="flex justify-center bg-slate-950 p-4 rounded-xl">
                  {viewProofModal.startsWith('data:application/pdf') ? (
                      <iframe src={viewProofModal} className="w-full h-96" title="PDF Comprovante"></iframe>
                  ) : (
                      <img src={viewProofModal} alt="Comprovante" className="max-w-full max-h-[70vh] rounded-lg shadow-lg" />
                  )}
              </div>
              <div className="mt-4 flex gap-3">
                  <button onClick={() => setViewProofModal(null)} className="flex-1 py-3 bg-slate-800 text-white rounded-xl font-bold uppercase text-xs">Fechar</button>
                  <a href={viewProofModal} download="comprovante_pagamento" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold uppercase text-xs flex items-center justify-center gap-2"><Download size={16}/> Baixar</a>
              </div>
          </Modal>
      )}

      {donateModal && (
          <Modal onClose={() => setDonateModal(false)} title="Apoiar Projeto">
              <div className="text-center space-y-6">
                  <div className="w-20 h-20 bg-pink-500/20 rounded-full flex items-center justify-center mx-auto text-pink-500 animate-pulse">
                      <Heart size={40} fill="currentColor" />
                  </div>
                  <p className="text-slate-300">Este sistema é gratuito. Se ele te ajuda a lucrar, considere apoiar o desenvolvedor!</p>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 relative group cursor-pointer" onClick={() => { navigator.clipboard.writeText("00020126580014br.gov.bcb.pix0136d8135204-13f6-483b-90c9-fb530257d7b55204000053039865802BR5925MANOEL SOCRATES COSTA LEV6011Itacoatiara6211050726f78796304E08B"); showToast("Chave PIX copiada!"); }}>
                      <p className="text-[10px] font-black uppercase text-slate-500 mb-1">Chave PIX (Copia e Cola)</p>
                      <p className="text-white font-mono text-xs break-all">00020126580014br.gov.bcb.pix0136d8135204...</p>
                      <div className="absolute inset-0 bg-blue-600/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl">
                          <span className="text-white font-bold text-xs uppercase">Clique para Copiar</span>
                      </div>
                  </div>
              </div>
          </Modal>
      )}
      
      {deleteAccountModal && (
  <Modal onClose={() => setDeleteAccountModal(false)} title="Excluir Conta (Irreversível)">
      <div className="space-y-6">
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4">
              <p className="text-xs text-slate-200 font-bold mb-2 flex items-center gap-2"><AlertTriangle size={16} className="text-rose-500"/> Aviso Legal</p>
              <ul className="text-[11px] text-slate-300 space-y-1 list-disc pl-5">
                  <li>Esta ação é <span className="font-black text-rose-400">permanente</span> e apaga sua conta e seus dados.</li>
                  <li>Não é possível recuperar contratos, clientes, histórico e backups após a exclusão.</li>
                  <li>Você confirma que possui autorização para excluir estes dados.</li>
              </ul>
          </div>

          <label className="flex items-start gap-3 bg-slate-950 border border-slate-800 p-4 rounded-2xl cursor-pointer">
              <input type="checkbox" checked={deleteAccountAgree} onChange={e => setDeleteAccountAgree(e.target.checked)} className="mt-1" />
              <span className="text-[11px] text-slate-300">
                  Li e concordo com o aviso acima. Entendo que a exclusão é irreversível.
              </span>
          </label>

          <div className="space-y-2">
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Confirmação</p>
              <p className="text-xs text-slate-400">Digite <span className="text-white font-black">EXCLUIR</span> para confirmar.</p>
              <input
                  value={deleteAccountConfirm}
                  onChange={e => setDeleteAccountConfirm(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm outline-none focus:border-rose-500"
                  placeholder="EXCLUIR"
              />
          </div>

          <div className="flex gap-3 pt-2">
              <button onClick={() => setDeleteAccountModal(false)} className="flex-1 py-4 bg-slate-800 text-slate-300 rounded-2xl text-xs font-black uppercase">Cancelar</button>
              <button
                  disabled={!deleteAccountAgree || deleteAccountConfirm.trim().toUpperCase() !== 'EXCLUIR' || isLoadingData}
                  onClick={async () => {
                      if (!activeUser) return;
                      setIsLoadingData(true);
                      try {
                          // delete profile + cascade via FK (recomendado no BD). Se não houver cascade, apenas perfil será deletado.
                          const { error } = await supabase.from('perfis').delete().eq('id', activeUser.id);
                          if (error) throw new Error(error.message);
                          handleLogout();
                          showToast("Conta excluída.", "success");
                      } catch (e: any) {
                          console.error(e);
                          showToast("Erro ao excluir conta: " + (e?.message || 'desconhecido'), "error");
                      } finally {
                          setIsLoadingData(false);
                          setDeleteAccountModal(false);
                      }
                  }}
                  className="flex-1 py-4 bg-rose-600 text-white rounded-2xl text-xs font-black uppercase shadow-lg shadow-rose-600/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                  {isLoadingData ? <Loader2 className="animate-spin" size={18}/> : 'Excluir Conta'}
              </button>
          </div>
      </div>
  </Modal>
)}

{resetDataModal && (
        <Modal onClose={() => { setResetDataModal(false); setResetPasswordInput(''); }} title="Zerar Tudo">
            <div className="space-y-6 text-center">
                <div className="w-20 h-20 bg-rose-950 rounded-full flex items-center justify-center mx-auto text-rose-500 border-4 border-rose-900/50">
                    <RefreshCcw size={32} />
                </div>
                <div className="space-y-2">
                    <h3 className="text-lg font-bold text-white uppercase">Atenção Extrema</h3>
                    <p className="text-slate-400 text-sm">Esta ação apagará <b>TODOS</b> os contratos, clientes, histórico financeiro e fontes de capital. <br/><br/>O seu perfil de acesso será mantido, mas com saldo zerado.</p>
                </div>
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Confirme sua senha para continuar</p>
                    <input 
                        type="password" 
                        value={resetPasswordInput}
                        onChange={e => setResetPasswordInput(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-center font-bold outline-none focus:border-rose-500 transition-colors"
                        placeholder="Sua senha atual"
                    />
                </div>
                <div className="flex gap-3">
                    <button onClick={() => { setResetDataModal(false); setResetPasswordInput(''); }} className="flex-1 py-4 bg-slate-800 text-slate-400 rounded-2xl font-black uppercase text-xs">Cancelar</button>
                    <button onClick={handleResetData} className="flex-1 py-4 bg-rose-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg shadow-rose-600/20 hover:bg-rose-500 transition-all flex items-center justify-center gap-2">
                        {isLoadingData ? <Loader2 className="animate-spin"/> : <><Trash2 size={16}/> APAGAR TUDO</>}
                    </button>
                </div>
            </div>
        </Modal>
      )}

      {showHelpModal && (
          <Modal onClose={() => setShowHelpModal(false)} title="Central de Ajuda">
              <div className="space-y-4">
                  <div className="bg-blue-900/20 border border-blue-500/20 p-4 rounded-2xl mb-6">
                      <p className="text-center text-blue-300 text-xs font-bold uppercase tracking-widest">Suporte Exclusivo via WhatsApp</p>
                  </div>
                  <button onClick={() => handleHelpSupport('password')} className="w-full p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between hover:bg-slate-800 transition-all group">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-slate-800 rounded-lg group-hover:bg-slate-700"><KeyRound className="text-blue-500" size={20}/></div>
                          <span className="text-sm font-bold text-white">Esqueci a Senha</span>
                      </div>
                      <ChevronRight size={16} className="text-slate-500"/>
                  </button>
                  <button onClick={() => handleHelpSupport('user')} className="w-full p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between hover:bg-slate-800 transition-all group">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-slate-800 rounded-lg group-hover:bg-slate-700"><User className="text-emerald-500" size={20}/></div>
                          <span className="text-sm font-bold text-white">Esqueci o Usuário</span>
                      </div>
                      <ChevronRight size={16} className="text-slate-500"/>
                  </button>
              </div>
          </Modal>
      )}

      {/* RENDERIZAÇÃO DO MODAL DE CONFIRMAÇÃO (CORREÇÃO DOS BOTÕES DE EXCLUIR/ARQUIVAR) */}
      {confirmation && (
          <Modal onClose={() => setConfirmation(null)} title={confirmation.title || "Confirmar Ação"}>
            <div className="space-y-4">
               <p className="text-slate-300">{confirmation.message || "Tem certeza que deseja prosseguir com esta ação? Esta operação pode ser irreversível."}</p>
               {confirmation.showRefundOption && (
                 <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center gap-3">
                   <input type="checkbox" checked={refundChecked} onChange={e => setRefundChecked(e.target.checked)} className="w-5 h-5 accent-blue-600"/>
                   <span className="text-sm text-slate-400">Estornar valor para a Fonte de Capital?</span>
                 </div>
               )}
               <div className="flex gap-3 mt-4">
                 <button onClick={() => setConfirmation(null)} className="flex-1 py-3 bg-slate-800 text-white rounded-xl font-bold uppercase text-xs">Cancelar</button>
                 <button onClick={executeConfirmation} className="flex-1 py-3 bg-rose-600 text-white rounded-xl font-bold uppercase text-xs shadow-lg">Confirmar</button>
               </div>
            </div>
          </Modal>
      )}

      {toast && <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[300] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top duration-300 ${toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>{toast.type === 'error' ? <AlertCircle size={20}/> : <CheckCircle2 size={20}/>}<p className="font-bold text-xs uppercase tracking-widest">{toast.msg}</p></div>}

      {/* Inputs ocultos de upload precisam existir em TODAS as abas para que os botões funcionem */}
      <input
        ref={promissoriaFileInputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={handlePromissoriaFileSelected}
      />
      <input
        ref={extraDocFileInputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={handleExtraDocFileSelected}
      />
    </div>
  );
};
export default App;
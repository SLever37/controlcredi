import React, { useState, useEffect, useRef } from 'react';
import { Loan, LoanStatus, PaymentMethod, Client, CapitalSource, Installment } from '../types';
import { Camera, X, Users, Wallet, MapPin, ShieldCheck, FileText, CheckCircle2, Search, Loader2, CalendarClock, ArrowDownCircle } from 'lucide-react';

interface LoanFormProps {
  onAdd: (loan: Loan) => void;
  onCancel: () => void;
  initialData?: Loan | null;
  clients: Client[];
  sources: CapitalSource[];
}

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

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try { return crypto.randomUUID(); } catch (e) {}
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

export const LoanForm: React.FC<LoanFormProps> = ({ onAdd, onCancel, initialData, clients, sources }) => {
  const defaultDate = new Date();
  defaultDate.setHours(12, 0, 0, 0);
  const defaultDateStr = defaultDate.toISOString().split('T')[0];

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    clientId: '',
    debtorName: '',
    debtorPhone: '',
    debtorDocument: '',
    debtorAddress: '',
    sourceId: sources[0]?.id || '',
    preferredPaymentMethod: 'PIX' as PaymentMethod,
    pixKey: '',
    principal: '',
    interestRate: '30',
    finePercent: '2', 
    dailyInterestPercent: '1',
    months: '1', // Agora representa "Prazo" (dias ou meses)
    billingCycle: 'MONTHLY' as 'MONTHLY' | 'DAILY',
    amortizationType: 'PRICE' as 'PRICE' | 'BULLET',
    notes: '',
    guaranteeDescription: '',
    startDate: defaultDateStr
  });

  const [attachments, setAttachments] = useState<string[]>([]);
  const [documentPhotos, setDocumentPhotos] = useState<string[]>([]);
  const [showCamera, setShowCamera] = useState<{ active: boolean, type: 'guarantee' | 'document' }>({ active: false, type: 'guarantee' });
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (initialData) {
      setFormData({
        clientId: initialData.clientId,
        debtorName: initialData.debtorName,
        debtorPhone: maskPhone(initialData.debtorPhone || ''),
        debtorDocument: maskDocument(initialData.debtorDocument || ''),
        debtorAddress: initialData.debtorAddress || '',
        sourceId: initialData.sourceId,
        preferredPaymentMethod: initialData.preferredPaymentMethod || 'PIX',
        pixKey: initialData.pixKey || '',
        principal: initialData.principal.toString(),
        interestRate: initialData.interestRate.toString(),
        finePercent: (initialData.finePercent || 2).toString(),
        dailyInterestPercent: (initialData.dailyInterestPercent || 1).toString(),
        months: initialData.installments.length.toString(),
        billingCycle: initialData.billingCycle || 'MONTHLY',
        amortizationType: initialData.amortizationType || 'PRICE',
        notes: initialData.notes,
        guaranteeDescription: initialData.guaranteeDescription || '',
        startDate: initialData.startDate.includes('T') ? initialData.startDate.split('T')[0] : initialData.startDate
      });
      setAttachments(initialData.attachments || []);
      setDocumentPhotos(initialData.documentPhotos || []);
    }
  }, [initialData]);

  const handleClientSelect = (id: string) => {
    if (!id) { setFormData({ ...formData, clientId: '' }); return; }
    const client = clients.find(c => c.id === id);
    if (client) {
      setFormData({
        ...formData,
        clientId: client.id,
        debtorName: client.name,
        debtorPhone: maskPhone(client.phone),
        debtorDocument: maskDocument(client.document),
        debtorAddress: client.address || ''
      });
    }
  };

  const startCamera = async (type: 'guarantee' | 'document') => {
    setShowCamera({ active: true, type });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Câmera indisponível. Verifique as permissões do navegador.");
      setShowCamera({ active: false, type });
    }
  };

  const takePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
      const photo = canvas.toDataURL('image/jpeg');
      if (showCamera.type === 'guarantee') setAttachments([...attachments, photo]);
      else setDocumentPhotos([...documentPhotos, photo]);
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    stream?.getTracks().forEach(t => t.stop());
    setShowCamera({ ...showCamera, active: false });
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
          setFormData(prev => ({ ...prev, debtorName: name || prev.debtorName, debtorPhone: clean ? maskPhone(clean) : prev.debtorPhone }));
        }
      } catch (ex) {}
    } else { alert("Importação de contatos disponível apenas em dispositivos Android via Chrome."); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        if (!formData.debtorName || !formData.debtorPhone) { alert("Preencha ao menos Nome e Telefone do devedor."); return; }
        const principal = parseFloat(formData.principal);
        if (isNaN(principal) || principal <= 0) { alert("O valor Principal deve ser maior que zero."); return; }
        const periodCount = parseInt(formData.months);
        if (isNaN(periodCount) || periodCount <= 0) { alert("O prazo deve ser maior que zero."); return; }

        if (formData.sourceId) {
            const selectedSource = sources.find(s => s.id === formData.sourceId);
            if (!initialData && selectedSource && principal > selectedSource.balance) {
                if(!window.confirm(`AVISO: A fonte ${selectedSource.name} tem saldo de R$ ${selectedSource.balance.toLocaleString()}. O saldo ficará negativo. Deseja continuar?`)) return;
            }
        }

        setIsSubmitting(true);

        const rate = parseFloat(formData.interestRate);
        let totalInterest = 0;
        let totalToReceive = 0;
        
        // --- LÓGICA DE CÁLCULO INTELIGENTE ---
        // Se Diário: Rate é considerado "Taxa Total do Período" (Ex: 30% em 10 dias)
        // Se Mensal: Rate é "Taxa Mensal"
        
        if (formData.billingCycle === 'DAILY') {
             // Juros simples totais para o período
             totalInterest = principal * (rate / 100);
             totalToReceive = principal + totalInterest;
        } else {
             // Mensal (Price Simples)
             totalInterest = principal * (rate / 100) * periodCount;
             totalToReceive = principal + totalInterest;
        }

        const [year, month, day] = formData.startDate.split('-').map(Number);
        const baseDate = new Date(year, month - 1, day, 12, 0, 0);

        const installments: Installment[] = [];

        if (formData.billingCycle === 'DAILY') {
            // --- CÁLCULO DIÁRIO ---
            if (formData.amortizationType === 'PRICE') {
                // Caminho A: Quitação Total (Parcelas Iguais)
                // Divide Tudo pelos dias
                const dailyAmount = totalToReceive / periodCount;
                const dailyPrincipal = principal / periodCount;
                const dailyInterest = totalInterest / periodCount;

                for (let i = 0; i < periodCount; i++) {
                    const dueDate = new Date(baseDate);
                    dueDate.setDate(dueDate.getDate() + (i + 1));
                    installments.push({
                        id: generateId(),
                        dueDate: dueDate.toISOString(),
                        amount: parseFloat(dailyAmount.toFixed(2)),
                        scheduledPrincipal: parseFloat(dailyPrincipal.toFixed(2)),
                        scheduledInterest: parseFloat(dailyInterest.toFixed(2)),
                        principalRemaining: parseFloat(dailyPrincipal.toFixed(2)),
                        interestRemaining: parseFloat(dailyInterest.toFixed(2)),
                        lateFeeAccrued: 0, avApplied: 0, paidPrincipal: 0, paidInterest: 0, paidLateFee: 0, paidTotal: 0, status: LoanStatus.PENDING, logs: []
                    });
                }
            } else {
                // Caminho B: Giro de Juros (Bullet)
                // Paga juro diário, Principal no final
                const dailyInterest = totalInterest / periodCount;
                
                for (let i = 0; i < periodCount; i++) {
                    const dueDate = new Date(baseDate);
                    dueDate.setDate(dueDate.getDate() + (i + 1));
                    const isLast = i === periodCount - 1;
                    
                    const scheduledPrincipal = isLast ? principal : 0;
                    const amount = dailyInterest + scheduledPrincipal;

                    installments.push({
                        id: generateId(),
                        dueDate: dueDate.toISOString(),
                        amount: parseFloat(amount.toFixed(2)),
                        scheduledPrincipal: parseFloat(scheduledPrincipal.toFixed(2)),
                        scheduledInterest: parseFloat(dailyInterest.toFixed(2)),
                        principalRemaining: parseFloat(scheduledPrincipal.toFixed(2)),
                        interestRemaining: parseFloat(dailyInterest.toFixed(2)),
                        lateFeeAccrued: 0, avApplied: 0, paidPrincipal: 0, paidInterest: 0, paidLateFee: 0, paidTotal: 0, status: LoanStatus.PENDING, logs: []
                    });
                }
            }
        } else {
            // --- CÁLCULO MENSAL (Existente) ---
            const principalPerInst = principal / periodCount;
            const interestPerInst = totalInterest / periodCount;
            
            for (let i = 0; i < periodCount; i++) {
                const dueDate = new Date(baseDate);
                dueDate.setDate(dueDate.getDate() + ((i + 1) * 30));
                
                // Correção de centavos no último
                const isLast = i === periodCount - 1;
                // Simplificação: Manter parcelas iguais para Monthly Price por enquanto
                const amount = principalPerInst + interestPerInst;

                installments.push({
                    id: generateId(),
                    dueDate: dueDate.toISOString(),
                    amount: parseFloat(amount.toFixed(2)),
                    scheduledPrincipal: parseFloat(principalPerInst.toFixed(2)),
                    scheduledInterest: parseFloat(interestPerInst.toFixed(2)),
                    principalRemaining: parseFloat(principalPerInst.toFixed(2)),
                    interestRemaining: parseFloat(interestPerInst.toFixed(2)),
                    lateFeeAccrued: 0, avApplied: 0, paidPrincipal: 0, paidInterest: 0, paidLateFee: 0, paidTotal: 0, status: LoanStatus.PENDING, logs: []
                });
            }
        }

        await onAdd({
          id: initialData?.id || generateId(),
          clientId: formData.clientId, 
          debtorName: formData.debtorName,
          debtorPhone: formData.debtorPhone,
          debtorDocument: formData.debtorDocument,
          debtorAddress: formData.debtorAddress,
          sourceId: formData.sourceId, 
          preferredPaymentMethod: formData.preferredPaymentMethod,
          pixKey: formData.pixKey,
          principal,
          interestRate: rate,
          finePercent: parseFloat(formData.finePercent),
          dailyInterestPercent: parseFloat(formData.dailyInterestPercent),
          billingCycle: formData.billingCycle,
          amortizationType: formData.amortizationType,
          policiesSnapshot: { interestRate: rate, finePercent: parseFloat(formData.finePercent), dailyInterestPercent: parseFloat(formData.dailyInterestPercent) },
          startDate: formData.startDate, 
          installments,
          totalToReceive,
          ledger: initialData?.ledger || [],
          paymentSignals: initialData?.paymentSignals || [],
          notes: formData.notes,
          guaranteeDescription: formData.guaranteeDescription,
          attachments,
          documentPhotos,
          isArchived: initialData?.isArchived || false
        });
        setIsSubmitting(false);
    } catch (error: any) {
        console.error("Erro interno no formulário:", error);
        alert("Ocorreu um erro ao processar o contrato.");
        setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md flex items-start md:items-center justify-center z-[100] p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-[2rem] sm:rounded-[3rem] w-full max-w-6xl p-5 sm:p-12 shadow-2xl my-4 md:my-auto animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-6 sm:mb-10">
            <h2 className="text-xl sm:text-3xl font-black text-white tracking-tighter uppercase leading-none">
              {initialData ? 'Ajustar Contrato' : 'Novo Contrato'}
            </h2>
            <button onClick={() => { if(showCamera.active) stopCamera(); onCancel(); }} className="p-2 sm:p-3 bg-slate-800 text-slate-500 hover:text-white rounded-full transition-colors">
              <X size={20}/>
            </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-10">
            
            {/* COLUNA 1: CLIENTE */}
            <div className="space-y-4 sm:space-y-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-500 flex items-center gap-2"><Users className="w-4 h-4" /> Devedor</h3>
              <div className="space-y-4">
                <select value={formData.clientId} onChange={e => handleClientSelect(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white outline-none focus:ring-1 focus:ring-blue-500 transition-all text-sm">
                  <option value="">-- Novo Cliente --</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input required type="text" value={formData.debtorName} onChange={e => setFormData({...formData, debtorName: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm focus:border-blue-500 outline-none" placeholder="Nome Completo" />
                <div className="flex gap-2">
                  <input required type="tel" value={formData.debtorPhone} onChange={e => setFormData({...formData, debtorPhone: maskPhone(e.target.value)})} className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm focus:border-blue-500 outline-none" placeholder="WhatsApp" />
                  <button type="button" onClick={handlePickContact} className="px-4 bg-slate-950 border border-slate-800 rounded-2xl text-slate-400 hover:text-emerald-500"><Search className="w-5 h-5" /></button>
                </div>
                <input type="text" value={formData.debtorDocument} onChange={e => setFormData({...formData, debtorDocument: maskDocument(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white text-sm focus:border-blue-500 outline-none" placeholder="CPF/CNPJ" />
              </div>
            </div>

            {/* COLUNA 2: FINANCEIRO */}
            <div className="space-y-4 sm:space-y-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-purple-500 flex items-center gap-2"><Wallet className="w-4 h-4" /> Financeiro</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setFormData({...formData, billingCycle: 'MONTHLY'})} className={`p-3 rounded-xl border text-[10px] font-black uppercase transition-all ${formData.billingCycle === 'MONTHLY' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>Mensal</button>
                    <button type="button" onClick={() => setFormData({...formData, billingCycle: 'DAILY'})} className={`p-3 rounded-xl border text-[10px] font-black uppercase transition-all ${formData.billingCycle === 'DAILY' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>Diário</button>
                </div>

                {formData.billingCycle === 'DAILY' && (
                    <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
                        <label className="text-[9px] text-slate-500 font-black uppercase">Estratégia Diária</label>
                        <select value={formData.amortizationType} onChange={e => setFormData({...formData, amortizationType: e.target.value as any})} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs outline-none">
                            <option value="PRICE">Caminho A: Quitação Total (Parcelas Iguais)</option>
                            <option value="BULLET">Caminho B: Giro de Juros (Principal no Final)</option>
                        </select>
                        <p className="text-[9px] text-slate-500 italic px-1">
                            {formData.amortizationType === 'PRICE' ? 'Divide Capital + Juros pelos dias.' : 'Cobra apenas juros por dia. Capital fica pro final.'}
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 font-black uppercase ml-2">Principal</label>
                    <input required type="number" step="0.01" value={formData.principal} onChange={e => setFormData({...formData,principal: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 font-black uppercase ml-2">{formData.billingCycle === 'DAILY' ? 'Taxa Total (%)' : 'Juros % AM'}</label>
                    <input required type="number" step="0.01" value={formData.interestRate} onChange={e => setFormData({...formData, interestRate: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 font-black uppercase ml-2">Início</label>
                      <input required type="date" value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm" />
                  </div>
                  <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 font-black uppercase ml-2">{formData.billingCycle === 'DAILY' ? 'Dias' : 'Meses'}</label>
                      <input required type="number" value={formData.months} onChange={e => setFormData({...formData, months: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white" />
                  </div>
                </div>
                <select value={formData.sourceId} onChange={e => setFormData({...formData, sourceId: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm">
                  {sources.map(s => <option key={s.id} value={s.id}>{s.name} (R$ {s.balance.toLocaleString()})</option>)}
                </select>
              </div>
            </div>

            {/* COLUNA 3: GARANTIAS */}
            <div className="space-y-4 sm:space-y-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-500 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Garantias</h3>
              <div className="space-y-4">
                <textarea placeholder="Descrição da garantia..." value={formData.guaranteeDescription} onChange={e => setFormData({...formData, guaranteeDescription: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white min-h-[100px] text-xs resize-none" />
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => startCamera('guarantee')} className="flex flex-col items-center justify-center gap-2 bg-slate-800 border border-slate-700 p-4 rounded-3xl text-[9px] font-black uppercase text-slate-400 hover:text-white border-dashed"><Camera className="w-5 h-5 text-emerald-500" /> Foto Garantia</button>
                  <button type="button" onClick={() => startCamera('document')} className="flex flex-col items-center justify-center gap-2 bg-slate-800 border border-slate-700 p-4 rounded-3xl text-[9px] font-black uppercase text-slate-400 hover:text-white border-dashed"><FileText className="w-5 h-5 text-blue-500" /> Foto Documento</button>
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
                  {[...attachments, ...documentPhotos].map((img, i) => (<div key={i} className="relative w-14 h-14 rounded-xl border border-slate-700 overflow-hidden flex-shrink-0 shadow-lg"><img src={img} className="w-full h-full object-cover" /></div>))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button type="submit" disabled={isSubmitting} className="w-full py-5 sm:py-6 bg-blue-600 text-white rounded-[2rem] font-black uppercase tracking-widest hover:bg-blue-500 shadow-2xl shadow-blue-600/30 active:scale-95 transition-all flex items-center justify-center gap-3 text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {isSubmitting ? <Loader2 className="animate-spin" /> : <><CheckCircle2 size={20}/> {initialData ? 'Salvar Alterações' : 'Emitir Contrato'}</>}
            </button>
          </div>
        </form>
      </div>
      {showCamera.active && (
        <div className="fixed inset-0 z-[110] bg-slate-950 flex flex-col items-center justify-center p-6">
          <div className="mb-6 text-white text-[10px] font-black uppercase tracking-[0.3em] bg-blue-600 px-6 py-2 rounded-full">MODO CAPTURA</div>
          <video ref={videoRef} autoPlay playsInline className="w-full max-w-2xl h-auto border-4 border-slate-900 rounded-[2rem] shadow-2xl shadow-blue-900/20" />
          <div className="mt-8 sm:mt-12 flex gap-10">
            <button onClick={stopCamera} className="p-6 bg-slate-800 rounded-full text-slate-400 hover:text-white hover:bg-rose-600 transition-all shadow-xl"><X size={28}/></button>
            <button onClick={takePhoto} className="p-10 bg-white rounded-full text-black shadow-2xl shadow-white/10 active:scale-90 transition-transform"><Camera size={36}/></button>
          </div>
        </div>
      )}
    </div>
  );
};
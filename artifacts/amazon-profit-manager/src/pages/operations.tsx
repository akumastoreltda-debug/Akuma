import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Check, ChevronRight, Eye, EyeOff, FileUp, Plus, RefreshCw, Truck, UploadCloud } from "lucide-react";
import { getGetDashboardSummaryQueryKey, getListAlertsQueryKey, getListSuppliersQueryKey, useCreateSupplier, useListAlerts, useListSuppliers, useUpdateAlert } from "@workspace/api-client-react";
import { AppShell, Button, Card, EmptyState, ErrorState, PageHeading, Skeleton } from "@/components/app-shell";
import { useToast } from "@/hooks/use-toast";

export function Suppliers() {
  const query=useListSuppliers(); const create=useCreateSupplier(); const client=useQueryClient(); const [show,setShow]=useState(false);
  return <AppShell><PageHeading eyebrow="Parceiros" title="Fornecedores" description="Prazos e relacionamento que impactam o seu estoque." action={<Button onClick={()=>setShow(true)} data-testid="button-new-supplier"><Plus size={15}/> Novo fornecedor</Button>}/>{query.isLoading?<Card className="p-6"><Skeleton className="h-32 w-full"/></Card>:query.isError?<ErrorState retry={()=>query.refetch()}/>:<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{(query.data||[]).map(s=><Card key={s.id} className="p-5 transition-transform duration-200 hover:-translate-y-0.5"><div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary font-bold text-primary">{s.name.slice(0,2).toUpperCase()}</div><span className="rounded-full bg-muted px-2 py-1 font-mono text-[9px] text-muted-foreground">{s.productsCount} SKUs</span></div><h3 className="mt-5 text-sm font-bold">{s.name}</h3><p className="mt-1 text-xs text-muted-foreground">{s.cnpj || "CNPJ não informado"}</p><div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4"><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Truck size={14}/> Entrega em {s.deliveryDays} dias</span><span className="font-mono text-[10px] text-primary">{s.email || "Sem e-mail"}</span></div></Card>)}{!query.data?.length&&<div className="md:col-span-2 xl:col-span-3"><Card><EmptyState title="Nenhum fornecedor cadastrado" text="Organize prazos e custos para calcular reposições com mais segurança." action={<Button onClick={()=>setShow(true)}><Plus size={14}/> Adicionar fornecedor</Button>}/></Card></div>}</div>}{show&&<SupplierDialog create={create} onClose={()=>setShow(false)} onSuccess={()=>{setShow(false);client.invalidateQueries({queryKey:getListSuppliersQueryKey()})}}/>}</AppShell>;
}
function SupplierDialog({create,onClose,onSuccess}:{create:any;onClose:()=>void;onSuccess:()=>void}) { const [name,setName]=useState(""); const [days,setDays]=useState("7"); const [email,setEmail]=useState(""); const submit=(e:FormEvent)=>{e.preventDefault();if(!name)return;create.mutate({data:{name,deliveryDays:Number(days),email:email||null}},{onSuccess})};return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#142033]/45 sm:items-center sm:p-5"><form onSubmit={submit} className="w-full max-w-md rounded-t-2xl bg-card p-6 sm:rounded-2xl"><p className="font-mono text-[10px] uppercase tracking-widest text-primary">Novo parceiro</p><h2 className="mt-1 text-xl font-bold">Cadastrar fornecedor</h2><div className="mt-6 space-y-4"><label className="block text-xs font-semibold">Nome<input required value={name} onChange={e=>setName(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-supplier-name"/></label><label className="block text-xs font-semibold">Prazo médio de entrega (dias)<input type="number" value={days} onChange={e=>setDays(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-supplier-days"/></label><label className="block text-xs font-semibold">E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-supplier-email"/></label></div><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={create.isPending}>{create.isPending?"Salvando...":"Salvar fornecedor"}</Button></div></form></div>; }

function formatAcknowledgedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function Alerts() {
  const query = useListAlerts();
  const updateAlert = useUpdateAlert();
  const client = useQueryClient();
  const { toast } = useToast();
  const handleToggleRead = (id: string, read: boolean) => {
    updateAlert.mutate({
      id,
      data: { read },
    }, {
      onSuccess: () => {
        toast({ title: read ? "Alerta marcado como lido" : "Alerta marcado como não lido" });
      },
      onError: () => toast({
        title: "Erro",
        description: "Não foi possível atualizar o alerta.",
        variant: "destructive",
      }),
      onSettled: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: getListAlertsQueryKey() }),
          client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
        ]);
      },
    });
  };

  return (
    <AppShell>
      <PageHeading
        eyebrow="Central de controle"
        title="Alertas"
        description="Sinais da sua operação que merecem contexto e ação."
        action={<Button variant="secondary" onClick={() => query.refetch()}><RefreshCw size={14} /> Atualizar</Button>}
      />
      {query.isLoading ? (
        <Card className="space-y-3 p-6"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></Card>
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : (
        <Card className="overflow-hidden">
          {(query.data || []).map((alert) => {
            const acknowledgedAt = alert.read ? formatAcknowledgedAt(alert.acknowledgedAt) : null;
            return (
              <div key={alert.id} className={`flex gap-4 border-b border-border/60 p-5 last:border-0 ${alert.read ? "bg-muted/20" : "bg-card"}`}>
                <div className={`mt-0.5 rounded-lg p-2 ${alert.severity === "danger" ? "bg-[#f5ddda] text-[#b33e31]" : alert.severity === "warning" ? "bg-[#f9edcb] text-[#977018]" : "bg-secondary text-primary"}`}>
                  {alert.severity === "danger" ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`text-sm font-bold ${alert.read ? "text-muted-foreground" : ""}`}>{alert.title}</p>
                    <span className="font-mono text-[9px] text-muted-foreground">{new Date(alert.createdAt).toLocaleDateString("pt-BR")}</span>
                  </div>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{alert.message}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      variant="ghost"
                      className="px-2.5 py-2"
                      onClick={() => handleToggleRead(alert.id, !alert.read)}
                      disabled={updateAlert.isPending}
                      aria-label={alert.read ? "Marcar alerta como não lido" : "Marcar alerta como lido"}
                      aria-pressed={alert.read}
                    >
                      {alert.read ? <><EyeOff size={14} /> Marcar como não lido</> : <><Eye size={14} /> Marcar como lido</>}
                    </Button>
                    {alert.read && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                        <Check size={12} /> Tratado{acknowledgedAt ? ` em ${acknowledgedAt}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                {!alert.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Alerta não lido" />}
              </div>
            );
          })}
          {!query.data?.length && <EmptyState title="Tudo em dia" text="Nenhum alerta foi gerado para os filtros atuais." />}
        </Card>
      )}
    </AppShell>
  );
}

const pageData:Record<string,{eyebrow:string;title:string;description:string;icon:any;body:string}> = {
 purchases:{eyebrow:"Capital",title:"Compras",description:"Lotes recebidos, custo médio e impacto no caixa.",icon:Truck,body:"Registre ou importe seus lotes para acompanhar a evolução do custo médio."},
 cash:{eyebrow:"Financeiro",title:"Fluxo de caixa",description:"Entradas, saídas e caixa projetado para a operação.",icon:CashIcon,body:"Importe suas movimentações para montar uma visão honesta do caixa disponível."},
 expenses:{eyebrow:"Financeiro",title:"Despesas",description:"Custos operacionais que pressionam sua margem.",icon:ReceiptIcon,body:"Nenhuma despesa registrada. Comece adicionando custos fixos e variáveis da sua operação."},
 reports:{eyebrow:"Inteligência",title:"Relatórios",description:"Análises para uma decisão mais segura.",icon:ChartIcon,body:"Seus rankings e análises ganham vida quando houver histórico de vendas e custos."},
 settings:{eyebrow:"Conta",title:"Configurações",description:"Preferências da operação e da conta.",icon:SettingsIcon,body:"As configurações da sua operação aparecerão aqui conforme forem disponibilizadas."},
};
function PackageIcon(){return <span className="text-primary">▧</span>} function ChartIcon(){return <span className="text-primary">↗</span>} function CashIcon(){return <span className="text-primary">◌</span>} function ReceiptIcon(){return <span className="text-primary">▤</span>} function SettingsIcon(){return <span className="text-primary">⊙</span>}
export function GenericPage({kind}:{kind:keyof typeof pageData}) { const d=pageData[kind]; const Icon=d.icon; return <AppShell><PageHeading eyebrow={d.eyebrow} title={d.title} description={d.description}/><div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><Card><EmptyState title={kind==="inventory"?"Acompanhe cada dia de cobertura":"Dados aguardando sua operação"} text={d.body} action={kind==="inventory"?<Link href="/products" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground" data-testid={`link-${kind}-products`}>Ver produtos <ChevronRight size={14}/></Link>:<Link href="/import" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground" data-testid={`link-${kind}-import`}>Importar dados <UploadCloud size={14}/></Link>}/></Card><Card className="p-6"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-lg"><Icon/></div><h3 className="mt-5 text-sm font-bold">Próximo passo</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">Comece pela importação manual para transformar seus números em decisões.</p><Link href="/import" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-primary" data-testid={`link-${kind}-next`}>Ir para importação <ArrowUpRight size={14}/></Link></Card></div></AppShell>; }
export function ImportPage(){ const [file,setFile]=useState<File|null>(null); return <AppShell><PageHeading eyebrow="Entrada de dados" title="Importar dados" description="Traga vendas, compras e despesas para dentro da sua operação."/><div className="grid gap-5 lg:grid-cols-[1fr_.72fr]"><Card className="p-6"><div className="rounded-xl border-2 border-dashed border-primary/25 bg-primary/[.03] p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-primary"><FileUp size={22}/></div><h2 className="mt-5 text-base font-bold">Solte um arquivo CSV ou XLSX</h2><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">Aceitamos os arquivos exportados da Central do Vendedor. Seus dados só entram após sua confirmação.</p><label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground" data-testid="label-upload-file"><UploadCloud size={15}/> {file?file.name:"Escolher arquivo"}<input type="file" accept=".csv,.xlsx" className="hidden" onChange={e=>setFile(e.target.files?.[0]||null)} data-testid="input-upload-file"/></label></div>{file&&<div className="mt-4 flex items-center justify-between rounded-lg bg-secondary p-3 text-xs"><span className="font-semibold">{file.name}</span><Button variant="ghost" onClick={()=>setFile(null)}>Remover</Button></div>}</Card><Card className="p-6"><h3 className="text-sm font-bold">Como funciona</h3><ol className="mt-5 space-y-5">{["Exporte o relatório na Central do Vendedor.","Escolha o arquivo no formato CSV ou XLSX.","Revise o resumo antes de confirmar a importação."].map((t,i)=><li key={t} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[10px] font-bold text-primary">0{i+1}</span><p className="text-xs leading-5 text-muted-foreground">{t}</p></li>)}</ol><Button className="mt-7 w-full" disabled={!file} data-testid="button-confirm-import">Continuar com revisão <ChevronRight size={14}/></Button></Card></div></AppShell>; }
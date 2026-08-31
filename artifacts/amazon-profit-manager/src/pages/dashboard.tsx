import * as React from "react";
import { ArrowUpRight, CalendarDays, ChevronRight, CircleAlert, DollarSign, PackageOpen, Percent, RefreshCw, TrendingUp } from "lucide-react";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { AppShell, Button, Card, EmptyState, ErrorState, PageHeading, Skeleton } from "@/components/app-shell";

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const tone = (v: string) => v === "negative" ? "text-[#c64e3d]" : v === "warning" ? "text-[#b88216]" : v === "positive" ? "text-[#2a866b]" : "text-muted-foreground";

type AlertsSchemaErrorPayload = {
  code: "ALERTS_SCHEMA_UNAVAILABLE" | "ALERTS_SCHEMA_INCOMPLETE";
  error?: string;
  missingTables: string[];
  missingFunctions: string[];
};

function getAlertsSchemaError(error: unknown): AlertsSchemaErrorPayload | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = error.data;
  if (!data || typeof data !== "object" || !("code" in data)) return null;
  const code = data.code;
  if (code !== "ALERTS_SCHEMA_UNAVAILABLE" && code !== "ALERTS_SCHEMA_INCOMPLETE") return null;
  return {
    code,
    error: "error" in data && typeof data.error === "string" ? data.error : undefined,
    missingTables: "missingTables" in data && Array.isArray(data.missingTables)
      ? data.missingTables.filter((value): value is string => typeof value === "string")
      : [],
    missingFunctions: "missingFunctions" in data && Array.isArray(data.missingFunctions)
      ? data.missingFunctions.filter((value): value is string => typeof value === "string")
      : [],
  };
}

function DashboardSkeleton() { return <AppShell><PageHeading title="Visão geral" description="Carregando os números da sua operação..." /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map(i=><Card key={i} className="h-32 p-5"><Skeleton className="h-3 w-24" /><Skeleton className="mt-5 h-7 w-32" /></Card>)}</div><div className="mt-5 grid gap-5 lg:grid-cols-[1.5fr_1fr]"><Card className="h-80 p-6"><Skeleton className="h-4 w-44" /></Card><Card className="h-80 p-6"><Skeleton className="h-4 w-32" /></Card></div></AppShell>; }

export default function Dashboard() {
  const query = useGetDashboardSummary();
  if (query.isLoading) return <DashboardSkeleton />;
  if (query.isError) {
    const alertsSchemaError = getAlertsSchemaError(query.error);
    const alertsSchemaIncomplete = alertsSchemaError?.code === "ALERTS_SCHEMA_INCOMPLETE";
    return <AppShell><PageHeading title="Visão geral" description="Não conseguimos atualizar os dados agora." /><ErrorState
      retry={() => query.refetch()}
      title={alertsSchemaError ? "A central de alertas está indisponível." : undefined}
      text={alertsSchemaIncomplete ? alertsSchemaError?.error : undefined}
    /></AppShell>;
  }
  const data = query.data;
  if (!data) return <AppShell><PageHeading title="Visão geral" /><Card><EmptyState title="Sua visão financeira começa aqui" text="Assim que houver dados de vendas, este espaço mostra faturamento, lucro e os próximos movimentos." action={<Button onClick={() => query.refetch()} variant="secondary"><RefreshCw size={14} /> Atualizar</Button>} /></Card></AppShell>;
  const max = Math.max(...(data.chart || []).map(p => p.revenue), 1);
  return <AppShell><PageHeading eyebrow="Quarta-feira, 18 de junho" title="Visão geral" description="O que merece sua atenção hoje, Loja Aurora." action={<Button variant="secondary"><CalendarDays size={15} /> Junho de 2025</Button>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{(data.metrics || []).slice(0,4).map((metric, i) => { const Icon = [DollarSign, TrendingUp, Percent, PackageOpen][i] || DollarSign; return <Card key={metric.label} className="animate-enter p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-muted-foreground">{metric.label}</p><p className="mt-3 text-2xl font-bold tracking-[-.04em] tabular">{metric.value}</p></div><div className={`rounded-lg bg-muted p-2 ${tone(metric.tone)}`}><Icon size={17} /></div></div><p className={`mt-3 flex items-center gap-1 text-[11px] font-semibold ${tone(metric.tone)}`}>{metric.change}<ArrowUpRight size={12} /></p></Card>; })}</div>
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.5fr_1fr]"><Card className="animate-enter-delay p-6"><div className="flex items-start justify-between"><div><p className="text-sm font-bold">Faturamento e lucro</p><p className="mt-1 text-xs text-muted-foreground">{data.periodLabel || "Período selecionado"}</p></div><div className="flex gap-4 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" /> Faturamento</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-accent" /> Lucro</span></div></div><div className="mt-8 flex h-48 items-end gap-2 border-b border-border/70 pl-1">{(data.chart || []).map((point, i) => <div key={point.label} className="group flex h-full flex-1 items-end gap-0.5" title={`${point.label}: ${money(point.revenue)}`}><div className="w-1/2 rounded-t-sm bg-primary/75 transition-all duration-300 group-hover:bg-primary" style={{height:`${Math.max(4,point.revenue/max*100)}%`}} /><div className="w-1/2 rounded-t-sm bg-accent transition-all duration-300 group-hover:brightness-95" style={{height:`${Math.max(4,point.profit/max*100)}%`}} /></div>)}</div><div className="mt-3 flex justify-between pl-1 font-mono text-[9px] text-muted-foreground">{(data.chart || []).filter((_,i)=>i%2===0).map(p=><span key={p.label}>{p.label}</span>)}</div></Card>
      <Card className="animate-enter-delay p-6"><div className="flex items-start justify-between"><div><p className="text-sm font-bold">Atenção hoje</p><p className="mt-1 text-xs text-muted-foreground">Sinais que pedem uma decisão</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-amber-500/10 px-2 py-1 font-mono text-[10px] font-bold text-amber-700 dark:text-amber-400">{data.unreadAlertsCount} não lidos</span><CircleAlert size={18} className="text-[#b88216]" /></div></div><div className="mt-5 space-y-1">{(data.recentAlerts || []).slice(0,4).map(alert=><div key={alert.id} className={`flex gap-3 rounded-lg p-3 transition-colors hover:bg-muted ${alert.read?"opacity-60":""}`}><div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${alert.severity === "danger" ? "bg-[#c64e3d]" : alert.severity === "warning" ? "bg-[#d2a428]" : "bg-primary"}`} /><div className="min-w-0"><p className="text-xs font-semibold">{alert.title}</p><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{alert.message}</p></div></div>)}{!data.recentAlerts?.length && <p className="py-8 text-center text-xs text-muted-foreground">Nenhum alerta no período.</p>}</div><Button variant="ghost" className="mt-3 w-full justify-between" onClick={() => window.location.assign("/alerts")}>Ver central de alertas <ChevronRight size={14} /></Button></Card></div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-border/70 px-6 py-4"><div><p className="text-sm font-bold">Produtos que mais vendem</p><p className="mt-1 text-xs text-muted-foreground">Receita no período</p></div><Button variant="ghost" onClick={() => window.location.assign("/sales")}>Ver análise <ChevronRight size={14} /></Button></div><Ranking rows={data.productSales} type="revenue" /></Card><Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-border/70 px-6 py-4"><div><p className="text-sm font-bold">Mais rentáveis</p><p className="mt-1 text-xs text-muted-foreground">Lucro por produto</p></div><Button variant="ghost" onClick={() => window.location.assign("/reports")}>Ver ranking <ChevronRight size={14} /></Button></div><Ranking rows={data.mostProfitable} type="profit" /></Card></div>
  </AppShell>;
}
function Ranking({ rows = [], type }: { rows?: any[]; type: "revenue" | "profit" }) { return <div className="divide-y divide-border/60">{rows.slice(0,5).map((row, i)=><div className="flex items-center gap-3 px-6 py-3.5" key={row.sku || i}><span className="font-mono text-[10px] text-muted-foreground">0{i+1}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{row.productName}</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{row.sku} · {row.units} un.</p></div><div className="text-right"><p className="font-mono text-xs font-bold">{money(type === "revenue" ? row.revenue : row.profit)}</p><p className="mt-0.5 text-[10px] text-primary">{row.margin?.toFixed(1)}% margem</p></div></div>)}{!rows.length && <p className="p-8 text-center text-xs text-muted-foreground">Sem vendas para exibir.</p>}</div>; }
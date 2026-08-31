import * as React from "react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAmazonStatus,
  getGetAmazonStatusQueryKey,
  useTestAmazonConnection,
  useSyncAmazon,
  useSyncAmazonType,
  useListAmazonSyncRuns,
  useListAmazonConnectionTests,
  getListAmazonConnectionTestsQueryKey,
  useGetAmazonOwnerTransfer,
  getGetAmazonOwnerTransferQueryKey,
  useTransferAmazonOwner,
  useListAmazonOwnerTransferAudit,
  getListAmazonOwnerTransferAuditQueryKey,
  exportAmazonOwnerTransferAudit,
  useGetAmazonAlertSettings,
  getGetAmazonAlertSettingsQueryKey,
  useUpdateAmazonAlertSettings,
  useListAmazonModuleAlerts,
  getListAmazonModuleAlertsQueryKey,
  getListAlertsQueryKey,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AppShell, PageHeading, Card, Button, Skeleton, ErrorState, EmptyState } from "@/components/app-shell";
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, KeyRound, PlugZap, Play, Activity, Clock, Box, ShoppingCart, DollarSign, BellRing, Save, Settings2, ShieldCheck, ArrowRight, Download
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AmazonSchemaIssueCard } from "@/components/amazon-schema-issue";
import { nextAmazonSchemaIssue, type AmazonSchemaIssue } from "@/lib/amazon-schema";
import { refreshAmazonSyncQueries } from "@/lib/amazon-sync-refresh";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function AmazonConnection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const statusQuery = useGetAmazonStatus();
  const historyQuery = useListAmazonSyncRuns();
  const testHistoryQuery = useListAmazonConnectionTests();
  const moduleAlertsQuery = useListAmazonModuleAlerts();
  const alertSettingsQuery = useGetAmazonAlertSettings();
  const ownerTransferQuery = useGetAmazonOwnerTransfer();
  const ownerTransferAuditQuery = useListAmazonOwnerTransferAudit({
    query: {
      queryKey: getListAmazonOwnerTransferAuditQueryKey(),
      enabled: ownerTransferQuery.data?.isAdmin === true,
    },
  });
  
  const testMutation = useTestAmazonConnection();
  const syncFullMutation = useSyncAmazon();
  const syncTypeMutation = useSyncAmazonType();
  const updateAlertSettingsMutation = useUpdateAmazonAlertSettings();
  const ownerTransferMutation = useTransferAmazonOwner();
  const [alertSettingsForm, setAlertSettingsForm] = useState({
    sampleWindow: 3,
    failureThreshold: 2,
    latencyThresholdMs: 5000,
    enabled: true,
    notificationChannel: null as 'slack' | 'discord' | 'microsoft_teams' | 'webhook' | null,
    notificationDestination: "",
  });
  const [lastResult, setLastResult] = useState<{
    status: string;
    totals: { orders: number; finances: number; inventory: number };
    error?: string | null;
  } | null>(null);
  const [schemaIssue, setSchemaIssue] = useState<AmazonSchemaIssue | null>(null);
  const [transferForm, setTransferForm] = useState({
    newOwnerClerkId: "",
    reason: "",
  });
  const [transferConfirmationOpen, setTransferConfirmationOpen] = useState(false);
  const [isExportingAudit, setIsExportingAudit] = useState(false);

  useEffect(() => {
    if (alertSettingsQuery.data) {
      setAlertSettingsForm(current => ({
        ...current,
        ...alertSettingsQuery.data,
        notificationDestination: "",
      }));
    }
  }, [alertSettingsQuery.data]);

  const handleTest = () => {
    testMutation.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetAmazonStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAmazonConnectionTestsQueryKey() });
         queryClient.invalidateQueries({ queryKey: getListAmazonModuleAlertsQueryKey() });
         queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        if (data.success) {
          toast({ title: "Conexão bem-sucedida", description: data.message });
        } else {
          toast({ title: "Falha na conexão", description: data.message, variant: "destructive" });
        }
      },
      onError: () => toast({ title: "Erro", description: "Não foi possível testar a conexão.", variant: "destructive" })
    });
  };

  const handleSaveAlertSettings = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (alertSettingsForm.failureThreshold > alertSettingsForm.sampleWindow) {
      toast({
        title: "Configuração inválida",
        description: "O limiar de falhas não pode ser maior que a janela de amostras.",
        variant: "destructive",
      });
      return;
    }
    updateAlertSettingsMutation.mutate({
      data: {
        ...alertSettingsForm,
        notificationDestination: alertSettingsForm.notificationDestination.trim() || undefined,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAmazonAlertSettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAmazonModuleAlertsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        toast({ title: "Alertas atualizados", description: "Os novos limiares serão aplicados ao próximo teste de conexão." });
      },
      onError: () => toast({ title: "Erro", description: "Não foi possível salvar as configurações de alertas.", variant: "destructive" }),
    });
  };

  const handlePrepareOwnerTransfer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ownerTransferQuery.data?.currentOwnerClerkId) {
      toast({
        title: "Proprietário não disponível",
        description: "Atualize a página e confirme o proprietário atual antes de continuar.",
        variant: "destructive",
      });
      return;
    }
    if (!transferForm.newOwnerClerkId.trim() || transferForm.newOwnerClerkId.trim() === ownerTransferQuery.data.currentOwnerClerkId) {
      toast({
        title: "Novo proprietário inválido",
        description: "Informe um Clerk ID diferente do proprietário atual.",
        variant: "destructive",
      });
      return;
    }
    if (transferForm.reason.trim().length < 10) {
      toast({
        title: "Motivo obrigatório",
        description: "Descreva o motivo da troca com pelo menos 10 caracteres.",
        variant: "destructive",
      });
      return;
    }
    setTransferConfirmationOpen(true);
  };

  const handleConfirmOwnerTransfer = () => {
    const currentOwnerClerkId = ownerTransferQuery.data?.currentOwnerClerkId;
    if (!currentOwnerClerkId) return;
    ownerTransferMutation.mutate({
      data: {
        currentOwnerClerkId,
        newOwnerClerkId: transferForm.newOwnerClerkId.trim(),
        reason: transferForm.reason.trim(),
      },
    }, {
      onSuccess: (data) => {
        setTransferConfirmationOpen(false);
        setTransferForm({ newOwnerClerkId: "", reason: "" });
        queryClient.invalidateQueries({ queryKey: getGetAmazonOwnerTransferQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAmazonOwnerTransferAuditQueryKey() });
        void refreshAmazonSyncQueries(queryClient);
        queryClient.invalidateQueries({ queryKey: getListAmazonConnectionTestsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAmazonModuleAlertsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAmazonAlertSettingsQueryKey() });
        toast({
          title: "Proprietário Amazon atualizado",
          description: `A transferência para ${data.newOwnerClerkId} foi registrada com auditoria.`,
        });
      },
      onError: () => {
        toast({
          title: "Transferência não concluída",
          description: "O proprietário pode ter mudado ou o destino já pode conter dados. Atualize e tente novamente.",
          variant: "destructive",
        });
      },
    });
  };

  const handleExportAudit = async () => {
    setIsExportingAudit(true);
    try {
      const csv = await exportAmazonOwnerTransferAudit({ responseType: "blob" });
      const url = URL.createObjectURL(csv);
      const link = document.createElement("a");
      link.href = url;
      link.download = `amazon-owner-transfer-audit-${format(new Date(), "yyyy-MM-dd")}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Histórico exportado",
        description: "O CSV contém os eventos administrativos exibidos e a data de geração.",
      });
    } catch {
      toast({
        title: "Exportação não concluída",
        description: "Não foi possível gerar o histórico administrativo.",
        variant: "destructive",
      });
    } finally {
      setIsExportingAudit(false);
    }
  };

  const invalidateAfterSync = () => {
    void refreshAmazonSyncQueries(queryClient);
  };

  const handleSyncFull = () => {
    syncFullMutation.mutate({ data: {} }, {
      onSuccess: (data) => {
        setSchemaIssue(nextAmazonSchemaIssue({ type: "success" }));
        setLastResult(data);
        toast({
          title: data.status === "completed" ? "Sincronização concluída" : data.status === "partial" ? "Sincronização parcial" : "Sincronização não concluída",
          description: data.error || `${data.totals.orders} pedidos, ${data.totals.finances} eventos financeiros e ${data.totals.inventory} itens de estoque processados.`,
          variant: data.status === "failed" ? "destructive" : "default"
        });
        invalidateAfterSync();
      },
      onError: (error) => {
        const issue = nextAmazonSchemaIssue({ type: "error", error });
        setSchemaIssue(issue);
        toast({
          title: issue
            ? issue.code === "AMAZON_SCHEMA_INCOMPLETE"
              ? "Schema Amazon incompleto"
              : "Schema do Supabase indisponível"
            : "Erro",
          description: issue?.message ?? "Falha ao iniciar sincronização.",
          variant: "destructive",
        });
      }
    });
  };

  const handleSyncType = (type: 'orders' | 'finances' | 'inventory') => {
    syncTypeMutation.mutate({ type, data: {} }, {
      onSuccess: (data) => {
        setSchemaIssue(nextAmazonSchemaIssue({ type: "success" }));
        setLastResult(data);
        toast({
          title: data.status === "completed" ? "Sincronização concluída" : "Sincronização com pendências",
          description: data.error || `${data.totals[type]} registros processados.`,
          variant: data.status === "failed" ? "destructive" : "default"
        });
        invalidateAfterSync();
      },
      onError: (error) => {
        const issue = nextAmazonSchemaIssue({ type: "error", error });
        setSchemaIssue(issue);
        toast({
          title: issue
            ? issue.code === "AMAZON_SCHEMA_INCOMPLETE"
              ? "Schema Amazon incompleto"
              : "Schema do Supabase indisponível"
            : "Erro",
          description: issue?.message ?? "Falha ao iniciar sincronização.",
          variant: "destructive",
        });
      }
    });
  };

  const isSyncing = syncFullMutation.isPending || syncTypeMutation.isPending;

  return (
    <AppShell>
      <PageHeading 
        eyebrow="Integração" 
        title="Conexão Amazon" 
        description="Gerencie a comunicação com a Selling Partner API e mantenha vendas e estoque em sincronia."
        action={
          <Button variant="secondary" onClick={() => {
            statusQuery.refetch();
            historyQuery.refetch();
            testHistoryQuery.refetch();
            moduleAlertsQuery.refetch();
            alertSettingsQuery.refetch();
          }}>
            <RefreshCw size={14} className={statusQuery.isFetching || historyQuery.isFetching || testHistoryQuery.isFetching || moduleAlertsQuery.isFetching || alertSettingsQuery.isFetching ? "animate-spin" : ""} /> Atualizar
          </Button>
        }
      />
      
      {statusQuery.isLoading ? (
        <Card className="p-6 mb-6"><Skeleton className="h-40 w-full" /></Card>
      ) : statusQuery.isError ? (
        <div className="mb-6"><ErrorState retry={() => statusQuery.refetch()} /></div>
      ) : statusQuery.data ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px] mb-6">
          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className={`mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                statusQuery.data.connectionStatus === 'connected' ? 'bg-primary/10 text-primary' :
                statusQuery.data.connectionStatus === 'invalid' ? 'bg-destructive/10 text-destructive' :
                'bg-muted text-muted-foreground'
              }`}>
                {statusQuery.data.connectionStatus === 'connected' ? <CheckCircle2 size={24} /> :
                 statusQuery.data.connectionStatus === 'invalid' ? <XCircle size={24} /> :
                 <PlugZap size={24} />}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold">
                  {statusQuery.data.connectionStatus === 'connected' ? 'Conectado à Amazon' :
                   statusQuery.data.connectionStatus === 'invalid' ? 'Credenciais Inválidas' :
                   'Não Configurado'}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusQuery.data.connectionStatus === 'connected' ? 
                    `Sua conta está conectada ao marketplace ${statusQuery.data.marketplaceName || 'Brasil'}.` :
                   statusQuery.data.connectionStatus === 'invalid' ?
                    'As chaves fornecidas não têm acesso à SP-API ou expiraram.' :
                    'Configure as três credenciais LWA na Replit para iniciar a sincronização.'}
                </p>
                
                {statusQuery.data.missingSecrets && statusQuery.data.missingSecrets.length > 0 && (
                  <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                    <div className="flex items-center gap-2 font-semibold text-destructive mb-2">
                      <KeyRound size={16} /> Segredos Ausentes (Environment Variables)
                    </div>
                    <ul className="list-inside list-disc pl-4 text-xs text-destructive/80 space-y-1">
                      {statusQuery.data.missingSecrets.map(s => <li key={s} className="font-mono">{s}</li>)}
                    </ul>
                  </div>
                )}
                {statusQuery.data.lastError && (
                  <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
                      <AlertTriangle size={15} /> Último erro
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{statusQuery.data.lastError}</p>
                  </div>
                )}
                
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button onClick={handleTest} disabled={testMutation.isPending || !statusQuery.data.configured} variant="secondary">
                    {testMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />} 
                    Testar Conexão
                  </Button>
                </div>
              </div>
            </div>
            
            {statusQuery.data.connectionStatus === 'connected' && (
              <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-border pt-6">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Marketplace ID</p>
                  <p className="font-mono text-sm">{statusQuery.data.marketplaceId || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Último Teste</p>
                  <p className="text-sm">{statusQuery.data.lastTestAt ? format(new Date(statusQuery.data.lastTestAt), "dd/MM/yyyy HH:mm", { locale: ptBR }) : '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Última Sincronização</p>
                  <p className="text-sm">{statusQuery.data.lastSyncAt ? format(new Date(statusQuery.data.lastSyncAt), "dd/MM/yyyy HH:mm", { locale: ptBR }) : '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Status</p>
                  <p className="text-sm capitalize">{statusQuery.data.connectionStatus}</p>
                </div>
              </div>
            )}
          </Card>
          
          <Card className="p-6">
            <h3 className="text-sm font-bold flex items-center gap-2 mb-4"><RefreshCw size={16} className="text-primary" /> Sincronização</h3>
            <p className="text-xs text-muted-foreground mb-6">Inicie a extração de dados da Amazon sob demanda.</p>
            
            <div className="space-y-3">
              <Button 
                onClick={handleSyncFull} 
                disabled={isSyncing || statusQuery.data.connectionStatus !== 'connected'} 
                className="w-full justify-between"
              >
                <span>Sincronização Completa</span> <Play size={14} />
              </Button>
              <Button 
                onClick={() => handleSyncType('orders')} 
                disabled={isSyncing || statusQuery.data.connectionStatus !== 'connected'} 
                variant="secondary" 
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2"><ShoppingCart size={14} /> Vendas</span> <Play size={14} />
              </Button>
              <Button 
                onClick={() => handleSyncType('inventory')} 
                disabled={isSyncing || statusQuery.data.connectionStatus !== 'connected'} 
                variant="secondary" 
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2"><Box size={14} /> Estoque FBA</span> <Play size={14} />
              </Button>
              <Button 
                onClick={() => handleSyncType('finances')} 
                disabled={isSyncing || statusQuery.data.connectionStatus !== 'connected'} 
                variant="secondary" 
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2"><DollarSign size={14} /> Financeiro</span> <Play size={14} />
              </Button>
            </div>
            {isSyncing && (
              <div className="mt-5 rounded-xl bg-primary/5 p-4 text-xs text-primary">
                <div className="flex items-center gap-2 font-semibold">
                  <RefreshCw size={14} className="animate-spin" /> Sincronização em andamento
                </div>
                <p className="mt-1 text-muted-foreground">Aguarde enquanto os dados são processados em sequência.</p>
              </div>
            )}
            {lastResult && !isSyncing && (
              <div className={`mt-5 rounded-xl border p-4 text-xs ${lastResult.status === "completed" ? "border-primary/20 bg-primary/5" : "border-amber-500/25 bg-amber-500/5"}`}>
                <p className="font-semibold">Último resultado: {lastResult.status === "completed" ? "concluído" : lastResult.status === "partial" ? "parcial" : lastResult.status}</p>
                <p className="mt-1 text-muted-foreground">Pedidos {lastResult.totals.orders} · Finanças {lastResult.totals.finances} · Estoque {lastResult.totals.inventory}</p>
                {lastResult.error && <p className="mt-2 text-destructive">{lastResult.error}</p>}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {schemaIssue && <AmazonSchemaIssueCard issue={schemaIssue} />}

      {ownerTransferQuery.data?.isAdmin && (
        <Card className="mt-8 border-amber-500/30 bg-amber-500/[0.03] p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold">Transferência administrativa</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                Use somente para uma troca autorizada de conta. Todos os dados da operação Amazon serão movidos juntos e o motivo ficará registrado para auditoria.
              </p>
            </div>
          </div>
          <form className="mt-5 space-y-4" onSubmit={handlePrepareOwnerTransfer}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold">
                Proprietário atual
                <input
                  value={ownerTransferQuery.data.currentOwnerClerkId ?? ""}
                  readOnly
                  className="mt-1.5 h-10 w-full rounded-lg border border-input bg-muted/50 px-3 font-mono text-xs text-muted-foreground"
                />
              </label>
              <label className="text-xs font-semibold">
                Novo proprietário (Clerk ID)
                <input
                  value={transferForm.newOwnerClerkId}
                  onChange={event => setTransferForm(current => ({ ...current, newOwnerClerkId: event.target.value }))}
                  placeholder="user_..."
                  maxLength={255}
                  required
                  className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs"
                />
              </label>
            </div>
            <label className="block text-xs font-semibold">
              Motivo da troca
              <textarea
                value={transferForm.reason}
                onChange={event => setTransferForm(current => ({ ...current, reason: event.target.value }))}
                placeholder="Ex.: substituição autorizada do usuário proprietário"
                minLength={10}
                maxLength={1000}
                required
                rows={3}
                className="mt-1.5 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <p className="text-[10px] leading-4 text-muted-foreground">
              A autorização é verificada no servidor. Usuários comuns não podem iniciar esta operação, mesmo que tentem chamar a API diretamente.
            </p>
            <Button type="submit" variant="danger" disabled={ownerTransferMutation.isPending || !ownerTransferQuery.data.currentOwnerClerkId}>
              <ShieldCheck size={14} /> Revisar transferência
            </Button>
          </form>
          <div className="mt-8 border-t border-amber-500/20 pt-6">
              <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-sm font-bold">Histórico de transferências</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  As 20 trocas administrativas mais recentes, em ordem cronológica reversa.
                </p>
              </div>
               <div className="flex items-center gap-3">
                 <Button
                   variant="secondary"
                   onClick={handleExportAudit}
                   disabled={isExportingAudit}
                   className="shrink-0"
                 >
                   <Download size={14} /> {isExportingAudit ? "Gerando..." : "Baixar CSV"}
                 </Button>
                 <Clock size={17} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
               </div>
            </div>
            {ownerTransferAuditQuery.isLoading ? (
              <div className="mt-5 space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : ownerTransferAuditQuery.isError ? (
              <div className="mt-5">
                <ErrorState retry={() => ownerTransferAuditQuery.refetch()} />
              </div>
            ) : ownerTransferAuditQuery.data && ownerTransferAuditQuery.data.length > 0 ? (
              <div className="mt-5 overflow-x-auto rounded-lg border border-border/70 bg-card">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 font-semibold text-muted-foreground">Data</th>
                      <th className="px-4 py-3 font-semibold text-muted-foreground">Autorizado por</th>
                      <th className="px-4 py-3 font-semibold text-muted-foreground">Transferência</th>
                      <th className="px-4 py-3 font-semibold text-muted-foreground">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ownerTransferAuditQuery.data.map(event => (
                      <tr key={event.id} className="align-top transition-colors hover:bg-muted/30">
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {format(new Date(event.transferredAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </td>
                        <td className="px-4 py-3 font-mono text-[10px]">{event.actorClerkId}</td>
                        <td className="px-4 py-3 font-mono text-[10px]">
                          <span>{event.previousOwnerClerkId}</span>
                          <ArrowRight size={12} className="mx-1 inline text-muted-foreground" />
                          <span>{event.newOwnerClerkId}</span>
                        </td>
                        <td className="max-w-[280px] px-4 py-3 leading-5 text-muted-foreground">{event.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                Nenhuma transferência administrativa foi registrada.
              </div>
            )}
          </div>
        </Card>
      )}

      <AlertDialog open={transferConfirmationOpen} onOpenChange={setTransferConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar transferência do proprietário?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação moverá o tenant Amazon de <strong>{ownerTransferQuery.data?.currentOwnerClerkId}</strong> para <strong>{transferForm.newOwnerClerkId.trim()}</strong>. Ela não pode ser iniciada por usuários comuns e será registrada com o motivo informado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg bg-muted/60 p-3 text-xs leading-5">
            <span className="font-semibold">Motivo:</span> {transferForm.reason.trim()}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ownerTransferMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmOwnerTransfer} disabled={ownerTransferMutation.isPending}>
              {ownerTransferMutation.isPending ? "Transferindo..." : <>Confirmar transferência <ArrowRight size={14} /></>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2"><BellRing size={18} className="text-amber-600" /> Alertas dos módulos</h3>
              <p className="mt-1 text-xs text-muted-foreground">A equipe é avisada quando uma piora persiste na janela configurada.</p>
            </div>
            <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              {moduleAlertsQuery.data?.length ?? 0} ativos
            </span>
          </div>
          {moduleAlertsQuery.isLoading ? (
            <div className="mt-5 space-y-3"><Skeleton className="h-20 w-full" /></div>
          ) : moduleAlertsQuery.isError ? (
            <div className="mt-5"><ErrorState retry={() => moduleAlertsQuery.refetch()} /></div>
          ) : moduleAlertsQuery.data && moduleAlertsQuery.data.length > 0 ? (
            <div className="mt-5 space-y-3">
              {moduleAlertsQuery.data.map(alert => {
                const labels = { orders: "Pedidos", finances: "Finanças", inventory: "Estoque" };
                const categoryLabels: Record<string, string> = {
                  authorization: "autorização",
                  signature: "assinatura",
                  throttling: "throttling",
                  configuration: "configuração",
                  payload: "payload",
                  availability: "disponibilidade",
                  latency: "latência",
                  unknown: "não classificado",
                };
                return (
                  <div key={alert.module} className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-destructive"><AlertTriangle size={15} /> {labels[alert.module]} degradado</div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      Categoria: <strong className="text-foreground">{categoryLabels[alert.failureCategory]}</strong> · Latência observada: <strong className="font-mono text-foreground">{alert.observedLatencyMs} ms</strong>
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{alert.degradedSamples} de {alert.sampleWindow} amostras acima do limiar.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={handleTest}><RefreshCw size={13} /> Testar novamente</Button>
                      <a href="/alerts" className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold text-primary hover:bg-primary/10">Abrir central de alertas</a>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-6 rounded-xl bg-secondary/60 p-4 text-xs text-muted-foreground">Nenhum módulo em degradação persistente. Execute um teste para atualizar esta leitura.</p>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold flex items-center gap-2"><Settings2 size={18} className="text-primary" /> Sensibilidade dos alertas</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Ajuste quantas amostras precisam indicar uma piora antes de avisar a equipe.</p>
          {alertSettingsQuery.isLoading ? (
            <div className="mt-5 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : (
            <form className="mt-5 space-y-4" onSubmit={handleSaveAlertSettings}>
              <label className="flex items-center gap-3 rounded-lg border border-border/70 p-3 text-xs font-semibold">
                <input type="checkbox" checked={alertSettingsForm.enabled} onChange={event => setAlertSettingsForm(current => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 accent-primary" />
                Ativar alertas de degradação
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold">Janela de amostras
                  <input type="number" min={1} max={20} value={alertSettingsForm.sampleWindow} onChange={event => setAlertSettingsForm(current => ({ ...current, sampleWindow: Number(event.target.value) }))} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                </label>
                <label className="text-xs font-semibold">Amostras para alertar
                  <input type="number" min={1} max={alertSettingsForm.sampleWindow} value={alertSettingsForm.failureThreshold} onChange={event => setAlertSettingsForm(current => ({ ...current, failureThreshold: Number(event.target.value) }))} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                </label>
                <label className="text-xs font-semibold">Latência máxima (ms)
                  <input type="number" min={100} max={600000} step={100} value={alertSettingsForm.latencyThresholdMs} onChange={event => setAlertSettingsForm(current => ({ ...current, latencyThresholdMs: Number(event.target.value) }))} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                </label>
              </div>
              <div className="rounded-xl border border-border/70 bg-secondary/30 p-4">
                <div className="flex items-start gap-3">
                  <BellRing size={16} className="mt-0.5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Aviso fora do painel</p>
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      Receba apenas módulo, categoria, amostras e latência quando uma degradação começar. O destino salvo fica protegido e nunca é exibido novamente.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold">
                    Canal externo
                    <select
                      value={alertSettingsForm.notificationChannel ?? ""}
                      onChange={event => setAlertSettingsForm(current => ({
                        ...current,
                        notificationChannel: (event.target.value || null) as typeof current.notificationChannel,
                      }))}
                      className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Não enviar fora do painel</option>
                      <option value="slack">Slack</option>
                      <option value="discord">Discord</option>
                      <option value="microsoft_teams">Microsoft Teams</option>
                      <option value="webhook">Webhook compatível</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold">
                    URL de destino protegida
                    <input
                      type="password"
                      value={alertSettingsForm.notificationDestination}
                      onChange={event => setAlertSettingsForm(current => ({ ...current, notificationDestination: event.target.value }))}
                      placeholder={alertSettingsQuery.data?.notificationConfigured ? "Destino protegido — informe apenas para substituir" : "https://..."}
                      disabled={!alertSettingsForm.notificationChannel}
                      className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                </div>
                {alertSettingsQuery.data?.notificationConfigured && (
                  <p className="mt-2 text-[10px] text-muted-foreground">Já existe um destino protegido para este canal. Deixe a URL vazia para mantê-lo.</p>
                )}
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">Um módulo precisa ter o número configurado de amostras degradadas dentro da janela para gerar um alerta. Falhas e latências acima do limite contam como degradação.</p>
              <Button type="submit" disabled={updateAlertSettingsMutation.isPending}><Save size={14} /> {updateAlertSettingsMutation.isPending ? "Salvando..." : "Salvar limiares"}</Button>
            </form>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-bold mb-4">Histórico de disponibilidade</h3>
        {testHistoryQuery.isLoading ? (
          <Card className="p-6"><Skeleton className="h-32 w-full" /></Card>
        ) : testHistoryQuery.isError ? (
          <ErrorState retry={() => testHistoryQuery.refetch()} />
        ) : testHistoryQuery.data && testHistoryQuery.data.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Execução</th>
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Resultado</th>
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Pedidos</th>
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Finanças</th>
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Estoque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {testHistoryQuery.data.map(test => (
                    <tr key={test.id} className="transition-colors hover:bg-muted/30 align-top">
                      <td className="px-5 py-3 text-muted-foreground">
                        <p>{format(new Date(test.testedAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                        <p className="mt-1 font-mono text-[10px]">{(test.durationMs / 1000).toFixed(1)}s total</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          test.success ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                        }`}>
                          {test.success ? 'Disponível' : 'Falha'}
                        </span>
                      </td>
                      {(['orders', 'finances', 'inventory'] as const).map(type => {
                        const check = test.checks.find(item => item.type === type);
                        const categoryLabels: Record<string, string> = {
                          authorization: 'autorização',
                          signature: 'assinatura',
                          throttling: 'throttling',
                          configuration: 'configuração',
                          payload: 'payload',
                          availability: 'disponibilidade',
                           latency: 'latência',
                          unknown: 'não classificado',
                        };
                        const labels = { orders: 'Pedidos', finances: 'Finanças', inventory: 'Estoque' };
                        return (
                          <td key={type} className="px-5 py-3 min-w-[150px]">
                            {check ? (
                              <>
                                <div className={`flex items-center gap-2 font-medium ${check.status === 'completed' ? 'text-primary' : 'text-destructive'}`}>
                                  {check.status === 'completed' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                                  {labels[type]}
                                  <span className="font-mono text-[10px] text-muted-foreground">{check.durationMs}ms</span>
                                </div>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {check.status === 'completed'
                                    ? `${check.count} registro${check.count === 1 ? '' : 's'}`
                                    : categoryLabels[check.errorCategory ?? 'unknown']}
                                </p>
                                {check.status === 'failed' && check.error && (
                                  <p className="mt-1 max-w-[190px] truncate text-[10px] text-destructive" title={check.error}>{check.error}</p>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sem leitura</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card>
            <EmptyState
              title="Nenhum teste de disponibilidade"
              text="Execute o teste de conexão para começar a acompanhar os módulos."
            />
          </Card>
        )}
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-bold mb-4">Histórico de Sincronizações</h3>
        {historyQuery.isLoading ? (
          <Card className="p-6"><Skeleton className="h-40 w-full" /></Card>
        ) : historyQuery.isError ? (
          <ErrorState retry={() => historyQuery.refetch()} />
        ) : historyQuery.data && historyQuery.data.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Módulo</th>
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Status</th>
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Início</th>
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Duração</th>
                    <th className="px-5 py-3 font-semibold text-muted-foreground">Módulos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historyQuery.data.map(run => (
                    <tr key={run.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium capitalize flex items-center gap-2">
                        {run.syncType === 'full' && <RefreshCw size={14} className="text-primary" />}
                        {run.syncType === 'orders' && <ShoppingCart size={14} className="text-chart-2" />}
                        {run.syncType === 'inventory' && <Box size={14} className="text-chart-3" />}
                        {run.syncType === 'finances' && <DollarSign size={14} className="text-chart-4" />}
                        {run.syncType === 'full' ? 'Completa' : run.syncType}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          run.status === 'completed' ? 'bg-primary/10 text-primary' :
                          run.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                          run.status === 'partial' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {run.status === 'completed' ? 'Sucesso' : run.status === 'failed' ? 'Falha' : run.status === 'partial' ? 'Parcial' : run.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {format(new Date(run.startedAt), "dd/MM HH:mm", { locale: ptBR })}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground font-mono text-xs">
                        {run.durationMs > 0 ? `${(run.durationMs / 1000).toFixed(1)}s` : '-'}
                      </td>
                      <td className="px-5 py-3">
                        {run.steps.length > 0 ? (
                          <div className="space-y-1.5">
                            {run.steps.map(step => {
                              const labels = { orders: 'Pedidos', finances: 'Finanças', inventory: 'Estoque' };
                              const categoryLabels: Record<string, string> = {
                                authorization: 'autorização',
                                signature: 'assinatura',
                                throttling: 'throttling',
                                configuration: 'configuração',
                                payload: 'payload',
                                availability: 'disponibilidade',
                                 latency: 'latência',
                                unknown: 'não classificado',
                              };
                              return (
                                <div key={step.type} className="min-w-[180px]">
                                  <div className={`flex items-center gap-1.5 text-xs font-medium ${step.status === 'completed' ? 'text-primary' : step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    {step.status === 'completed' ? <CheckCircle2 size={13} /> : step.status === 'failed' ? <XCircle size={13} /> : <AlertTriangle size={13} />}
                                    {labels[step.type]}
                                    <span className="font-mono text-[10px] text-muted-foreground">{step.durationMs}ms</span>
                                  </div>
                                  <p className="ml-5 text-[10px] text-muted-foreground">
                                    {step.status === 'completed'
                                      ? `${step.count} registro${step.count === 1 ? '' : 's'}`
                                      : step.status === 'failed'
                                        ? categoryLabels[step.errorCategory ?? 'unknown']
                                        : 'não executado'}
                                  </p>
                                  {step.status === 'failed' && step.error && (
                                    <p className="ml-5 max-w-[220px] truncate text-[10px] text-destructive" title={step.error}>{step.error}</p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex gap-2 text-xs text-muted-foreground">
                            <span title="Pedidos">P: {run.counts.orders}</span>
                            <span title="Estoque">E: {run.counts.inventory}</span>
                            <span title="Finanças">F: {run.counts.finances}</span>
                          </div>
                        )}
                        {run.error && (
                          <p className="mt-1 text-[10px] text-destructive max-w-xs truncate" title={run.error}>
                            {run.error}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card>
            <EmptyState 
              title="Nenhuma sincronização" 
              text="Você ainda não sincronizou dados da Amazon." 
            />
          </Card>
        )}
      </div>
    </AppShell>
  );
}

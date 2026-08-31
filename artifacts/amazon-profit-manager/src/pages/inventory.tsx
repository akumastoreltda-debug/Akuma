import * as React from "react";
import { useState } from "react";
import { useListInventory, ListInventoryRisk } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AppShell, PageHeading, Card, Button, Skeleton, ErrorState, EmptyState } from "@/components/app-shell";
import { Search, PackageSearch, AlertTriangle, CheckCircle2, Info } from "lucide-react";

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [risk, setRisk] = useState<ListInventoryRisk>("all");

  const query = useListInventory({ 
    search: debouncedSearch || undefined, 
    risk: risk !== "all" ? risk : undefined 
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedSearch(search);
  };

  const inventory = query.data || [];

  const totalAvailable = inventory.reduce((acc, i) => acc + i.available, 0);
  const totalReserved = inventory.reduce((acc, i) => acc + i.reserved, 0);
  const totalInbound = inventory.reduce((acc, i) => acc + i.inbound, 0);
  
  const riskCount = inventory.filter(i => i.status === 'attention').length;
  const healthyCount = inventory.filter(i => i.status === 'healthy').length;

  return (
    <AppShell>
      <PageHeading 
        eyebrow="Estoque" 
        title="Estoque FBA e Cobertura" 
        description="Acompanhe o que está disponível na Amazon e saiba exatamente quando repor para não quebrar estoque."
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Disponível FBA</h3>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <PackageSearch size={14} />
            </div>
          </div>
          <p className="mt-4 text-2xl font-bold">{totalAvailable}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reservado / Trânsito</h3>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <span className="text-xs font-bold">{totalReserved + totalInbound}</span>
            </div>
          </div>
          <p className="mt-4 text-2xl font-bold">{totalReserved} <span className="text-sm font-normal text-muted-foreground">/ {totalInbound}</span></p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">SKUs Saudáveis</h3>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CheckCircle2 size={14} />
            </div>
          </div>
          <p className="mt-4 text-2xl font-bold text-primary">{healthyCount}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Risco de Ruptura</h3>
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${riskCount > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
              <AlertTriangle size={14} />
            </div>
          </div>
          <p className={`mt-4 text-2xl font-bold ${riskCount > 0 ? 'text-destructive' : ''}`}>{riskCount}</p>
        </Card>
      </div>

      <Card className="mb-6 p-4">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input 
              type="text" 
              placeholder="Buscar SKU ou produto..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex gap-2">
            <select 
              value={risk}
              onChange={(e) => setRisk(e.target.value as ListInventoryRisk)}
              className="h-10 px-3 pr-8 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none"
            >
              <option value="all">Todos os Status</option>
              <option value="healthy">Saudável</option>
              <option value="attention">Atenção</option>
              <option value="unknown">Desconhecido</option>
            </select>
            <Button type="submit">Filtrar</Button>
            {(debouncedSearch || risk !== 'all') && (
              <Button type="button" variant="ghost" onClick={() => {
                setSearch(""); setDebouncedSearch(""); setRisk("all");
              }}>Limpar</Button>
            )}
          </div>
        </form>
      </Card>

      {query.isLoading ? (
        <Card className="p-6"><Skeleton className="h-64 w-full" /></Card>
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : inventory.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-3 font-semibold text-muted-foreground">Produto / SKU</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Disponível</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Reservado</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Em Trânsito</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Total FBA</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Cobertura</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground">Status</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Sincronizado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inventory.map(item => (
                  <tr key={item.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-5 py-3 max-w-[250px]">
                      <div className="truncate font-medium" title={item.productName}>{item.productName}</div>
                      <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{item.sku} {item.asin ? `• ${item.asin}` : ''}</div>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-primary">
                      {item.available}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground">
                      {item.reserved}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground">
                      {item.inbound}
                    </td>
                    <td className="px-5 py-3 text-right font-bold">
                      {item.total}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {item.coverageDays > 0 ? (
                        <span className="font-mono text-xs">{item.coverageDays} dias</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        item.status === 'healthy' ? 'bg-primary/10 text-primary' :
                        item.status === 'attention' ? 'bg-destructive/10 text-destructive' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {item.status === 'healthy' ? 'Saudável' : 
                         item.status === 'attention' ? 'Atenção' : 'Desconhecido'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-[11px] text-muted-foreground font-mono">
                      {item.lastSyncedAt ? format(new Date(item.lastSyncedAt), "dd/MM HH:mm") : '-'}
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
            title="Nenhum item encontrado" 
            text="Não há registros de estoque para os filtros aplicados. Tente ajustar a busca." 
          />
        </Card>
      )}
    </AppShell>
  );
}

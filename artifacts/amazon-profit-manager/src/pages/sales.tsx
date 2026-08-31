import * as React from "react";
import { useState } from "react";
import { useListSales } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AppShell, PageHeading, Card, Button, Skeleton, ErrorState, EmptyState } from "@/components/app-shell";
import { Search, ShoppingCart, ArrowDownRight, ArrowUpRight } from "lucide-react";

export default function Sales() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = useListSales({ 
    search: debouncedSearch || undefined, 
    from: from || undefined, 
    to: to || undefined 
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedSearch(search);
  };

  const sales = query.data || [];
  
  const totalRevenue = sales.reduce((acc, s) => acc + s.revenueTotal, 0);
  const totalProfit = sales.reduce((acc, s) => acc + s.netProfit, 0);
  const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const totalUnits = sales.reduce((acc, s) => acc + s.quantity, 0);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  return (
    <AppShell>
      <PageHeading 
        eyebrow="Performance" 
        title="Vendas e Rentabilidade" 
        description="Acompanhe vendas reais da Amazon com cálculo exato de taxas, custos e lucro líquido."
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Receita Bruta</h3>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShoppingCart size={14} />
            </div>
          </div>
          <p className="mt-4 text-2xl font-bold">{formatCurrency(totalRevenue)}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lucro Líquido</h3>
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${totalProfit >= 0 ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
              {totalProfit >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            </div>
          </div>
          <p className={`mt-4 text-2xl font-bold ${totalProfit < 0 ? 'text-destructive' : ''}`}>{formatCurrency(totalProfit)}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Margem Média</h3>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary">
              <span className="text-xs font-bold">%</span>
            </div>
          </div>
          <p className="mt-4 text-2xl font-bold">{totalMargin.toFixed(1)}%</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Unidades Vendidas</h3>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <span className="text-xs font-bold">Q</span>
            </div>
          </div>
          <p className="mt-4 text-2xl font-bold">{totalUnits}</p>
        </Card>
      </div>

      <Card className="mb-6 p-4">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input 
              type="text" 
              placeholder="Buscar pedido, SKU ou produto..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex gap-2">
            <input 
              type="date" 
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-10 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              title="Data inicial"
            />
            <input 
              type="date" 
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-10 px-3 rounded-lg border border-input bg-background text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              title="Data final"
            />
            <Button type="submit">Filtrar</Button>
            {(debouncedSearch || from || to) && (
              <Button type="button" variant="ghost" onClick={() => {
                setSearch(""); setDebouncedSearch(""); setFrom(""); setTo("");
              }}>Limpar</Button>
            )}
          </div>
        </form>
      </Card>

      {query.isLoading ? (
        <Card className="p-6"><Skeleton className="h-64 w-full" /></Card>
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : sales.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-3 font-semibold text-muted-foreground">Data / Pedido</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground">Produto</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Qtd</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Receita</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Taxas (FBA+Com)</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">CMV</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Lucro Líquido</th>
                  <th className="px-5 py-3 font-semibold text-muted-foreground text-right">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sales.map(sale => (
                  <tr key={sale.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="font-medium">{format(new Date(sale.soldAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>
                      <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{sale.amazonOrderNumber}</div>
                    </td>
                    <td className="px-5 py-3 max-w-[200px]">
                      <div className="truncate font-medium" title={sale.productName}>{sale.productName}</div>
                      <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{sale.sku}</div>
                    </td>
                    <td className="px-5 py-3 text-right font-medium">
                      {sale.quantity}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {formatCurrency(sale.revenueTotal)}
                    </td>
                    <td className="px-5 py-3 text-right text-destructive/80">
                      -{formatCurrency(sale.fbaFee + sale.commission + sale.otherFees)}
                    </td>
                    <td className="px-5 py-3 text-right text-destructive/80">
                      -{formatCurrency(sale.productCost)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-semibold ${sale.netProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        {formatCurrency(sale.netProfit)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        sale.netMargin >= 15 ? 'bg-primary/10 text-primary' :
                        sale.netMargin > 0 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                        'bg-destructive/10 text-destructive'
                      }`}>
                        {sale.netMargin.toFixed(1)}%
                      </span>
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
            title="Nenhuma venda encontrada" 
            text="Não há registros de vendas para os filtros aplicados. Tente ajustar a busca ou período." 
          />
        </Card>
      )}
    </AppShell>
  );
}

import * as React from "react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { Bell, Boxes, ChevronDown, CircleDollarSign, FileBarChart2, LayoutDashboard, Menu, PackageSearch, ReceiptText, Settings, ShoppingCart, Store, Truck, Upload, X, PlugZap } from "lucide-react";
import { useListAlerts } from "@workspace/api-client-react";

const nav = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { href: "/products", label: "Produtos", icon: Boxes },
  { href: "/inventory", label: "Estoque", icon: PackageSearch },
  { href: "/sales", label: "Vendas e rentabilidade", icon: ShoppingCart },
  { href: "/purchases", label: "Compras", icon: Truck },
  { href: "/suppliers", label: "Fornecedores", icon: Store },
  { href: "/cash", label: "Fluxo de caixa", icon: CircleDollarSign },
  { href: "/expenses", label: "Despesas", icon: ReceiptText },
];
const secondary = [
  { href: "/amazon", label: "Conexão Amazon", icon: PlugZap },
  { href: "/import", label: "Importar dados", icon: Upload },
  { href: "/reports", label: "Relatórios", icon: FileBarChart2 },
  { href: "/alerts", label: "Alertas", icon: Bell },
  { href: "/settings", label: "Configurações", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const unreadAlertsQuery = useListAlerts({ unreadOnly: true });
  const initials = (user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0] || "M").toUpperCase();
  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[82px] items-center justify-between border-b border-sidebar-border px-6">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <img src="/logo.svg" alt="Margem Clara" className="h-9 w-auto" />
          </Link>
          <button onClick={() => setOpen(false)} className="text-sidebar-foreground/60 md:hidden" data-testid="button-close-menu"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-6">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/45">Operação</p>
          <nav className="space-y-1">
            {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${location === href ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm" : "text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} data-testid={`link-nav-${href.slice(1)}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></Link>)}
          </nav>
          <p className="px-3 pb-2 pt-8 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/45">Inteligência</p>
          <nav className="space-y-1">
            {secondary.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${location === href ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} data-testid={`link-nav-${href.slice(1)}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{href === "/alerts" && unreadAlertsQuery.data?.length ? <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#dd654d] px-1 text-[10px] font-bold text-white">{unreadAlertsQuery.data.length > 99 ? "99+" : unreadAlertsQuery.data.length}</span> : null}</Link>)}
          </nav>
        </div>
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/70 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8b83a] text-xs font-bold text-sidebar">{initials}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user?.firstName || "Minha conta"}</p><p className="truncate text-[10px] text-sidebar-foreground/50">Operação Brasil</p></div>
            <button onClick={() => signOut({ redirectUrl: "/" })} title="Sair" className="text-sidebar-foreground/45 hover:text-sidebar-foreground" data-testid="button-sign-out"><ChevronDown size={16} /></button>
          </div>
        </div>
      </aside>
      {open && <button onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-[#142033]/40 md:hidden" aria-label="Fechar menu" data-testid="button-overlay" />}
      <div className="md:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md md:px-9">
          <div className="flex items-center gap-3"><button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-muted md:hidden" data-testid="button-open-menu"><Menu size={20} /></button><div className="hidden text-[11px] text-muted-foreground sm:block">Quarta-feira, 18 de junho de 2025</div></div>
          <div className="flex items-center gap-3"><Link href="/alerts" className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" data-testid="link-header-alerts" aria-label={unreadAlertsQuery.data?.length ? `${unreadAlertsQuery.data.length} alertas não lidos` : "Alertas"}><Bell size={19} />{unreadAlertsQuery.data?.length ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[#d95b43] px-1 text-center font-mono text-[9px] font-bold leading-4 text-white">{unreadAlertsQuery.data.length > 99 ? "99+" : unreadAlertsQuery.data.length}</span> : null}</Link><div className="h-5 w-px bg-border" /><div className="hidden text-right sm:block"><p className="text-xs font-semibold">Loja Aurora</p><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Seller BR</p></div><div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{initials}</div></div>
        </header>
        <main className="paper-grid min-h-[calc(100dvh-70px)] px-5 py-7 md:px-9 md:py-9">{children}</main>
      </div>
    </div>
  );
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 font-mono text-[10px] uppercase tracking-[.2em] text-primary">{eyebrow || "Margem Clara"}</p><h1 className="text-[27px] font-bold tracking-[-.04em] text-foreground md:text-[32px]">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}</div>{action}</div>;
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = { primary: "bg-primary text-primary-foreground hover:brightness-110", secondary: "border border-border bg-card text-foreground hover:bg-muted", ghost: "text-muted-foreground hover:bg-muted hover:text-foreground", danger: "bg-destructive text-destructive-foreground hover:brightness-110" };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-semibold transition-all duration-200 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${props.className || ""}`}>{children}</button>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <section className={`rounded-xl border border-card-border bg-card shadow-[0_2px_12px_rgba(33,49,69,.035)] ${className}`}>{children}</section>; }
export function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-primary/40 bg-primary/5 text-primary"><Boxes size={20} /></div><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{text}</p>{action && <div className="mt-4">{action}</div>}</div>; }
export function ErrorState({ retry, title = "Não foi possível carregar estes dados.", text = "Verifique sua conexão e tente novamente." }: { retry: () => void; title?: string; text?: string }) { return <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-7 text-center"><p className="text-sm font-semibold text-destructive">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p><Button onClick={retry} variant="secondary" className="mt-4">Tentar novamente</Button></div>; }
export function Skeleton({ className = "" }: { className?: string }) { return <div className={`animate-pulse rounded-md bg-muted ${className}`} />; }
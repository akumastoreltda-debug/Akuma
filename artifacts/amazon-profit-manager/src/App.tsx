import { type ReactNode, useEffect, useRef } from "react";
import { ClerkProvider, Show, SignIn, SignUp, useAuth, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Products, { ProductDetail } from "@/pages/products";
import { GenericPage, ImportPage, Suppliers, Alerts } from "@/pages/operations";
import NotFound from "@/pages/not-found";
import AmazonConnection from "@/pages/amazon";
import Sales from "@/pages/sales";
import Inventory from "@/pages/inventory";

const queryClient = new QueryClient();
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path; }
if (!clerkPubKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: { logoPlacement: "inside" as const, logoLinkUrl: basePath || "/", logoImageUrl: `${window.location.origin}${basePath}/logo.svg`, socialButtonsPlacement: "top" as const },
  variables: { colorPrimary: "#2f735f", colorForeground: "#233449", colorMutedForeground: "#687482", colorDanger: "#c64e3d", colorBackground: "#fbfaf5", colorInput: "#fffefa", colorInputForeground: "#233449", colorNeutral: "#d9d4c8", fontFamily: "DM Sans, sans-serif", borderRadius: "0.65rem" },
  elements: {
    rootBox: "w-full flex justify-center", cardBox: "bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl", card: "!shadow-none !border-0 !bg-transparent !rounded-none", footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#233449] text-2xl font-bold tracking-tight", headerSubtitle: "text-[#687482]", socialButtonsBlockButtonText: "text-[#233449] font-semibold", formFieldLabel: "text-[#233449] font-semibold", footerActionLink: "text-[#2f735f] font-bold", footerActionText: "text-[#687482]", dividerText: "text-[#687482]", identityPreviewEditButton: "text-[#2f735f]", formFieldSuccessText: "text-[#2f735f]", alertText: "text-[#c64e3d]", logoBox: "mb-5", logoImage: "max-h-10", socialButtonsBlockButton: "border-[#d9d4c8] bg-[#fffefa] hover:bg-[#f1eee6]", formButtonPrimary: "bg-[#2f735f] hover:bg-[#255b4c] text-[#fbfaf5]", formFieldInput: "border-[#d9d4c8] bg-[#fffefa] text-[#233449]", footerAction: "border-t border-[#e5dfd2]", dividerLine: "bg-[#e5dfd2]", alert: "bg-[#f5ddda]", otpCodeFieldInput: "border-[#d9d4c8]", formFieldRow: "gap-2", main: "gap-5",
  },
};

function HomeRedirect() { const { isLoaded, isSignedIn } = useAuth(); if (!isLoaded) return <div className="min-h-[100dvh] bg-[#233449]" />; return isSignedIn ? <Redirect to="/dashboard" /> : <Landing />; }
function SignInPage() { return <div className="flex min-h-[100dvh] items-center justify-center bg-[#233449] px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>; }
function SignUpPage() { return <div className="flex min-h-[100dvh] items-center justify-center bg-[#233449] px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>; }
function ClerkCacheInvalidator() { const { addListener } = useClerk(); const client = useQueryClient(); const previous = useRef<string | null | undefined>(undefined); useEffect(() => { const unsubscribe = addListener(({ user }) => { const id = user?.id ?? null; if (previous.current !== undefined && previous.current !== id) client.clear(); previous.current = id; }); return unsubscribe; }, [addListener, client]); return null; }
function Protected({ children }: { children: ReactNode }) { const { isLoaded, isSignedIn } = useAuth(); if (!isLoaded) return <div className="min-h-[100dvh] bg-background" />; return isSignedIn ? <>{children}</> : <Redirect to="/sign-in" />; }
function PortalRoutes() { return <Protected><Switch><Route path="/dashboard" component={Dashboard}/><Route path="/products" component={Products}/><Route path="/products/:id" component={ProductDetail}/><Route path="/inventory" component={Inventory}/><Route path="/sales" component={Sales}/><Route path="/amazon" component={AmazonConnection}/><Route path="/purchases"><GenericPage kind="purchases"/></Route><Route path="/suppliers" component={Suppliers}/><Route path="/cash"><GenericPage kind="cash"/></Route><Route path="/expenses"><GenericPage kind="expenses"/></Route><Route path="/import" component={ImportPage}/><Route path="/reports"><GenericPage kind="reports"/></Route><Route path="/alerts" component={Alerts}/><Route path="/settings"><GenericPage kind="settings"/></Route><Route component={NotFound}/></Switch></Protected>; }
function Router() { const [location] = useLocation(); return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={HomeRedirect}/><Route path="/sign-in/*?" component={SignInPage}/><Route path="/sign-up/*?" component={SignUpPage}/><Route component={PortalRoutes}/></Switch></ErrorBoundary>; }
function ClerkApp() { const [, setLocation] = useLocation(); return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: "Entre na sua operação", subtitle: "A clareza financeira da Loja Aurora começa aqui." } }, signUp: { start: { title: "Crie sua conta Margem Clara", subtitle: "Organize sua operação Amazon desde o primeiro SKU." } } }} routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}><QueryClientProvider client={queryClient}><TooltipProvider><ClerkCacheInvalidator/><Router/><Toaster/></TooltipProvider></QueryClientProvider></ClerkProvider>; }
function App() { return <WouterRouter base={basePath}><ClerkApp/></WouterRouter>; }
export default App;
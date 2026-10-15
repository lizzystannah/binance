import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Zap, Shield, BarChart3, ArrowRight, Bot, Globe } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-background/50 backdrop-blur-xl px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary animate-pulse" />
          <span className="font-bold tracking-widest text-xl glow-text">QUANTTERM</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
          <a href="#features" className="hover:text-primary transition-colors">Funcionalidades</a>
          <a href="#automation" className="hover:text-primary transition-colors">Automação</a>
          <a href="#markets" className="hover:text-primary transition-colors">Mercados</a>
        </div>
        <Link to="/trading">
          <Button variant="outline" className="border-primary/50 text-primary hover:bg-primary/10">
            Acessar Plataforma
          </Button>
        </Link>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 opacity-30">
          <img 
            src="/trading_platform_hero_1778016972621.png" 
            alt="Background" 
            className="w-full h-full object-cover mask-gradient-to-b"
          />
        </div>
        
        <div className="max-w-6xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-bold mb-6 animate-fade-in">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            NOVA VERSÃO v0.2 DISPONÍVEL
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent">
            A Próxima Geração do <br />
            <span className="text-primary">Trading Algorítmico</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Domine os Futuros USDT-M na Binance com backtesting realista sobre klines reais, robôs com leverage, TP/SL e gestão de risco.
          </p>
          <div className="flex flex-col md:flex-row items-center justify-center gap-4">
            <Link to="/trading">
              <Button size="lg" className="bg-primary text-primary-foreground font-bold px-8 py-6 text-lg hover:scale-105 transition-transform">
                Começar Agora <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Button size="lg" variant="ghost" className="px-8 py-6 text-lg text-muted-foreground hover:text-white" asChild>
              <Link to="/strategies">Ver Documentação</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-20 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Potência em cada detalhe</h2>
            <p className="text-muted-foreground">Ferramentas avançadas para traders que buscam consistência.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="panel p-8 group hover:border-primary/50 transition-all">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6 text-primary group-hover:scale-110 transition-transform">
                <BarChart3 className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Backtesting Realista</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Simule suas estratégias com dados históricos reais e execução milimétrica para validar sua assertividade.
              </p>
            </div>

            <div className="panel p-8 group hover:border-primary/50 transition-all border-primary/20 bg-primary/5">
              <div className="h-12 w-12 rounded-lg bg-primary/20 flex items-center justify-center mb-6 text-primary group-hover:scale-110 transition-transform">
                <Bot className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Automação Híbrida</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Opere no modo manual, semi-automático ou totalmente automático integrando seu script diretamente com a corretora.
              </p>
            </div>

            <div className="panel p-8 group hover:border-primary/50 transition-all">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6 text-primary group-hover:scale-110 transition-transform">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Gestão de Risco</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Controle absoluto com Stop Loss, Take Profit e filtros de sequência de vitórias/derrotas integrados.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Markets Section */}
      <section id="markets" className="py-20 px-6 bg-secondary/30">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1">
            <h2 className="text-4xl font-bold mb-6">Todos os mercados na palma da sua mão</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="mt-1 h-5 w-5 text-primary shrink-0"><Globe className="h-full w-full" /></div>
                <div>
                  <h4 className="font-bold">Futuros USDT-M</h4>
                  <p className="text-sm text-muted-foreground">BTC, ETH, SOL e altcoins com LONG/SHORT, alavancagem 1-125x e margem isolated/cross.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="mt-1 h-5 w-5 text-primary shrink-0"><BarChart3 className="h-full w-full" /></div>
                <div>
                  <h4 className="font-bold">Spot & Mercado</h4>
                  <p className="text-sm text-muted-foreground">Pares USDT à vista, top movers 24h, funding rates e novas listagens.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 w-full md:w-auto">
            <div className="panel p-2 aspect-video bg-black/40 border-primary/10 relative group overflow-hidden">
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
              <img src="/trading_platform_hero_1778016972621.png" className="w-full h-full object-cover rounded-sm grayscale opacity-50 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-700" alt="Platform" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-glow animate-bounce">
                  <Zap className="h-6 w-6" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-white/5 text-center text-sm text-muted-foreground">
        <div className="mb-6">
          <Zap className="h-5 w-5 text-primary mx-auto mb-2 opacity-50" />
          <p className="font-bold tracking-widest uppercase text-[10px]">QUANTTERM PRO</p>
        </div>
        <p>© 2026 QuantTerm Technologies. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}

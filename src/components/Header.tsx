import React from 'react';
import { motion } from 'motion/react';
import { ShoppingBag, Store, PackageSearch, Briefcase, LayoutGrid } from 'lucide-react';

export type ActiveRoute = 'catalog' | 'shops' | 'shop-detail' | 'tracking' | 'pro' | 'thread';

interface HeaderProps {
  activeRoute: ActiveRoute;
  onNavigate: (route: ActiveRoute) => void;
  cartCount: number;
  onOpenCart: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeRoute,
  onNavigate,
  cartCount,
  onOpenCart,
}) => {
  const navItems: Array<{ id: ActiveRoute; label: string }> = [
    { id: 'catalog', label: 'Parc Matériel' },
    { id: 'shops', label: 'Concessionnaires' },
    { id: 'tracking', label: 'Suivi commande' },
    { id: 'pro', label: 'Espace Pro' },
  ];

  return (
    <>
      <header className="sticky top-0 z-[var(--sim-z-header)] border-b border-[var(--sim-steel-800)] bg-[var(--sim-steel-950)] text-white shadow-[var(--sim-shadow-1)]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-2.5 sm:px-6">
          <button
            type="button"
            onClick={() => onNavigate('catalog')}
            className="inline-flex items-center gap-2 font-display text-2xl font-extrabold tracking-wider uppercase text-white whitespace-nowrap shrink-0 hover:text-[var(--sim-accent-400)] transition-colors"
          >
            <span>SIMCOVA</span>
          </button>

          <nav aria-label="Navigation principale" className="hidden md:flex items-center gap-7">
            {navItems.map((item) => {
              const isActive =
                activeRoute === item.id ||
                (item.id === 'shops' && activeRoute === 'shop-detail');
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`relative py-1.5 text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? 'text-[var(--sim-accent-400)] font-semibold'
                      : 'text-slate-200 hover:text-white'
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <motion.span
                      layoutId="simcova-nav-underline"
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-[var(--sim-accent-400)]"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <motion.button
              type="button"
              onClick={onOpenCart}
              whileTap={{ scale: 0.96 }}
              aria-label={`Ouvrir le panier (${cartCount} article${cartCount > 1 ? 's' : ''})`}
              className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[#F59E0B] px-4 py-2 text-xs font-bold text-[#0F1111] shadow-[var(--sim-shadow-1)] hover:bg-[#D97706] transition-colors whitespace-nowrap shrink-0"
            >
              <ShoppingBag className="w-4 h-4 shrink-0" />
              <span>Panier</span>
              <span className="font-mono-nums text-xs bg-[#0F1111] text-white px-1.5 py-0.5 rounded-[var(--sim-radius-sm)]">
                {cartCount}
              </span>
            </motion.button>
          </div>
        </div>
      </header>

      <nav
        aria-label="Navigation mobile"
        className="fixed bottom-0 inset-x-0 z-[var(--sim-z-header)] flex md:hidden items-center justify-around border-t border-[var(--sim-steel-800)] bg-[var(--sim-steel-950)] h-14 px-2"
      >
        {(
          [
            { id: 'catalog', label: 'Matériel', icon: LayoutGrid, active: activeRoute === 'catalog' },
            {
              id: 'shops',
              label: 'Vendeurs',
              icon: Store,
              active: activeRoute === 'shops' || activeRoute === 'shop-detail',
            },
            {
              id: 'tracking',
              label: 'Suivi',
              icon: PackageSearch,
              active: activeRoute === 'tracking' || activeRoute === 'thread',
            },
            { id: 'pro', label: 'Espace Pro', icon: Briefcase, active: activeRoute === 'pro' },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] px-3 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                item.active ? 'text-[var(--sim-accent-400)] font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              {item.active && (
                <span aria-hidden="true" className="absolute top-0 inset-x-2 h-0.5 bg-[var(--sim-accent-500)]" />
              )}
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
};

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from './connect-button';
import { LayoutDashboard, TrendingUp, DollarSign, Settings } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/performance', label: 'My Performance', icon: TrendingUp },
  { href: '/claim', label: 'Claim Winnings', icon: DollarSign },
  { href: '/settings', label: 'Auto-Copy Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h1>
          {/* Dotted globe/sphere logo icon */}
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="4" r="1.3" fill="var(--accent)" />
            <circle cx="12" cy="5.5" r="1.3" fill="var(--accent)" opacity="0.7" />
            <circle cx="20" cy="5.5" r="1.3" fill="var(--accent)" opacity="0.7" />
            <circle cx="8" cy="8" r="1.3" fill="var(--accent)" opacity="0.5" />
            <circle cx="13" cy="8" r="1.3" fill="var(--accent)" />
            <circle cx="18" cy="8" r="1.3" fill="var(--accent)" />
            <circle cx="24" cy="8" r="1.3" fill="var(--accent)" opacity="0.5" />
            <circle cx="5.5" cy="11" r="1.3" fill="var(--accent)" opacity="0.4" />
            <circle cx="10" cy="11" r="1.3" fill="var(--accent)" opacity="0.8" />
            <circle cx="16" cy="11" r="1.3" fill="var(--accent)" />
            <circle cx="22" cy="11" r="1.3" fill="var(--accent)" opacity="0.8" />
            <circle cx="27" cy="11" r="1.3" fill="var(--accent)" opacity="0.4" />
            <circle cx="4.5" cy="14.5" r="1.3" fill="var(--accent)" opacity="0.35" />
            <circle cx="9" cy="14.5" r="1.3" fill="var(--accent)" opacity="0.9" />
            <circle cx="14" cy="14.5" r="1.3" fill="var(--accent)" />
            <circle cx="19" cy="14.5" r="1.3" fill="var(--accent)" />
            <circle cx="24" cy="14.5" r="1.3" fill="var(--accent)" opacity="0.9" />
            <circle cx="28.5" cy="14.5" r="1.3" fill="var(--accent)" opacity="0.35" />
            <circle cx="4.5" cy="18" r="1.3" fill="var(--accent)" opacity="0.35" />
            <circle cx="9" cy="18" r="1.3" fill="var(--accent)" opacity="0.9" />
            <circle cx="14" cy="18" r="1.3" fill="var(--accent)" />
            <circle cx="19" cy="18" r="1.3" fill="var(--accent)" />
            <circle cx="24" cy="18" r="1.3" fill="var(--accent)" opacity="0.9" />
            <circle cx="28.5" cy="18" r="1.3" fill="var(--accent)" opacity="0.35" />
            <circle cx="5.5" cy="21.5" r="1.3" fill="var(--accent)" opacity="0.4" />
            <circle cx="10" cy="21.5" r="1.3" fill="var(--accent)" opacity="0.8" />
            <circle cx="16" cy="21.5" r="1.3" fill="var(--accent)" />
            <circle cx="22" cy="21.5" r="1.3" fill="var(--accent)" opacity="0.8" />
            <circle cx="27" cy="21.5" r="1.3" fill="var(--accent)" opacity="0.4" />
            <circle cx="8" cy="24.5" r="1.3" fill="var(--accent)" opacity="0.5" />
            <circle cx="13" cy="24.5" r="1.3" fill="var(--accent)" />
            <circle cx="18" cy="24.5" r="1.3" fill="var(--accent)" />
            <circle cx="24" cy="24.5" r="1.3" fill="var(--accent)" opacity="0.5" />
            <circle cx="12" cy="27" r="1.3" fill="var(--accent)" opacity="0.7" />
            <circle cx="20" cy="27" r="1.3" fill="var(--accent)" opacity="0.7" />
            <circle cx="16" cy="28.5" r="1.3" fill="var(--accent)" />
          </svg>
          Followdot
        </h1>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-label">Followdot</div>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <ConnectButton />
      </div>
    </aside>
  );
}

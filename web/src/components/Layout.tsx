import { Bell, BarChart3, Camera, Code2, History, LayoutDashboard, LogOut, Menu, Settings } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';

const nav = [
  { to: '/', label: 'Live overview', icon: LayoutDashboard },
  { to: '/cameras', label: 'Lots & cameras', icon: Camera },
  { to: '/timeline', label: 'Audit timeline', icon: History },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/developer', label: 'Developer API', icon: Code2 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Layout({ username, children }: { username: string; children: ReactNode }) {
  const { connected } = useLive();
  const [open, setOpen] = useState(false);

  const logout = async () => {
    await api.post('/api/auth/logout');
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen lg:pl-60">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button onClick={() => setOpen(!open)} className="rounded p-1 hover:bg-slate-100">
          <Menu className="size-5" />
        </button>
        <span className="font-semibold">LotWatch</span>
      </header>
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-900 text-slate-300 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-400 font-bold text-slate-900">P</div>
          <div>
            <div className="font-semibold text-white">LotWatch</div>
            <div className="text-xs text-slate-400">Parking occupancy</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60 hover:text-white'}`
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-5 py-4 text-xs">
          <div className="mb-3 flex items-center gap-2">
            <span className={`size-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {connected ? 'Live feed connected' : 'Reconnecting…'}
          </div>
          <div className="flex items-center justify-between">
            <span className="truncate text-slate-400">{username}</span>
            <button onClick={logout} className="flex items-center gap-1 text-slate-400 hover:text-white">
              <LogOut className="size-3.5" /> Sign out
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}

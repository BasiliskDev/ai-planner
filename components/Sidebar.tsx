'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/calendar', icon: '📅', label: 'Calendar' },
  { href: '/chat',     icon: '💬', label: 'AI Chat'  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="group flex-shrink-0 w-14 hover:w-52 transition-[width] duration-200 ease-in-out bg-gray-900 flex flex-col pt-3 pb-4 overflow-hidden z-30">
      {navItems.map(({ href, icon, label }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            title={label}
            className={`flex items-center gap-3 mx-2 px-2.5 py-3 rounded-xl mb-1 transition-colors ${
              active
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <span className="text-xl flex-shrink-0 leading-none w-7 text-center">{icon}</span>
            <span className="text-sm font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-75 leading-none">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import App from './App';
import { CashierTerminal } from './components/CashierTerminal';
import { KioskHealthMonitor } from './components/KioskHealthMonitor';

function isAdminRoute(): boolean {
  return new URLSearchParams(window.location.search).get('cashier') === 'true';
}

export const AppRouter: React.FC = () => {
  const isNative = Capacitor.isNativePlatform();
  const [adminRoute, setAdminRoute] = useState(() => isNative || isAdminRoute());

  useEffect(() => {
    if (!isNative) return;

    const url = new URL(window.location.href);
    url.searchParams.set('cashier', 'true');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setAdminRoute(true);
  }, [isNative]);

  if (adminRoute) {
    return (
      <KioskHealthMonitor>
        <CashierTerminal />
      </KioskHealthMonitor>
    );
  }

  return <App />;
};
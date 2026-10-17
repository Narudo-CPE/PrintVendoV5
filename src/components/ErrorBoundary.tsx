import React, { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || 'Component render failed',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Kiosk captured React component error:', error, errorInfo);
  }

  private handleReset = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.location.href = window.location.origin + window.location.pathname;
    } else {
      this.setState({ hasError: false, errorMessage: '' });
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <h1 className="text-xl font-black tracking-tight text-white mb-2">
              Kiosk Display Recovered
            </h1>
            <p className="text-sm text-slate-400 mb-6">
              An unexpected render error occurred. The terminal watchdog preserved system integrity.
            </p>

            {this.state.errorMessage && (
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-left mb-6 overflow-auto max-h-36">
                <p className="text-xs font-mono text-rose-300 break-words">{this.state.errorMessage}</p>
              </div>
            )}

            <button
              onClick={this.handleReset}
              className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
            >
              <RefreshCw className="w-5 h-5" />
              Reset Kiosk to Start Screen
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

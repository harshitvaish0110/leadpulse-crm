import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Catches render errors so one broken widget or page doesn't blank the app.
 * `compact` renders a small inline card for page sections.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[UI] render error:', error, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.compact) {
      return (
        <div role="alert" className="bg-white rounded-xl border border-red-100 p-5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">{this.props.title || 'This section could not be shown'}</p>
            <button onClick={this.reset} className="text-xs text-indigo-600 hover:text-indigo-700 mt-1">Try again</button>
          </div>
        </div>
      );
    }

    return (
      <div role="alert" className="max-w-md mx-auto text-center py-20">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={22} className="text-red-500" />
        </div>
        <h2 className="text-base font-semibold text-gray-900">Something went wrong on this page</h2>
        <p className="text-sm text-gray-500 mt-1">Your data is safe. Try again, or go back and reopen the page.</p>
        <button onClick={this.reset}
          className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
          <RotateCcw size={14} /> Try again
        </button>
      </div>
    );
  }
}
